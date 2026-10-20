import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersRepository } from './users.repository';

describe('UsersRepository', () => {
  let repository: UsersRepository;
  let prisma: { user: { findUnique: jest.Mock }; $transaction: jest.Mock };
  let transaction: { user: { create: jest.Mock } };

  beforeEach(() => {
    transaction = { user: { create: jest.fn() } };
    prisma = {
      user: { findUnique: jest.fn() },
      $transaction: jest.fn(
        <T>(operation: (client: typeof transaction) => Promise<T>) =>
          operation(transaction),
      ),
    };
    repository = new UsersRepository(prisma as unknown as PrismaService);
  });

  it('should load the user and wallet by ID', async () => {
    const user = {
      id: 'user-1',
      username: 'alice',
      wallet: { id: 'wallet-1' },
    };
    prisma.user.findUnique.mockResolvedValueOnce(user);
    await expect(repository.findById('user-1')).resolves.toBe(user);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      include: { wallet: true },
    });
  });

  it('should load the user and wallet by the exact username', async () => {
    const user = {
      id: 'user-1',
      username: 'Alice',
      wallet: { id: 'wallet-1' },
    };
    prisma.user.findUnique.mockResolvedValueOnce(user);
    await expect(repository.findByUsername('Alice')).resolves.toBe(user);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { username: 'Alice' },
      include: { wallet: true },
    });
  });

  it.each(['findById', 'findByUsername'] as const)(
    'should preserve a missing user result from %s',
    async (method) => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(repository[method]('missing-user')).resolves.toBeNull();
    },
  );

  it('should create the user and initial wallet together in one transaction', async () => {
    const user = {
      id: 'user-1',
      username: 'alice',
      wallet: { id: 'wallet-1' },
    };
    transaction.user.create.mockResolvedValueOnce(user);
    await expect(repository.createWithWallet('alice')).resolves.toBe(user);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.user.create).toHaveBeenCalledWith({
      data: {
        username: 'alice',
        wallet: {
          create: {
            availableBtc: new Prisma.Decimal('100.00000000'),
            reservedBtc: new Prisma.Decimal('0.00000000'),
            availableUsd: new Prisma.Decimal('100000.00000000'),
            reservedUsd: new Prisma.Decimal('0.00000000'),
          },
        },
      },
      include: { wallet: true },
    });
  });

  it('should propagate failed nested creation through the transaction', async () => {
    const failure = new Error('Wallet creation failed');
    transaction.user.create.mockRejectedValueOnce(failure);
    await expect(repository.createWithWallet('alice')).rejects.toBe(failure);
  });

  it('should identify Prisma unique constraint violations for login race recovery', () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['username'] },
      },
    );
    expect(repository.isUniqueUsernameViolation(error)).toBe(true);
  });

  it.each(['P2001', 'P2003', 'P2025'])(
    'should not treat %s as a unique username violation',
    (code) => {
      const error = new Prisma.PrismaClientKnownRequestError('Database error', {
        code,
        clientVersion: '6.19.3',
      });
      expect(repository.isUniqueUsernameViolation(error)).toBe(false);
    },
  );

  it.each([
    null,
    undefined,
    new Error('Database unavailable'),
    { code: 'P2002' },
  ])(
    'should not classify non-Prisma failures as unique violations (%s)',
    (error) => {
      expect(repository.isUniqueUsernameViolation(error)).toBe(false);
    },
  );
});
