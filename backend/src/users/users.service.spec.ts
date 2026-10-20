import { InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UsersRepository } from './users.repository';
import { UsersService, UserWithWallet } from './users.service';

const buildUser = (): UserWithWallet => ({
  id: 'user-1',
  username: 'alice',
  createdAt: new Date('2026-10-15T18:00:00Z'),
  updatedAt: new Date('2026-10-15T18:00:00Z'),
  wallet: {
    id: 'wallet-1',
    userId: 'user-1',
    availableBtc: new Prisma.Decimal('100'),
    reservedBtc: new Prisma.Decimal('0'),
    availableUsd: new Prisma.Decimal('100000'),
    reservedUsd: new Prisma.Decimal('0'),
    createdAt: new Date('2026-10-15T18:00:00Z'),
    updatedAt: new Date('2026-10-15T18:00:00Z'),
  },
});

describe('UsersService', () => {
  let service: UsersService;
  let repository: jest.Mocked<UsersRepository>;

  beforeEach(() => {
    repository = {
      findById: jest.fn(),
      findByUsername: jest.fn(),
      createWithWallet: jest.fn(),
      isUniqueUsernameViolation: jest.fn(),
    } as unknown as jest.Mocked<UsersRepository>;
    service = new UsersService(repository);
  });

  it.each(['findById', 'findByUsername'] as const)(
    'should return existing users with their wallets through %s',
    async (method) => {
      const user = buildUser();
      repository[method].mockResolvedValueOnce(user);
      await expect(service[method]('lookup-value')).resolves.toBe(user);
      expect(repository[method]).toHaveBeenCalledWith('lookup-value');
    },
  );

  it.each(['findById', 'findByUsername'] as const)(
    'should return null for a missing user through %s',
    async (method) => {
      repository[method].mockResolvedValueOnce(null);
      await expect(service[method]('missing-user')).resolves.toBeNull();
    },
  );

  it.each(['findById', 'findByUsername', 'createWithWallet'] as const)(
    'should reject a user without a wallet returned by %s',
    async (method) => {
      repository[method].mockResolvedValueOnce({
        ...buildUser(),
        wallet: null,
      });
      await expect(service[method]('lookup-value')).rejects.toEqual(
        new InternalServerErrorException('Wallet not found for user'),
      );
    },
  );

  it('should delegate user creation and preserve the initial wallet', async () => {
    const user = buildUser();
    repository.createWithWallet.mockResolvedValueOnce(user);
    await expect(service.createWithWallet('alice')).resolves.toBe(user);
    expect(repository.createWithWallet).toHaveBeenCalledWith('alice');
  });

  it.each(['findById', 'findByUsername', 'createWithWallet'] as const)(
    'should propagate repository failures from %s',
    async (method) => {
      const failure = new Error('Database unavailable');
      repository[method].mockRejectedValueOnce(failure);
      await expect(service[method]('lookup-value')).rejects.toBe(failure);
    },
  );

  it.each([true, false])(
    'should delegate persistence error classification and return %s',
    (result) => {
      const error = new Error('Database error');
      repository.isUniqueUsernameViolation.mockReturnValueOnce(result);
      expect(service.isUniqueUsernameViolation(error)).toBe(result);
      expect(repository.isUniqueUsernameViolation).toHaveBeenCalledWith(error);
    },
  );
});
