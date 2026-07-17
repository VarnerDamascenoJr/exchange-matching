import Decimal from 'decimal.js';

const FALLBACK_DECIMAL = new Decimal(0);
const DECIMAL_SEPARATOR = '.';
const DECIMAL_INPUT_PATTERN = /[^\d.]/g;
const DECIMAL_SCALE = 8;

export const parseDecimal = (value?: string | null) => {
  if (!value) {
    return FALLBACK_DECIMAL;
  }

  try {
    return new Decimal(value);
  } catch {
    return FALLBACK_DECIMAL;
  }
};

export const multiplyDecimals = (left?: string | null, right?: string | null) =>
  parseDecimal(left).mul(parseDecimal(right)).toFixed(8);

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
