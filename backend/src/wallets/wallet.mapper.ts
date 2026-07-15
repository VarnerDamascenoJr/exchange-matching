import { Prisma } from '@prisma/client';

export type WalletSummary = {
  availableBtc: string;
  reservedBtc: string;
  availableUsd: string;
  reservedUsd: string;
};

const toDecimalString = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).toFixed(8);

export const toWalletSummary = (wallet: {
  availableBtc: Prisma.Decimal.Value;
  reservedBtc: Prisma.Decimal.Value;
  availableUsd: Prisma.Decimal.Value;
  reservedUsd: Prisma.Decimal.Value;
}): WalletSummary => ({
  availableBtc: toDecimalString(wallet.availableBtc),
  reservedBtc: toDecimalString(wallet.reservedBtc),
  availableUsd: toDecimalString(wallet.availableUsd),
  reservedUsd: toDecimalString(wallet.reservedUsd),
});
