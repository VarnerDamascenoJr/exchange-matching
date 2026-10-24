import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PaginatedResponse } from '../src/common/pagination';
import { MatchingModule } from '../src/matching/matching.module';
import { MatchingService } from '../src/matching/matching.service';
import { PrismaService } from '../src/prisma/prisma.service';

const describeDatabase =
  process.env.RUN_DATABASE_E2E === 'true' ? describe : describe.skip;
const routes = [
  { path: '/orders/active', filter: {}, totalItems: 4 },
  { path: '/market/order-book', filter: { side: 'BUY' }, totalItems: 2 },
  { path: '/market/order-book', filter: { side: 'SELL' }, totalItems: 2 },
  { path: '/market/matches', filter: {}, totalItems: 2 },
  { path: '/trades/history', filter: {}, totalItems: 2 },
];

describeDatabase('Strict pagination contract (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let matching: MatchingService;
  let ownerToken: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule, MatchingModule],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    matching = app.get(MatchingService);
    ownerToken = await login('pagination-owner');
    const makerToken = await login('pagination-maker');
    for (const price of ['100', '200']) {
      await placeAndProcess(makerToken, 'SELL', price);
      await placeAndProcess(ownerToken, 'BUY', price);
    }
    for (const price of ['10', '11']) {
      await placeAndProcess(ownerToken, 'BUY', price);
    }
    for (const price of ['1000', '1001']) {
      await placeAndProcess(ownerToken, 'SELL', price);
    }
  }, 30_000);

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

  async function placeAndProcess(
    token: string,
    side: 'BUY' | 'SELL',
    price: string,
  ) {
    const response = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ side, amount: '0.1', price })
      .expect(201);
    await matching.processOrder((response.body as { id: string }).id);
  }

  describe.each(routes)('$path $filter', ({ path, filter, totalItems }) => {
    function get(query: Record<string, unknown> = {}) {
      return request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${ownerToken}`)
        .query({ ...filter, ...query });
    }

    it.each([{}, { page: '', pageSize: '' }])(
      'preserves defaults and totals for %j',
      async (query) => {
        const response = await get(query).expect(200);
        const result = response.body as PaginatedResponse<unknown>;
        expect(result.items).toHaveLength(totalItems);
        expect(result.pagination).toEqual({
          page: 1,
          pageSize: 25,
          totalItems,
          totalPages: 1,
        });
      },
    );

    it.each([
      ['1', '1'],
      ['2', '1'],
      ['3', '1'],
      ['1', '100'],
      ['0002', '0010'],
      [String(Number.MAX_SAFE_INTEGER), '1'],
      [String(Math.floor(Number.MAX_SAFE_INTEGER / 100) + 1), '100'],
    ])(
      'accepts page=%s, pageSize=%s with consistent results',
      async (page, pageSize) => {
        const response = await get({ page, pageSize }).expect(200);
        const result = response.body as PaginatedResponse<unknown>;
        const expectedPage = Number(page);
        const expectedSize = Number(pageSize);
        const remaining = totalItems - (expectedPage - 1) * expectedSize;
        expect(result.items).toHaveLength(
          Math.max(0, Math.min(expectedSize, remaining)),
        );
        expect(result.pagination).toEqual({
          page: expectedPage,
          pageSize: expectedSize,
          totalItems,
          totalPages: Math.ceil(totalItems / expectedSize),
        });
      },
    );

    it('returns different records on consecutive pages', async () => {
      const first = await get({ page: '1', pageSize: '1' }).expect(200);
      const second = await get({ page: '2', pageSize: '1' }).expect(200);
      expect((first.body as PaginatedResponse<unknown>).items[0]).not.toEqual(
        (second.body as PaginatedResponse<unknown>).items[0],
      );
    });

    describe.each(['page', 'pageSize'])('%s', (field) => {
      it.each(
        [
          '1.5',
          '2abc',
          '1e2',
          '0x10',
          'Infinity',
          '-Infinity',
          'NaN',
          ' ',
          ' 2 ',
          '+2',
          '-1',
          '0',
          '9007199254740992',
          '9007199254740993',
          '99999999999999999999999999999999999999999999',
          ['1', '2'],
        ].map((value) => ({ value })),
      )('rejects $value with HTTP 400', async ({ value }) => {
        await get({ [field]: value }).expect(400);
      });
    });

    it('rejects an out-of-range page size and unsafe calculated offsets', async () => {
      await get({ pageSize: '101' }).expect(400);
      await get({
        page: String(Number.MAX_SAFE_INTEGER),
        pageSize: '100',
      }).expect(400);
      await get({
        page: String(Math.floor(Number.MAX_SAFE_INTEGER / 100) + 2),
        pageSize: '100',
      }).expect(400);
    });
  });
});
