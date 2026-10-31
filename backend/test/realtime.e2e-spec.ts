import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import Redis from 'ioredis';
import { configModuleOptions } from '../src/config/config-module-options';
import { PrismaService } from '../src/prisma/prisma.service';
import { RealtimeCoreModule } from '../src/realtime/realtime-core.module';
import { RealtimeOutboxRepository } from '../src/realtime/realtime-outbox.repository';
import { RealtimeOutboxService } from '../src/realtime/realtime-outbox.service';
import { RealtimeOutboxDispatcherService } from '../src/realtime/realtime-outbox-dispatcher.service';
import { RealtimePublisherService } from '../src/realtime/realtime.publisher';
import {
  REALTIME_EVENTS_CHANNEL,
  REALTIME_OUTBOX_MAX_RETRY_DELAY_MS,
} from '../src/realtime/realtime.constants';
import { RealtimeDispatchEvent } from '../src/realtime/realtime.types';

const describeDatabase =
  process.env.RUN_DATABASE_E2E === 'true' ? describe : describe.skip;
const event: RealtimeDispatchEvent = {
  type: 'market.changed',
  reason: 'order-opened',
  occurredAt: '2026-10-15T18:00:00Z',
  orderId: 'order-1',
};

describeDatabase('Realtime outbox persistence (e2e)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let repository: RealtimeOutboxRepository;
  let outbox: RealtimeOutboxService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot(configModuleOptions), RealtimeCoreModule],
    })
      .overrideProvider(RealtimeOutboxDispatcherService)
      .useValue({})
      .compile();
    await module.init();
    prisma = module.get(PrismaService);
    repository = module.get(RealtimeOutboxRepository);
    outbox = module.get(RealtimeOutboxService);
  });

  afterEach(async () => {
    await prisma.realtimeEventOutbox.deleteMany();
  });
  afterAll(async () => {
    await module.close();
  });

  it('should persist transactional batches as JSON and retain all event fields', async () => {
    const account: RealtimeDispatchEvent = {
      type: 'account.changed',
      reason: 'order-created',
      occurredAt: event.occurredAt,
      userId: 'user-1',
      orderId: 'order-1',
    };
    await prisma.$transaction((client) =>
      outbox.appendEvents(client, [event, account]),
    );
    const rows = await prisma.realtimeEventOutbox.findMany({
      orderBy: { eventType: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      eventType: 'account.changed',
      payload: account,
      attemptCount: 0,
      claimedAt: null,
      publishedAt: null,
    });
    expect(rows[1]).toMatchObject({
      eventType: 'market.changed',
      payload: event,
      attemptCount: 0,
      claimedAt: null,
      publishedAt: null,
    });
  });

  it('should roll back event insertion with the enclosing transaction', async () => {
    const failure = new Error('Order transaction failed');
    await expect(
      prisma.$transaction(async (client) => {
        await outbox.appendEvent(client, event);
        throw failure;
      }),
    ).rejects.toBe(failure);
    await expect(prisma.realtimeEventOutbox.count()).resolves.toBe(0);
  });

  it('should assign disjoint batches to concurrent claimers', async () => {
    await outbox.appendNow(Array.from({ length: 6 }, () => event));
    const [first, second] = await Promise.all([
      repository.claimNextBatch('claim-a', 3, 30),
      repository.claimNextBatch('claim-b', 3, 30),
    ]);
    expect(first).toHaveLength(3);
    expect(second).toHaveLength(3);
    expect(new Set([...first, ...second].map((row) => row.id)).size).toBe(6);
    expect(first.every((row) => row.claim_token === 'claim-a')).toBe(true);
    expect(second.every((row) => row.claim_token === 'claim-b')).toBe(true);
  });

  it('should reclaim expired leases while excluding active, published and dead-lettered events', async () => {
    const now = new Date();
    await prisma.realtimeEventOutbox.createMany({
      data: [
        { id: 'pending', eventType: event.type, payload: event },
        {
          id: 'expired',
          eventType: event.type,
          payload: event,
          claimToken: 'old-token',
          claimedAt: new Date(now.getTime() - 60000),
        },
        {
          id: 'active',
          eventType: event.type,
          payload: event,
          claimToken: 'active-token',
          claimedAt: now,
        },
        {
          id: 'published',
          eventType: event.type,
          payload: event,
          publishedAt: now,
        },
        {
          id: 'dead-letter',
          eventType: event.type,
          payload: event,
          deadLetteredAt: now,
        },
      ],
    });
    const rows = await repository.claimNextBatch('new-token', 50, 30);
    expect(rows.map((row) => row.id).sort()).toEqual(['expired', 'pending']);
    expect(rows.every((row) => row.claim_token === 'new-token')).toBe(true);
  });

  it('should reject stale acknowledgements and releases without changing the current owner’s claim', async () => {
    await outbox.appendNow([event]);
    const [row] = await repository.claimNextBatch('owner-token', 1, 30);
    await repository.markAsPublished(row.id, 'stale-token');
    await repository.releaseClaim(
      row.id,
      'stale-token',
      'Old failure',
      10,
      2000,
      REALTIME_OUTBOX_MAX_RETRY_DELAY_MS,
    );
    await expect(
      prisma.realtimeEventOutbox.findUniqueOrThrow({ where: { id: row.id } }),
    ).resolves.toMatchObject({
      claimToken: 'owner-token',
      attemptCount: 0,
      publishedAt: null,
      lastError: null,
    });
    await repository.markAsPublished(row.id, 'owner-token');
    await expect(
      prisma.realtimeEventOutbox.findUniqueOrThrow({ where: { id: row.id } }),
    ).resolves.toMatchObject({
      claimToken: null,
      claimedAt: null,
      publishedAt: expect.any(Date),
      lastError: null,
    });
  });

  it('should dead-letter an event at the retry threshold and stop reclaiming it', async () => {
    await outbox.appendNow([event]);
    const [first] = await repository.claimNextBatch('claim-1', 1, 30);
    await repository.releaseClaim(
      first.id,
      'claim-1',
      'First failure',
      2,
      0,
      REALTIME_OUTBOX_MAX_RETRY_DELAY_MS,
    );
    await expect(
      prisma.realtimeEventOutbox.findUniqueOrThrow({ where: { id: first.id } }),
    ).resolves.toMatchObject({
      attemptCount: 1,
      claimToken: null,
      claimedAt: null,
      deadLetteredAt: null,
      lastError: 'First failure',
    });
    const [second] = await repository.claimNextBatch('claim-2', 1, 30);
    expect(second.id).toBe(first.id);
    await repository.releaseClaim(
      second.id,
      'claim-2',
      'Second failure',
      2,
      0,
      REALTIME_OUTBOX_MAX_RETRY_DELAY_MS,
    );
    await expect(
      prisma.realtimeEventOutbox.findUniqueOrThrow({ where: { id: first.id } }),
    ).resolves.toMatchObject({
      attemptCount: 2,
      deadLetteredAt: expect.any(Date),
      lastError: 'Second failure',
    });
    await expect(repository.claimNextBatch('claim-3', 50, 30)).resolves.toEqual(
      [],
    );
  });

  it('should prune expired published and dead-lettered rows while preserving pending and recent events', async () => {
    const now = new Date('2026-10-15T18:00:00Z');
    const publishedCutoff = new Date('2026-10-08T18:00:00Z');
    const deadLetterCutoff = new Date('2026-09-15T18:00:00Z');
    await prisma.realtimeEventOutbox.createMany({
      data: [
        {
          id: 'published-expired',
          eventType: event.type,
          payload: event,
          publishedAt: publishedCutoff,
        },
        {
          id: 'published-recent',
          eventType: event.type,
          payload: event,
          publishedAt: now,
        },
        {
          id: 'dead-expired',
          eventType: event.type,
          payload: event,
          deadLetteredAt: deadLetterCutoff,
        },
        {
          id: 'dead-recent',
          eventType: event.type,
          payload: event,
          deadLetteredAt: now,
        },
        {
          id: 'pending-old',
          eventType: event.type,
          payload: event,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
    });
    await repository.pruneExpiredEvents(publishedCutoff, deadLetterCutoff);
    const remaining = await prisma.realtimeEventOutbox.findMany({
      select: { id: true },
    });
    expect(remaining.map((row) => row.id).sort()).toEqual([
      'dead-recent',
      'pending-old',
      'published-recent',
    ]);
  });

  it('should publish a stored event through Redis before acknowledging its outbox claim', async () => {
    const config = module.get(ConfigService);
    const subscriber = new Redis({
      host: config.getOrThrow<string>('REDIS_HOST'),
      port: config.getOrThrow<number>('REDIS_PORT'),
    });
    let timeout: NodeJS.Timeout | undefined;
    try {
      await subscriber.subscribe(REALTIME_EVENTS_CHANNEL);
      const message = new Promise<RealtimeDispatchEvent>((resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Realtime message not received')),
          5000,
        );
        subscriber.once('message', (channel, payload) => {
          if (channel !== REALTIME_EVENTS_CHANNEL) {
            reject(new Error('Unexpected realtime channel'));
            return;
          }
          try {
            resolve(JSON.parse(payload) as RealtimeDispatchEvent);
          } catch (error) {
            reject(
              error instanceof Error
                ? error
                : new Error('Invalid realtime JSON'),
            );
          }
        });
      });
      await outbox.appendNow([event]);
      const dispatcher = new RealtimeOutboxDispatcherService(
        repository,
        config,
        module.get(RealtimePublisherService),
      );
      const [received] = await Promise.all([
        message,
        dispatcher.dispatchPending(),
      ]);
      expect(received).toEqual(event);
      const [row] = await prisma.realtimeEventOutbox.findMany();
      expect(row.publishedAt).toBeInstanceOf(Date);
      expect(row.claimToken).toBeNull();
      expect(row.attemptCount).toBe(0);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      await subscriber.quit();
    }
  });
});
