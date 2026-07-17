import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

const toPositiveInteger = (value: unknown, fallback: number) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsedValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : value;

  return Number.isNaN(parsedValue) ? value : parsedValue;
};

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
  pageSize: number = 25;

  @Transform(({ value }: { value: unknown }) => toOptionalString(value))
  @IsOptional()
  @IsString()
  id?: string;
}
