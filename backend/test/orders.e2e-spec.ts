import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OrderSide } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { OrdersService } from '../src/orders/orders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RealtimeOutboxService } from '../src/realtime/realtime-outbox.service';

const describeDatabase =
  process.env.RUN_DATABASE_E2E === 'true' ? describe : describe.skip;

describeDatabase('Order persistence boundaries (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let ordersService: OrdersService;
  let outboxService: RealtimeOutboxService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    ordersService = app.get(OrdersService);
    outboxService = app.get(RealtimeOutboxService);
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
    await app.close();
  });

  async function login(username: string) {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username })
      .expect(201);
    const { accessToken } = response.body as { accessToken: string };
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    return { accessToken, userId: user.id };
  }

  async function createBuyOrder(accessToken: string) {
    const response = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ side: 'BUY', amount: '1', price: '10000' })
      .expect(201);
    return response.body as { id: string; updatedAt: string };
  }

  it('should persist a queued order, reserve its balance and record its account event', async () => {
    const user = await login('order-owner');
    const order = await createBuyOrder(user.accessToken);
    const storedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: user.userId },
    });
    expect(storedOrder.status).toBe('QUEUED');
    expect(storedOrder.remainingAmount.toString()).toBe('1');
    expect(wallet.availableUsd.toString()).toBe('90000');
    expect(wallet.reservedUsd.toString()).toBe('10000');
    await expect(
      prisma.realtimeEventOutbox.count({
        where: { eventType: 'account.changed' },
      }),
    ).resolves.toBe(1);
  });

  it('should hide another user’s order from cancellation and preserve its reserved balance', async () => {
    const owner = await login('cancellation-owner');
    const stranger = await login('cancellation-stranger');
    const order = await createBuyOrder(owner.accessToken);
    await request(app.getHttpServer())
      .delete(`/orders/${order.id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .expect(404);
    const storedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: owner.userId },
    });
    expect(storedOrder.status).toBe('QUEUED');
    expect(wallet.reservedUsd.toString()).toBe('10000');
  });

  it('should release the reserved balance only once when cancellations race', async () => {
    const owner = await login('concurrent-cancellation-owner');
    const order = await createBuyOrder(owner.accessToken);
    const responses = await Promise.all([
      request(app.getHttpServer())
        .delete(`/orders/${order.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`),
      request(app.getHttpServer())
        .delete(`/orders/${order.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 400,
    ]);
    const storedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: owner.userId },
    });
    expect(storedOrder.status).toBe('CANCELLED');
    expect(wallet.availableUsd.toString()).toBe('100000');
    expect(wallet.reservedUsd.toString()).toBe('0');
    const successfulResponse = responses.find(
      (response) => response.status === 200,
    );
    expect(successfulResponse?.body).toMatchObject({
      updatedAt: storedOrder.updatedAt.toISOString(),
    });
    await expect(
      prisma.realtimeEventOutbox.count({
        where: { eventType: 'market.changed' },
      }),
    ).resolves.toBe(1);
  });

  it('should roll back the order, reservation and matching outbox when event storage fails', async () => {
    const owner = await login('creation-rollback-owner');
    const failure = new Error('Event storage failed');
    jest.spyOn(outboxService, 'appendEvent').mockRejectedValueOnce(failure);
    await expect(
      ordersService.createOrder(owner.userId, OrderSide.BUY, '1', '10000'),
    ).rejects.toBe(failure);
    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: owner.userId },
    });
    expect(wallet.availableUsd.toString()).toBe('100000');
    expect(wallet.reservedUsd.toString()).toBe('0');
    await expect(prisma.order.count()).resolves.toBe(0);
    await expect(prisma.orderMatchingOutbox.count()).resolves.toBe(0);
    await expect(prisma.realtimeEventOutbox.count()).resolves.toBe(0);
  });

  it('should roll back cancellation and balance release when cancellation events cannot be stored', async () => {
    const owner = await login('cancellation-rollback-owner');
    const order = await createBuyOrder(owner.accessToken);
    const failure = new Error('Cancellation event storage failed');
    jest.spyOn(outboxService, 'appendEvents').mockRejectedValueOnce(failure);
    await expect(
      ordersService.cancelOrder(owner.userId, order.id),
    ).rejects.toBe(failure);
    const storedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: owner.userId },
    });
    expect(storedOrder.status).toBe('QUEUED');
    expect(wallet.availableUsd.toString()).toBe('90000');
    expect(wallet.reservedUsd.toString()).toBe('10000');
    await expect(
      prisma.realtimeEventOutbox.count({
        where: { eventType: 'market.changed' },
      }),
    ).resolves.toBe(0);
  });

  it('should apply owner and ID filtering to active-order pagination', async () => {
    const owner = await login('active-orders-owner');
    const stranger = await login('active-orders-stranger');
    const order = await createBuyOrder(owner.accessToken);
    await createBuyOrder(stranger.accessToken);
    const prefix = order.id.slice(0, -1);
    const response = await request(app.getHttpServer())
      .get('/orders/active')
      .query({ page: 1, pageSize: 1, id: prefix })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(response.body).toMatchObject({
      items: [{ id: order.id, status: 'QUEUED' }],
      pagination: { page: 1, pageSize: 1, totalItems: 1, totalPages: 1 },
    });
  });
});
