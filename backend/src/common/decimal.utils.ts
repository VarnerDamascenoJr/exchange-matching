import { Prisma } from '@prisma/client';

export const DECIMAL_PRECISION = 28;
export const DECIMAL_SCALE = 8;
export const DECIMAL_ROUNDING_MODE = Prisma.Decimal.ROUND_DOWN;

export const toScaledDecimal = (value: Prisma.Decimal.Value): Prisma.Decimal =>
  new Prisma.Decimal(value).toDecimalPlaces(
    DECIMAL_SCALE,
    DECIMAL_ROUNDING_MODE,
  );

export const multiplyScaled = (
  left: Prisma.Decimal.Value,
  right: Prisma.Decimal.Value,
): Prisma.Decimal => toScaledDecimal(new Prisma.Decimal(left).mul(right));

export const subtractScaled = (
  left: Prisma.Decimal.Value,
  right: Prisma.Decimal.Value,
): Prisma.Decimal => toScaledDecimal(new Prisma.Decimal(left).sub(right));
