import { Injectable, Logger } from '@nestjs/common';
import {
  Order,
  OrderSide,
  Prisma,
  PrismaClient,
  TradeFeeAsset,
  Wallet,
} from '@prisma/client';
import { multiplyScaled, subtractScaled } from '../common/decimal.utils';

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export type TradeFeeDetails = {
  makerFeeRate: Prisma.Decimal;
  makerFeeAmount: Prisma.Decimal;
  makerFeeAsset: TradeFeeAsset;
  takerFeeRate: Prisma.Decimal;
  takerFeeAmount: Prisma.Decimal;
  takerFeeAsset: TradeFeeAsset;
};

@Injectable()
export class TradeSettlementService {
  private readonly logger = new Logger(TradeSettlementService.name);
  private static readonly MAKER_FEE_RATE = new Prisma.Decimal('0.005');
  private static readonly TAKER_FEE_RATE = new Prisma.Decimal('0.003');

  async lockAndLoadWallets(
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

  async applyTradeBalances(
    transactionClient: TransactionClient,
    taker: Order,
    maker: Order,
    takerWallet: Wallet,
    makerWallet: Wallet,
    tradeAmount: Prisma.Decimal,
    tradePrice: Prisma.Decimal,
  ): Promise<void> {
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

  buildFeeDetails(
    takerSide: OrderSide,
    tradeAmount: Prisma.Decimal,
    tradePrice: Prisma.Decimal,
  ): TradeFeeDetails {
    const executedCost = multiplyScaled(tradeAmount, tradePrice);

    if (takerSide === OrderSide.BUY) {
      return {
        makerFeeRate: TradeSettlementService.MAKER_FEE_RATE,
        makerFeeAmount: multiplyScaled(
          executedCost,
          TradeSettlementService.MAKER_FEE_RATE,
        ),
        makerFeeAsset: TradeFeeAsset.USD,
        takerFeeRate: TradeSettlementService.TAKER_FEE_RATE,
        takerFeeAmount: multiplyScaled(
          tradeAmount,
          TradeSettlementService.TAKER_FEE_RATE,
        ),
        takerFeeAsset: TradeFeeAsset.BTC,
      };
    }

    return {
      makerFeeRate: TradeSettlementService.MAKER_FEE_RATE,
      makerFeeAmount: multiplyScaled(
        tradeAmount,
        TradeSettlementService.MAKER_FEE_RATE,
      ),
      makerFeeAsset: TradeFeeAsset.BTC,
      takerFeeRate: TradeSettlementService.TAKER_FEE_RATE,
      takerFeeAmount: multiplyScaled(
        executedCost,
        TradeSettlementService.TAKER_FEE_RATE,
      ),
      takerFeeAsset: TradeFeeAsset.USD,
    };
  }

  private async applyBuyTakerBalances(
    transactionClient: TransactionClient,
    taker: Order,
    maker: Order,
    takerWallet: Wallet,
    makerWallet: Wallet,
    tradeAmount: Prisma.Decimal,
    tradePrice: Prisma.Decimal,
  ): Promise<void> {
    const reservedCost = multiplyScaled(tradeAmount, taker.price);
    const executedCost = multiplyScaled(tradeAmount, tradePrice);
    const priceImprovement = subtractScaled(reservedCost, executedCost);
    const takerFeeAmount = multiplyScaled(
      tradeAmount,
      TradeSettlementService.TAKER_FEE_RATE,
    );
    const makerFeeAmount = multiplyScaled(
      executedCost,
      TradeSettlementService.MAKER_FEE_RATE,
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
  ): Promise<void> {
    const executedCost = multiplyScaled(tradeAmount, tradePrice);
    const takerFeeAmount = multiplyScaled(
      executedCost,
      TradeSettlementService.TAKER_FEE_RATE,
    );
    const makerFeeAmount = multiplyScaled(
      tradeAmount,
      TradeSettlementService.MAKER_FEE_RATE,
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
}
