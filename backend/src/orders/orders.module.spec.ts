import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { MatchingModule } from '../matching/matching.module';
import { MatchingService } from '../matching/matching.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersController } from './orders.controller';
import { OrdersModule } from './orders.module';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

describe('OrdersModule', () => {
  let module: TestingModule;
  const prisma = { order: { count: jest.fn(), findMany: jest.fn() } };

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
        OrdersModule,
        MatchingModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
  });

  afterAll(async () => {
    await module.close();
  });

  it('should wire the orders controller, service and repository', async () => {
    const ordersModule = module.select(OrdersModule);
    expect(ordersModule.get(OrdersController, { strict: true })).toBeInstanceOf(
      OrdersController,
    );
    expect(ordersModule.get(OrdersRepository, { strict: true })).toBeInstanceOf(
      OrdersRepository,
    );
    prisma.order.count.mockResolvedValueOnce(0);
    prisma.order.findMany.mockResolvedValueOnce([]);
    await expect(
      ordersModule
        .get(OrdersService, { strict: true })
        .getActiveOrders('user-1', { page: 1, pageSize: 25 }),
    ).resolves.toEqual({
      items: [],
      pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 },
    });
    expect(prisma.order.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-1' }),
      }),
    );
  });

  it('should make the repository available to the matching worker after removing OrderLockingService', () => {
    const matchingModule = module.select(MatchingModule);
    expect(
      matchingModule.get(MatchingService, { strict: true }),
    ).toBeInstanceOf(MatchingService);
    expect(
      matchingModule.get(OrdersRepository, { strict: true }),
    ).toBeInstanceOf(OrdersRepository);
  });
});
