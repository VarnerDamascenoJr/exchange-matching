import { OrderSide, Prisma, TradeFeeAsset } from '@prisma/client';
import { TradesRepository } from './trades.repository';
import { TradesService } from './trades.service';

describe('TradesService', () => {
  let service: TradesService;
  let repository: jest.Mocked<TradesRepository>;

  beforeEach(() => {
    repository = {
      findUserHistory: jest.fn(),
    } as unknown as jest.Mocked<TradesRepository>;
    service = new TradesService(repository);
  });

  it.each([
    [
      OrderSide.BUY,
      'TAKER',
      'user-1',
      'user-1',
      '25',
      TradeFeeAsset.USD,
      '0.0015',
      TradeFeeAsset.BTC,
      '0.00150000',
      TradeFeeAsset.BTC,
    ],
    [
      OrderSide.BUY,
      'MAKER',
      'user-1',
      'other-user',
      '0.0025',
      TradeFeeAsset.BTC,
      '15',
      TradeFeeAsset.USD,
      '0.00250000',
      TradeFeeAsset.BTC,
    ],
    [
      OrderSide.SELL,
      'TAKER',
      'other-user',
      'user-1',
      '0.0025',
      TradeFeeAsset.BTC,
      '15',
      TradeFeeAsset.USD,
      '15.00000000',
      TradeFeeAsset.USD,
    ],
    [
      OrderSide.SELL,
      'MAKER',
      'other-user',
      'other-user',
      '25',
      TradeFeeAsset.USD,
      '0.0015',
      TradeFeeAsset.BTC,
      '25.00000000',
      TradeFeeAsset.USD,
    ],
  ] as const)(
    'should map %s history for a %s using the correct fee',
    async (
      side,
      role,
      buyUserId,
      takerUserId,
      makerFeeAmount,
      makerFeeAsset,
      takerFeeAmount,
      takerFeeAsset,
      feeAmount,
      feeAsset,
    ) => {
      repository.findUserHistory.mockResolvedValueOnce({
        totalItems: 3,
        trades: [
          {
            id: 'trade-1',
            price: new Prisma.Decimal('10000'),
            amount: new Prisma.Decimal('0.5'),
            createdAt: new Date('2026-10-15T18:00:00Z'),
            makerFeeAmount: new Prisma.Decimal(makerFeeAmount),
            makerFeeAsset,
            takerFeeAmount: new Prisma.Decimal(takerFeeAmount),
            takerFeeAsset,
            buyOrder: { userId: buyUserId },
            takerOrder: { userId: takerUserId },
          },
        ],
      });
      await expect(
        service.getUserHistory('user-1', 2, 1, 'trade'),
      ).resolves.toEqual({
        items: [
          {
            id: 'trade-1',
            price: '10000.00000000',
            amount: '0.50000000',
            side,
            role,
            feeAmount,
            feeAsset,
            createdAt: '2026-10-15T18:00:00.000Z',
          },
        ],
        pagination: { page: 2, pageSize: 1, totalItems: 3, totalPages: 3 },
      });
      expect(repository.findUserHistory).toHaveBeenCalledWith(
        'user-1',
        2,
        1,
        'trade',
      );
    },
  );

  it('should return empty pagination when the user has no trades', async () => {
    repository.findUserHistory.mockResolvedValueOnce({
      trades: [],
      totalItems: 0,
    });
    await expect(service.getUserHistory('user-1', 1, 25)).resolves.toEqual({
      items: [],
      pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 },
    });
    expect(repository.findUserHistory).toHaveBeenCalledWith(
      'user-1',
      1,
      25,
      undefined,
    );
  });

  it('should preserve pagination totals when a later page is empty', async () => {
    repository.findUserHistory.mockResolvedValueOnce({
      trades: [],
      totalItems: 3,
    });
    await expect(service.getUserHistory('user-1', 4, 2)).resolves.toEqual({
      items: [],
      pagination: { page: 4, pageSize: 2, totalItems: 3, totalPages: 2 },
    });
  });

  it('should propagate repository failures', async () => {
    const failure = new Error('History lookup failed');
    repository.findUserHistory.mockRejectedValueOnce(failure);
    await expect(service.getUserHistory('user-1', 1, 25)).rejects.toBe(failure);
  });
});
