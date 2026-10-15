import { OrderSide, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MarketRepository } from './market.repository';

describe('MarketRepository', () => {
  let repository: MarketRepository;
  let prisma: {
    $queryRaw: jest.Mock;
    order: { findFirst: jest.Mock; groupBy: jest.Mock };
    trade: { findFirst: jest.Mock; count: jest.Mock; findMany: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn(),
      order: { findFirst: jest.fn(), groupBy: jest.fn() },
      trade: { findFirst: jest.fn(), count: jest.fn(), findMany: jest.fn() },
    };
    repository = new MarketRepository(prisma as unknown as PrismaService);
  });

  it('should query the latest trade, 24-hour statistics and best active prices', async () => {
    const lastTrade = { price: new Prisma.Decimal('10000') };
    const bestBid = { price: new Prisma.Decimal('9900') };
    const bestAsk = { price: new Prisma.Decimal('10100') };
    const stats = {
      btc_volume_24h: new Prisma.Decimal('0.5'),
      usd_volume_24h: new Prisma.Decimal('5000'),
      high_24h: new Prisma.Decimal('10000'),
      low_24h: new Prisma.Decimal('10000'),
    };
    prisma.trade.findFirst.mockResolvedValueOnce(lastTrade);
    prisma.$queryRaw.mockResolvedValueOnce([stats]);
    prisma.order.findFirst
      .mockResolvedValueOnce(bestBid)
      .mockResolvedValueOnce(bestAsk);

    await expect(repository.findStats()).resolves.toEqual({
      lastTrade,
      tradeStats: stats,
      bestBid,
      bestAsk,
    });
    expect(prisma.trade.findFirst).toHaveBeenCalledWith({
      orderBy: [{ createdAt: 'desc' }, { sequence: 'desc' }],
      select: { price: true },
    });
    const [sql] = prisma.$queryRaw.mock.calls[0] as [TemplateStringsArray];
    expect(sql.join('')).toContain('SUM("amount" * "price")');
    expect(sql.join('')).toContain(
      'WHERE "created_at" >= NOW() - INTERVAL \'24 hours\'',
    );
    for (const [index, side, direction] of [
      [1, OrderSide.BUY, 'desc'],
      [2, OrderSide.SELL, 'asc'],
    ] as const) {
      expect(prisma.order.findFirst).toHaveBeenNthCalledWith(index, {
        where: {
          side,
          status: { in: [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED] },
        },
        orderBy: [{ price: direction }, { sequence: 'asc' }],
        select: { price: true },
      });
    }
  });

  it('should return absent statistics when the market is empty', async () => {
    prisma.trade.findFirst.mockResolvedValueOnce(null);
    prisma.$queryRaw.mockResolvedValueOnce([]);
    prisma.order.findFirst.mockResolvedValue(null);
    await expect(repository.findStats()).resolves.toEqual({
      lastTrade: null,
      tradeStats: undefined,
      bestBid: null,
      bestAsk: null,
    });
  });

  it.each([
    [OrderSide.BUY, 'desc'],
    [OrderSide.SELL, 'asc'],
  ])(
    'should group active %s orders by price in %s order',
    async (side, direction) => {
      const price = new Prisma.Decimal('10000');
      const level = {
        price,
        _count: { _all: 2 },
        _sum: { remainingAmount: new Prisma.Decimal('0.5') },
      };
      prisma.order.groupBy
        .mockResolvedValueOnce([level, level, level])
        .mockResolvedValueOnce([level]);
      await expect(
        repository.findOrderBookLevels({ side, price, page: 2, pageSize: 1 }),
      ).resolves.toEqual({ levels: [level], totalItems: 3 });
      const baseArgs = {
        by: ['price'],
        where: {
          side,
          price,
          status: { in: [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED] },
        },
        _count: { _all: true },
        _sum: { remainingAmount: true },
        orderBy: [{ price: direction }],
      };
      expect(prisma.order.groupBy).toHaveBeenNthCalledWith(1, baseArgs);
      expect(prisma.order.groupBy).toHaveBeenNthCalledWith(2, {
        ...baseArgs,
        skip: 1,
        take: 1,
      });
    },
  );

  it('should list the order book without a price filter', async () => {
    prisma.order.groupBy.mockResolvedValue([]);
    await expect(
      repository.findOrderBookLevels({
        side: OrderSide.SELL,
        page: 1,
        pageSize: 25,
      }),
    ).resolves.toEqual({ levels: [], totalItems: 0 });
    expect(prisma.order.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          side: OrderSide.SELL,
          status: { in: [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED] },
        },
        skip: 0,
        take: 25,
      }),
    );
  });

  it.each([
    [' trade ', { id: { startsWith: 'trade' } }],
    [undefined, {}],
    ['   ', {}],
  ])(
    'should apply the same ID filter to match counting and listing (%s)',
    async (id, where) => {
      prisma.trade.count.mockResolvedValueOnce(3);
      prisma.trade.findMany.mockResolvedValueOnce([]);
      await expect(repository.findMatches(2, 2, id)).resolves.toEqual({
        trades: [],
        totalItems: 3,
      });
      expect(prisma.trade.count).toHaveBeenCalledWith({ where });
      expect(prisma.trade.findMany).toHaveBeenCalledWith({
        where,
        orderBy: [{ createdAt: 'desc' }, { sequence: 'desc' }],
        skip: 2,
        take: 2,
        select: {
          id: true,
          price: true,
          amount: true,
          takerSide: true,
          createdAt: true,
        },
      });
    },
  );
});
