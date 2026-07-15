import { OrderSide } from '@prisma/client';
import { IsEnum, IsString } from 'class-validator';

export class CreateOrderDto {
  @IsEnum(OrderSide)
  side!: OrderSide;

  @IsString()
  amount!: string;

  @IsString()
  price!: string;
}
