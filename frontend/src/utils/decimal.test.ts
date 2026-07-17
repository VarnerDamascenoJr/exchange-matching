import { describe, expect, it } from 'vitest';
import { multiplyDecimals, parseDecimal, sanitizeDecimalInput } from './decimal';

describe('decimal utils', () => {
  it('multiplies strings with 8 decimal places', () => {
    expect(multiplyDecimals('0.5', '10000')).toBe('5000.00000000');
    expect(multiplyDecimals('0.1', '0.33333333')).toBe('0.03333333');
  });

  it('falls back to zero for invalid input', () => {
    expect(parseDecimal('abc').toFixed(8)).toBe('0.00000000');
  });

  it('sanitizes decimal input to digits and a single decimal separator', () => {
    expect(sanitizeDecimalInput('abc12.34xyz')).toBe('12.34');
    expect(sanitizeDecimalInput('12..34')).toBe('12.34');
    expect(sanitizeDecimalInput('.5')).toBe('0.5');
    expect(sanitizeDecimalInput('10.123456789')).toBe('10.12345678');
  });
});
