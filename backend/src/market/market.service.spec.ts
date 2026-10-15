import { BadRequestException } from '@nestjs/common';
import { OrderSide, Prisma } from '@prisma/client';
import { MarketRepository } from './market.repository';
import { MarketService } from './market.service';

describe('MarketService', () => {
  let service: MarketService;
  let repository: jest.Mocked<MarketRepository>;

  beforeEach(() => {
    repository = {
      findStats: jest.fn(),
      findOrderBookLevels: jest.fn(),
      findMatches: jest.fn(),
    } as unknown as jest.Mocked<MarketRepository>;
    service = new MarketService(repository);
  });

  it('should reject invalid price filters before querying the repository', async () => {
    await expect(
      service.getOrderBook({
        side: OrderSide.BUY,
        page: 1,
        pageSize: 25,
        price: 'abc',
      }),
    ).rejects.toEqual(new BadRequestException('price must be a valid decimal'));
    expect(repository.findOrderBookLevels).not.toHaveBeenCalled();
  });

  it('should return zero volumes and null prices for an empty market', async () => {
    repository.findStats.mockResolvedValueOnce({
      lastTrade: null,
      tradeStats: undefined,
      bestBid: null,
      bestAsk: null,
    });
    await expect(service.getStats()).resolves.toEqual({
      lastPrice: null,
      btcVolume24h: '0.00000000',
      usdVolume24h: '0.00000000',
      high24h: null,
      low24h: null,
      bestBid: null,
      bestAsk: null,
    });
  });

  it('should map repository statistics into the market response', async () => {
    repository.findStats.mockResolvedValueOnce({
      lastTrade: { price: new Prisma.Decimal('10000') },
      tradeStats: {
        btc_volume_24h: new Prisma.Decimal('0.5'),
        usd_volume_24h: new Prisma.Decimal('5000'),
        high_24h: new Prisma.Decimal('11000'),
        low_24h: new Prisma.Decimal('9000'),
      },
      bestBid: { price: new Prisma.Decimal('9900') },
      bestAsk: { price: new Prisma.Decimal('10100') },
    });
    await expect(service.getStats()).resolves.toEqual({
      lastPrice: '10000.00000000',
      btcVolume24h: '0.50000000',
      usdVolume24h: '5000.00000000',
      high24h: '11000.00000000',
      low24h: '9000.00000000',
      bestBid: '9900.00000000',
      bestAsk: '10100.00000000',
    });
  });

  it('should validate the price and paginate formatted order book levels', async () => {
    repository.findOrderBookLevels.mockResolvedValueOnce({
      levels: [
        {
          price: new Prisma.Decimal('10000'),
          _sum: { remainingAmount: new Prisma.Decimal('0.5') },
          _count: { _all: 2 },
        },
      ],
      totalItems: 3,
    });
    await expect(
      service.getOrderBook({
        side: OrderSide.BUY,
        page: 2,
        pageSize: 1,
        price: '10000',
      }),
    ).resolves.toEqual({
      items: [
        {
          price: '10000.00000000',
          amount: '0.50000000',
          orderCount: 2,
          side: OrderSide.BUY,
        },
      ],
      pagination: { page: 2, pageSize: 1, totalItems: 3, totalPages: 3 },
    });
    expect(repository.findOrderBookLevels).toHaveBeenCalledWith({
      side: OrderSide.BUY,
      page: 2,
      pageSize: 1,
      price: new Prisma.Decimal('10000'),
    });
  });

  it('should format and paginate matches while forwarding the ID filter', async () => {
    repository.findMatches.mockResolvedValueOnce({
      trades: [
        {
          id: 'trade-1',
          price: new Prisma.Decimal('10000'),
          amount: new Prisma.Decimal('0.25'),
          takerSide: OrderSide.SELL,
          createdAt: new Date('2026-07-14T15:30:00.000Z'),
        },
      ],
      totalItems: 3,
    });
    await expect(service.getMatches(2, 1, 'trade')).resolves.toEqual({
      items: [
        {
          id: 'trade-1',
          price: '10000.00000000',
          amount: '0.25000000',
          takerSide: OrderSide.SELL,
          createdAt: '2026-07-14T15:30:00.000Z',
        },
      ],
      pagination: { page: 2, pageSize: 1, totalItems: 3, totalPages: 3 },
    });
    expect(repository.findMatches).toHaveBeenCalledWith(2, 1, 'trade');
  });
});
