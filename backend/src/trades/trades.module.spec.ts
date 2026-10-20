import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { TradesController } from './trades.controller';
import { TradesModule } from './trades.module';
import { TradesRepository } from './trades.repository';
import { TradesService } from './trades.service';

class HistoryConsumer {
  constructor(readonly tradesService: TradesService) {}
}

describe('TradesModule', () => {
  let module: TestingModule;
  const trade = { count: jest.fn(), findMany: jest.fn() };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              NODE_ENV: 'test',
              JWT_SECRET: 'test-secret',
              JWT_EXPIRES_IN: '1h',
            }),
          ],
        }),
        TradesModule,
      ],
      providers: [
        {
          provide: HistoryConsumer,
          inject: [TradesService],
          useFactory: (service: TradesService) => new HistoryConsumer(service),
        },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({ trade })
      .compile();
  });

  afterAll(async () => {
    await module.close();
  });

  it('should wire the controller and repository and export the history service', () => {
    const tradesModule = module.select(TradesModule);
    expect(tradesModule.get(TradesController, { strict: true })).toBeInstanceOf(
      TradesController,
    );
    expect(tradesModule.get(TradesRepository, { strict: true })).toBeInstanceOf(
      TradesRepository,
    );
    expect(module.get(HistoryConsumer).tradesService).toBe(
      tradesModule.get(TradesService, { strict: true }),
    );
  });

  it('should load history through the exported service, repository and Prisma provider', async () => {
    trade.count.mockResolvedValueOnce(0);
    trade.findMany.mockResolvedValueOnce([]);
    await expect(
      module.get(HistoryConsumer).tradesService.getUserHistory('user-1', 1, 25),
    ).resolves.toEqual({
      items: [],
      pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 },
    });
    expect(trade.count).toHaveBeenCalledWith({
      where: {
        OR: [
          { buyOrder: { userId: 'user-1' } },
          { sellOrder: { userId: 'user-1' } },
        ],
      },
    });
  });
});
