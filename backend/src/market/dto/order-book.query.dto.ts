import { Transform } from 'class-transformer';
import { OrderSide } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const toOptionalString = (value: unknown) => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : undefined;
};

export class OrderBookQueryDto extends PaginationQueryDto {
  @IsEnum(OrderSide)
  side!: OrderSide;

  @Transform(({ value }: { value: unknown }) => toOptionalString(value))
  @IsOptional()
  @IsString()
  price?: string;
}
