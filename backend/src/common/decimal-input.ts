import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DECIMAL_PRECISION, DECIMAL_SCALE } from './decimal.utils';

export const assertDecimalFitsSchema = (
  value: Prisma.Decimal,
  fieldName: string,
) => {
  const normalizedValue = value.toFixed();
  const unsignedValue = normalizedValue.startsWith('-')
    ? normalizedValue.slice(1)
    : normalizedValue;
  const [integerPart, fractionalPart = ''] = unsignedValue.split('.');
  const normalizedIntegerPart = integerPart.replace(/^0+(?=\d)/, '');
  const integerDigits =
    normalizedIntegerPart.length > 0 ? normalizedIntegerPart.length : 1;
  const significantFractionalPart = fractionalPart.replace(/0+$/, '');
  const fractionalDigits = significantFractionalPart.length;
  const totalDigits = integerDigits + fractionalDigits;

  if (fractionalDigits > DECIMAL_SCALE) {
    throw new BadRequestException(
      `${fieldName} must have at most ${DECIMAL_SCALE} decimal places`,
    );
  }

  if (totalDigits > DECIMAL_PRECISION) {
    throw new BadRequestException(
      `${fieldName} must fit within DECIMAL(${DECIMAL_PRECISION},${DECIMAL_SCALE})`,
    );
  }
};

export const parsePositiveDecimalInput = (
  value: string,
  fieldName: string,
): Prisma.Decimal => {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new BadRequestException(`${fieldName} must be a non-empty string`);
  }

  try {
    const parsedValue = new Prisma.Decimal(normalizedValue);

    if (!parsedValue.isFinite()) {
      throw new BadRequestException(`${fieldName} must be a valid decimal`);
    }

    if (parsedValue.lte(0)) {
      throw new BadRequestException(`${fieldName} must be greater than zero`);
    }

    assertDecimalFitsSchema(parsedValue, fieldName);

    return parsedValue;
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error;
    }

    throw new BadRequestException(`${fieldName} must be a valid decimal`);
  }
};
