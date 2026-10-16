import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsModule } from './wallets.module';
import { WalletsRepository } from './wallets.repository';
import { WalletsService } from './wallets.service';

class WalletConsumer {
  constructor(
    readonly walletsService: WalletsService,
    readonly walletsRepository: WalletsRepository,
  ) {}
}

describe('WalletsModule', () => {
  let module: TestingModule;
  const findUnique = jest.fn();

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [WalletsModule],
      providers: [
        {
          provide: WalletConsumer,
          inject: [WalletsService, WalletsRepository],
          useFactory: (
            service: WalletsService,
            repository: WalletsRepository,
          ) => new WalletConsumer(service, repository),
        },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({ wallet: { findUnique } })
      .compile();
  });

  afterAll(async () => {
    await module.close();
  });

  it('should export the service and repository for API and matching consumers', () => {
    const consumer = module.get(WalletConsumer);
    const walletsModule = module.select(WalletsModule);
    expect(consumer.walletsService).toBe(
      walletsModule.get(WalletsService, { strict: true }),
    );
    expect(consumer.walletsRepository).toBe(
      walletsModule.get(WalletsRepository, { strict: true }),
    );
  });

  it('should wire wallet queries through the repository and Prisma provider', async () => {
    const wallet = { id: 'wallet-1', userId: 'user-1' };
    findUnique.mockResolvedValueOnce(wallet);
    await expect(
      module.get(WalletConsumer).walletsService.findByUserId('user-1'),
    ).resolves.toBe(wallet);
    expect(findUnique).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
  });
});
