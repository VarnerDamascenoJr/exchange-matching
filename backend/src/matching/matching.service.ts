import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Order,
  OrderSide,
  OrderStatus,
  Prisma,
  PrismaClient,
  TradeFeeAsset,
  Wallet,
} from '@prisma/client';
import { multiplyScaled, subtractScaled } from '../common/decimal.utils';
import { PrismaService } from '../prisma/prisma.service';

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);
  private static readonly MAKER_FEE_RATE = new Prisma.Decimal('0.005');
  private static readonly TAKER_FEE_RATE = new Prisma.Decimal('0.003');

  constructor(private readonly prismaService: PrismaService) {}

  async processOrder(orderId: string): Promise<void> {
    await this.prismaService.$transaction(async (transactionClient) => {
      const taker = await this.lockAndLoadOrder(transactionClient, orderId);

      if (!taker) {
        throw new NotFoundException(`Order ${orderId} not found`);
      }

      if (taker.status !== OrderStatus.QUEUED) {
        this.logger.log(
          `Skipping order ${taker.id} because status is ${taker.status}`,
        );
        return;
      }

      const makers = await this.findAndLockEligibleMakers(
        transactionClient,
        taker,
      );

      if (makers.length === 0) {
        await transactionClient.order.update({
          where: {
            id: taker.id,
          },
          data: {
            status: OrderStatus.OPEN,
          },
        });

        this.logger.log(`Order ${taker.id} moved from QUEUED to OPEN`);
        return;
      }

      let takerRemaining = new Prisma.Decimal(taker.remainingAmount);
      let matchedAmount = new Prisma.Decimal(0);

      for (const maker of makers) {
        if (takerRemaining.lte(0)) {
          break;
        }

        const makerRemaining = new Prisma.Decimal(maker.remainingAmount);

        if (makerRemaining.lte(0)) {
          continue;
        }

        const tradeAmount = takerRemaining.lt(makerRemaining)
          ? takerRemaining
          : makerRemaining;
        const tradePrice = new Prisma.Decimal(maker.price);

        const lockedWallets = await this.lockAndLoadWallets(transactionClient, [
          taker.userId,
          maker.userId,
        ]);
        const takerWallet = lockedWallets.get(taker.userId);
        const makerWallet = lockedWallets.get(maker.userId);

        if (!takerWallet || !makerWallet) {
          throw new NotFoundException('Wallet not found for matched order');
        }

        await this.applyTradeBalances(
          transactionClient,
          taker,
          maker,
          takerWallet,
          makerWallet,
          tradeAmount,
          tradePrice,
        );

        const feeDetails = this.buildFeeDetails(
          taker.side,
          tradeAmount,
          tradePrice,
        );

        const nextMakerRemaining = makerRemaining.sub(tradeAmount);
        const buyOrderId = taker.side === OrderSide.BUY ? taker.id : maker.id;
        const sellOrderId = taker.side === OrderSide.SELL ? taker.id : maker.id;

        await transactionClient.trade.create({
          data: {
            makerOrderId: maker.id,
            takerOrderId: taker.id,
            buyOrderId,
            sellOrderId,
            takerSide: taker.side,
            makerFeeRate: MatchingService.MAKER_FEE_RATE,
            makerFeeAmount: feeDetails.makerFeeAmount,
            makerFeeAsset: feeDetails.makerFeeAsset,
            takerFeeRate: MatchingService.TAKER_FEE_RATE,
            takerFeeAmount: feeDetails.takerFeeAmount,
            takerFeeAsset: feeDetails.takerFeeAsset,
            price: tradePrice,
            amount: tradeAmount,
          },
        });

        await transactionClient.order.update({
          where: {
            id: maker.id,
          },
          data: {
            remainingAmount: nextMakerRemaining,
            status: nextMakerRemaining.eq(0)
              ? OrderStatus.FILLED
              : OrderStatus.PARTIALLY_FILLED,
          },
        });

        takerRemaining = takerRemaining.sub(tradeAmount);
        matchedAmount = matchedAmount.add(tradeAmount);
      }

      const takerStatus = matchedAmount.eq(0)
        ? OrderStatus.OPEN
        : takerRemaining.eq(0)
          ? OrderStatus.FILLED
          : OrderStatus.PARTIALLY_FILLED;

      await transactionClient.order.update({
        where: {
          id: taker.id,
        },
        data: {
          remainingAmount: takerRemaining,
          status: takerStatus,
        },
      });

      this.logger.log(
        `Processed order ${taker.id} with final status ${takerStatus} and remaining amount ${takerRemaining.toFixed(8)}`,
      );
    });
  }

  private async lockAndLoadOrder(
    transactionClient: TransactionClient,
    orderId: string,
  ): Promise<Order | null> {
    await transactionClient.$queryRaw`
      SELECT "id"
      FROM "orders"
      WHERE "id" = ${orderId}
      FOR UPDATE
    `;

    return transactionClient.order.findUnique({
      where: {
        id: orderId,
      },
    });
  }

  private async findAndLockEligibleMakers(
    transactionClient: TransactionClient,
    taker: Order,
  ): Promise<Order[]> {
    const candidateIds = await transactionClient.order.findMany({
      where: {
        side: taker.side === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY,
        status: {
          in: [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED],
        },
        price:
          taker.side === OrderSide.BUY
            ? {
                lte: taker.price,
              }
            : {
                gte: taker.price,
              },
      },
      select: {
        id: true,
      },
      orderBy:
        taker.side === OrderSide.BUY
          ? [{ price: 'asc' }, { sequence: 'asc' }]
          : [{ price: 'desc' }, { sequence: 'asc' }],
    });

    const makers: Order[] = [];

    for (const candidate of candidateIds) {
      const lockedRows = await transactionClient.$queryRaw<{ id: string }[]>`
        SELECT "id"
        FROM "orders"
        WHERE "id" = ${candidate.id}
        FOR UPDATE SKIP LOCKED
      `;

      if (lockedRows.length === 0) {
        continue;
      }

      const maker = await transactionClient.order.findUnique({
        where: {
          id: candidate.id,
        },
      });

      if (!maker) {
        continue;
      }

      if (!this.isEligibleMaker(taker, maker)) {
        continue;
      }

      makers.push(maker);
    }

    return makers;
  }

  private isEligibleMaker(taker: Order, maker: Order): boolean {
    if (
      maker.status !== OrderStatus.OPEN &&
      maker.status !== OrderStatus.PARTIALLY_FILLED
    ) {
      return false;
    }

    if (maker.remainingAmount.lte(0)) {
      return false;
    }

    if (taker.side === OrderSide.BUY) {
      return maker.side === OrderSide.SELL && maker.price.lte(taker.price);
    }

    return maker.side === OrderSide.BUY && maker.price.gte(taker.price);
  }

  private async lockAndLoadWallets(
    transactionClient: TransactionClient,
    userIds: string[],
  ): Promise<Map<string, Wallet>> {
    const uniqueUserIds = [...new Set(userIds)].sort();
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
      where: {
        userId: {
          in: uniqueUserIds,
        },
      },
    });

    return new Map(wallets.map((wallet) => [wallet.userId, wallet]));
  }

  private async applyTradeBalances(
    transactionClient: TransactionClient,
    taker: Order,
    maker: Order,
    takerWallet: Wallet,
    makerWallet: Wallet,
    tradeAmount: Prisma.Decimal,
    tradePrice: Prisma.Decimal,
  ) {
    if (taker.side === OrderSide.BUY) {
      await this.applyBuyTakerBalances(
        transactionClient,
        taker,
        maker,
        takerWallet,
        makerWallet,
        tradeAmount,
        tradePrice,
      );
      return;
    }

    await this.applySellTakerBalances(
      transactionClient,
      taker,
      maker,
      takerWallet,
      makerWallet,
      tradeAmount,
      tradePrice,
    );
  }

  private async applyBuyTakerBalances(
    transactionClient: TransactionClient,
    taker: Order,
    maker: Order,
    takerWallet: Wallet,
    makerWallet: Wallet,
    tradeAmount: Prisma.Decimal,
    tradePrice: Prisma.Decimal,
  ) {
    const reservedCost = multiplyScaled(tradeAmount, taker.price);
    const executedCost = multiplyScaled(tradeAmount, tradePrice);
    const priceImprovement = subtractScaled(reservedCost, executedCost);
    const takerFeeAmount = multiplyScaled(
      tradeAmount,
      MatchingService.TAKER_FEE_RATE,
    );
    const makerFeeAmount = multiplyScaled(
      executedCost,
      MatchingService.MAKER_FEE_RATE,
    );
    const receivedBtc = subtractScaled(tradeAmount, takerFeeAmount);
    const receivedUsd = subtractScaled(executedCost, makerFeeAmount);

    await transactionClient.wallet.update({
      where: {
        userId: takerWallet.userId,
      },
      data: {
        reservedUsd: {
          decrement: reservedCost,
        },
        availableUsd: {
          increment: priceImprovement,
        },
        availableBtc: {
          increment: receivedBtc,
        },
      },
    });

    await transactionClient.wallet.update({
      where: {
        userId: makerWallet.userId,
      },
      data: {
        reservedBtc: {
          decrement: tradeAmount,
        },
        availableUsd: {
          increment: receivedUsd,
        },
      },
    });

    this.logger.log(
      `Matched BUY taker ${taker.id} with SELL maker ${maker.id} for ${tradeAmount.toFixed(8)} BTC at ${tradePrice.toFixed(8)}`,
    );
  }

  private async applySellTakerBalances(
    transactionClient: TransactionClient,
    taker: Order,
    maker: Order,
    takerWallet: Wallet,
    makerWallet: Wallet,
    tradeAmount: Prisma.Decimal,
    tradePrice: Prisma.Decimal,
  ) {
    const executedCost = multiplyScaled(tradeAmount, tradePrice);
    const takerFeeAmount = multiplyScaled(
      executedCost,
      MatchingService.TAKER_FEE_RATE,
    );
    const makerFeeAmount = multiplyScaled(
      tradeAmount,
      MatchingService.MAKER_FEE_RATE,
    );
    const receivedUsd = subtractScaled(executedCost, takerFeeAmount);
    const receivedBtc = subtractScaled(tradeAmount, makerFeeAmount);

    await transactionClient.wallet.update({
      where: {
        userId: takerWallet.userId,
      },
      data: {
        reservedBtc: {
          decrement: tradeAmount,
        },
        availableUsd: {
          increment: receivedUsd,
        },
      },
    });

    await transactionClient.wallet.update({
      where: {
        userId: makerWallet.userId,
      },
      data: {
        reservedUsd: {
          decrement: executedCost,
        },
        availableBtc: {
          increment: receivedBtc,
        },
      },
    });

    this.logger.log(
      `Matched SELL taker ${taker.id} with BUY maker ${maker.id} for ${tradeAmount.toFixed(8)} BTC at ${tradePrice.toFixed(8)}`,
    );
  }

  private buildFeeDetails(
    takerSide: OrderSide,
    tradeAmount: Prisma.Decimal,
    tradePrice: Prisma.Decimal,
  ) {
    const executedCost = multiplyScaled(tradeAmount, tradePrice);

    if (takerSide === OrderSide.BUY) {
      return {
        makerFeeAmount: multiplyScaled(
          executedCost,
          MatchingService.MAKER_FEE_RATE,
        ),
        makerFeeAsset: TradeFeeAsset.USD,
        takerFeeAmount: multiplyScaled(
          tradeAmount,
          MatchingService.TAKER_FEE_RATE,
        ),
        takerFeeAsset: TradeFeeAsset.BTC,
      };
    }

    return {
      makerFeeAmount: multiplyScaled(
        tradeAmount,
        MatchingService.MAKER_FEE_RATE,
      ),
      makerFeeAsset: TradeFeeAsset.BTC,
      takerFeeAmount: multiplyScaled(
        executedCost,
        MatchingService.TAKER_FEE_RATE,
      ),
      takerFeeAsset: TradeFeeAsset.USD,
    };
  }
}
