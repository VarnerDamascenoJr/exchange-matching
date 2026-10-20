import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeCoreModule } from './realtime-core.module';
import { RealtimeOutboxRepository } from './realtime-outbox.repository';
import { RealtimeOutboxService } from './realtime-outbox.service';
import { RealtimeOutboxDispatcherService } from './realtime-outbox-dispatcher.service';
import { RealtimePublisherService } from './realtime.publisher';

class CoreConsumer {
  constructor(
    readonly outbox: RealtimeOutboxService,
    readonly dispatcher: RealtimeOutboxDispatcherService,
    readonly publisher: RealtimePublisherService,
  ) {}
}

describe('RealtimeCoreModule', () => {
  let module: TestingModule;
  const executeRaw = jest.fn();

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ NODE_ENV: 'test', RUN_DATABASE_E2E: false })],
        }),
        RealtimeCoreModule,
      ],
      providers: [
        {
          provide: CoreConsumer,
          inject: [
            RealtimeOutboxService,
            RealtimeOutboxDispatcherService,
            RealtimePublisherService,
          ],
          useFactory: (
            outbox: RealtimeOutboxService,
            dispatcher: RealtimeOutboxDispatcherService,
            publisher: RealtimePublisherService,
          ) => new CoreConsumer(outbox, dispatcher, publisher),
        },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({ $executeRaw: executeRaw })
      .compile();
  });

  afterAll(async () => {
    await module.close();
  });

  it('should export separate outbox, dispatch and publication services without requiring the API module', () => {
    const consumer = module.get(CoreConsumer);
    const core = module.select(RealtimeCoreModule);
    expect(consumer.outbox).toBe(
      core.get(RealtimeOutboxService, { strict: true }),
    );
    expect(consumer.dispatcher).toBe(
      core.get(RealtimeOutboxDispatcherService, { strict: true }),
    );
    expect(consumer.publisher).toBe(
      core.get(RealtimePublisherService, { strict: true }),
    );
    expect(core.get(RealtimeOutboxRepository, { strict: true })).toBeInstanceOf(
      RealtimeOutboxRepository,
    );
  });

  it('should wire event insertion through the outbox service and shared repository', async () => {
    await module.get(CoreConsumer).outbox.appendNow([
      {
        type: 'market.changed',
        reason: 'order-opened',
        occurredAt: '2026-10-15T18:00:00Z',
      },
    ]);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });
});
