import { parseDecimal } from './decimal';

const formatDecimal = (value?: string | null) => {
  if (!value) {
    return null;
  }

  // Keep every significant API decimal (scale 8), with at least two places.
  // This presentation format must not be used to populate order payloads.
  return parseDecimal(value).toFixed(8).replace(/(\.\d{2,}?)0+$/, '$1');
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
