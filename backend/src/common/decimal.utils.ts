import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const DECIMAL_PRECISION = 28;
export const DECIMAL_SCALE = 8;
export const DECIMAL_INTEGER_DIGITS = DECIMAL_PRECISION - DECIMAL_SCALE;
export const DECIMAL_MAX = '99999999999999999999.99999999';
export const DECIMAL_ROUNDING_MODE = Prisma.Decimal.ROUND_DOWN;

// A product of two DECIMAL(28,8) operands needs up to 56 significant digits.
// Isolate this configuration from Prisma's global Decimal constructor.
const ArithmeticDecimal = Prisma.Decimal.clone({
  precision: DECIMAL_PRECISION * 2,
  rounding: DECIMAL_ROUNDING_MODE,
});

export const assertDecimalFitsSchema = (
  value: Prisma.Decimal,
  fieldName: string,
): void => {
  if (!value.isFinite()) {
    throw new BadRequestException(`${fieldName} must be a valid decimal`);
  }
  if (value.decimalPlaces() > DECIMAL_SCALE) {
    throw new BadRequestException(
      `${fieldName} must have at most ${DECIMAL_SCALE} decimal places`,
    );
  }
  if (value.abs().gt(DECIMAL_MAX)) {
    throw new BadRequestException(
      `${fieldName} must fit within DECIMAL(${DECIMAL_PRECISION},${DECIMAL_SCALE})`,
    );
  }
};

export const toScaledDecimal = (
  value: Prisma.Decimal.Value,
): Prisma.Decimal => {
  const scaled = new Prisma.Decimal(value).toDecimalPlaces(
    DECIMAL_SCALE,
    DECIMAL_ROUNDING_MODE,
  );
  assertDecimalFitsSchema(scaled, 'Calculated value');
  return scaled;
};

export const multiplyScaled = (
  left: Prisma.Decimal.Value,
  right: Prisma.Decimal.Value,
): Prisma.Decimal => toScaledDecimal(new ArithmeticDecimal(left).mul(right));

export const subtractScaled = (
  left: Prisma.Decimal.Value,
  right: Prisma.Decimal.Value,
): Prisma.Decimal => toScaledDecimal(new ArithmeticDecimal(left).sub(right));

export const addScaled = (
  left: Prisma.Decimal.Value,
  right: Prisma.Decimal.Value,
): Prisma.Decimal => toScaledDecimal(new ArithmeticDecimal(left).add(right));

export const assertPositiveOrderCost = (
  amount: Prisma.Decimal,
  price: Prisma.Decimal,
): Prisma.Decimal => {
  const cost = multiplyScaled(amount, price);
  if (cost.lte(0)) {
    throw new BadRequestException('Order cost must be at least 0.00000001 USD');
  }
  return cost;
};
