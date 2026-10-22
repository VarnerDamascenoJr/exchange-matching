import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertDecimalFitsSchema } from './decimal.utils';

export { assertDecimalFitsSchema } from './decimal.utils';

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
