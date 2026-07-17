import { OrderSide, Prisma } from '@prisma/client';

const toDecimalString = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).toFixed(8);

const toNullableDecimalString = (value: Prisma.Decimal.Value | null) =>
  value === null ? null : toDecimalString(value);

export type MarketStatsSummary = {
  lastPrice: string | null;
  btcVolume24h: string;
  usdVolume24h: string;
  high24h: string | null;
  low24h: string | null;
  bestBid: string | null;
  bestAsk: string | null;
};

export type OrderBookLevel = {
  price: string;
  amount: string;
  orderCount: number;
  side: OrderSide;
};

export type MarketMatchSummary = {
  id: string;
  price: string;
  amount: string;
  takerSide: OrderSide;
  createdAt: string;
};

export const toMarketStatsSummary = (value: {
  lastPrice: Prisma.Decimal.Value | null;
  btcVolume24h: Prisma.Decimal.Value;
  usdVolume24h: Prisma.Decimal.Value;
  high24h: Prisma.Decimal.Value | null;
  low24h: Prisma.Decimal.Value | null;
  bestBid: Prisma.Decimal.Value | null;
  bestAsk: Prisma.Decimal.Value | null;
}): MarketStatsSummary => ({
  lastPrice: toNullableDecimalString(value.lastPrice),
  btcVolume24h: toDecimalString(value.btcVolume24h),
  usdVolume24h: toDecimalString(value.usdVolume24h),
  high24h: toNullableDecimalString(value.high24h),
  low24h: toNullableDecimalString(value.low24h),
  bestBid: toNullableDecimalString(value.bestBid),
  bestAsk: toNullableDecimalString(value.bestAsk),
});

export const toOrderBookLevel = (value: {
  price: Prisma.Decimal.Value;
  amount: Prisma.Decimal.Value;
  orderCount: number;
  side: OrderSide;
}): OrderBookLevel => ({
  price: toDecimalString(value.price),
  amount: toDecimalString(value.amount),
  orderCount: value.orderCount,
  side: value.side,
});

export const toMarketMatchSummary = (value: {
  id: string;
  price: Prisma.Decimal.Value;
  amount: Prisma.Decimal.Value;
  takerSide: OrderSide;
  createdAt: Date;
}): MarketMatchSummary => ({
  id: value.id,
  price: toDecimalString(value.price),
  amount: toDecimalString(value.amount),
  takerSide: value.takerSide,
  createdAt: value.createdAt.toISOString(),
});
