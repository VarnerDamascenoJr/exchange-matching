import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeModule } from './realtime.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeSubscriberService } from './realtime.subscriber';
import { RealtimeOutboxService } from './realtime-outbox.service';
import { RealtimeOutboxDispatcherService } from './realtime-outbox-dispatcher.service';

class ApiConsumer {
  constructor(
    readonly gateway: RealtimeGateway,
    readonly outbox: RealtimeOutboxService,
    readonly dispatcher: RealtimeOutboxDispatcherService,
  ) {}
}

describe('RealtimeModule', () => {
  let module: TestingModule;
  const queryRaw = jest.fn();

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              NODE_ENV: 'test',
              RUN_DATABASE_E2E: false,
              JWT_SECRET: 'test-secret',
              JWT_EXPIRES_IN: '1h',
            }),
          ],
        }),
        RealtimeModule,
      ],
      providers: [
        {
          provide: ApiConsumer,
          inject: [
            RealtimeGateway,
            RealtimeOutboxService,
            RealtimeOutboxDispatcherService,
          ],
          useFactory: (
            gateway: RealtimeGateway,
            outbox: RealtimeOutboxService,
            dispatcher: RealtimeOutboxDispatcherService,
          ) => new ApiConsumer(gateway, outbox, dispatcher),
        },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: queryRaw })
      .compile();
  });

  afterAll(async () => {
    await module.close();
  });

  it('should wire the gateway and subscriber while re-exporting the core services', () => {
    const consumer = module.get(ApiConsumer);
    expect(consumer.gateway).toBe(
      module.select(RealtimeModule).get(RealtimeGateway, { strict: true }),
    );
    expect(consumer.outbox).toBeInstanceOf(RealtimeOutboxService);
    expect(consumer.dispatcher).toBeInstanceOf(RealtimeOutboxDispatcherService);
    expect(module.get(RealtimeSubscriberService)).toBeInstanceOf(
      RealtimeSubscriberService,
    );
  });

  it('should initialize in unit-test mode without polling the database or opening Redis subscriptions', async () => {
    await module.init();
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
