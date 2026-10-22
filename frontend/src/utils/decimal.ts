import Decimal from 'decimal.js';

// Match the backend's exact intermediate precision and quantization policy.
const ArithmeticDecimal = Decimal.clone({
  precision: 56,
  rounding: Decimal.ROUND_DOWN,
});
const FALLBACK_DECIMAL = new ArithmeticDecimal(0);
const DECIMAL_MAX = '99999999999999999999.99999999';
const DECIMAL_SEPARATOR = '.';
const DECIMAL_INPUT_PATTERN = /[^\d.]/g;
const DECIMAL_SCALE = 8;

export const parseDecimal = (value?: string | null) => {
  if (!value) {
    return FALLBACK_DECIMAL;
  }

  try {
    return new ArithmeticDecimal(value);
  } catch {
    return FALLBACK_DECIMAL;
  }
};

export const multiplyDecimals = (left?: string | null, right?: string | null) =>
  parseDecimal(left)
    .mul(parseDecimal(right))
    .toFixed(DECIMAL_SCALE, Decimal.ROUND_DOWN);

export const decimalFitsSchema = (value: string) => {
  try {
    const decimal = new ArithmeticDecimal(value);
    return (
      decimal.isFinite() &&
      decimal.abs().lte(DECIMAL_MAX) &&
      decimal.decimalPlaces() <= DECIMAL_SCALE
    );
  } catch {
    return false;
  }
};

export const sanitizeDecimalInput = (value: string) => {
  const normalizedValue = value.replace(DECIMAL_INPUT_PATTERN, '');

  if (!normalizedValue) {
    return '';
  }

  const hasDecimalSeparator = normalizedValue.includes(DECIMAL_SEPARATOR);
  const [integerPart, ...fractionParts] = normalizedValue.split(
    DECIMAL_SEPARATOR,
  );
  const normalizedIntegerPart =
    integerPart === '' && hasDecimalSeparator ? '0' : integerPart;

  if (!hasDecimalSeparator) {
    return normalizedIntegerPart;
  }

  const normalizedFractionPart = fractionParts.join('').slice(0, DECIMAL_SCALE);

  return `${normalizedIntegerPart}.${normalizedFractionPart}`;
};
