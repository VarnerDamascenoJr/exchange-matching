import { parseDecimal } from './decimal';

const formatDecimal = (value?: string | null) => {
  if (!value) {
    return null;
  }

  return parseDecimal(value).toFixed(2);
};

export const toDisplayDecimal = (value?: string | null) =>
  formatDecimal(value) ?? '0.00';

export const formatUsd = (value?: string | null) => {
  const formattedValue = formatDecimal(value);
  return formattedValue ? `US$ ${formattedValue}` : '-';
};

export const formatBtc = (value?: string | null) => {
  const formattedValue = formatDecimal(value);
  return formattedValue ? `BTC ${formattedValue}` : '-';
};

export const formatTimestamp = (value: string) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
