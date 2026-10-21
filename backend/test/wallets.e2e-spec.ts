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

describeDatabase('Wallet persistence boundaries (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let matchingService: MatchingService;

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
  });

  afterEach(async () => {
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
    return response.body as { accessToken: string };
  }

  function placeOrder(
    accessToken: string,
    side: 'BUY' | 'SELL',
    amount: string,
    price = '10000',
  ) {
    return request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ side, amount, price });
  }

  async function getWallet(accessToken: string) {
    const response = await request(app.getHttpServer())
      .get('/wallet')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    return response.body as {
      availableBtc: string;
      reservedBtc: string;
      availableUsd: string;
      reservedUsd: string;
    };
  }

  it('should require authentication and return only the current owner’s wallet balances', async () => {
    const owner = await login('wallet-owner');
    const other = await login('wallet-other');
    await placeOrder(owner.accessToken, 'BUY', '1').expect(201);
    await request(app.getHttpServer()).get('/wallet').expect(401);
    await expect(getWallet(owner.accessToken)).resolves.toEqual({
      availableBtc: '100.00000000',
      reservedBtc: '0.00000000',
      availableUsd: '90000.00000000',
      reservedUsd: '10000.00000000',
    });
    await expect(getWallet(other.accessToken)).resolves.toEqual({
      availableBtc: '100.00000000',
      reservedBtc: '0.00000000',
      availableUsd: '100000.00000000',
      reservedUsd: '0.00000000',
    });
  });

  it.each([
    [
      'BUY',
      '7',
      'availableUsd',
      'reservedUsd',
      '30000.00000000',
      '70000.00000000',
    ],
    ['SELL', '75', 'availableBtc', 'reservedBtc', '25.00000000', '75.00000000'],
  ] as const)(
    'should prevent concurrent %s orders from reserving more than the available balance',
    async (
      side,
      amount,
      available,
      reserved,
      expectedAvailable,
      expectedReserved,
    ) => {
      const owner = await login(`concurrent-wallet-${side.toLowerCase()}`);
      const responses = await Promise.all([
        placeOrder(owner.accessToken, side, amount),
        placeOrder(owner.accessToken, side, amount),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([
        201, 400,
      ]);
      const wallet = await getWallet(owner.accessToken);
      expect(wallet[available]).toBe(expectedAvailable);
      expect(wallet[reserved]).toBe(expectedReserved);
      await expect(prisma.order.count()).resolves.toBe(1);
    },
  );

  it.each([
    ['BUY', '10', 'availableUsd', 'reservedUsd', '100000.00000000'],
    ['SELL', '100', 'availableBtc', 'reservedBtc', '100.00000000'],
  ] as const)(
    'should allow a %s order that reserves exactly the available balance',
    async (side, amount, available, reserved, expectedReserved) => {
      const owner = await login(`exact-wallet-${side.toLowerCase()}`);
      await placeOrder(owner.accessToken, side, amount).expect(201);
      const wallet = await getWallet(owner.accessToken);
      expect(wallet[available]).toBe('0.00000000');
      expect(wallet[reserved]).toBe(expectedReserved);
    },
  );

  it('should reserve and release a rounded USD cost without losing a balance unit', async () => {
    const owner = await login('rounded-wallet-owner');
    const response = await placeOrder(
      owner.accessToken,
      'BUY',
      '0.1',
      '0.33333333',
    ).expect(201);
    const { id } = response.body as { id: string };
    await expect(getWallet(owner.accessToken)).resolves.toMatchObject({
      availableUsd: '99999.96666667',
      reservedUsd: '0.03333333',
    });
    await request(app.getHttpServer())
      .delete(`/orders/${id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    await expect(getWallet(owner.accessToken)).resolves.toMatchObject({
      availableUsd: '100000.00000000',
      reservedUsd: '0.00000000',
    });
  });

  it('should release only the remaining BTC after partial matching and preserve settled fees', async () => {
    const seller = await login('partial-wallet-seller');
    const buyer = await login('partial-wallet-buyer');
    const sellResponse = await placeOrder(
      seller.accessToken,
      'SELL',
      '0.75',
    ).expect(201);
    const sellOrder = sellResponse.body as { id: string };
    await matchingService.processOrder(sellOrder.id);
    const buyResponse = await placeOrder(
      buyer.accessToken,
      'BUY',
      '0.25',
    ).expect(201);
    const buyOrder = buyResponse.body as { id: string };
    await matchingService.processOrder(buyOrder.id);
    await expect(getWallet(seller.accessToken)).resolves.toMatchObject({
      availableBtc: '99.25000000',
      reservedBtc: '0.50000000',
      availableUsd: '102487.50000000',
    });
    await request(app.getHttpServer())
      .delete(`/orders/${sellOrder.id}`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);
    await expect(getWallet(seller.accessToken)).resolves.toEqual({
      availableBtc: '99.75000000',
      reservedBtc: '0.00000000',
      availableUsd: '102487.50000000',
      reservedUsd: '0.00000000',
    });
    await expect(getWallet(buyer.accessToken)).resolves.toEqual({
      availableBtc: '100.24925000',
      reservedBtc: '0.00000000',
      availableUsd: '97500.00000000',
      reservedUsd: '0.00000000',
    });
  });
});
