import { OrderSide, Prisma } from '@prisma/client';
import {
  toMarketMatchSummary,
  toMarketStatsSummary,
  toOrderBookLevel,
} from './market.mapper';

describe('market mapper', () => {
  describe('toMarketStatsSummary', () => {
    it('should format all prices and volumes with eight decimal places', () => {
      expect(
        toMarketStatsSummary({
          lastPrice: new Prisma.Decimal('10000.12345678'),
          btcVolume24h: new Prisma.Decimal('0.00000001'),
          usdVolume24h: new Prisma.Decimal('5000.5'),
          high24h: new Prisma.Decimal('11000'),
          low24h: new Prisma.Decimal('9000'),
          bestBid: new Prisma.Decimal('9900'),
          bestAsk: new Prisma.Decimal('10100'),
        }),
      ).toEqual({
        lastPrice: '10000.12345678',
        btcVolume24h: '0.00000001',
        usdVolume24h: '5000.50000000',
        high24h: '11000.00000000',
        low24h: '9000.00000000',
        bestBid: '9900.00000000',
        bestAsk: '10100.00000000',
      });
    });

    it('should preserve null prices and format zero volumes', () => {
      expect(
        toMarketStatsSummary({
          lastPrice: null,
          btcVolume24h: 0,
          usdVolume24h: 0,
          high24h: null,
          low24h: null,
          bestBid: null,
          bestAsk: null,
        }),
      ).toEqual({
        lastPrice: null,
        btcVolume24h: '0.00000000',
        usdVolume24h: '0.00000000',
        high24h: null,
        low24h: null,
        bestBid: null,
        bestAsk: null,
      });
    });
  });

  describe('toOrderBookLevel', () => {
    it.each([OrderSide.BUY, OrderSide.SELL])(
      'should format decimals and preserve the order count and %s side',
      (side) => {
        expect(
          toOrderBookLevel({
            price: new Prisma.Decimal('99999999999999999999.12345678'),
            amount: new Prisma.Decimal('0.00000001'),
            orderCount: 3,
            side,
          }),
        ).toEqual({
          price: '99999999999999999999.12345678',
          amount: '0.00000001',
          orderCount: 3,
          side,
        });
      },
    );
  });

  describe('toMarketMatchSummary', () => {
    it.each([OrderSide.BUY, OrderSide.SELL])(
      'should format a match with an ISO date and %s taker side',
      (takerSide) => {
        expect(
          toMarketMatchSummary({
            id: 'trade-1',
            price: new Prisma.Decimal('10000.5'),
            amount: new Prisma.Decimal('0.25'),
            takerSide,
            createdAt: new Date('2026-07-14T12:30:00-03:00'),
          }),
        ).toEqual({
          id: 'trade-1',
          price: '10000.50000000',
          amount: '0.25000000',
          takerSide,
          createdAt: '2026-07-14T15:30:00.000Z',
        });
      },
    );
  });
});
