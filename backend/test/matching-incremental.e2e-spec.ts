import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { OrderSide, PrismaClient } from '@prisma/client';
import { setTimeout as delay } from 'node:timers/promises';
import { configModuleOptions } from '../src/config/config-module-options';
import { MatchingModule } from '../src/matching/matching.module';
import { MatchingService } from '../src/matching/matching.service';
import { OrdersModule } from '../src/orders/orders.module';
import { OrdersService } from '../src/orders/orders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrderMatchingOutboxDispatcherService } from '../src/queue/order-matching-outbox-dispatcher.service';
import { RealtimeOutboxDispatcherService } from '../src/realtime/realtime-outbox-dispatcher.service';

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
  throw new Error('Timed out waiting for incremental matching');
}

describeDatabase('Incremental maker selection (e2e)', () => {
  let module: TestingModule;
  let prisma: PrismaClient;
  const queries: string[] = [];
  let matching: MatchingService;
  let orders: OrdersService;

  beforeAll(async () => {
    const client = new PrismaClient({
      log: [{ emit: 'event', level: 'query' }],
    });
    client.$on('query', (event) => queries.push(event.query));
    prisma = client;
    await prisma.$connect();
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(configModuleOptions),
        OrdersModule,
        MatchingModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(OrderMatchingOutboxDispatcherService)
      .useValue({ dispatchPending: jest.fn().mockResolvedValue(undefined) })
      .overrideProvider(RealtimeOutboxDispatcherService)
      .useValue({ dispatchPending: jest.fn().mockResolvedValue(undefined) })
      .compile();
    await module.init();
    matching = module.get(MatchingService);
    orders = module.get(OrdersService);
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
    await prisma.$disconnect();
  });

  function candidateReads() {
    return queries.filter(
      (query) => query.includes('"orders"') && query.includes('ORDER BY'),
    );
  }

  async function place(
    username: string,
    side: OrderSide,
    amount: string,
    price: string,
  ) {
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
    const order = await orders.createOrder(user.id, side, amount, price);
    return { ...order, userId: user.id };
  }

  it.each([OrderSide.BUY, OrderSide.SELL])(
    '%s: fills without fetching or waiting for an unnecessary locked maker',
    async (side) => {
      const makerSide = side === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY;
      const firstPrice = side === OrderSide.BUY ? '9000' : '11000';
      const lastPrice = side === OrderSide.BUY ? '9500' : '10500';
      const first = await place('first-maker', makerSide, '1', firstPrice);
      await matching.processOrder(first.id);
      const last = await place('last-maker', makerSide, '1', lastPrice);
      await matching.processOrder(last.id);
      const taker = await place('taker', side, '1', '10000');
      let releaseLast!: () => void;
      const lastGate = new Promise<void>((resolve) => {
        releaseLast = resolve;
      });
      let lastLocked = false;
      const blocker = Promise.allSettled([
        prisma.$transaction(async (tx) => {
          await tx.$queryRaw`
            SELECT "id" FROM "orders" WHERE "id" = ${last.id} FOR UPDATE
          `;
          lastLocked = true;
          await lastGate;
        }),
      ]);
      let processing: Promise<PromiseSettledResult<void>[]> | undefined;
      try {
        await waitUntil(() => lastLocked);
        queries.length = 0;
        processing = Promise.allSettled([matching.processOrder(taker.id)]);
        await waitUntil(
          async () =>
            (await prisma.order.findUniqueOrThrow({ where: { id: taker.id } }))
              .status === 'FILLED',
        );
        expect(await processing).toEqual([
          { status: 'fulfilled', value: undefined },
        ]);
        const reads = candidateReads();
        expect(reads).toHaveLength(1);
        expect(reads[0]).toContain('LIMIT');
        expect(
          (await prisma.order.findUniqueOrThrow({ where: { id: last.id } }))
            .status,
        ).toBe('OPEN');
        const [trade] = await prisma.trade.findMany();
        expect(trade.makerOrderId).toBe(first.id);
      } finally {
        releaseLast();
        await blocker;
        await processing;
      }
    },
  );

  it.each([OrderSide.BUY, OrderSide.SELL])(
    '%s: advances by price and sequence through partial fills and stops at coverage',
    async (side) => {
      const makerSide = side === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY;
      const prices =
        side === OrderSide.BUY
          ? ['9000', '9000', '9500', '10000', '10000']
          : ['11000', '11000', '10500', '10000', '10000'];
      const amounts = ['0.25', '0.25', '0.25', '0.5', '1'];
      const makers: string[] = [];
      for (let index = 0; index < prices.length; index++) {
        const maker = await place(
          `maker-${index}`,
          makerSide,
          amounts[index],
          prices[index],
        );
        await matching.processOrder(maker.id);
        makers.push(maker.id);
      }
      const taker = await place('taker', side, '1', '10000');
      queries.length = 0;

      await matching.processOrder(taker.id);

      const trades = await prisma.trade.findMany({
        orderBy: { sequence: 'asc' },
      });
      expect(trades.map((trade) => trade.makerOrderId)).toEqual(
        makers.slice(0, 4),
      );
      expect(trades.map((trade) => trade.amount.toString())).toEqual([
        '0.25',
        '0.25',
        '0.25',
        '0.25',
      ]);
      const reads = candidateReads();
      expect(reads).toHaveLength(4);
      expect(reads.every((query) => query.includes('LIMIT'))).toBe(true);
      const partial = await prisma.order.findUniqueOrThrow({
        where: { id: makers[3] },
      });
      const untouched = await prisma.order.findUniqueOrThrow({
        where: { id: makers[4] },
      });
      expect(partial.status).toBe('PARTIALLY_FILLED');
      expect(partial.remainingAmount.toString()).toBe('0.25');
      expect(untouched.status).toBe('OPEN');
      expect(untouched.remainingAmount.toString()).toBe('1');
    },
  );

  it('does not count zero-cost fragments toward the taker quantity', async () => {
    const dust = await place('dust-maker', OrderSide.SELL, '2', '0.00000001');
    await matching.processOrder(dust.id);
    const initialBuyer = await place(
      'initial-buyer',
      OrderSide.BUY,
      '1.9',
      '0.00000001',
    );
    await matching.processOrder(initialBuyer.id);
    const next = await place('next-maker', OrderSide.SELL, '0.9', '0.00000100');
    await matching.processOrder(next.id);
    const last = await place('last-maker', OrderSide.SELL, '0.1', '0.00000100');
    await matching.processOrder(last.id);
    const taker = await place('taker', OrderSide.BUY, '1', '0.00000100');
    queries.length = 0;

    await matching.processOrder(taker.id);

    const trades = await prisma.trade.findMany({
      where: { takerOrderId: taker.id },
      orderBy: { sequence: 'asc' },
    });
    expect(trades.map((trade) => trade.makerOrderId)).toEqual([
      next.id,
      last.id,
    ]);
    expect(candidateReads()).toHaveLength(3);
    const storedTaker = await prisma.order.findUniqueOrThrow({
      where: { id: taker.id },
    });
    const storedDust = await prisma.order.findUniqueOrThrow({
      where: { id: dust.id },
    });
    expect(storedTaker.status).toBe('FILLED');
    expect(storedDust.status).toBe('PARTIALLY_FILLED');
    expect(storedDust.remainingAmount.toString()).toBe('0.1');
  });
});
