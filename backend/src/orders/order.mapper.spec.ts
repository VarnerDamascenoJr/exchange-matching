import { OrderSide, OrderStatus, Prisma } from '@prisma/client';
import { toOrderSummary } from './order.mapper';

const buildOrder = () => ({
  id: 'order-1',
  side: OrderSide.BUY,
  status: OrderStatus.OPEN,
  price: new Prisma.Decimal('10000.5'),
  originalAmount: new Prisma.Decimal('0.75'),
  remainingAmount: new Prisma.Decimal('0.25'),
  createdAt: new Date('2026-10-15T12:00:00-03:00'),
  updatedAt: new Date('2026-10-15T12:30:00-03:00'),
});

describe('toOrderSummary', () => {
  it('should format monetary values to eight decimal places and dates in UTC', () => {
    expect(toOrderSummary(buildOrder())).toEqual({
      id: 'order-1',
      side: OrderSide.BUY,
      status: OrderStatus.OPEN,
      price: '10000.50000000',
      originalAmount: '0.75000000',
      remainingAmount: '0.25000000',
      createdAt: '2026-10-15T15:00:00.000Z',
      updatedAt: '2026-10-15T15:30:00.000Z',
    });
  });

  it('should preserve DECIMAL(28,8) precision and a zero remaining amount', () => {
    expect(
      toOrderSummary({
        ...buildOrder(),
        price: new Prisma.Decimal('99999999999999999999.12345678'),
        originalAmount: new Prisma.Decimal('0.00000001'),
        remainingAmount: new Prisma.Decimal(0),
      }),
    ).toMatchObject({
      price: '99999999999999999999.12345678',
      originalAmount: '0.00000001',
      remainingAmount: '0.00000000',
    });
  });

  it.each(Object.values(OrderStatus))(
    'should preserve the %s status',
    (status) => {
      expect(toOrderSummary({ ...buildOrder(), status }).status).toBe(status);
    },
  );

  it.each(Object.values(OrderSide))('should preserve the %s side', (side) => {
    expect(toOrderSummary({ ...buildOrder(), side }).side).toBe(side);
  });

  it('should omit internal persistence fields from the API response', () => {
    const order = { ...buildOrder(), userId: 'user-1', sequence: BigInt(123) };
    const summary = toOrderSummary(order);
    expect(summary).not.toHaveProperty('userId');
    expect(summary).not.toHaveProperty('sequence');
    expect(() => JSON.stringify(summary)).not.toThrow();
  });
});
