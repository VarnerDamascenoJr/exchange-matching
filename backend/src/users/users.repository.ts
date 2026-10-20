import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildInitialWalletCreateInput } from '../wallets/wallet.constants';

@Injectable()
export class UsersRepository {
  constructor(private readonly prismaService: PrismaService) {}

  findById(id: string) {
    return this.prismaService.user.findUnique({
      where: { id },
      include: { wallet: true },
    });
  }

  findByUsername(username: string) {
    return this.prismaService.user.findUnique({
      where: { username },
      include: { wallet: true },
    });
  }

  createWithWallet(username: string) {
    return this.prismaService.$transaction((transactionClient) =>
      transactionClient.user.create({
        data: {
          username,
          wallet: { create: buildInitialWalletCreateInput() },
        },
        include: { wallet: true },
      }),
    );
  }

  isUniqueUsernameViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
