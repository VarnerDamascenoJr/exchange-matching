import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, Wallet } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertDecimalFitsSchema,
  DECIMAL_MAX,
  subtractScaled,
} from '../common/decimal.utils';

type WalletAsset = 'BTC' | 'USD';
type BalanceField =
  'availableBtc' | 'reservedBtc' | 'availableUsd' | 'reservedUsd';
type BalanceUpdate = Partial<
  Record<
    BalanceField,
    {
      increment?: Prisma.Decimal;
      decrement?: Prisma.Decimal;
    }
  >
>;

// Check the live balance in the write predicate, including concurrent updates.
const balanceConstraints = (
  data: BalanceUpdate,
): Pick<Prisma.WalletWhereInput, BalanceField> => {
  const where: Pick<Prisma.WalletWhereInput, BalanceField> = {};
  for (const field of Object.keys(data) as BalanceField[]) {
    const { increment, decrement } = data[field]!;
    const delta = increment ?? decrement!;
    assertDecimalFitsSchema(delta, field);
    if (delta.lt(0)) {
      throw new BadRequestException('Balance changes must be nonnegative');
    }
    where[field] =
      increment !== undefined
        ? { lte: subtractScaled(DECIMAL_MAX, increment) }
        : { gte: decrement };
  }
  return where;
};

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
    const data: BalanceUpdate =
      asset === 'USD'
        ? {
            availableUsd: { decrement: amount },
            reservedUsd: { increment: amount },
          }
        : {
            availableBtc: { decrement: amount },
            reservedBtc: { increment: amount },
          };
    return transactionClient.wallet.updateMany({
      where: { userId, ...balanceConstraints(data) },
      data,
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

  async updateBalances(
    transactionClient: Prisma.TransactionClient,
    userId: string,
    data: BalanceUpdate,
  ) {
    const constraints = balanceConstraints(data);
    try {
      return await transactionClient.wallet.update({
        where: { userId, ...constraints },
        data,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new BadRequestException(
          'Balance update would exceed its numeric bounds',
        );
      }
      throw error;
    }
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
