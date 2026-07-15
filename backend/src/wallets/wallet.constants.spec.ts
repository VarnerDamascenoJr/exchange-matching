import { Prisma } from '@prisma/client';
import {
  buildInitialWalletCreateInput,
  INITIAL_BTC_BALANCE,
  INITIAL_USD_BALANCE,
  ZERO_BALANCE,
} from './wallet.constants';

const formatDecimal = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).toFixed(8);

describe('wallet.constants', () => {
  it('should build the initial wallet balances using decimal-safe values', () => {
    const wallet = buildInitialWalletCreateInput();

    expect(formatDecimal(wallet.availableBtc)).toBe(INITIAL_BTC_BALANCE);
    expect(formatDecimal(wallet.reservedBtc)).toBe(ZERO_BALANCE);
    expect(formatDecimal(wallet.availableUsd)).toBe(INITIAL_USD_BALANCE);
    expect(formatDecimal(wallet.reservedUsd)).toBe(ZERO_BALANCE);
  });

  it('should return a fresh object for each wallet initialization', () => {
    const firstWallet = buildInitialWalletCreateInput();
    const secondWallet = buildInitialWalletCreateInput();

    expect(firstWallet).not.toBe(secondWallet);
    expect(firstWallet.availableBtc).not.toBe(secondWallet.availableBtc);
    expect(firstWallet.availableUsd).not.toBe(secondWallet.availableUsd);
  });
});
