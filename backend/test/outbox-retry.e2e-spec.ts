import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { createServer } from 'node:net';
import { configModuleOptions } from '../src/config/config-module-options';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrderMatchingOutboxDispatcherService } from '../src/queue/order-matching-outbox-dispatcher.service';
import { OrderMatchingQueueService } from '../src/queue/order-matching.queue';
import { ORDER_MATCHING_OUTBOX_RETRY_DELAY_MS } from '../src/queue/order-matching.constants';
import { RealtimeOutboxDispatcherService } from '../src/realtime/realtime-outbox-dispatcher.service';
import { RealtimeOutboxRepository } from '../src/realtime/realtime-outbox.repository';
import { RealtimeOutboxService } from '../src/realtime/realtime-outbox.service';
import { RealtimePublisherService } from '../src/realtime/realtime.publisher';
import { REALTIME_OUTBOX_RETRY_DELAY_MS } from '../src/realtime/realtime.constants';
import { RealtimeDispatchEvent } from '../src/realtime/realtime.types';

const describeDatabase =
  process.env.RUN_DATABASE_E2E === 'true' ? describe : describe.skip;
const event: RealtimeDispatchEvent = {
  type: 'market.changed',
  reason: 'order-opened',
  occurredAt: '2026-10-23T18:00:00Z',
};

describeDatabase('Durable outbox retry and recovery (e2e)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let config: ConfigService;
  let repository: RealtimeOutboxRepository;
  let outbox: RealtimeOutboxService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot(configModuleOptions), PrismaModule],
      providers: [RealtimeOutboxRepository, RealtimeOutboxService],
    }).compile();
    await module.init();
    prisma = module.get(PrismaService);
    config = module.get(ConfigService);
    repository = module.get(RealtimeOutboxRepository);
    outbox = module.get(RealtimeOutboxService);
  }, 30_000);

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

  async function createIntents() {
    const owner = await prisma.user.create({
      data: {
        username: 'retry-owner',
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
    for (let index = 0; index < 2; index += 1) {
      await prisma.order.create({
        data: {
          id: `order-${index}`,
          userId: owner.id,
          side: 'BUY',
          status: 'QUEUED',
          price: '1',
          originalAmount: '1',
          remainingAmount: '1',
          matchingOutbox: { create: { id: `intent-${index}` } },
        },
      });
    }
  }

  it('persists realtime retry deadlines across dispatchers while publishing healthy events', async () => {
    await outbox.appendNow([event, event]);
    const publishEvent = jest
      .fn()
      .mockRejectedValueOnce(new Error('Redis unavailable'))
      .mockResolvedValue(undefined);
    const publisher = { publishEvent } as unknown as RealtimePublisherService;
    const dispatcher = new RealtimeOutboxDispatcherService(
      repository,
      config,
      publisher,
    );
    const startedAt = Date.now();
    await dispatcher.dispatchPending();
    const failed = await prisma.realtimeEventOutbox.findFirstOrThrow({
      where: { publishedAt: null },
    });
    expect(failed.attemptCount).toBe(1);
    expect(failed.claimToken).toBeNull();
    expect(failed.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(
      startedAt + REALTIME_OUTBOX_RETRY_DELAY_MS - 1,
    );
    expect(
      await prisma.realtimeEventOutbox.count({
        where: { publishedAt: { not: null } },
      }),
    ).toBe(1);

    // Move database deadlines explicitly instead of waiting on wall-clock time.
    await prisma.realtimeEventOutbox.update({
      where: { id: failed.id },
      data: { nextAttemptAt: new Date(Date.now() + 60_000) },
    });
    const restarted = new RealtimeOutboxDispatcherService(
      new RealtimeOutboxRepository(prisma),
      config,
      publisher,
    );
    await restarted.dispatchPending();
    expect(publishEvent).toHaveBeenCalledTimes(2);
    expect(
      (
        await prisma.realtimeEventOutbox.findUniqueOrThrow({
          where: { id: failed.id },
        })
      ).attemptCount,
    ).toBe(1);

    await prisma.realtimeEventOutbox.update({
      where: { id: failed.id },
      data: { nextAttemptAt: new Date(0) },
    });
    await restarted.dispatchPending();
    expect(publishEvent).toHaveBeenCalledTimes(3);
    expect(
      await prisma.realtimeEventOutbox.findUniqueOrThrow({
        where: { id: failed.id },
      }),
    ).toMatchObject({
      publishedAt: expect.any(Date),
      nextAttemptAt: null,
      claimToken: null,
      lastError: null,
      attemptCount: 1,
    });
  });

  it('keeps a realtime claim recoverable after release persistence fails', async () => {
    await outbox.appendNow([event, event]);
    const publishEvent = jest
      .fn()
      .mockRejectedValueOnce(new Error('Redis unavailable'))
      .mockResolvedValue(undefined);
    jest
      .spyOn(repository, 'releaseClaim')
      .mockRejectedValueOnce(new Error('Database unavailable'));
    const dispatcher = new RealtimeOutboxDispatcherService(repository, config, {
      publishEvent,
    } as unknown as RealtimePublisherService);
    await dispatcher.dispatchPending();
    const failed = await prisma.realtimeEventOutbox.findFirstOrThrow({
      where: { publishedAt: null },
    });
    expect(failed).toMatchObject({
      claimToken: expect.any(String),
      claimedAt: expect.any(Date),
      attemptCount: 0,
    });
    expect(
      await prisma.realtimeEventOutbox.count({
        where: { publishedAt: { not: null } },
      }),
    ).toBe(1);
    await prisma.realtimeEventOutbox.update({
      where: { id: failed.id },
      data: { claimedAt: new Date(0) },
    });
    await dispatcher.dispatchPending();
    expect(
      (
        await prisma.realtimeEventOutbox.findUniqueOrThrow({
          where: { id: failed.id },
        })
      ).publishedAt,
    ).toBeInstanceOf(Date);
  });

  it('persists matching retry deadlines across dispatchers and removes only accepted intents', async () => {
    await createIntents();
    const enqueueProcessOrder = jest
      .fn()
      .mockRejectedValueOnce(new Error('Redis unavailable'))
      .mockResolvedValue(undefined);
    const queue = {
      enqueueProcessOrder,
    } as unknown as OrderMatchingQueueService;
    const dispatcher = new OrderMatchingOutboxDispatcherService(
      prisma,
      config,
      queue,
    );
    const startedAt = Date.now();
    await dispatcher.dispatchPending();
    const failed = await prisma.orderMatchingOutbox.findFirstOrThrow();
    expect(failed.attemptCount).toBe(1);
    expect(failed.claimToken).toBeNull();
    expect(failed.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(
      startedAt + ORDER_MATCHING_OUTBOX_RETRY_DELAY_MS - 1,
    );
    expect(await prisma.orderMatchingOutbox.count()).toBe(1);
    await prisma.orderMatchingOutbox.update({
      where: { id: failed.id },
      data: { nextAttemptAt: new Date(Date.now() + 60_000) },
    });
    const restarted = new OrderMatchingOutboxDispatcherService(
      prisma,
      config,
      queue,
    );
    await restarted.dispatchPending();
    expect(enqueueProcessOrder).toHaveBeenCalledTimes(2);
    await prisma.orderMatchingOutbox.update({
      where: { id: failed.id },
      data: { nextAttemptAt: new Date(0) },
    });
    await restarted.dispatchPending();
    expect(enqueueProcessOrder).toHaveBeenCalledTimes(3);
    expect(await prisma.orderMatchingOutbox.count()).toBe(0);
  });

  it('recovers matching claims by lease expiry when release persistence fails', async () => {
    await createIntents();
    const enqueueProcessOrder = jest
      .fn()
      .mockRejectedValueOnce(new Error('Redis unavailable'))
      .mockResolvedValue(undefined);
    jest
      .spyOn(prisma, '$executeRaw')
      .mockRejectedValueOnce(new Error('Database unavailable'));
    const dispatcher = new OrderMatchingOutboxDispatcherService(
      prisma,
      config,
      { enqueueProcessOrder } as unknown as OrderMatchingQueueService,
    );
    await dispatcher.dispatchPending();
    const failed = await prisma.orderMatchingOutbox.findFirstOrThrow();
    expect(failed).toMatchObject({
      claimToken: expect.any(String),
      claimedAt: expect.any(Date),
      attemptCount: 0,
    });
    await prisma.orderMatchingOutbox.update({
      where: { id: failed.id },
      data: { claimedAt: new Date(0) },
    });
    await dispatcher.dispatchPending();
    expect(enqueueProcessOrder).toHaveBeenCalledTimes(3);
    expect(await prisma.orderMatchingOutbox.count()).toBe(0);
  });

  it.each(['accepted', 'rejected'])(
    'does not overwrite a reassigned matching claim after a stale enqueue is %s',
    async (result) => {
      await createIntents();
      await prisma.orderMatchingOutbox.delete({ where: { id: 'intent-1' } });
      let started!: () => void;
      let accept!: () => void;
      let reject!: (error: Error) => void;
      const enqueueStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      const queueResult = new Promise<void>((resolve, rejectPromise) => {
        accept = resolve;
        reject = rejectPromise;
      });
      const enqueueProcessOrder = jest.fn(() => {
        started();
        return queueResult;
      });
      const dispatcher = new OrderMatchingOutboxDispatcherService(
        prisma,
        config,
        { enqueueProcessOrder } as unknown as OrderMatchingQueueService,
      );
      const dispatch = dispatcher.dispatchPending();
      await enqueueStarted;
      await prisma.orderMatchingOutbox.update({
        where: { id: 'intent-0' },
        data: { claimToken: 'new-owner', claimedAt: new Date() },
      });
      if (result === 'accepted') {
        accept();
      } else {
        reject(new Error('Redis unavailable'));
      }
      await dispatch;
      expect(
        await prisma.orderMatchingOutbox.findUniqueOrThrow({
          where: { id: 'intent-0' },
        }),
      ).toMatchObject({
        claimToken: 'new-owner',
        attemptCount: 0,
        lastError: null,
        nextAttemptAt: null,
      });
    },
  );

  it.each(['realtime', 'matching'] as const)(
    'recovers the real %s producer after Redis is unavailable at connection startup',
    async (kind) => {
      const server = createServer();
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Missing ephemeral TCP port');
      }
      let redisPort = address.port;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      const producerConfig = {
        get: config.get.bind(config),
        getOrThrow: (key: string) =>
          key === 'REDIS_PORT' ? redisPort : config.getOrThrow<unknown>(key),
      } as unknown as ConfigService;
      const publisher = new RealtimePublisherService(producerConfig);
      const queue = new OrderMatchingQueueService(producerConfig);
      try {
        if (kind === 'realtime') {
          await outbox.appendNow([event]);
          const dispatcher = new RealtimeOutboxDispatcherService(
            repository,
            config,
            publisher,
          );
          await dispatcher.dispatchPending();
          expect(
            await prisma.realtimeEventOutbox.findFirstOrThrow(),
          ).toMatchObject({ attemptCount: 1, publishedAt: null });
          redisPort = config.getOrThrow<number>('REDIS_PORT');
          await prisma.realtimeEventOutbox.updateMany({
            data: { nextAttemptAt: new Date(0) },
          });
          await dispatcher.dispatchPending();
          expect(
            (await prisma.realtimeEventOutbox.findFirstOrThrow()).publishedAt,
          ).toBeInstanceOf(Date);
        } else {
          await createIntents();
          await prisma.orderMatchingOutbox.delete({
            where: { id: 'intent-1' },
          });
          const dispatcher = new OrderMatchingOutboxDispatcherService(
            prisma,
            config,
            queue,
          );
          await dispatcher.dispatchPending();
          expect(
            await prisma.orderMatchingOutbox.findFirstOrThrow(),
          ).toMatchObject({ attemptCount: 1 });
          redisPort = config.getOrThrow<number>('REDIS_PORT');
          await prisma.orderMatchingOutbox.updateMany({
            data: { nextAttemptAt: new Date(0) },
          });
          await dispatcher.dispatchPending();
          expect(await prisma.orderMatchingOutbox.count()).toBe(0);
        }
      } finally {
        await publisher.onApplicationShutdown();
        await queue.onApplicationShutdown();
      }
    },
    30_000,
  );
});
