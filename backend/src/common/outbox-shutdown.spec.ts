import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueueModule } from '../queue/queue.module';
import { OrderMatchingOutboxDispatcherService } from '../queue/order-matching-outbox-dispatcher.service';
import { OrderMatchingQueueService } from '../queue/order-matching.queue';
import { RealtimeCoreModule } from '../realtime/realtime-core.module';
import { RealtimeOutboxDispatcherService } from '../realtime/realtime-outbox-dispatcher.service';
import { RealtimePublisherService } from '../realtime/realtime.publisher';

describe('Outbox shutdown lifecycle', () => {
  it('drains both dispatchers before Prisma disconnects or Redis clients close', async () => {
    let acceptPublication!: () => void;
    let acceptEnqueue!: () => void;
    let publicationStarted!: () => void;
    let enqueueStarted!: () => void;
    let destroyStarted!: () => void;
    const publication = new Promise<void>((resolve) => {
      acceptPublication = resolve;
    });
    const enqueue = new Promise<void>((resolve) => {
      acceptEnqueue = resolve;
    });
    const publicationReady = new Promise<void>((resolve) => {
      publicationStarted = resolve;
    });
    const enqueueReady = new Promise<void>((resolve) => {
      enqueueStarted = resolve;
    });
    const destructionReady = new Promise<void>((resolve) => {
      destroyStarted = resolve;
    });
    let realtimeAck = false;
    let matchingAck = false;
    const closedResources: { name: string; drained: boolean }[] = [];
    const seen = new Set<string>();
    const prisma = {
      $queryRaw: jest.fn((sql: Prisma.Sql) => {
        const type = sql.strings.join('').includes('realtime_event_outbox')
          ? 'realtime'
          : 'matching';
        if (seen.has(type)) {
          return Promise.resolve([]);
        }
        seen.add(type);
        return Promise.resolve(
          type === 'realtime'
            ? [
                {
                  id: 'event-1',
                  claim_token: 'claim-1',
                  payload: {
                    type: 'market.changed',
                    reason: 'order-opened',
                    occurredAt: '2026-10-23T18:00:00Z',
                  },
                },
              ]
            : [{ id: 'intent-1', order_id: 'order-1', claim_token: 'claim-1' }],
        );
      }),
      $executeRaw: jest.fn((sql: Prisma.Sql) => {
        if (sql.strings.join('').includes('realtime_event_outbox')) {
          realtimeAck = true;
        } else {
          matchingAck = true;
        }
        return Promise.resolve(1);
      }),
      onModuleDestroy: jest.fn(() => {
        closedResources.push({
          name: 'prisma',
          drained: realtimeAck && matchingAck,
        });
      }),
    };
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ NODE_ENV: 'test', RUN_DATABASE_E2E: false })],
        }),
        QueueModule,
        RealtimeCoreModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(RealtimePublisherService)
      .useValue({
        publishEvent: jest.fn(() => {
          publicationStarted();
          return publication;
        }),
        onApplicationShutdown: () => {
          closedResources.push({
            name: 'publisher',
            drained: realtimeAck && matchingAck,
          });
        },
      })
      .overrideProvider(OrderMatchingQueueService)
      .useValue({
        enqueueProcessOrder: jest.fn(() => {
          enqueueStarted();
          return enqueue;
        }),
        onApplicationShutdown: () => {
          closedResources.push({
            name: 'queue',
            drained: realtimeAck && matchingAck,
          });
        },
      })
      .compile();
    await module.init();
    const realtime = module.get(RealtimeOutboxDispatcherService);
    const matching = module.get(OrderMatchingOutboxDispatcherService);
    const stopRealtime = realtime.onModuleDestroy.bind(
      realtime,
    ) as () => Promise<void>;
    const stopMatching = matching.onModuleDestroy.bind(
      matching,
    ) as () => Promise<void>;
    jest.spyOn(realtime, 'onModuleDestroy').mockImplementation(() => {
      destroyStarted();
      return stopRealtime();
    });
    jest.spyOn(matching, 'onModuleDestroy').mockImplementation(() => {
      destroyStarted();
      return stopMatching();
    });
    const dispatches = Promise.all([
      realtime.dispatchPending(),
      matching.dispatchPending(),
    ]);
    await Promise.all([publicationReady, enqueueReady]);
    const shutdown = module.close();
    await destructionReady;
    const waitedBeforeClosing = closedResources.length === 0;
    acceptPublication();
    acceptEnqueue();
    await Promise.all([dispatches, shutdown]);
    expect(waitedBeforeClosing).toBe(true);
    expect(closedResources).toEqual(
      expect.arrayContaining([
        { name: 'prisma', drained: true },
        { name: 'publisher', drained: true },
        { name: 'queue', drained: true },
      ]),
    );
    jest.restoreAllMocks();
  });
});
