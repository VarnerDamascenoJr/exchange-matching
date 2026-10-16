import { Prisma } from '@prisma/client';
import { toWalletSummary } from './wallet.mapper';

describe('toWalletSummary', () => {
  it('should format every available and reserved balance to eight decimal places', () => {
    expect(
      toWalletSummary({
        availableBtc: new Prisma.Decimal('99.5'),
        reservedBtc: new Prisma.Decimal('0.5'),
        availableUsd: new Prisma.Decimal('95000.25'),
        reservedUsd: new Prisma.Decimal('4999.75'),
      }),
    ).toEqual({
      availableBtc: '99.50000000',
      reservedBtc: '0.50000000',
      availableUsd: '95000.25000000',
      reservedUsd: '4999.75000000',
    });
  });

  it('should preserve DECIMAL(28,8) precision and the smallest balance unit', () => {
    expect(
      toWalletSummary({
        availableBtc: new Prisma.Decimal('0.00000001'),
        reservedBtc: new Prisma.Decimal('99999999999999999999.12345678'),
        availableUsd: new Prisma.Decimal('99999999999999999999.99999999'),
        reservedUsd: new Prisma.Decimal('0.00000001'),
      }),
    ).toEqual({
      availableBtc: '0.00000001',
      reservedBtc: '99999999999999999999.12345678',
      availableUsd: '99999999999999999999.99999999',
      reservedUsd: '0.00000001',
    });
  });

  it('should format empty balances as zero rather than scientific notation', () => {
    expect(
      toWalletSummary({
        availableBtc: 0,
        reservedBtc: 0,
        availableUsd: 0,
        reservedUsd: 0,
      }),
    ).toEqual({
      availableBtc: '0.00000000',
      reservedBtc: '0.00000000',
      availableUsd: '0.00000000',
      reservedUsd: '0.00000000',
    });
  });

  it('should expose only the balance fields from a persisted wallet', () => {
    const wallet = {
      id: 'wallet-1',
      userId: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      availableBtc: new Prisma.Decimal('100'),
      reservedBtc: new Prisma.Decimal('0'),
      availableUsd: new Prisma.Decimal('100000'),
      reservedUsd: new Prisma.Decimal('0'),
    };
    expect(Object.keys(toWalletSummary(wallet)).sort()).toEqual([
      'availableBtc',
      'availableUsd',
      'reservedBtc',
      'reservedUsd',
    ]);
  });
});
