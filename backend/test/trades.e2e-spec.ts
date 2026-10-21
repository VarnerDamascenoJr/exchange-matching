import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { MatchingModule } from '../src/matching/matching.module';
import { MatchingService } from '../src/matching/matching.service';
import { PrismaService } from '../src/prisma/prisma.service';

const describeDatabase =
  process.env.RUN_DATABASE_E2E === 'true' ? describe : describe.skip;

describeDatabase('Trade history persistence (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let matchingService: MatchingService;
  let takerToken: string;
  let makerToken: string;
  let outsiderToken: string;
  let tradeIds: string[];
  const createdAt = '2026-10-15T18:00:00.000Z';

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule, MatchingModule],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    matchingService = app.get(MatchingService);
    takerToken = await login('history-taker');
    makerToken = await login('history-maker');
    outsiderToken = await login('history-outsider');
    await executeTrade('SELL');
    await executeTrade('BUY');
    const trades = await prisma.trade.findMany({
      orderBy: { sequence: 'asc' },
    });
    expect(trades).toHaveLength(2);
    tradeIds = trades.map((trade) => trade.id);
    await prisma.trade.updateMany({ data: { createdAt: new Date(createdAt) } });
  });

  afterAll(async () => {
    await prisma.realtimeEventOutbox.deleteMany();
    await prisma.orderMatchingOutbox.deleteMany();
    await prisma.trade.deleteMany();
    await prisma.order.deleteMany();
    await prisma.user.deleteMany();
    await app.close();
  });

  async function login(username: string) {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username })
      .expect(201);
    return (response.body as { accessToken: string }).accessToken;
  }

  async function executeTrade(makerSide: 'BUY' | 'SELL') {
    const makerResponse = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${makerToken}`)
      .send({ side: makerSide, amount: '0.5', price: '10000' })
      .expect(201);
    await matchingService.processOrder(
      (makerResponse.body as { id: string }).id,
    );
    const takerResponse = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${takerToken}`)
      .send({
        side: makerSide === 'BUY' ? 'SELL' : 'BUY',
        amount: '0.5',
        price: '10000',
      })
      .expect(201);
    await matchingService.processOrder(
      (takerResponse.body as { id: string }).id,
    );
  }

  function history(token: string) {
    return request(app.getHttpServer())
      .get('/trades/history')
      .set('Authorization', `Bearer ${token}`);
  }

  it('should report both taker sides with their own fee amounts and assets', async () => {
    const response = await history(takerToken).expect(200);
    expect(response.body).toEqual({
      items: [
        {
          id: tradeIds[1],
          price: '10000.00000000',
          amount: '0.50000000',
          side: 'SELL',
          role: 'TAKER',
          feeAmount: '15.00000000',
          feeAsset: 'USD',
          createdAt,
        },
        {
          id: tradeIds[0],
          price: '10000.00000000',
          amount: '0.50000000',
          side: 'BUY',
          role: 'TAKER',
          feeAmount: '0.00150000',
          feeAsset: 'BTC',
          createdAt,
        },
      ],
      pagination: { page: 1, pageSize: 25, totalItems: 2, totalPages: 1 },
    });
  });

  it('should report both maker sides with their own fee amounts and assets', async () => {
    const response = await history(makerToken).expect(200);
    expect(response.body).toEqual({
      items: [
        {
          id: tradeIds[1],
          price: '10000.00000000',
          amount: '0.50000000',
          side: 'BUY',
          role: 'MAKER',
          feeAmount: '0.00250000',
          feeAsset: 'BTC',
          createdAt,
        },
        {
          id: tradeIds[0],
          price: '10000.00000000',
          amount: '0.50000000',
          side: 'SELL',
          role: 'MAKER',
          feeAmount: '25.00000000',
          feeAsset: 'USD',
          createdAt,
        },
      ],
      pagination: { page: 1, pageSize: 25, totalItems: 2, totalPages: 1 },
    });
  });

  it('should hide trades from nonparticipants even when their IDs are known', async () => {
    const response = await history(outsiderToken)
      .query({ id: tradeIds[0] })
      .expect(200);
    expect(response.body).toEqual({
      items: [],
      pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 },
    });
  });

  it('should trim and apply an ID prefix to both items and pagination totals', async () => {
    const prefix = tradeIds[0].slice(0, -1);
    const response = await history(takerToken)
      .query({ id: ` ${prefix} ` })
      .expect(200);
    expect(response.body).toMatchObject({
      items: [{ id: tradeIds[0] }],
      pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
    });
  });

  it('should paginate by descending sequence when trade timestamps are equal', async () => {
    const first = await history(takerToken)
      .query({ page: 1, pageSize: 1 })
      .expect(200);
    const second = await history(takerToken)
      .query({ page: 2, pageSize: 1 })
      .expect(200);
    expect(first.body).toMatchObject({
      items: [{ id: tradeIds[1] }],
      pagination: { page: 1, pageSize: 1, totalItems: 2, totalPages: 2 },
    });
    expect(second.body).toMatchObject({
      items: [{ id: tradeIds[0] }],
      pagination: { page: 2, pageSize: 1, totalItems: 2, totalPages: 2 },
    });
  });

  it('should preserve totals for a page beyond the last trade', async () => {
    const response = await history(takerToken)
      .query({ page: 3, pageSize: 1 })
      .expect(200);
    expect(response.body).toEqual({
      items: [],
      pagination: { page: 3, pageSize: 1, totalItems: 2, totalPages: 2 },
    });
  });

  it('should require authentication for persisted trade history', async () => {
    await request(app.getHttpServer()).get('/trades/history').expect(401);
  });
});
