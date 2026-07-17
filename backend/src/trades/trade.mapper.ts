import { OrderSide, Prisma, TradeFeeAsset } from '@prisma/client';

const toDecimalString = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).toFixed(8);

export type UserTradeHistoryItem = {
  id: string;
  price: string;
  amount: string;
  side: OrderSide;
  role: 'MAKER' | 'TAKER';
  feeAmount: string;
  feeAsset: TradeFeeAsset;
  createdAt: string;
};

export const toUserTradeHistoryItem = (value: {
  id: string;
  price: Prisma.Decimal.Value;
  amount: Prisma.Decimal.Value;
  side: OrderSide;
  role: 'MAKER' | 'TAKER';
  feeAmount: Prisma.Decimal.Value;
  feeAsset: TradeFeeAsset;
  createdAt: Date;
}): UserTradeHistoryItem => ({
  id: value.id,
  price: toDecimalString(value.price),
  amount: toDecimalString(value.amount),
  side: value.side,
  role: value.role,
  feeAmount: toDecimalString(value.feeAmount),
  feeAsset: value.feeAsset,
  createdAt: value.createdAt.toISOString(),
});
