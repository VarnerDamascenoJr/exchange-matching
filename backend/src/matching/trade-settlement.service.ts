import { Injectable, Logger } from '@nestjs/common';
import {
  Order,
  OrderSide,
  Prisma,
  TradeFeeAsset,
  Wallet,
} from '@prisma/client';
import {
  assertPositiveOrderCost,
  multiplyScaled,
  subtractScaled,
} from '../common/decimal.utils';
import { WalletsRepository } from '../wallets/wallets.repository';

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

  constructor(private readonly walletsRepository: WalletsRepository) {}

  lockAndLoadWallets(
    transactionClient: Prisma.TransactionClient,
    userIds: string[],
  ): Promise<Map<string, Wallet>> {
    return this.walletsRepository.lockAndLoadByUserIds(
      transactionClient,
      userIds,
    );
  }

  async applyTradeBalances(
    transactionClient: Prisma.TransactionClient,
    taker: Order,
    maker: Order,
    takerWallet: Wallet,
    makerWallet: Wallet,
    tradeAmount: Prisma.Decimal,
    tradePrice: Prisma.Decimal,
  ): Promise<void> {
    assertPositiveOrderCost(tradeAmount, tradePrice);
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
    transactionClient: Prisma.TransactionClient,
    taker: Order,
    maker: Order,
    takerWallet: Wallet,
    makerWallet: Wallet,
    tradeAmount: Prisma.Decimal,
    tradePrice: Prisma.Decimal,
  ): Promise<void> {
    const reservedCost = this.buyReservationDebit(taker, tradeAmount);
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

    await this.walletsRepository.updateBalances(
      transactionClient,
      takerWallet.userId,
      {
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
    );

    await this.walletsRepository.updateBalances(
      transactionClient,
      makerWallet.userId,
      {
        reservedBtc: {
          decrement: tradeAmount,
        },
        availableUsd: {
          increment: receivedUsd,
        },
      },
    );

    this.logger.log(
      `Matched BUY taker ${taker.id} with SELL maker ${maker.id} for ${tradeAmount.toFixed(8)} BTC at ${tradePrice.toFixed(8)}`,
    );
  }

  private async applySellTakerBalances(
    transactionClient: Prisma.TransactionClient,
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
    const reservedCost = this.buyReservationDebit(maker, tradeAmount);
    const roundingRefund = subtractScaled(reservedCost, executedCost);

    await this.walletsRepository.updateBalances(
      transactionClient,
      takerWallet.userId,
      {
        reservedBtc: {
          decrement: tradeAmount,
        },
        availableUsd: {
          increment: receivedUsd,
        },
      },
    );

    await this.walletsRepository.updateBalances(
      transactionClient,
      makerWallet.userId,
      {
        reservedUsd: {
          decrement: reservedCost,
        },
        ...(roundingRefund.gt(0)
          ? { availableUsd: { increment: roundingRefund } }
          : {}),
        availableBtc: {
          increment: receivedBtc,
        },
      },
    );

    this.logger.log(
      `Matched SELL taker ${taker.id} with BUY maker ${maker.id} for ${tradeAmount.toFixed(8)} BTC at ${tradePrice.toFixed(8)}`,
    );
  }

  private buyReservationDebit(order: Order, tradeAmount: Prisma.Decimal) {
    // floor(a*p) - floor((a-q)*p) keeps the reservation equal to the remaining
    // order's rounded cost. Return any quantization surplus to available USD.
    const remaining = subtractScaled(order.remainingAmount, tradeAmount);
    return subtractScaled(
      multiplyScaled(order.remainingAmount, order.price),
      multiplyScaled(remaining, order.price),
    );
  }
}
