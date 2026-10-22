import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePositiveDecimalInput } from './decimal-input';
import {
  addScaled,
  assertPositiveOrderCost,
  DECIMAL_PRECISION,
  DECIMAL_SCALE,
  multiplyScaled,
  subtractScaled,
} from './decimal.utils';

const cases = JSON.parse(
  readFileSync(join(__dirname, '../../../shared/decimal-cases.json'), 'utf8'),
) as {
  precision: number;
  scale: number;
  validInputs: string[];
  invalidInputs: string[];
  products: { amount: string; price: string; expected: string }[];
  overflowProducts: { amount: string; price: string }[];
};

describe('shared decimal contract', () => {
  it('uses the storage precision and scale from the contract', () => {
    expect(DECIMAL_PRECISION).toBe(cases.precision);
    expect(DECIMAL_SCALE).toBe(cases.scale);
  });

  it.each(cases.validInputs)('accepts %s without losing precision', (value) => {
    expect(parsePositiveDecimalInput(value, 'value').eq(value)).toBe(true);
  });

  it.each(cases.invalidInputs)('rejects %s before persistence', (value) => {
    expect(() => parsePositiveDecimalInput(value, 'value')).toThrow(
      BadRequestException,
    );
  });

  it.each(cases.products)(
    'quantizes $amount × $price to $expected',
    ({ amount, price, expected }) => {
      expect(multiplyScaled(amount, price).toFixed(8)).toBe(expected);
      const cost = () =>
        assertPositiveOrderCost(
          new Prisma.Decimal(amount),
          new Prisma.Decimal(price),
        );
      if (expected === '0.00000000') {
        expect(cost).toThrow('Order cost must be at least 0.00000001 USD');
      } else {
        expect(cost().toFixed(8)).toBe(expected);
      }
    },
  );

  it.each(cases.overflowProducts)(
    'rejects overflowing product $amount × $price',
    ({ amount, price }) => {
      expect(() => multiplyScaled(amount, price)).toThrow(BadRequestException);
    },
  );

  it('preserves large additions and subtractions and rejects overflow', () => {
    expect(
      subtractScaled('99999999999999999999.99999999', '0.00000001').toFixed(8),
    ).toBe('99999999999999999999.99999998');
    expect(
      addScaled('99999999999999999999.99999998', '0.00000001').toFixed(8),
    ).toBe('99999999999999999999.99999999');
    expect(() =>
      addScaled('99999999999999999999.99999999', '0.00000001'),
    ).toThrow(BadRequestException);
  });

  it('does not modify Prisma Decimal global precision', () => {
    const precision = Prisma.Decimal.precision;
    multiplyScaled('1', '2');
    expect(Prisma.Decimal.precision).toBe(precision);
  });
});
