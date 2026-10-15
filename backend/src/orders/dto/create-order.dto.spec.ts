import { OrderSide } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOrderDto } from './create-order.dto';

describe('CreateOrderDto', () => {
  it.each([OrderSide.BUY, OrderSide.SELL])(
    'should accept a %s order with string amounts and prices',
    async (side) => {
      const dto = plainToInstance(CreateOrderDto, {
        side,
        amount: '0.12345678',
        price: '10000.5',
      });
      await expect(validate(dto)).resolves.toEqual([]);
      expect(dto.amount).toBe('0.12345678');
      expect(dto.price).toBe('10000.5');
    },
  );

  it.each([
    ['side', undefined],
    ['side', 'buy'],
    ['side', 'INVALID'],
    ['amount', undefined],
    ['amount', 0.5],
    ['amount', null],
    ['price', undefined],
    ['price', 10000],
    ['price', null],
  ])('should reject %s with value %s', async (property, value) => {
    const dto = plainToInstance(CreateOrderDto, {
      side: OrderSide.BUY,
      amount: '0.5',
      price: '10000',
      [property]: value,
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toContain(property);
  });
});
