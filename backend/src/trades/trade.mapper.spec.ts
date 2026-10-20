import { OrderSide, Prisma, TradeFeeAsset } from '@prisma/client';
import { toUserTradeHistoryItem } from './trade.mapper';

const buildTrade = () => ({
  id: 'trade-1',
  price: new Prisma.Decimal('10000.5'),
  amount: new Prisma.Decimal('0.5'),
  side: OrderSide.BUY,
  role: 'TAKER' as const,
  feeAmount: new Prisma.Decimal('0.0015'),
  feeAsset: TradeFeeAsset.BTC,
  createdAt: new Date('2026-10-15T15:00:00-03:00'),
});

describe('toUserTradeHistoryItem', () => {
  it('should format price, amount and fee to eight decimal places and dates in UTC', () => {
    expect(toUserTradeHistoryItem(buildTrade())).toEqual({
      id: 'trade-1',
      price: '10000.50000000',
      amount: '0.50000000',
      side: OrderSide.BUY,
      role: 'TAKER',
      feeAmount: '0.00150000',
      feeAsset: TradeFeeAsset.BTC,
      createdAt: '2026-10-15T18:00:00.000Z',
    });
  });

  it('should preserve DECIMAL(28,8) precision, the smallest trade amount and a zero fee', () => {
    expect(
      toUserTradeHistoryItem({
        ...buildTrade(),
        price: new Prisma.Decimal('99999999999999999999.12345678'),
        amount: new Prisma.Decimal('0.00000001'),
        feeAmount: new Prisma.Decimal(0),
      }),
    ).toMatchObject({
      price: '99999999999999999999.12345678',
      amount: '0.00000001',
      feeAmount: '0.00000000',
    });
  });

  it.each([
    [OrderSide.BUY, 'MAKER', TradeFeeAsset.BTC],
    [OrderSide.BUY, 'TAKER', TradeFeeAsset.BTC],
    [OrderSide.SELL, 'MAKER', TradeFeeAsset.USD],
    [OrderSide.SELL, 'TAKER', TradeFeeAsset.USD],
  ] as const)(
    'should preserve the %s side, %s role and %s fee asset',
    (side, role, feeAsset) => {
      expect(
        toUserTradeHistoryItem({ ...buildTrade(), side, role, feeAsset }),
      ).toMatchObject({ side, role, feeAsset });
    },
  );

  it('should expose only the public history fields', () => {
    const trade = {
      ...buildTrade(),
      sequence: BigInt(1),
      makerOrderId: 'maker-order',
      takerOrderId: 'taker-order',
      userId: 'user-1',
    };
    const item = toUserTradeHistoryItem(trade);
    expect(Object.keys(item).sort()).toEqual([
      'amount',
      'createdAt',
      'feeAmount',
      'feeAsset',
      'id',
      'price',
      'role',
      'side',
    ]);
    expect(() => JSON.stringify(item)).not.toThrow();
  });
});
