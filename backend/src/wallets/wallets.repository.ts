import { Injectable } from '@nestjs/common';
import { Prisma, Wallet } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type WalletAsset = 'BTC' | 'USD';
type BalanceUpdate = Pick<
  Prisma.WalletUpdateInput,
  'availableBtc' | 'reservedBtc' | 'availableUsd' | 'reservedUsd'
>;

@Injectable()
export class WalletsRepository {
  constructor(private readonly prismaService: PrismaService) {}

  findByUserId(
    userId: string,
    transactionClient: Prisma.TransactionClient = this.prismaService,
  ): Promise<Wallet | null> {
    return transactionClient.wallet.findUnique({ where: { userId } });
  }

  reserveFunds(
    transactionClient: Prisma.TransactionClient,
    userId: string,
    asset: WalletAsset,
    amount: Prisma.Decimal,
  ) {
    return asset === 'USD'
      ? transactionClient.wallet.updateMany({
          where: { userId, availableUsd: { gte: amount } },
          data: {
            availableUsd: { decrement: amount },
            reservedUsd: { increment: amount },
          },
        })
      : transactionClient.wallet.updateMany({
          where: { userId, availableBtc: { gte: amount } },
          data: {
            availableBtc: { decrement: amount },
            reservedBtc: { increment: amount },
          },
        });
  }

  releaseFunds(
    transactionClient: Prisma.TransactionClient,
    userId: string,
    asset: WalletAsset,
    amount: Prisma.Decimal,
  ) {
    return this.updateBalances(
      transactionClient,
      userId,
      asset === 'USD'
        ? {
            availableUsd: { increment: amount },
            reservedUsd: { decrement: amount },
          }
        : {
            availableBtc: { increment: amount },
            reservedBtc: { decrement: amount },
          },
    );
  }

  updateBalances(
    transactionClient: Prisma.TransactionClient,
    userId: string,
    data: BalanceUpdate,
  ) {
    return transactionClient.wallet.update({ where: { userId }, data });
  }

  async lockAndLoadByUserIds(
    transactionClient: Prisma.TransactionClient,
    userIds: string[],
  ): Promise<Map<string, Wallet>> {
    const uniqueUserIds = [...new Set(userIds)].sort();

    if (uniqueUserIds.length === 0) {
      return new Map();
    }

    const userIdParameters = Prisma.join(
      uniqueUserIds.map((userId) => Prisma.sql`${userId}`),
    );

    await transactionClient.$queryRaw`
      SELECT "id"
      FROM "wallets"
      WHERE "user_id" IN (${userIdParameters})
      ORDER BY "user_id" ASC
      FOR UPDATE
    `;

    const wallets = await transactionClient.wallet.findMany({
      where: { userId: { in: uniqueUserIds } },
    });

    return new Map(wallets.map((wallet) => [wallet.userId, wallet]));
  }
}
