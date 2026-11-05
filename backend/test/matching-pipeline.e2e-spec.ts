import { OrderStatus, PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { AuthSessionResponse } from '../src/auth/dto/auth-session.response';
import type { OrderSummary } from '../src/orders/order.mapper';
import { ORDER_MATCHING_QUEUE_NAME } from '../src/queue/order-matching.constants';
import type { ProcessOrderJobData } from '../src/queue/order-matching.types';
import type { WalletSummary } from '../src/wallets/wallet.mapper';
import {
  apiPort,
  MatchingProcess,
  waitUntil,
} from './support/matching-process';

const describeDatabase =
  process.env.RUN_DATABASE_E2E === 'true' ? describe : describe.skip;
const docker = promisify(execFile);
const dropFaults = [
  'DROP TRIGGER IF EXISTS pipeline_trade_fault ON trades',
  'DROP TRIGGER IF EXISTS pipeline_outbox_ack_fault ON order_matching_outbox',
  'DROP TRIGGER IF EXISTS pipeline_post_commit_fault ON realtime_event_outbox',
  'DROP FUNCTION IF EXISTS pipeline_fail_trade()',
  'DROP FUNCTION IF EXISTS pipeline_fail_outbox_ack()',
  'DROP FUNCTION IF EXISTS pipeline_hold_post_commit()',
  'DROP TABLE IF EXISTS pipeline_faults',
];

describeDatabase(
  'HTTP → durable intent → BullMQ → matching worker recovery (e2e)',
  () => {
    let prisma: PrismaClient;
    let queue: Queue<ProcessOrderJobData>;
    let api: MatchingProcess;
    let baseURL: string;
    let redisContainer: string;
    let redisPaused = false;
    const children: MatchingProcess[] = [];

    beforeAll(async () => {
      prisma = new PrismaClient();
      await prisma.$connect();
      queue = new Queue<ProcessOrderJobData>(ORDER_MATCHING_QUEUE_NAME, {
        connection: {
          host: process.env.REDIS_HOST,
          port: Number(process.env.REDIS_PORT),
          maxRetriesPerRequest: 0,
          commandTimeout: 2_000,
        },
      });
      // The runner supplies a private Redis. Ignore expected connection errors
      // during the controlled outage; assertions below still fail on lost work.
      queue.on('error', () => undefined);
      const context = JSON.parse(
        await readFile(process.env.E2E_ISOLATION_FILE!, 'utf8'),
      ) as { runId: string };
      redisContainer = `exchange-e2e-${context.runId}-redis-1`;
      for (const sql of dropFaults) await prisma.$executeRawUnsafe(sql);
      const faults = await readFile(
        resolve(__dirname, 'support/matching-pipeline-faults.sql'),
        'utf8',
      );
      for (const sql of faults.split('-- @statement').slice(1))
        await prisma.$executeRawUnsafe(sql);
    }, 30_000);

    beforeEach(async () => {
      await clearFixtures();
      await startAPI();
    }, 40_000);

    afterEach(async () => {
      const restored = await Promise.allSettled(
        redisPaused ? [resumeRedis()] : [],
      );
      const stops = await Promise.allSettled(
        children.splice(0).map((child) => child.stop()),
      );
      const failed = [...restored, ...stops].find(
        (result) => result.status === 'rejected',
      );
      if (failed?.status === 'rejected') throw failed.reason;
      await clearFixtures();
    }, 40_000);

    afterAll(async () => {
      for (const sql of dropFaults) await prisma.$executeRawUnsafe(sql);
      await Promise.all([queue.close(), prisma.$disconnect()]);
    }, 30_000);

    async function clearFixtures() {
      await queue.obliterate({ force: true });
      await prisma.$executeRaw`DELETE FROM pipeline_faults`;
      await prisma.realtimeEventOutbox.deleteMany();
      await prisma.orderMatchingOutbox.deleteMany();
      await prisma.trade.deleteMany();
      await prisma.order.deleteMany();
      await prisma.user.deleteMany();
    }

    async function startAPI() {
      const port = await apiPort();
      baseURL = `http://127.0.0.1:${port}`;
      api = new MatchingProcess('api', {
        PORT: String(port),
        JWT_SECRET: 'pipeline-test-secret',
        JWT_EXPIRES_IN: '1h',
      });
      children.push(api);
      await waitUntil(
        'real HTTP API startup',
        async () => {
          api.assertRunning();
          try {
            return (
              await fetch(`${baseURL}/health`, {
                signal: AbortSignal.timeout(1_000),
              })
            ).ok;
          } catch {
            return false;
          }
        },
        30_000,
      );
    }

    async function startWorker() {
      const worker = new MatchingProcess('worker');
      children.push(worker);
      await worker.ready();
      return worker;
    }

    async function request<T>(
      method: string,
      path: string,
      token?: string,
      body?: unknown,
    ): Promise<T> {
      const response = await fetch(`${baseURL}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok)
        throw new Error(
          `${method} ${path}: ${response.status} ${await response.text()}`,
        );
      return (await response.json()) as T;
    }

    const login = (username: string) =>
      request<AuthSessionResponse>('POST', '/auth/login', undefined, {
        username,
      });
    const create = (
      session: AuthSessionResponse,
      side: 'BUY' | 'SELL',
      amount = '1',
      price = '10000',
    ) =>
      request<OrderSummary>('POST', '/orders', session.accessToken, {
        side,
        amount,
        price,
      });
    const wallet = (session: AuthSessionResponse) =>
      request<WalletSummary>('GET', '/wallet', session.accessToken);

    async function waitForStatus(
      id: string,
      status: OrderStatus,
      timeout = 20_000,
    ) {
      await waitUntil(
        `${id} to become ${status}`,
        async () =>
          (await prisma.order.findUniqueOrThrow({ where: { id } })).status ===
          status,
        timeout,
      );
    }

    async function waitForJob(
      id: string,
      state = 'completed',
      timeout = 20_000,
    ) {
      await waitUntil(
        `${id} job to become ${state}`,
        async () =>
          (await queue.getJob(id))
            ?.getState()
            .then((value) => value === state) ?? false,
        timeout,
      );
      return (await queue.getJob(id))!;
    }

    async function settlementSnapshot() {
      const wallets = await prisma.wallet.findMany({
        orderBy: { userId: 'asc' },
      });
      return {
        wallets: wallets.map((w) => ({
          userId: w.userId,
          availableBtc: w.availableBtc.toFixed(8),
          reservedBtc: w.reservedBtc.toFixed(8),
          availableUsd: w.availableUsd.toFixed(8),
          reservedUsd: w.reservedUsd.toFixed(8),
        })),
        orders: await prisma.order.findMany({
          orderBy: { sequence: 'asc' },
          select: { id: true, status: true, remainingAmount: true },
        }),
        trades: await prisma.trade.findMany({ orderBy: { sequence: 'asc' } }),
      };
    }

    async function fault(subject: string, stage: string) {
      await prisma.$executeRaw`INSERT INTO pipeline_faults (subject_id, stage) VALUES (${subject}, ${stage})`;
    }

    async function clearFaults() {
      await prisma.$executeRaw`DELETE FROM pipeline_faults`;
    }

    async function resumeRedis() {
      await docker('docker', ['unpause', redisContainer], { timeout: 15_000 });
      redisPaused = false;
      await waitUntil(
        'dedicated Redis to respond after the outage',
        async () => {
          try {
            await queue.getJobCounts('waiting');
            return true;
          } catch {
            return false;
          }
        },
        15_000,
      );
    }

    async function simpleTrade(takerSide: 'BUY' | 'SELL' = 'BUY') {
      const seller = await login('pipeline-seller');
      const buyer = await login('pipeline-buyer');
      const maker = await create(
        takerSide === 'BUY' ? seller : buyer,
        takerSide === 'BUY' ? 'SELL' : 'BUY',
      );
      const worker = await startWorker();
      await waitForStatus(maker.id, 'OPEN');
      await waitForJob(maker.id);
      await worker.stop();
      const taker = await create(
        takerSide === 'BUY' ? buyer : seller,
        takerSide,
      );
      expect(taker.status).toBe('QUEUED');
      return {
        seller,
        buyer,
        sell: takerSide === 'BUY' ? maker : taker,
        buy: takerSide === 'BUY' ? taker : maker,
        maker,
        taker,
      };
    }

    async function holdAdvisoryLock(key: string) {
      let release!: () => void;
      let acquired!: () => void;
      const gate = new Promise<void>((resolveGate) => {
        release = resolveGate;
      });
      const ready = new Promise<void>((resolveReady) => {
        acquired = resolveReady;
      });
      const transaction = prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
          acquired();
          await gate;
        },
        { timeout: 120_000 },
      );
      await Promise.race([ready, transaction]);
      return async () => {
        release();
        await transaction;
      };
    }

    async function workerIsBlocked(worker: MatchingProcess) {
      const [state] = await prisma.$queryRaw<{ waiting: number }[]>`
      SELECT COUNT(*)::int AS waiting FROM pg_stat_activity
      WHERE application_name = ${worker.label} AND wait_event_type = 'Lock'
    `;
      return state.waiting > 0;
    }

    it('settles in price-time order across two real workers and ignores completed-job redelivery', async () => {
      const expensive = await login('price-maker');
      const firstCheap = await login('first-cheap-maker');
      const secondCheap = await login('second-cheap-maker');
      const buyer = await login('priority-buyer');
      const older = await create(expensive, 'SELL', '0.5', '10000');
      const first = await create(firstCheap, 'SELL', '0.25', '9000');
      const second = await create(secondCheap, 'SELL', '0.5', '9000');
      await Promise.all([startWorker(), startWorker()]);
      for (const order of [older, first, second])
        await waitForStatus(order.id, 'OPEN');
      expect(await queue.getGlobalConcurrency()).toBe(1);
      const buy = await create(buyer, 'BUY', '1', '10000');
      expect(buy.status).toBe('QUEUED');
      await waitForStatus(buy.id, 'FILLED');
      const job = await waitForJob(buy.id);
      const trades = await prisma.trade.findMany({
        orderBy: { sequence: 'asc' },
      });
      expect(
        trades.map((trade) => [
          trade.makerOrderId,
          trade.amount.toFixed(8),
          trade.price.toFixed(8),
        ]),
      ).toEqual([
        [first.id, '0.25000000', '9000.00000000'],
        [second.id, '0.50000000', '9000.00000000'],
        [older.id, '0.25000000', '10000.00000000'],
      ]);
      expect(trades.map((trade) => trade.makerFeeAmount.toFixed(8))).toEqual([
        '11.25000000',
        '22.50000000',
        '12.50000000',
      ]);
      expect(trades.map((trade) => trade.takerFeeAmount.toFixed(8))).toEqual([
        '0.00075000',
        '0.00150000',
        '0.00075000',
      ]);
      expect(await wallet(buyer)).toEqual({
        availableBtc: '100.99700000',
        reservedBtc: '0.00000000',
        availableUsd: '90750.00000000',
        reservedUsd: '0.00000000',
      });
      expect(await wallet(firstCheap)).toEqual({
        availableBtc: '99.75000000',
        reservedBtc: '0.00000000',
        availableUsd: '102238.75000000',
        reservedUsd: '0.00000000',
      });
      expect(await wallet(secondCheap)).toEqual({
        availableBtc: '99.50000000',
        reservedBtc: '0.00000000',
        availableUsd: '104477.50000000',
        reservedUsd: '0.00000000',
      });
      expect(await wallet(expensive)).toEqual({
        availableBtc: '99.50000000',
        reservedBtc: '0.25000000',
        availableUsd: '102487.50000000',
        reservedUsd: '0.00000000',
      });
      await waitForStatus(older.id, 'PARTIALLY_FILLED');
      const before = await settlementSnapshot();
      const finishedOn = job.finishedOn!;
      await job.retry('completed');
      await waitUntil(
        'redelivered job acknowledgement',
        async () => (await queue.getJob(buy.id))!.finishedOn! > finishedOn,
      );
      await waitForJob(buy.id);
      expect(await settlementSnapshot()).toEqual(before);
    }, 120_000);

    it('recovers a durable enqueue intent after Redis is unavailable and the API is killed and restarted', async () => {
      const buyer = await login('outage-buyer');
      // Pause preserves ephemeral port bindings; stop/start can assign a new
      // host port and would test a changed endpoint instead of an outage.
      await docker('docker', ['pause', redisContainer], {
        timeout: 15_000,
      });
      redisPaused = true;
      const buy = await create(buyer, 'BUY');
      expect(buy.status).toBe('QUEUED');
      const intent = await prisma.orderMatchingOutbox.findUniqueOrThrow({
        where: { orderId: buy.id },
      });
      expect(intent.attemptCount).toBeGreaterThanOrEqual(1);
      expect(intent.nextAttemptAt).toBeInstanceOf(Date);
      await api.stop('SIGKILL');
      await resumeRedis();
      await startAPI();
      await waitForJob(buy.id, 'waiting');
      await startWorker();
      await waitForStatus(buy.id, 'OPEN');
      await waitForJob(buy.id);
      expect(await prisma.orderMatchingOutbox.count()).toBe(0);
      expect(await wallet(buyer)).toEqual({
        availableBtc: '100.00000000',
        reservedBtc: '0.00000000',
        availableUsd: '90000.00000000',
        reservedUsd: '10000.00000000',
      });
      expect(await prisma.trade.count()).toBe(0);
    }, 120_000);

    it('retains an accepted job intent when enqueue acknowledgement fails and deduplicates its replay', async () => {
      const buyer = await login('ack-buyer');
      await fault(buyer.user.id, 'outbox-ack');
      const buy = await create(buyer, 'BUY');
      expect(await queue.getJob(buy.id)).toBeDefined();
      expect(
        await prisma.orderMatchingOutbox.count({ where: { orderId: buy.id } }),
      ).toBe(1);
      await api.stop('SIGKILL');
      await clearFaults();
      await startAPI();
      await waitUntil(
        'matching intent acknowledgement',
        async () => (await prisma.orderMatchingOutbox.count()) === 0,
      );
      expect(await queue.getJobCounts('waiting')).toMatchObject({ waiting: 1 });
      await startWorker();
      await waitForStatus(buy.id, 'OPEN');
      await waitForJob(buy.id);
      expect(await wallet(buyer)).toMatchObject({
        availableUsd: '90000.00000000',
        reservedUsd: '10000.00000000',
      });
      expect(await prisma.trade.count()).toBe(0);
    }, 120_000);

    it.each(['before-commit', 'after-commit'] as const)(
      'recovers a real worker SIGKILL %s through BullMQ stalled detection without double settlement',
      async (boundary) => {
        const { buy, buyer, sell } = await simpleTrade();
        await api.stop();
        if (boundary === 'after-commit') await fault(buy.id, 'after-commit');
        const before = await settlementSnapshot();
        const release = await holdAdvisoryLock(
          boundary === 'before-commit'
            ? 'exchange-matching:BTC/USD'
            : 'pipeline:after-commit',
        );
        try {
          const worker = await startWorker();
          await waitUntil(
            'worker to reach controlled transaction boundary',
            () => workerIsBlocked(worker),
          );
          expect(await (await queue.getJob(buy.id))!.getState()).toBe('active');
          if (boundary === 'after-commit')
            await waitForStatus(buy.id, 'FILLED');
          await worker.stop('SIGKILL');
          if (boundary === 'before-commit')
            expect(await settlementSnapshot()).toEqual(before);
          else expect(await prisma.trade.count()).toBe(1);
        } finally {
          await release();
        }
        await clearFaults();
        const settled =
          boundary === 'after-commit' ? await settlementSnapshot() : undefined;
        await startWorker();
        // Preserve real BullMQ lease/check intervals rather than forcing queue state.
        await waitForJob(buy.id, 'completed', 90_000);
        await waitForStatus(buy.id, 'FILLED');
        await waitForStatus(sell.id, 'FILLED');
        expect(await prisma.trade.count()).toBe(1);
        if (settled) expect(await settlementSnapshot()).toEqual(settled);
        await startAPI();
        expect(await wallet(buyer)).toEqual({
          availableBtc: '100.99700000',
          reservedBtc: '0.00000000',
          availableUsd: '90000.00000000',
          reservedUsd: '0.00000000',
        });
      },
      150_000,
    );

    it('rolls back a transient settlement failure and retries the real job successfully', async () => {
      const { buy, buyer } = await simpleTrade();
      await fault(buy.id, 'trade');
      const before = await settlementSnapshot();
      await startWorker();
      await waitUntil(
        'first failed matching attempt',
        async () => (await queue.getJob(buy.id))!.attemptsMade >= 1,
      );
      await queue.pause();
      expect(await settlementSnapshot()).toEqual(before);
      await clearFaults();
      await queue.resume();
      await waitForStatus(buy.id, 'FILLED');
      const job = await waitForJob(buy.id);
      expect(job.attemptsMade).toBeGreaterThanOrEqual(2);
      expect(await prisma.trade.count()).toBe(1);
      expect(await wallet(buyer)).toMatchObject({
        availableBtc: '100.99700000',
        reservedUsd: '0.00000000',
      });
    }, 120_000);

    it.each(['BUY', 'SELL'] as const)(
      'rejects after the real retry budget is exhausted and returns all %s reservations',
      async (side) => {
        const { taker, maker, buyer, seller } = await simpleTrade(side);
        const owner = side === 'BUY' ? buyer : seller;
        await fault(taker.id, 'trade');
        await startWorker();
        await waitForStatus(taker.id, 'REJECTED');
        const job = await waitForJob(taker.id);
        expect(job.attemptsMade).toBe(3);
        expect(await prisma.trade.count()).toBe(0);
        await waitForStatus(maker.id, 'OPEN');
        expect(await wallet(owner)).toEqual(owner.wallet);
        const active = await request<{ items: unknown[] }>(
          'GET',
          '/orders/active',
          owner.accessToken,
        );
        expect(active.items).toEqual([]);
        expect(
          await prisma.realtimeEventOutbox.count({
            where: { payload: { path: ['reason'], equals: 'order-rejected' } },
          }),
        ).toBe(1);
      },
      120_000,
    );

    it('does not resurrect or debit a QUEUED order cancelled before worker delivery', async () => {
      const { buy, buyer, sell } = await simpleTrade();
      await request('DELETE', `/orders/${buy.id}`, buyer.accessToken);
      expect(await wallet(buyer)).toEqual(buyer.wallet);
      const before = await settlementSnapshot();
      await startWorker();
      const job = await waitForJob(buy.id);
      expect(await settlementSnapshot()).toEqual(before);
      await waitForStatus(buy.id, 'CANCELLED');
      await waitForStatus(sell.id, 'OPEN');
      const finishedOn = job.finishedOn!;
      await job.retry('completed');
      await waitUntil(
        'cancelled order job replay acknowledgement',
        async () => (await queue.getJob(buy.id))!.finishedOn! > finishedOn,
      );
      expect(await settlementSnapshot()).toEqual(before);
      const repair = await readFile(
        resolve(__dirname, '../scripts/restore-matching-intents.sql'),
        'utf8',
      );
      expect(await prisma.$executeRawUnsafe(repair)).toBe(0);
    }, 120_000);

    it('restores a lost acknowledged Redis job from a reviewed QUEUED-order recovery batch', async () => {
      const buyer = await login('lost-job-buyer');
      const buy = await create(buyer, 'BUY');
      const job = await queue.getJob(buy.id);
      expect(job).toBeDefined();
      expect(await prisma.orderMatchingOutbox.count()).toBe(0);
      await api.stop();
      await job!.remove();
      expect(await queue.getJob(buy.id)).toBeUndefined();
      const repair = await readFile(
        resolve(__dirname, '../scripts/restore-matching-intents.sql'),
        'utf8',
      );
      expect(await prisma.$executeRawUnsafe(repair)).toBe(1);
      expect(await prisma.$executeRawUnsafe(repair)).toBe(0);
      await startAPI();
      await startWorker();
      await waitForStatus(buy.id, 'OPEN');
      await waitForJob(buy.id);
      expect(await prisma.orderMatchingOutbox.count()).toBe(0);
      expect(await prisma.$executeRawUnsafe(repair)).toBe(0);
      expect(await wallet(buyer)).toMatchObject({
        availableUsd: '90000.00000000',
        reservedUsd: '10000.00000000',
      });
      expect(await prisma.trade.count()).toBe(0);
    }, 120_000);
  },
);
