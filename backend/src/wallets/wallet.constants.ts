import { Prisma } from '@prisma/client';

export const INITIAL_BTC_BALANCE = '100.00000000';
export const INITIAL_USD_BALANCE = '100000.00000000';
export const ZERO_BALANCE = '0.00000000';

export const buildInitialWalletCreateInput =
  (): Prisma.WalletCreateWithoutUserInput => ({
    availableBtc: new Prisma.Decimal(INITIAL_BTC_BALANCE),
    reservedBtc: new Prisma.Decimal(ZERO_BALANCE),
    availableUsd: new Prisma.Decimal(INITIAL_USD_BALANCE),
    reservedUsd: new Prisma.Decimal(ZERO_BALANCE),
  });
