import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { UsersModule } from './users.module';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

class UserConsumer {
  constructor(readonly usersService: UsersService) {}
}

describe('UsersModule', () => {
  let module: TestingModule;
  const findUnique = jest.fn();

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [UsersModule],
      providers: [
        {
          provide: UserConsumer,
          inject: [UsersService],
          useFactory: (service: UsersService) => new UserConsumer(service),
        },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({ user: { findUnique } })
      .compile();
  });

  afterAll(async () => {
    await module.close();
  });

  it('should provide the repository and export the service to authentication consumers', () => {
    const usersModule = module.select(UsersModule);
    expect(usersModule.get(UsersRepository, { strict: true })).toBeInstanceOf(
      UsersRepository,
    );
    expect(module.get(UserConsumer).usersService).toBe(
      usersModule.get(UsersService, { strict: true }),
    );
  });

  it('should resolve the exported service through the repository and Prisma provider', async () => {
    const user = {
      id: 'user-1',
      username: 'alice',
      wallet: { id: 'wallet-1' },
    };
    findUnique.mockResolvedValueOnce(user);
    await expect(
      module.get(UserConsumer).usersService.findById('user-1'),
    ).resolves.toBe(user);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      include: { wallet: true },
    });
  });
});
