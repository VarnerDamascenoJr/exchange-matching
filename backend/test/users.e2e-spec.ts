import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { UsersService } from '../src/users/users.service';
import * as walletConstants from '../src/wallets/wallet.constants';
import { WalletSummary } from '../src/wallets/wallet.mapper';

const describeDatabase =
  process.env.RUN_DATABASE_E2E === 'true' ? describe : describe.skip;

describeDatabase('User and wallet persistence (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let usersService: UsersService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    usersService = app.get(UsersService);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await prisma.realtimeEventOutbox.deleteMany();
    await prisma.orderMatchingOutbox.deleteMany();
    await prisma.trade.deleteMany();
    await prisma.order.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(username: string) {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username })
      .expect(201);
    return response.body as {
      accessToken: string;
      user: { id: string; username: string };
      wallet: WalletSummary;
    };
  }

  it('should create a normalized user and initial wallet and return only the public profile', async () => {
    const session = await login('  new-user  ');
    expect(session.user).toEqual({
      id: expect.any(String),
      username: 'new-user',
    });
    expect(session.wallet).toEqual({
      availableBtc: '100.00000000',
      reservedBtc: '0.00000000',
      availableUsd: '100000.00000000',
      reservedUsd: '0.00000000',
    });
    await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200)
      .expect(session.user);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      include: { wallet: true },
    });
    expect(user.wallet?.userId).toBe(user.id);
    await expect(prisma.user.count()).resolves.toBe(1);
    await expect(prisma.wallet.count()).resolves.toBe(1);
  });

  it('should reuse the persisted wallet without resetting balances on later logins', async () => {
    const first = await login('returning-user');
    const wallet = await prisma.wallet.update({
      where: { userId: first.user.id },
      data: {
        availableBtc: '10.5',
        reservedBtc: '1.5',
        availableUsd: '8000',
        reservedUsd: '2000',
      },
    });
    const second = await login('returning-user');
    expect(second.user).toEqual(first.user);
    expect(second.wallet).toEqual({
      availableBtc: '10.50000000',
      reservedBtc: '1.50000000',
      availableUsd: '8000.00000000',
      reservedUsd: '2000.00000000',
    });
    const storedWallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: first.user.id },
    });
    expect(storedWallet.id).toBe(wallet.id);
    expect(storedWallet.createdAt).toEqual(wallet.createdAt);
    await expect(prisma.user.count()).resolves.toBe(1);
    await expect(prisma.wallet.count()).resolves.toBe(1);
  });

  it('should share one user and wallet across concurrent logins for the same normalized username', async () => {
    const sessions = await Promise.all([
      login('parallel-user'),
      login(' parallel-user '),
      login('parallel-user'),
    ]);
    expect(new Set(sessions.map((session) => session.user.id)).size).toBe(1);
    for (const session of sessions) {
      expect(session.user.username).toBe('parallel-user');
      expect(session.wallet.availableBtc).toBe('100.00000000');
      expect(session.wallet.availableUsd).toBe('100000.00000000');
    }
    await expect(prisma.user.count()).resolves.toBe(1);
    await expect(prisma.wallet.count()).resolves.toBe(1);
  });

  it('should retrieve persisted users and wallets by ID and username and preserve missing results', async () => {
    const session = await login('lookup-user');
    await expect(usersService.findById(session.user.id)).resolves.toMatchObject(
      { ...session.user, wallet: { userId: session.user.id } },
    );
    await expect(
      usersService.findByUsername('lookup-user'),
    ).resolves.toMatchObject({
      ...session.user,
      wallet: { userId: session.user.id },
    });
    await expect(usersService.findById('missing-user')).resolves.toBeNull();
    await expect(
      usersService.findByUsername('missing-user'),
    ).resolves.toBeNull();
  });

  it('should classify a real duplicate username error without creating another wallet', async () => {
    await usersService.createWithWallet('duplicate-user');
    let failure: unknown;
    try {
      await usersService.createWithWallet('duplicate-user');
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(usersService.isUniqueUsernameViolation(failure)).toBe(true);
    await expect(prisma.user.count()).resolves.toBe(1);
    await expect(prisma.wallet.count()).resolves.toBe(1);
  });

  it('should roll back the user when its nested wallet fails a database constraint', async () => {
    const initialWallet = walletConstants.buildInitialWalletCreateInput();
    jest
      .spyOn(walletConstants, 'buildInitialWalletCreateInput')
      .mockReturnValueOnce({
        ...initialWallet,
        availableUsd: new Prisma.Decimal('-1'),
      });
    await expect(
      usersService.createWithWallet('wallet-rollback-user'),
    ).rejects.toThrow();
    await expect(prisma.user.count()).resolves.toBe(0);
    await expect(prisma.wallet.count()).resolves.toBe(0);
  });

  it('should reject a profile request when the token’s user no longer exists', async () => {
    const session = await login('deleted-user');
    await prisma.user.delete({ where: { id: session.user.id } });
    await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(401);
    await expect(prisma.wallet.count()).resolves.toBe(0);
  });
});
