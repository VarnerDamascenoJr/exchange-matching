import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { OrderSide, OrderStatus } from '@prisma/client';
import { setTimeout as delay } from 'node:timers/promises';
import { configModuleOptions } from '../src/config/config-module-options';
import { MatchingModule } from '../src/matching/matching.module';
import { MatchingOrderBookService } from '../src/matching/matching-order-book.service';
import { MatchingService } from '../src/matching/matching.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RealtimeOutboxDispatcherService } from '../src/realtime/realtime-outbox-dispatcher.service';
import { RealtimeOutboxService } from '../src/realtime/realtime-outbox.service';

const describeDatabase =
  process.env.RUN_DATABASE_E2E === 'true' ? describe : describe.skip;

async function waitUntil(condition: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await delay(20);
  }
  throw new Error('Timed out waiting for matching transaction lock state');
}

describeDatabase('Matching market transaction lock (e2e)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let matching: MatchingService;
  let orderBook: MatchingOrderBookService;
  let outbox: RealtimeOutboxService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot(configModuleOptions), MatchingModule],
    })
      .overrideProvider(RealtimeOutboxDispatcherService)
      .useValue({ dispatchPending: jest.fn().mockResolvedValue(undefined) })
      .compile();
    await module.init();
    prisma = module.get(PrismaService);
    matching = module.get(MatchingService);
    orderBook = module.get(MatchingOrderBookService);
    outbox = module.get(RealtimeOutboxService);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await prisma.realtimeEventOutbox.deleteMany();
    await prisma.orderMatchingOutbox.deleteMany();
    await prisma.trade.deleteMany();
    await prisma.order.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await module.close();
  });

  async function createQueuedOrder(username: string, side: OrderSide) {
    const user = await prisma.user.create({
      data: {
        username,
        wallet: {
          create: {
            availableBtc: side === OrderSide.SELL ? '99' : '100',
            reservedBtc: side === OrderSide.SELL ? '1' : '0',
            availableUsd: side === OrderSide.BUY ? '90000' : '100000',
            reservedUsd: side === OrderSide.BUY ? '10000' : '0',
          },
        },
      },
    });
    return prisma.order.create({
      data: {
        userId: user.id,
        side,
        status: OrderStatus.QUEUED,
        price: '10000',
        originalAmount: '1',
        remainingAmount: '1',
      },
    });
  }

  async function lockState() {
    const [state] = await prisma.$queryRaw<
      { holders: number; waiters: number; connections: number }[]
    >`
      SELECT
        COUNT(*) FILTER (WHERE granted)::int AS holders,
        COUNT(*) FILTER (WHERE NOT granted)::int AS waiters,
        COUNT(DISTINCT pid)::int AS connections
      FROM pg_locks
      WHERE locktype = 'advisory'
        AND database = (
          SELECT oid FROM pg_database WHERE datname = current_database()
        )
    `;
    return state;
  }

  it.each(['processOrder', 'rejectOrderAfterFailedProcessing'] as const)(
    'serializes direct %s calls behind another order on separate connections',
    async (method) => {
      const sell = await createQueuedOrder('lock-seller', OrderSide.SELL);
      const buy = await createQueuedOrder('lock-buyer', OrderSide.BUY);
      let releaseFirst!: () => void;
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const originalFind: MatchingOrderBookService['findAndLockEligibleMakers'] =
        orderBook.findAndLockEligibleMakers.bind(orderBook);
      const find = jest
        .spyOn(orderBook, 'findAndLockEligibleMakers')
        .mockImplementationOnce(async (transaction, taker) => {
          await firstGate;
          return originalFind(transaction, taker);
        });
      const outcomes: Promise<PromiseSettledResult<void>[]>[] = [];

      try {
        outcomes.push(Promise.allSettled([matching.processOrder(sell.id)]));
        await waitUntil(() => find.mock.calls.length === 1);

        outcomes.push(Promise.allSettled([matching[method](buy.id)]));
        await waitUntil(async () => (await lockState()).waiters === 1);
        expect(await lockState()).toEqual({
          holders: 1,
          waiters: 1,
          connections: 2,
        });
        const orders = await prisma.order.findMany();
        expect(orders).toHaveLength(2);
        expect(
          orders.every((order) => order.status === OrderStatus.QUEUED),
        ).toBe(true);

        releaseFirst();
        expect((await Promise.all(outcomes)).flat()).toEqual([
          { status: 'fulfilled', value: undefined },
          { status: 'fulfilled', value: undefined },
        ]);

        const processing = method === 'processOrder';
        const storedSell = await prisma.order.findUniqueOrThrow({
          where: { id: sell.id },
        });
        const storedBuy = await prisma.order.findUniqueOrThrow({
          where: { id: buy.id },
        });
        const buyerWallet = await prisma.wallet.findUniqueOrThrow({
          where: { userId: buy.userId },
        });
        expect(storedSell.status).toBe(processing ? 'FILLED' : 'OPEN');
        expect(storedBuy.status).toBe(processing ? 'FILLED' : 'REJECTED');
        expect(await prisma.trade.count()).toBe(processing ? 1 : 0);
        expect(buyerWallet.reservedUsd.toString()).toBe('0');
        expect(buyerWallet.availableUsd.toString()).toBe(
          processing ? '90000' : '100000',
        );
        expect(await lockState()).toEqual({
          holders: 0,
          waiters: 0,
          connections: 0,
        });
      } finally {
        releaseFirst();
        await Promise.all(outcomes);
      }
    },
  );

  it('releases the lock on rollback and allows the same order to be retried', async () => {
    const order = await createQueuedOrder('lock-rollback', OrderSide.BUY);
    const failure = new Error('Outbox insertion failed');
    jest.spyOn(outbox, 'appendEvents').mockRejectedValueOnce(failure);

    await expect(matching.processOrder(order.id)).rejects.toBe(failure);

    const stored = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(stored.status).toBe(OrderStatus.QUEUED);
    expect(await prisma.realtimeEventOutbox.count()).toBe(0);
    expect(await lockState()).toEqual({
      holders: 0,
      waiters: 0,
      connections: 0,
    });

    await matching.processOrder(order.id);

    const retried = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(retried.status).toBe(OrderStatus.OPEN);
    expect(await lockState()).toEqual({
      holders: 0,
      waiters: 0,
      connections: 0,
    });
  });
});
