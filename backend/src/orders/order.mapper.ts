import { Order, Prisma } from '@prisma/client';

export type OrderSummary = {
  id: string;
  side: Order['side'];
  status: Order['status'];
  price: string;
  originalAmount: string;
  remainingAmount: string;
  createdAt: string;
  updatedAt: string;
};

const toDecimalString = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).toFixed(8);

export const toOrderSummary = (order: {
  id: string;
  side: Order['side'];
  status: Order['status'];
  price: Prisma.Decimal.Value;
  originalAmount: Prisma.Decimal.Value;
  remainingAmount: Prisma.Decimal.Value;
  createdAt: Date;
  updatedAt: Date;
}): OrderSummary => ({
  id: order.id,
  side: order.side,
  status: order.status,
  price: toDecimalString(order.price),
  originalAmount: toDecimalString(order.originalAmount),
  remainingAmount: toDecimalString(order.remainingAmount),
  createdAt: order.createdAt.toISOString(),
  updatedAt: order.updatedAt.toISOString(),
});
