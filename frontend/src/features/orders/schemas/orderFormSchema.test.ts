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
});
