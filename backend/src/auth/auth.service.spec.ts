import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';

const buildUserWithWallet = (overrides?: {
  id?: string;
  username?: string;
  availableBtc?: string;
  reservedBtc?: string;
  availableUsd?: string;
  reservedUsd?: string;
}) => ({
  id: overrides?.id ?? 'user-1',
  username: overrides?.username ?? 'alice',
  createdAt: new Date(),
  updatedAt: new Date(),
  wallet: {
    id: 'wallet-1',
    userId: overrides?.id ?? 'user-1',
    availableBtc: new Prisma.Decimal(overrides?.availableBtc ?? '100'),
    reservedBtc: new Prisma.Decimal(overrides?.reservedBtc ?? '0'),
    availableUsd: new Prisma.Decimal(overrides?.availableUsd ?? '100000'),
    reservedUsd: new Prisma.Decimal(overrides?.reservedUsd ?? '0'),
    createdAt: new Date(),
    updatedAt: new Date(),
  },
});

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let walletsService: jest.Mocked<WalletsService>;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(() => {
    usersService = {
      findById: jest.fn(),
      findByUsername: jest.fn(),
      createWithWallet: jest.fn(),
      isUniqueUsernameViolation: jest.fn(),
    } as unknown as jest.Mocked<UsersService>;

    walletsService = {
      findByUserId: jest.fn(),
    } as unknown as jest.Mocked<WalletsService>;

    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed-jwt'),
    } as unknown as jest.Mocked<JwtService>;

    authService = new AuthService(usersService, walletsService, jwtService);
  });

  it('should create a user and wallet when the username does not exist', async () => {
    const createdUser = buildUserWithWallet();
    usersService.findByUsername.mockResolvedValueOnce(null);
    usersService.createWithWallet.mockResolvedValueOnce(createdUser);

    const session = await authService.login('alice');

    expect(usersService.createWithWallet.mock.calls).toEqual([['alice']]);
    expect(session.accessToken).toBe('signed-jwt');
    expect(session.user).toEqual({
      id: 'user-1',
      username: 'alice',
    });
    expect(session.wallet.availableBtc).toBe('100.00000000');
    expect(session.wallet.availableUsd).toBe('100000.00000000');
  });

  it('should authenticate an existing user without recreating the wallet balances', async () => {
    const existingUser = buildUserWithWallet({
      availableBtc: '25.5',
      availableUsd: '8000',
    });
    usersService.findByUsername.mockResolvedValueOnce(existingUser);

    const session = await authService.login('alice');

    expect(usersService.createWithWallet.mock.calls).toHaveLength(0);
    expect(session.wallet.availableBtc).toBe('25.50000000');
    expect(session.wallet.availableUsd).toBe('8000.00000000');
  });

  it('should recover from a unique username race by loading the created user', async () => {
    const raceUser = buildUserWithWallet();
    const uniqueError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        code: 'P2002',
        clientVersion: '6.19.3',
      },
    );

    usersService.findByUsername
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(raceUser);
    usersService.createWithWallet.mockRejectedValueOnce(uniqueError);
    usersService.isUniqueUsernameViolation.mockReturnValueOnce(true);

    const session = await authService.login('alice');

    expect(session.user.username).toBe('alice');
    expect(usersService.findByUsername.mock.calls).toHaveLength(2);
  });

  it('should return the authenticated user profile from the token subject', async () => {
    usersService.findById.mockResolvedValueOnce(buildUserWithWallet());

    await expect(authService.getMe('user-1')).resolves.toEqual({
      id: 'user-1',
      username: 'alice',
    });
  });

  it('should return the authenticated wallet balances as strings', async () => {
    walletsService.findByUserId.mockResolvedValueOnce(
      buildUserWithWallet().wallet,
    );

    await expect(authService.getWallet('user-1')).resolves.toEqual({
      availableBtc: '100.00000000',
      reservedBtc: '0.00000000',
      availableUsd: '100000.00000000',
      reservedUsd: '0.00000000',
    });
  });
});
