import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { OrderSide, Prisma } from '@prisma/client';
import { setTimeout as delay } from 'node:timers/promises';
import { configModuleOptions } from '../src/config/config-module-options';
import { MatchingModule } from '../src/matching/matching.module';
import { MatchingService } from '../src/matching/matching.service';
import { OrdersModule } from '../src/orders/orders.module';
import { OrdersService } from '../src/orders/orders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrderMatchingOutboxDispatcherService } from '../src/queue/order-matching-outbox-dispatcher.service';
import { RealtimeOutboxDispatcherService } from '../src/realtime/realtime-outbox-dispatcher.service';
import { RealtimeOutboxService } from '../src/realtime/realtime-outbox.service';

const describeDatabase =
  process.env.RUN_DATABASE_E2E === 'true' ? describe : describe.skip;
const scenarios = [OrderSide.BUY, OrderSide.SELL].flatMap((side) =>
  ['price', 'time'].flatMap((priority) =>
    ['commit', 'rollback'].map((outcome) => ({ side, priority, outcome })),
  ),
);

async function waitUntil(condition: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await delay(20);
  }
  throw new Error('Timed out waiting for matching to wait on cancellation');
}

describeDatabase('Maker priority during concurrent cancellation (e2e)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let matching: MatchingService;
  let orders: OrdersService;
  let outbox: RealtimeOutboxService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(configModuleOptions),
        OrdersModule,
        MatchingModule,
      ],
    })
      .overrideProvider(OrderMatchingOutboxDispatcherService)
      .useValue({ dispatchPending: jest.fn().mockResolvedValue(undefined) })
      .overrideProvider(RealtimeOutboxDispatcherService)
      .useValue({ dispatchPending: jest.fn().mockResolvedValue(undefined) })
      .compile();
    await module.init();
    prisma = module.get(PrismaService);
    matching = module.get(MatchingService);
    orders = module.get(OrdersService);
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

  async function place(username: string, side: OrderSide, price: string) {
    const user = await prisma.user.create({
      data: {
        username,
        wallet: {
          create: {
            availableBtc: '100',
            reservedBtc: '0',
            availableUsd: '100000',
            reservedUsd: '0',
          },
        },
      },
    });
    const order = await orders.createOrder(user.id, side, '1', price);
    return { ...order, userId: user.id };
  }

  async function isBlockedBy(backendPid: number) {
    const [state] = await prisma.$queryRaw<{ blocked: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity AS activity
        WHERE activity.datname = current_database()
          AND ${backendPid}::int = ANY(pg_blocking_pids(activity.pid))
      ) AS blocked
    `;
    return state.blocked;
  }

  it.each(scenarios)(
    '$side $priority $outcome: waits for the first maker and revalidates after cancellation',
    async ({ side, priority, outcome }) => {
      const makerSide = side === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY;
      const firstPrice =
        priority === 'time'
          ? '10000'
          : side === OrderSide.BUY
            ? '9000'
            : '11000';
      const nextPrice =
        priority === 'time'
          ? '10000'
          : side === OrderSide.BUY
            ? '9500'
            : '10500';
      const first = await place('first-maker', makerSide, firstPrice);
      await matching.processOrder(first.id);
      const next = await place('next-maker', makerSide, nextPrice);
      await matching.processOrder(next.id);
      const taker = await place('taker', side, '10000');
      let releaseCancellation!: () => void;
      const cancellationGate = new Promise<void>((resolve) => {
        releaseCancellation = resolve;
      });
      let cancellationPid = 0;
      const failure = new Error('Cancellation event storage failed');
      const originalAppend: RealtimeOutboxService['appendEvents'] =
        outbox.appendEvents.bind(outbox);
      jest
        .spyOn(outbox, 'appendEvents')
        .mockImplementationOnce(async (tx, events) => {
          const [connection] = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid() AS pid
        `;
          cancellationPid = connection.pid;
          await cancellationGate;
          if (outcome === 'rollback') {
            throw failure;
          }
          await originalAppend(tx, events);
        });

      const cancellation = Promise.allSettled([
        orders.cancelOrder(first.userId, first.id),
      ]);
      let processing: Promise<PromiseSettledResult<void>[]> | undefined;
      try {
        await waitUntil(() => cancellationPid !== 0);
        processing = Promise.allSettled([matching.processOrder(taker.id)]);
        await waitUntil(() => isBlockedBy(cancellationPid));
        expect(await prisma.trade.count()).toBe(0);
        expect(
          (await prisma.order.findUniqueOrThrow({ where: { id: taker.id } }))
            .status,
        ).toBe('QUEUED');

        releaseCancellation();
        const [cancelled] = await cancellation;
        if (outcome === 'commit') {
          expect(cancelled.status).toBe('fulfilled');
        } else {
          expect(cancelled).toEqual({ status: 'rejected', reason: failure });
        }
        expect(await processing).toEqual([
          { status: 'fulfilled', value: undefined },
        ]);

        const rolledBack = outcome === 'rollback';
        const executedMaker = rolledBack ? first : next;
        const trades = await prisma.trade.findMany();
        expect(trades).toHaveLength(1);
        expect(trades[0].makerOrderId).toBe(executedMaker.id);
        expect(trades[0].takerOrderId).toBe(taker.id);
        expect(trades[0].price.eq(executedMaker.price)).toBe(true);
        expect(trades[0].amount.toString()).toBe('1');
        const storedFirst = await prisma.order.findUniqueOrThrow({
          where: { id: first.id },
        });
        const storedNext = await prisma.order.findUniqueOrThrow({
          where: { id: next.id },
        });
        expect(storedFirst.status).toBe(rolledBack ? 'FILLED' : 'CANCELLED');
        expect(storedNext.status).toBe(rolledBack ? 'OPEN' : 'FILLED');

        const wallet = await prisma.wallet.findUniqueOrThrow({
          where: { userId: first.userId },
        });
        if (makerSide === OrderSide.SELL) {
          expect(wallet.reservedBtc.toString()).toBe('0');
          expect(wallet.availableBtc.toString()).toBe(
            rolledBack ? '99' : '100',
          );
        } else {
          expect(wallet.reservedUsd.toString()).toBe('0');
          const expectedUsd = new Prisma.Decimal('100000').minus(firstPrice);
          expect(wallet.availableUsd.toString()).toBe(
            rolledBack ? expectedUsd.toString() : '100000',
          );
        }
      } finally {
        releaseCancellation();
        await cancellation;
        await processing;
      }
    },
  );
});
