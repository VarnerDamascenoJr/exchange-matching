import { BadRequestException } from '@nestjs/common';
import { OrderSide, Prisma, Wallet } from '@prisma/client';
import { WalletsRepository } from './wallets.repository';
import { WalletsService } from './wallets.service';

const buildWallet = (): Wallet => ({
  id: 'wallet-1',
  userId: 'user-1',
  availableBtc: new Prisma.Decimal('100'),
  reservedBtc: new Prisma.Decimal('0'),
  availableUsd: new Prisma.Decimal('100000'),
  reservedUsd: new Prisma.Decimal('0'),
  createdAt: new Date('2026-10-15T15:00:00Z'),
  updatedAt: new Date('2026-10-15T15:00:00Z'),
});

describe('WalletsService', () => {
  let service: WalletsService;
  let repository: jest.Mocked<WalletsRepository>;
  const transactionClient = {} as Prisma.TransactionClient;

  beforeEach(() => {
    repository = {
      findByUserId: jest.fn(),
      reserveFunds: jest.fn(),
      releaseFunds: jest.fn(),
    } as unknown as jest.Mocked<WalletsRepository>;
    service = new WalletsService(repository);
  });

  it('should return the wallet from the repository', async () => {
    const wallet = buildWallet();
    repository.findByUserId.mockResolvedValueOnce(wallet);
    await expect(service.findByUserId(wallet.userId)).resolves.toBe(wallet);
    expect(repository.findByUserId).toHaveBeenCalledWith(
      wallet.userId,
      undefined,
    );
  });

  it('should forward the transaction when loading a wallet for an order', async () => {
    repository.findByUserId.mockResolvedValueOnce(buildWallet());
    await service.findByUserId('user-1', transactionClient);
    expect(repository.findByUserId).toHaveBeenCalledWith(
      'user-1',
      transactionClient,
    );
  });

  it('should preserve missing wallet results', async () => {
    repository.findByUserId.mockResolvedValueOnce(null);
    await expect(service.findByUserId('missing-user')).resolves.toBeNull();
  });

  it.each([
    [OrderSide.BUY, 'USD', '0.5', '10000', '5000'],
    [OrderSide.SELL, 'BTC', '0.75', '12000', '0.75'],
    [OrderSide.BUY, 'USD', '0.1', '0.33333333', '0.03333333'],
    [
      OrderSide.BUY,
      'USD',
      '0.00000001',
      '99999999999999999999.12345678',
      '999999999999.99999999',
    ],
  ] as const)(
    'should reserve %s funds in %s using eight-decimal arithmetic (%s × %s)',
    async (side, asset, amount, price, expectedAmount) => {
      repository.reserveFunds.mockResolvedValueOnce({ count: 1 });
      await expect(
        service.reserveFunds(
          transactionClient,
          buildWallet(),
          side,
          new Prisma.Decimal(amount),
          new Prisma.Decimal(price),
        ),
      ).resolves.toBeUndefined();
      expect(repository.reserveFunds).toHaveBeenCalledWith(
        transactionClient,
        'user-1',
        asset,
        new Prisma.Decimal(expectedAmount),
      );
    },
  );

  it.each([
    [OrderSide.BUY, 'USD'],
    [OrderSide.SELL, 'BTC'],
  ] as const)(
    'should reject %s orders when the atomic %s reservation fails',
    async (side, asset) => {
      repository.reserveFunds.mockResolvedValueOnce({ count: 0 });
      await expect(
        service.reserveFunds(
          transactionClient,
          buildWallet(),
          side,
          new Prisma.Decimal('1'),
          new Prisma.Decimal('10000'),
        ),
      ).rejects.toEqual(
        new BadRequestException(`Insufficient ${asset} balance`),
      );
      expect(repository.releaseFunds).not.toHaveBeenCalled();
    },
  );

  it.each([
    [OrderSide.BUY, 'USD', '0.25', '10000', '2500'],
    [OrderSide.SELL, 'BTC', '0.75', '12000', '0.75'],
    [OrderSide.BUY, 'USD', '0.1', '0.33333333', '0.03333333'],
    [OrderSide.BUY, 'USD', '0', '10000', '0'],
    [OrderSide.SELL, 'BTC', '0', '10000', '0'],
  ] as const)(
    'should release only the remaining %s amount in %s (%s × %s)',
    async (side, asset, amount, price, expectedAmount) => {
      repository.releaseFunds.mockResolvedValueOnce(buildWallet());
      await expect(
        service.releaseFunds(transactionClient, {
          userId: 'user-1',
          side,
          remainingAmount: new Prisma.Decimal(amount),
          price: new Prisma.Decimal(price),
        }),
      ).resolves.toBeUndefined();
      expect(repository.releaseFunds).toHaveBeenCalledWith(
        transactionClient,
        'user-1',
        asset,
        new Prisma.Decimal(expectedAmount),
      );
    },
  );

  it('should propagate reservation errors so the enclosing order transaction can roll back', async () => {
    const failure = new Error('Database unavailable');
    repository.reserveFunds.mockRejectedValueOnce(failure);
    await expect(
      service.reserveFunds(
        transactionClient,
        buildWallet(),
        OrderSide.BUY,
        new Prisma.Decimal('1'),
        new Prisma.Decimal('10000'),
      ),
    ).rejects.toBe(failure);
  });

  it('should propagate release errors so the enclosing cancellation transaction can roll back', async () => {
    const failure = new Error('Balance update failed');
    repository.releaseFunds.mockRejectedValueOnce(failure);
    await expect(
      service.releaseFunds(transactionClient, {
        userId: 'user-1',
        side: OrderSide.BUY,
        remainingAmount: new Prisma.Decimal('1'),
        price: new Prisma.Decimal('10000'),
      }),
    ).rejects.toBe(failure);
  });
});
