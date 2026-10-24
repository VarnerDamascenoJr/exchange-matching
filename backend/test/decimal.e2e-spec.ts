import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { MatchingModule } from '../src/matching/matching.module';
import { MatchingService } from '../src/matching/matching.service';
import { PrismaService } from '../src/prisma/prisma.service';

const describeDatabase =
  process.env.RUN_DATABASE_E2E === 'true' ? describe : describe.skip;

describeDatabase('Decimal monetary contract (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let matching: MatchingService;

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
    matching = app.get(MatchingService);
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
    return response.body as { accessToken: string; user: { id: string } };
  }

  function place(
    token: string,
    side: 'BUY' | 'SELL',
    amount: string,
    price: string,
  ) {
    return request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ side, amount, price });
  }

  async function order(
    token: string,
    side: 'BUY' | 'SELL',
    amount: string,
    price: string,
  ) {
    const response = await place(token, side, amount, price).expect(201);
    return response.body as { id: string };
  }

  async function wallet(userId: string) {
    const value = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    return {
      availableUsd: value.availableUsd.toFixed(8),
      reservedUsd: value.reservedUsd.toFixed(8),
      availableBtc: value.availableBtc.toFixed(8),
      reservedBtc: value.reservedBtc.toFixed(8),
    };
  }

  it.each([
    ['0.5', '0.00000001'],
    ['1', '100000000000000000000'],
    ['100000000000000000000', '1'],
    ['99999999999999999999.99999999', '2'],
  ])(
    'rejects %s × %s without persisting an order, reservation or event',
    async (amount, price) => {
      const owner = await login('decimal-invalid');
      const initial = await wallet(owner.user.id);
      const eventCount = await prisma.realtimeEventOutbox.count();
      for (const side of ['BUY', 'SELL'] as const) {
        await place(owner.accessToken, side, amount, price).expect(400);
      }
      expect(await wallet(owner.user.id)).toEqual(initial);
      expect(await prisma.order.count()).toBe(0);
      expect(await prisma.orderMatchingOutbox.count()).toBe(0);
      expect(await prisma.realtimeEventOutbox.count()).toBe(eventCount);
    },
  );

  it('executes the minimum positive cost while allowing rounded zero USD fees', async () => {
    const seller = await login('decimal-min-seller');
    const buyer = await login('decimal-min-buyer');
    const sell = await order(seller.accessToken, 'SELL', '1', '0.00000001');
    await matching.processOrder(sell.id);
    const buy = await order(buyer.accessToken, 'BUY', '1', '0.00000001');
    await matching.processOrder(buy.id);
    const trade = await prisma.trade.findFirstOrThrow();
    expect(trade.amount.toFixed(8)).toBe('1.00000000');
    expect(trade.makerFeeAmount.toFixed(8)).toBe('0.00000000');
    expect((await wallet(seller.user.id)).availableUsd).toBe('100000.00000001');
    expect((await wallet(buyer.user.id)).availableUsd).toBe('99999.99999999');
    expect((await wallet(buyer.user.id)).reservedUsd).toBe('0.00000000');
  });

  it('does not transfer assets when price improvement makes the candidate fill cost zero', async () => {
    const seller = await login('decimal-zero-seller');
    const buyer = await login('decimal-zero-buyer');
    const sell = await order(seller.accessToken, 'SELL', '2', '0.00000001');
    await matching.processOrder(sell.id);
    const buy = await order(buyer.accessToken, 'BUY', '0.5', '1');
    const snapshots = await Promise.all([
      wallet(seller.user.id),
      wallet(buyer.user.id),
    ]);
    await matching.processOrder(buy.id);
    expect(await prisma.trade.count()).toBe(0);
    expect(
      await Promise.all([wallet(seller.user.id), wallet(buyer.user.id)]),
    ).toEqual(snapshots);
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: buy.id } })).status,
    ).toBe('OPEN');
  });

  it.each(['maker', 'taker'] as const)(
    'keeps exact reservations after multiple fills for a BUY %s and leaves dust cancellable',
    async (role) => {
      const buyer = await login('decimal-partial-buyer');
      const sellers = await Promise.all([
        login('decimal-partial-seller1'),
        login('decimal-partial-seller2'),
      ]);
      if (role === 'taker') {
        for (const seller of sellers) {
          const sell = await order(
            seller.accessToken,
            'SELL',
            '0.4',
            '0.00000003',
          );
          await matching.processOrder(sell.id);
        }
      }
      const buy = await order(buyer.accessToken, 'BUY', '1', '0.00000003');
      await matching.processOrder(buy.id);
      if (role === 'maker') {
        for (const seller of sellers) {
          const sell = await order(
            seller.accessToken,
            'SELL',
            '0.4',
            '0.00000003',
          );
          await matching.processOrder(sell.id);
        }
      }
      expect(await prisma.trade.count()).toBe(2);
      const storedBuy = await prisma.order.findUniqueOrThrow({
        where: { id: buy.id },
      });
      expect(storedBuy.status).toBe('PARTIALLY_FILLED');
      expect(storedBuy.remainingAmount.toFixed(8)).toBe('0.20000000');
      const afterFills = await wallet(buyer.user.id);
      expect(afterFills.reservedUsd).toBe('0.00000000');
      expect(afterFills.availableUsd).toBe('99999.99999998');
      expect(afterFills.availableBtc).toBe(
        role === 'maker' ? '100.79600000' : '100.79760000',
      );

      const sellerBalances = await Promise.all(
        sellers.map((seller) => wallet(seller.user.id)),
      );
      for (const balance of sellerBalances) {
        expect(balance.availableUsd).toBe('100000.00000001');
        expect(balance.availableBtc).toBe('99.60000000');
        expect(balance.reservedBtc).toBe('0.00000000');
      }
      const trades = await prisma.trade.findMany();
      const btcFees = trades.reduce(
        (sum, trade) =>
          sum.add(
            trade.makerFeeAsset === 'BTC'
              ? trade.makerFeeAmount
              : trade.takerFeeAmount,
          ),
        new Prisma.Decimal(0),
      );
      const balances = [afterFills, ...sellerBalances];
      expect(
        balances
          .reduce(
            (sum, balance) =>
              sum.add(balance.availableUsd).add(balance.reservedUsd),
            new Prisma.Decimal(0),
          )
          .toFixed(8),
      ).toBe('300000.00000000');
      expect(
        balances
          .reduce(
            (sum, balance) =>
              sum.add(balance.availableBtc).add(balance.reservedBtc),
            btcFees,
          )
          .toFixed(8),
      ).toBe('300.00000000');

      // A valid new SELL order cannot execute the remaining zero-cost BUY fragment.
      const sellDust = await order(
        sellers[0].accessToken,
        'SELL',
        '1',
        '0.00000003',
      );
      await matching.processOrder(sellDust.id);
      expect(await prisma.trade.count()).toBe(2);
      expect(await wallet(buyer.user.id)).toEqual(afterFills);
      await request(app.getHttpServer())
        .delete(`/orders/${buy.id}`)
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .expect(200);
      expect(await wallet(buyer.user.id)).toEqual(afterFills);
      expect(
        (await prisma.order.findUniqueOrThrow({ where: { id: buy.id } }))
          .status,
      ).toBe('CANCELLED');
    },
  );

  it.each(['maker', 'taker'] as const)(
    'releases a positive rounded remainder after a BUY %s partial fill',
    async (role) => {
      const buyer = await login('decimal-cancel-buyer');
      const seller = await login('decimal-cancel-seller');
      let buy: { id: string };
      if (role === 'maker') {
        buy = await order(buyer.accessToken, 'BUY', '0.1', '0.33333333');
        await matching.processOrder(buy.id);
        const sell = await order(
          seller.accessToken,
          'SELL',
          '0.05',
          '0.33333333',
        );
        await matching.processOrder(sell.id);
      } else {
        const sell = await order(
          seller.accessToken,
          'SELL',
          '0.05',
          '0.33333333',
        );
        await matching.processOrder(sell.id);
        buy = await order(buyer.accessToken, 'BUY', '0.1', '0.33333333');
        await matching.processOrder(buy.id);
      }
      expect((await wallet(buyer.user.id)).reservedUsd).toBe('0.01666666');
      await request(app.getHttpServer())
        .delete(`/orders/${buy.id}`)
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .expect(200);
      const balance = await wallet(buyer.user.id);
      expect(balance.reservedUsd).toBe('0.00000000');
      expect(balance.availableUsd).toBe('99999.98333334');
    },
  );

  it('rejects overflowing live balance credits and rolls back settlement', async () => {
    const seller = await login('decimal-overflow-seller');
    const buyer = await login('decimal-overflow-buyer');
    await prisma.wallet.update({
      where: { userId: buyer.user.id },
      data: {
        availableBtc: new Prisma.Decimal('99999999999999999999.99999999'),
      },
    });
    const sell = await order(seller.accessToken, 'SELL', '1', '1');
    await matching.processOrder(sell.id);
    const buy = await order(buyer.accessToken, 'BUY', '1', '1');
    const snapshots = await Promise.all([
      wallet(seller.user.id),
      wallet(buyer.user.id),
    ]);
    await expect(matching.processOrder(buy.id)).rejects.toThrow(
      'numeric bounds',
    );
    expect(await prisma.trade.count()).toBe(0);
    expect(
      await Promise.all([wallet(seller.user.id), wallet(buyer.user.id)]),
    ).toEqual(snapshots);
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: buy.id } })).status,
    ).toBe('QUEUED');
  });
});
