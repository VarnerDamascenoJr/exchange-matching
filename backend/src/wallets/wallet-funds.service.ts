import { BadRequestException, Injectable } from '@nestjs/common';
import { OrderSide, Prisma, PrismaClient, Wallet } from '@prisma/client';
import { multiplyScaled } from '../common/decimal.utils';

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class WalletFundsService {
  async reserveFunds(
    transactionClient: TransactionClient,
    wallet: Wallet,
    side: OrderSide,
    amount: Prisma.Decimal,
    price: Prisma.Decimal,
  ): Promise<void> {
    if (side === OrderSide.BUY) {
      const requiredUsd = multiplyScaled(amount, price);
      const updatedWallet = await transactionClient.wallet.updateMany({
        where: {
          userId: wallet.userId,
          availableUsd: {
            gte: requiredUsd,
          },
        },
        data: {
          availableUsd: {
            decrement: requiredUsd,
          },
          reservedUsd: {
            increment: requiredUsd,
          },
        },
      });

      if (updatedWallet.count === 0) {
        throw new BadRequestException('Insufficient USD balance');
      }

      return;
    }

    const updatedWallet = await transactionClient.wallet.updateMany({
      where: {
        userId: wallet.userId,
        availableBtc: {
          gte: amount,
        },
      },
      data: {
        availableBtc: {
          decrement: amount,
        },
        reservedBtc: {
          increment: amount,
        },
      },
    });

    if (updatedWallet.count === 0) {
      throw new BadRequestException('Insufficient BTC balance');
    }
  }

  async releaseFunds(
    transactionClient: TransactionClient,
    order: {
      userId: string;
      side: OrderSide;
      price: Prisma.Decimal;
      remainingAmount: Prisma.Decimal;
    },
  ): Promise<void> {
    if (order.side === OrderSide.BUY) {
      const releasedUsd = multiplyScaled(order.remainingAmount, order.price);
      await transactionClient.wallet.update({
        where: {
          userId: order.userId,
        },
        data: {
          availableUsd: {
            increment: releasedUsd,
          },
          reservedUsd: {
            decrement: releasedUsd,
          },
        },
      });

      return;
    }

    await transactionClient.wallet.update({
      where: {
        userId: order.userId,
      },
      data: {
        availableBtc: {
          increment: order.remainingAmount,
        },
        reservedBtc: {
          decrement: order.remainingAmount,
        },
      },
    });
  }
}
