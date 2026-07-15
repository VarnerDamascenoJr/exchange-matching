import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma, User, Wallet } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildInitialWalletCreateInput } from '../wallets/wallet.constants';

export type UserWithWallet = User & {
  wallet: Wallet;
};

type UserWithOptionalWallet = User & {
  wallet: Wallet | null;
};

@Injectable()
export class UsersService {
  constructor(private readonly prismaService: PrismaService) {}

  async findById(id: string): Promise<UserWithWallet | null> {
    const user = await this.prismaService.user.findUnique({
      where: { id },
      include: { wallet: true },
    });

    return user ? this.ensureWallet(user) : null;
  }

  async findByUsername(username: string): Promise<UserWithWallet | null> {
    const user = await this.prismaService.user.findUnique({
      where: { username },
      include: { wallet: true },
    });

    return user ? this.ensureWallet(user) : null;
  }

  async createWithWallet(username: string): Promise<UserWithWallet> {
    const user = await this.prismaService.$transaction((transactionClient) =>
      transactionClient.user.create({
        data: {
          username,
          wallet: {
            create: buildInitialWalletCreateInput(),
          },
        },
        include: { wallet: true },
      }),
    );

    return this.ensureWallet(user);
  }

  isUniqueUsernameViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private ensureWallet(user: UserWithOptionalWallet): UserWithWallet {
    if (!user.wallet) {
      throw new InternalServerErrorException('Wallet not found for user');
    }

    return user as UserWithWallet;
  }
}
