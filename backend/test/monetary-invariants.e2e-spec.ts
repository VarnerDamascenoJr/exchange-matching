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
import {
  assertMonetaryInvariants,
  MonetaryState,
  OpeningBalance,
  units,
} from './support/monetary-invariants';

const describeDatabase =
  process.env.RUN_DATABASE_E2E === 'true' ? describe : describe.skip;
const active = ['QUEUED', 'OPEN', 'PARTIALLY_FILLED'];
const seeds = process.env.INVARIANT_SEED
  ? [Number(process.env.INVARIANT_SEED)]
  : [1, 0x5eed1234, 0xc0ffee, 0xffffffff];
if (
  seeds.some((seed) => !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
) {
  throw new Error('INVARIANT_SEED must be an unsigned 32-bit integer');
}

// Numbers select commands only. Every monetary calculation uses integer units.
function generator(seed: number) {
  let state = seed;
  return (length: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state >>> 16) % length;
  };
}

async function waitFor(predicate: () => Promise<boolean>) {
  const end = Date.now() + 5_000;
  while (Date.now() < end) {
    if (await predicate()) return;
    await delay(20);
  }
  throw new Error('Timed out observing concurrent monetary operations');
}

describeDatabase(
  'Persisted monetary invariants across operation sequences (e2e)',
  () => {
    let module: TestingModule;
    let prisma: PrismaService;
    let orders: OrdersService;
    let matching: MatchingService;
    let opening: OpeningBalance[];

    beforeAll(async () => {
      module = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot(configModuleOptions),
          OrdersModule,
          MatchingModule,
        ],
      })
        // The real-process pipeline suite covers transport. Keep its outbox
        // writes and control processing order for these monetary sequences.
        .overrideProvider(OrderMatchingOutboxDispatcherService)
        .useValue({ dispatchPending: () => Promise.resolve() })
        .overrideProvider(RealtimeOutboxDispatcherService)
        .useValue({ dispatchPending: () => Promise.resolve() })
        .compile();
      await module.init();
      prisma = module.get(PrismaService);
      orders = module.get(OrdersService);
      matching = module.get(MatchingService);
    }, 30_000);

    async function dropFault() {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS monetary_trade_fault ON trades',
      );
      await prisma.$executeRawUnsafe(
        'DROP FUNCTION IF EXISTS monetary_fail_second_fill()',
      );
    }

    async function clear() {
      await dropFault();
      await prisma.realtimeEventOutbox.deleteMany();
      await prisma.orderMatchingOutbox.deleteMany();
      await prisma.trade.deleteMany();
      await prisma.order.deleteMany();
      await prisma.user.deleteMany();
    }

    beforeEach(async () => {
      opening = [];
      await clear();
    });
    afterEach(clear);
    afterAll(async () => module.close());

    async function account(btc = '100', usd = '100000') {
      const user = await prisma.user.create({
        data: {
          username: `invariant-user-${opening.length}`,
          wallet: {
            create: {
              availableBtc: btc,
              reservedBtc: '0',
              availableUsd: usd,
              reservedUsd: '0',
            },
          },
        },
      });
      opening.push({ userId: user.id, btc, usd });
      await audit();
      return user.id;
    }

    async function snapshot(): Promise<MonetaryState> {
      const [wallets, storedOrders, trades] = await prisma.$transaction(
        [
          prisma.wallet.findMany({ orderBy: { id: 'asc' } }),
          prisma.order.findMany({ orderBy: { sequence: 'asc' } }),
          prisma.trade.findMany({ orderBy: { sequence: 'asc' } }),
        ],
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      return {
        wallets: wallets.map((w) => ({
          userId: w.userId,
          availableBtc: w.availableBtc.toFixed(8),
          reservedBtc: w.reservedBtc.toFixed(8),
          availableUsd: w.availableUsd.toFixed(8),
          reservedUsd: w.reservedUsd.toFixed(8),
        })),
        orders: storedOrders.map((o) => ({
          ...o,
          price: o.price.toFixed(8),
          originalAmount: o.originalAmount.toFixed(8),
          remainingAmount: o.remainingAmount.toFixed(8),
        })),
        trades: trades.map((t) => ({
          ...t,
          price: t.price.toFixed(8),
          amount: t.amount.toFixed(8),
          makerFeeRate: t.makerFeeRate.toFixed(8),
          makerFeeAmount: t.makerFeeAmount.toFixed(8),
          takerFeeRate: t.takerFeeRate.toFixed(8),
          takerFeeAmount: t.takerFeeAmount.toFixed(8),
        })),
      };
    }

    async function audit() {
      const state = await snapshot();
      assertMonetaryInvariants(state, opening);
      return state;
    }

    async function place(
      userId: string,
      side: OrderSide,
      amount: string,
      price: string,
    ) {
      const order = await orders.createOrder(userId, side, amount, price);
      await audit();
      return { ...order, userId };
    }

    async function process(id: string) {
      await matching.processOrder(id);
      return audit();
    }

    async function cancel(userId: string, id: string) {
      await orders.cancelOrder(userId, id);
      return audit();
    }

    async function cancelRemaining() {
      for (const order of (await audit()).orders.filter((o) =>
        active.includes(o.status),
      )) {
        await cancel(order.userId, order.id);
      }
      expect(
        (await audit()).wallets.every(
          (w) => units(w.reservedBtc) === 0n && units(w.reservedUsd) === 0n,
        ),
      ).toBe(true);
    }

    it.each([OrderSide.BUY, OrderSide.SELL])(
      '%s: conserves each account across multiple makers, fees, price differences and cancellation',
      async (side) => {
        const users = [
          await account(),
          await account(),
          await account(),
          await account(),
        ];
        const opposite = side === 'BUY' ? OrderSide.SELL : OrderSide.BUY;
        const prices =
          side === 'BUY'
            ? ['9000.33333333', '9001.00000001', '10000']
            : ['11000.33333333', '10999.00000001', '10000'];
        for (let index = 0; index < 3; index++) {
          const maker = await place(
            users[index],
            opposite,
            ['0.12345678', '0.2', '0.3'][index],
            prices[index],
          );
          await process(maker.id);
        }
        const taker = await place(users[3], side, '0.6', '10000');
        const state = await process(taker.id);
        expect(state.trades).toHaveLength(3);
        expect(state.orders.some((o) => o.status === 'PARTIALLY_FILLED')).toBe(
          true,
        );
        expect(
          assertMonetaryInvariants(state, opening).btcFees,
        ).toBeGreaterThan(0n);
        expect(
          assertMonetaryInvariants(state, opening).usdFees,
        ).toBeGreaterThan(0n);
        await cancelRemaining();
        const afterCancellation = await audit();
        expect(await process(taker.id)).toEqual(afterCancellation);
      },
      30_000,
    );

    it.each(
      [OrderSide.BUY, OrderSide.SELL].flatMap((side) => [
        { side, amount: '1', price: '0.00000001' },
        { side, amount: '0.00000001', price: '1' },
      ]),
    )(
      '$side: settles minimum positive consideration for $amount BTC at $price',
      async ({ side, amount, price }) => {
        const makerUser = await account();
        const takerUser = await account();
        const maker = await place(
          makerUser,
          side === 'BUY' ? OrderSide.SELL : OrderSide.BUY,
          amount,
          price,
        );
        await process(maker.id);
        const taker = await place(takerUser, side, amount, price);
        const state = await process(taker.id);
        expect(state.trades).toHaveLength(1);
        expect(assertMonetaryInvariants(state, opening).usdFees).toBe(0n);
        if (amount === '0.00000001')
          expect(assertMonetaryInvariants(state, opening).btcFees).toBe(0n);
      },
    );

    it.each(['maker', 'taker'] as const)(
      'BUY %s: refunds quantization surplus, preserves zero-cost dust and cancels it',
      async (role) => {
        const buyer = await account();
        const sellers = [await account(), await account(), await account()];
        const buy = await place(buyer, OrderSide.BUY, '1', '0.00000003');
        if (role === 'maker') await process(buy.id);
        for (const seller of sellers.slice(0, 2)) {
          const sell = await place(seller, OrderSide.SELL, '0.4', '0.00000003');
          await process(sell.id);
        }
        if (role === 'taker') await process(buy.id);
        const before = await audit();
        expect(before.trades).toHaveLength(2);
        expect(before.orders.find((o) => o.id === buy.id)).toMatchObject({
          status: 'PARTIALLY_FILLED',
          remainingAmount: '0.20000000',
        });
        expect(
          before.wallets.find((w) => w.userId === buyer)?.reservedUsd,
        ).toBe('0.00000000');
        expect(
          before.wallets.find((w) => w.userId === buyer)?.availableUsd,
        ).toBe('99999.99999998');
        const extra = await place(
          sellers[2],
          OrderSide.SELL,
          '1',
          '0.00000003',
        );
        expect((await process(extra.id)).trades).toHaveLength(2);
        const wallets = (await audit()).wallets;
        expect((await cancel(buyer, buy.id)).wallets).toEqual(wallets);
        await cancelRemaining();
      },
    );

    it('keeps large ledger totals exact beyond safe JavaScript integers', async () => {
      const buyer = await account('100', '99999999999999999999.99999999');
      const seller = await account();
      const sell = await place(
        seller,
        OrderSide.SELL,
        '0.00000001',
        '12345678901234567890.12345678',
      );
      await process(sell.id);
      const buy = await place(
        buyer,
        OrderSide.BUY,
        '0.00000001',
        '12345678901234567890.12345678',
      );
      expect((await process(buy.id)).trades).toHaveLength(1);
    });

    it('rolls back an overflowing credit without changing orders, fees or reserves', async () => {
      const buyer = await account('99999999999999999999.99999999');
      const seller = await account();
      const sell = await place(seller, OrderSide.SELL, '1', '1');
      await process(sell.id);
      const buy = await place(buyer, OrderSide.BUY, '1', '1');
      const before = await audit();
      await expect(matching.processOrder(buy.id)).rejects.toThrow(
        'numeric bounds',
      );
      expect(await audit()).toEqual(before);
      await cancelRemaining();
    });

    it('rolls back all preceding fills when the second fill fails, then retries and replays exactly once', async () => {
      const buyer = await account();
      for (let index = 0; index < 2; index++) {
        const seller = await account();
        const sell = await place(seller, OrderSide.SELL, '0.2', '0.33333333');
        await process(sell.id);
      }
      const buy = await place(buyer, OrderSide.BUY, '0.4', '1');
      const before = await audit();
      const eventsBefore = await prisma.realtimeEventOutbox.findMany({
        orderBy: { id: 'asc' },
      });
      await prisma.$executeRawUnsafe(`CREATE FUNCTION monetary_fail_second_fill() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM trades WHERE taker_order_id = NEW.taker_order_id) THEN
          RAISE EXCEPTION 'Injected second-fill failure';
        END IF;
        RETURN NEW;
      END; $$`);
      await prisma.$executeRawUnsafe(
        'CREATE TRIGGER monetary_trade_fault BEFORE INSERT ON trades FOR EACH ROW EXECUTE FUNCTION monetary_fail_second_fill()',
      );
      try {
        await expect(matching.processOrder(buy.id)).rejects.toThrow(
          'Injected second-fill failure',
        );
        expect(await audit()).toEqual(before);
        expect(
          await prisma.realtimeEventOutbox.findMany({ orderBy: { id: 'asc' } }),
        ).toEqual(eventsBefore);
      } finally {
        await dropFault();
      }
      const settled = await process(buy.id);
      expect(settled.trades).toHaveLength(2);
      await Promise.all([
        matching.processOrder(buy.id),
        matching.processOrder(buy.id),
      ]);
      expect(await audit()).toEqual(settled);
    });

    it.each([OrderSide.BUY, OrderSide.SELL])(
      '%s: rejects failed reservations atomically and releases rejected queued orders',
      async (side) => {
        const owner = await account();
        const before = await audit();
        const intents = await prisma.orderMatchingOutbox.count();
        await expect(
          orders.createOrder(
            owner,
            side,
            side === 'BUY' ? '11' : '101',
            '10000',
          ),
        ).rejects.toThrow('Insufficient');
        expect(await audit()).toEqual(before);
        expect(await prisma.orderMatchingOutbox.count()).toBe(intents);
        const queued = await place(owner, side, '0.12345678', '10000.12345678');
        await matching.rejectOrderAfterFailedProcessing(queued.id);
        const rejected = await audit();
        expect(rejected.orders[0].status).toBe('REJECTED');
        expect(rejected.wallets).toEqual(before.wallets);
        await matching.rejectOrderAfterFailedProcessing(queued.id);
        expect(await audit()).toEqual(rejected);
      },
    );

    async function lockOrder(id: string) {
      let release!: () => void;
      let ready!: (pid: number) => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const acquired = new Promise<number>((resolve) => {
        ready = resolve;
      });
      const transaction = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM orders WHERE id = ${id} FOR UPDATE`;
          const [row] = await tx.$queryRaw<
            { pid: number }[]
          >`SELECT pg_backend_pid() AS pid`;
          ready(row.pid);
          await gate;
        },
        { timeout: 30_000 },
      );
      const pid = await Promise.race([
        acquired,
        transaction.then(() => {
          throw new Error('Lock transaction ended early');
        }),
      ]);
      return {
        pid,
        release: async () => {
          release();
          await transaction;
        },
      };
    }

    async function waitingOn(pid: number) {
      const [row] = await prisma.$queryRaw<{ count: number }[]>`
      WITH RECURSIVE blocked(pid) AS (
        SELECT activity.pid FROM pg_stat_activity activity
        WHERE activity.datname = current_database()
          AND ${pid}::int = ANY(pg_blocking_pids(activity.pid))
        UNION
        SELECT activity.pid FROM pg_stat_activity activity
        JOIN blocked ON blocked.pid = ANY(pg_blocking_pids(activity.pid))
        WHERE activity.datname = current_database()
      )
      SELECT COUNT(*)::int AS count FROM blocked
    `;
      return row.count;
    }

    it.each(
      [OrderSide.BUY, OrderSide.SELL].flatMap((side) =>
        ['cancel', 'match'].map((first) => ({ side, first })),
      ),
    )(
      '$side: preserves reservations when $first wins concurrent cancellation and matching',
      async ({ side, first }) => {
        const makerUser = await account();
        const nextUser = await account();
        const takerUser = await account();
        const opposite = side === 'BUY' ? OrderSide.SELL : OrderSide.BUY;
        const maker = await place(
          makerUser,
          opposite,
          '1',
          side === 'BUY' ? '9000' : '11000',
        );
        await process(maker.id);
        const next = await place(
          nextUser,
          opposite,
          '1',
          side === 'BUY' ? '9500' : '10500',
        );
        await process(next.id);
        const taker = await place(takerUser, side, '0.4', '10000');
        const before = await audit();
        const gate = await lockOrder(maker.id);
        const cancelOperation = () => orders.cancelOrder(makerUser, maker.id);
        const matchOperation = () => matching.processOrder(taker.id);
        let firstResult: Promise<PromiseSettledResult<unknown>[]> | undefined;
        let secondResult: Promise<PromiseSettledResult<unknown>[]> | undefined;
        try {
          firstResult = Promise.allSettled([
            (first === 'cancel' ? cancelOperation : matchOperation)(),
          ]);
          await waitFor(async () => (await waitingOn(gate.pid)) >= 1);
          secondResult = Promise.allSettled([
            (first === 'cancel' ? matchOperation : cancelOperation)(),
          ]);
          await waitFor(async () => (await waitingOn(gate.pid)) >= 2);
          expect(await audit()).toEqual(before);
        } finally {
          await gate.release();
          await Promise.all([firstResult, secondResult]);
        }
        const results = await Promise.all([firstResult, secondResult]);
        for (const result of results)
          if (result) expect(result[0].status).toBe('fulfilled');
        const state = await audit();
        expect(state.trades).toHaveLength(1);
        expect(state.trades[0].makerOrderId).toBe(
          first === 'cancel' ? next.id : maker.id,
        );
        expect(state.orders.find((o) => o.id === maker.id)?.status).toBe(
          'CANCELLED',
        );
        await cancelRemaining();
      },
      30_000,
    );

    it('releases a reservation once across duplicate concurrent cancellations', async () => {
      const owner = await account();
      const order = await place(owner, OrderSide.BUY, '0.1', '0.33333333');
      const results = await Promise.allSettled([
        orders.cancelOrder(owner, order.id),
        orders.cancelOrder(owner, order.id),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      const after = await audit();
      expect(after.wallets[0].availableUsd).toBe('100000.00000000');
      expect(await process(order.id)).toEqual(after);
    });

    it.each(seeds)(
      'preserves the ledger after every generated operation (seed=%i)',
      async (seed) => {
        const choose = generator(seed);
        const users = [
          await account(),
          await account(),
          await account(),
          await account(),
        ];
        const amounts = [
          '0.00000001',
          '0.00000003',
          '0.1',
          '0.2',
          '0.33333333',
          '0.5',
          '0.99999999',
          '1',
          '1.9',
          '2',
        ];
        const prices = [
          '0.00000001',
          '0.00000003',
          '0.33333333',
          '1',
          '9000',
          '10000',
          '11000',
        ];
        const trace: string[] = [];
        try {
          // Start with an executable book; subsequent commands are generated.
          const maker = await place(users[0], OrderSide.SELL, '0.5', '1');
          await process(maker.id);
          const taker = await place(users[1], OrderSide.BUY, '0.2', '1');
          await process(taker.id);
          for (let step = 0; step < 64; step++) {
            const state = await audit();
            const action = choose(100);
            const queued = state.orders.filter((o) => o.status === 'QUEUED');
            const live = state.orders.filter((o) => active.includes(o.status));
            const processed = state.orders.filter((o) => o.status !== 'QUEUED');
            if (action < 50 || state.orders.length === 0) {
              const user = users[choose(users.length)];
              const side = choose(2) === 0 ? OrderSide.BUY : OrderSide.SELL;
              const amount = amounts[choose(amounts.length)];
              const price = prices[choose(prices.length)];
              trace.push(
                `${step}: create ${users.indexOf(user)} ${side} ${amount} @ ${price}`,
              );
              const wallet = state.wallets.find((w) => w.userId === user)!;
              const value = (units(amount) * units(price)) / 100_000_000n;
              const affordable =
                side === 'BUY'
                  ? units(wallet.availableUsd) >= value
                  : units(wallet.availableBtc) >= units(amount);
              if (value === 0n || !affordable) {
                await expect(
                  orders.createOrder(user, side, amount, price),
                ).rejects.toThrow();
                expect(await audit()).toEqual(state);
              } else await place(user, side, amount, price);
            } else if (action < 75 && queued.length) {
              const order = queued[choose(queued.length)];
              trace.push(`${step}: process ${order.id}`);
              await process(order.id);
            } else if (action < 90 && live.length) {
              const order = live[choose(live.length)];
              trace.push(`${step}: cancel ${order.id}`);
              await cancel(order.userId, order.id);
            } else if (action < 96 && processed.length) {
              const order = processed[choose(processed.length)];
              trace.push(`${step}: replay ${order.id}`);
              expect(await process(order.id)).toEqual(state);
            } else if (queued.length) {
              const order = queued[choose(queued.length)];
              trace.push(`${step}: reject ${order.id}`);
              await matching.rejectOrderAfterFailedProcessing(order.id);
              await audit();
            }
          }
          for (const order of (await audit()).orders.filter(
            (o) => o.status === 'QUEUED',
          ))
            await process(order.id);
          await cancelRemaining();
          const final = await audit();
          expect(final.trades.length).toBeGreaterThan(0);
          expect(final.orders.every((o) => !active.includes(o.status))).toBe(
            true,
          );
        } catch (error) {
          throw new Error(
            `Monetary sequence failed: INVARIANT_SEED=${seed}\n${trace.join('\n')}`,
            { cause: error },
          );
        }
      },
      60_000,
    );
  },
);
