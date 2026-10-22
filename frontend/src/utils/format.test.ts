import { describe, expect, it } from 'vitest';
import { formatBtc, formatUsd, toDisplayDecimal } from './format';

describe('financial display formatting', () => {
  it.each([
    ['0.00000001', '0.00000001'],
    ['0.00150000', '0.0015'],
    ['0.10000000', '0.10'],
    ['1.23456789', '1.23456789'],
    ['10000.12345678', '10000.12345678'],
    ['99999999999999999999.12345678', '99999999999999999999.12345678'],
    ['99999999999999999999.99999999', '99999999999999999999.99999999'],
  ])('preserves the significant decimals of %s', (value, expected) => {
    expect(toDisplayDecimal(value)).toBe(expected);
    expect(formatBtc(value)).toBe(`BTC ${expected}`);
    expect(formatUsd(value)).toBe(`US$ ${expected}`);
  });

  it.each(['0', '0.00000000'])('displays %s as zero', (value) => {
    expect(toDisplayDecimal(value)).toBe('0.00');
    expect(formatBtc(value)).toBe('BTC 0.00');
    expect(formatUsd(value)).toBe('US$ 0.00');
  });

  it.each([undefined, null, ''])('preserves the missing-value fallback for %s', (value) => {
    expect(toDisplayDecimal(value)).toBe('0.00');
    expect(formatBtc(value)).toBe('-');
    expect(formatUsd(value)).toBe('-');
  });
});
