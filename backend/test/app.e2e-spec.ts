import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { MatchingService } from '../src/matching/matching.service';
import { PrismaService } from '../src/prisma/prisma.service';

const describeDatabase =
  process.env.RUN_DATABASE_E2E === 'true' ? describe : describe.skip;

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer()).get('/health').expect(200).expect({
      status: 'ok',
    });
  });

  afterEach(async () => {
    await app.close();
  });
});

describeDatabase('Matching persistence boundaries (e2e)', () => {
  let app: INestApplication<App>;
  let prismaService: PrismaService;
  let matchingService: MatchingService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prismaService = app.get(PrismaService);
    matchingService = app.get(MatchingService);
  });

  afterEach(async () => {
    await prismaService.realtimeEventOutbox.deleteMany();
    await prismaService.orderMatchingOutbox.deleteMany();
    await prismaService.trade.deleteMany();
    await prismaService.order.deleteMany();
    await prismaService.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  it('never matches two opposing orders from the same user', async () => {
    const session = await login(app, 'self-trader');
    const sellOrder = await createOrder(
      app,
      session.accessToken,
      'SELL',
      '1',
      '10000',
    );
    await matchingService.processOrder(sellOrder.id);
    const buyOrder = await createOrder(
      app,
      session.accessToken,
      'BUY',
      '1',
      '10000',
    );

    await matchingService.processOrder(buyOrder.id);

    const [storedSellOrder, storedBuyOrder, tradeCount] = await Promise.all([
      prismaService.order.findUniqueOrThrow({ where: { id: sellOrder.id } }),
      prismaService.order.findUniqueOrThrow({ where: { id: buyOrder.id } }),
      prismaService.trade.count(),
    ]);

    expect(storedSellOrder.status).toBe('OPEN');
    expect(storedBuyOrder.status).toBe('OPEN');
    expect(tradeCount).toBe(0);
  });

  it('persists a single trade when the same queued order is processed concurrently', async () => {
    const seller = await login(app, 'concurrent-seller');
    const buyer = await login(app, 'concurrent-buyer');
    const sellOrder = await createOrder(
      app,
      seller.accessToken,
      'SELL',
      '1',
      '10000',
    );
    await matchingService.processOrder(sellOrder.id);
    const buyOrder = await createOrder(
      app,
      buyer.accessToken,
      'BUY',
      '1',
      '10000',
    );

    await Promise.all([
      matchingService.processOrder(buyOrder.id),
      matchingService.processOrder(buyOrder.id),
    ]);

    const [storedSellOrder, storedBuyOrder, tradeCount, publishedEvents] =
      await Promise.all([
        prismaService.order.findUniqueOrThrow({ where: { id: sellOrder.id } }),
        prismaService.order.findUniqueOrThrow({ where: { id: buyOrder.id } }),
        prismaService.trade.count(),
        prismaService.realtimeEventOutbox.count({
          where: { publishedAt: { not: null } },
        }),
      ]);

    expect(storedSellOrder.status).toBe('FILLED');
    expect(storedBuyOrder.status).toBe('FILLED');
    expect(tradeCount).toBe(1);
    expect(publishedEvents).toBeGreaterThan(0);
  });

  it('rejects a queued order and releases its reserved balance after processing fails', async () => {
    const buyer = await login(app, 'retry-failure-buyer');
    const buyOrder = await createOrder(
      app,
      buyer.accessToken,
      'BUY',
      '1',
      '10000',
    );

    await matchingService.rejectOrderAfterFailedProcessing(buyOrder.id);

    const [storedOrder, wallet] = await Promise.all([
      prismaService.order.findUniqueOrThrow({ where: { id: buyOrder.id } }),
      prismaService.wallet.findFirstOrThrow({
        where: { user: { username: 'retry-failure-buyer' } },
      }),
    ]);

    expect(storedOrder.status).toBe('REJECTED');
    expect(wallet.reservedUsd.toString()).toBe('0');
    expect(wallet.availableUsd.toString()).toBe('100000');
  });
});

async function login(app: INestApplication<App>, username: string) {
  const response = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ username })
    .expect(201);

  return response.body as { accessToken: string };
}

async function createOrder(
  app: INestApplication<App>,
  accessToken: string,
  side: 'BUY' | 'SELL',
  amount: string,
  price: string,
) {
  const response = await request(app.getHttpServer())
    .post('/orders')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ side, amount, price })
    .expect(201);

  return response.body as { id: string };
}
