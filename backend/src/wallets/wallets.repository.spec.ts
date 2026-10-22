import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsRepository } from './wallets.repository';

describe('WalletsRepository', () => {
  let repository: WalletsRepository;
  let rootWalletFindUnique: jest.Mock;
  let transaction: {
    $queryRaw: jest.Mock;
    wallet: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    };
  };
  let transactionClient: Prisma.TransactionClient;

  beforeEach(() => {
    rootWalletFindUnique = jest.fn();
    repository = new WalletsRepository({
      wallet: { findUnique: rootWalletFindUnique },
    } as unknown as PrismaService);
    transaction = {
      $queryRaw: jest.fn(),
      wallet: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
    };
    transactionClient = transaction as unknown as Prisma.TransactionClient;
  });

  it('should find the wallet by owner using the root client outside a transaction', async () => {
    const wallet = { id: 'wallet-1', userId: 'user-1' };
    rootWalletFindUnique.mockResolvedValueOnce(wallet);
    await expect(repository.findByUserId('user-1')).resolves.toBe(wallet);
    expect(rootWalletFindUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(transaction.wallet.findUnique).not.toHaveBeenCalled();
  });

  it('should use the supplied transaction for wallet lookups', async () => {
    const wallet = { id: 'wallet-1', userId: 'user-1' };
    transaction.wallet.findUnique.mockResolvedValueOnce(wallet);
    await expect(
      repository.findByUserId('user-1', transactionClient),
    ).resolves.toBe(wallet);
    expect(transaction.wallet.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(rootWalletFindUnique).not.toHaveBeenCalled();
  });

  it('should preserve a missing wallet result', async () => {
    rootWalletFindUnique.mockResolvedValueOnce(null);
    await expect(repository.findByUserId('unknown-user')).resolves.toBeNull();
  });

  it.each([
    ['USD', 'availableUsd', 'reservedUsd'],
    ['BTC', 'availableBtc', 'reservedBtc'],
  ] as const)(
    'should atomically reserve %s only when the available balance covers it',
    async (asset, available, reserved) => {
      const amount = new Prisma.Decimal('0.12345678');
      transaction.wallet.updateMany.mockResolvedValueOnce({ count: 1 });
      await expect(
        repository.reserveFunds(transactionClient, 'user-1', asset, amount),
      ).resolves.toEqual({ count: 1 });
      expect(transaction.wallet.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          [available]: { gte: amount },
          [reserved]: {
            lte: new Prisma.Decimal('99999999999999999999.87654321'),
          },
        },
        data: {
          [available]: { decrement: amount },
          [reserved]: { increment: amount },
        },
      });
      expect(transaction.wallet.findUnique).not.toHaveBeenCalled();
    },
  );

  it.each(['USD', 'BTC'] as const)(
    'should report a failed %s reservation without a second write',
    async (asset) => {
      transaction.wallet.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(
        repository.reserveFunds(
          transactionClient,
          'user-1',
          asset,
          new Prisma.Decimal('1'),
        ),
      ).resolves.toEqual({ count: 0 });
      expect(transaction.wallet.updateMany).toHaveBeenCalledTimes(1);
      expect(transaction.wallet.update).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['USD', 'availableUsd', 'reservedUsd'],
    ['BTC', 'availableBtc', 'reservedBtc'],
  ] as const)(
    'should release %s within the supplied transaction',
    async (asset, available, reserved) => {
      const amount = new Prisma.Decimal('0.12345678');
      const wallet = { id: 'wallet-1' };
      transaction.wallet.update.mockResolvedValueOnce(wallet);
      await expect(
        repository.releaseFunds(transactionClient, 'user-1', asset, amount),
      ).resolves.toBe(wallet);
      expect(transaction.wallet.update).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          [available]: {
            lte: new Prisma.Decimal('99999999999999999999.87654321'),
          },
          [reserved]: { gte: amount },
        },
        data: {
          [available]: { increment: amount },
          [reserved]: { decrement: amount },
        },
      });
    },
  );

  it('should apply trade balance changes without converting precise decimal values', async () => {
    const data = {
      reservedUsd: { decrement: new Prisma.Decimal('10000.12345678') },
      availableBtc: { increment: new Prisma.Decimal('0.00000001') },
    };
    const wallet = { id: 'wallet-1' };
    transaction.wallet.update.mockResolvedValueOnce(wallet);
    await expect(
      repository.updateBalances(transactionClient, 'user-1', data),
    ).resolves.toBe(wallet);
    expect(transaction.wallet.update).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        reservedUsd: { gte: new Prisma.Decimal('10000.12345678') },
        availableBtc: {
          lte: new Prisma.Decimal('99999999999999999999.99999998'),
        },
      },
      data,
    });
  });

  it('rejects a calculated balance delta outside DECIMAL(28,8) before writing', async () => {
    await expect(
      repository.updateBalances(transactionClient, 'user-1', {
        availableUsd: {
          increment: new Prisma.Decimal('100000000000000000000'),
        },
      }),
    ).rejects.toThrow(BadRequestException);
    expect(transaction.wallet.update).not.toHaveBeenCalled();
  });

  it('returns a validation error when the live balance would overflow or become negative', async () => {
    transaction.wallet.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError(
        'No row satisfies balance bounds',
        { code: 'P2025', clientVersion: 'test' },
      ),
    );
    await expect(
      repository.updateBalances(transactionClient, 'user-1', {
        availableUsd: { increment: new Prisma.Decimal('0.00000001') },
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should lock unique wallets in a stable owner order before loading them', async () => {
    const walletA = { id: 'wallet-a', userId: 'user-a' };
    const walletB = { id: 'wallet-b', userId: 'user-b' };
    transaction.$queryRaw.mockResolvedValueOnce([]);
    transaction.wallet.findMany.mockImplementationOnce(() => {
      expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
      return Promise.resolve([walletB, walletA]);
    });
    await expect(
      repository.lockAndLoadByUserIds(transactionClient, [
        'user-b',
        'user-a',
        'user-b',
      ]),
    ).resolves.toEqual(
      new Map([
        ['user-b', walletB],
        ['user-a', walletA],
      ]),
    );
    const [sql, parameters] = transaction.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      Prisma.Sql,
    ];
    expect(sql.join('?')).toContain('ORDER BY "user_id" ASC');
    expect(sql.join('?')).toContain('FOR UPDATE');
    expect(parameters.values).toEqual(['user-a', 'user-b']);
    expect(transaction.wallet.findMany).toHaveBeenCalledWith({
      where: { userId: { in: ['user-a', 'user-b'] } },
    });
  });

  it('should parameterize owner IDs in the wallet locking query', async () => {
    const ownerId = "user'); DROP TABLE wallets; --";
    transaction.$queryRaw.mockResolvedValueOnce([]);
    transaction.wallet.findMany.mockResolvedValueOnce([]);
    await expect(
      repository.lockAndLoadByUserIds(transactionClient, [ownerId]),
    ).resolves.toEqual(new Map());
    const [sql, parameters] = transaction.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      Prisma.Sql,
    ];
    expect(sql.join('')).not.toContain(ownerId);
    expect(parameters.values).toEqual([ownerId]);
  });

  it('should skip database access when there are no owners to lock', async () => {
    await expect(
      repository.lockAndLoadByUserIds(transactionClient, []),
    ).resolves.toEqual(new Map());
    expect(transaction.$queryRaw).not.toHaveBeenCalled();
    expect(transaction.wallet.findMany).not.toHaveBeenCalled();
  });

  it('should propagate lock failures without reading unlocked wallets', async () => {
    const failure = new Error('Deadlock detected');
    transaction.$queryRaw.mockRejectedValueOnce(failure);
    await expect(
      repository.lockAndLoadByUserIds(transactionClient, ['user-1']),
    ).rejects.toBe(failure);
    expect(transaction.wallet.findMany).not.toHaveBeenCalled();
  });
});
