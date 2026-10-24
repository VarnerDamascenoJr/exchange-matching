import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

const toPositiveInteger = (value: unknown, fallback: number) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsedValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;

  return Number.isSafeInteger(parsedValue) ? parsedValue : Number.NaN;
};

@ValidatorConstraint({ name: 'safePaginationOffset', async: false })
class SafePaginationOffset implements ValidatorConstraintInterface {
  validate(_value: unknown, { object }: ValidationArguments): boolean {
    const { page, pageSize } = object as PaginationQueryDto;
    // Let the field validators report invalid inputs independently.
    return (
      !Number.isSafeInteger(page) ||
      !Number.isSafeInteger(pageSize) ||
      Number.isSafeInteger((page - 1) * pageSize)
    );
  }

  defaultMessage(): string {
    return 'Pagination offset must be a safe integer';
  }
}

const toOptionalString = (value: unknown) => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : undefined;
};

export class PaginationQueryDto {
  @Transform(({ value }: { value: unknown }) => toPositiveInteger(value, 1))
  @IsInt()
  @Min(1)
  page: number = 1;

  @Transform(({ value }: { value: unknown }) => toPositiveInteger(value, 25))
  @IsInt()
  @Min(1)
  @Max(100)
  @Validate(SafePaginationOffset)
  pageSize: number = 25;

  @Transform(({ value }: { value: unknown }) => toOptionalString(value))
  @IsOptional()
  @IsString()
  id?: string;
}
