import { PrismaService } from '../prisma/prisma.service';
import { TradesRepository } from './trades.repository';

describe('TradesRepository', () => {
  let repository: TradesRepository;
  let trade: { count: jest.Mock; findMany: jest.Mock };

  beforeEach(() => {
    trade = { count: jest.fn(), findMany: jest.fn() };
    repository = new TradesRepository({ trade } as unknown as PrismaService);
  });

  it.each([
    [undefined, {}],
    ['', {}],
    ['   ', {}],
    [' trade ', { id: { startsWith: 'trade' } }],
  ] as const)(
    'should scope listing and counting to both sides of the user’s trades with the same ID filter (%s)',
    async (id, filter) => {
      const trades = [{ id: 'trade-1' }];
      trade.count.mockResolvedValueOnce(11);
      trade.findMany.mockResolvedValueOnce(trades);
      await expect(
        repository.findUserHistory('user-1', 2, 10, id),
      ).resolves.toEqual({ trades, totalItems: 11 });
      const where = {
        ...filter,
        OR: [
          { buyOrder: { userId: 'user-1' } },
          { sellOrder: { userId: 'user-1' } },
        ],
      };
      expect(trade.count).toHaveBeenCalledWith({ where });
      expect(trade.findMany).toHaveBeenCalledWith({
        where,
        orderBy: [{ createdAt: 'desc' }, { sequence: 'desc' }],
        skip: 10,
        take: 10,
        select: {
          id: true,
          price: true,
          amount: true,
          createdAt: true,
          makerFeeAmount: true,
          makerFeeAsset: true,
          takerFeeAmount: true,
          takerFeeAsset: true,
          buyOrder: { select: { userId: true } },
          takerOrder: { select: { userId: true } },
        },
      });
    },
  );

  it('should return an empty history for a user without trades', async () => {
    trade.count.mockResolvedValueOnce(0);
    trade.findMany.mockResolvedValueOnce([]);
    await expect(repository.findUserHistory('user-1', 1, 25)).resolves.toEqual({
      trades: [],
      totalItems: 0,
    });
    expect(trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 25 }),
    );
  });

  it('should preserve the total when the requested page is beyond the last trade', async () => {
    trade.count.mockResolvedValueOnce(3);
    trade.findMany.mockResolvedValueOnce([]);
    await expect(repository.findUserHistory('user-1', 5, 10)).resolves.toEqual({
      trades: [],
      totalItems: 3,
    });
    expect(trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 40, take: 10 }),
    );
  });

  it('should propagate query errors instead of returning a partial history', async () => {
    const failure = new Error('Database unavailable');
    trade.count.mockRejectedValueOnce(failure);
    trade.findMany.mockResolvedValueOnce([]);
    await expect(repository.findUserHistory('user-1', 1, 25)).rejects.toBe(
      failure,
    );
  });
});
