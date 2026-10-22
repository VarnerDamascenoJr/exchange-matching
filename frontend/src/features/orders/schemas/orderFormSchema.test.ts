import { describe, expect, it } from 'vitest';
import { orderFormSchema } from './orderFormSchema';

describe('orderFormSchema', () => {
  it('accepts positive decimal strings up to 8 places', () => {
    const result = orderFormSchema.safeParse({
      amount: '0.50000000',
      price: '10000.00000000',
    });

    expect(result.success).toBe(true);
  });

  it('rejects decimals with more than 8 places', () => {
    const result = orderFormSchema.safeParse({
      amount: '0.123456789',
      price: '10000',
    });

    expect(result.success).toBe(false);
  });

  it('preserves small and large decimal strings without numeric conversion', () => {
    const values = {
      amount: '0.00000001',
      price: '99999999999999999999.12345678',
    };

    expect(orderFormSchema.parse(values)).toEqual(values);
  });

  it.each(['0', '0.00000000', ''])('rejects a nonpositive or missing value: %s', (value) => {
    expect(orderFormSchema.safeParse({ amount: value, price: '1' }).success).toBe(false);
    expect(orderFormSchema.safeParse({ amount: '1', price: value }).success).toBe(false);
  });
});
