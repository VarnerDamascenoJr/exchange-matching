import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrderSide, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeOutboxDispatcherService } from '../realtime/realtime-outbox-dispatcher.service';
import { RealtimeOutboxService } from '../realtime/realtime-outbox.service';
import { OrderLockingService } from '../orders/order-locking.service';
import { MatchingOrderBookService } from './matching-order-book.service';
import { TradeSettlementService } from './trade-settlement.service';
import { WalletFundsService } from '../wallets/wallet-funds.service';

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly matchingOrderBookService: MatchingOrderBookService,
    private readonly orderLockingService: OrderLockingService,
    private readonly tradeSettlementService: TradeSettlementService,
    private readonly realtimeOutboxService: RealtimeOutboxService,
    private readonly realtimeOutboxDispatcherService: RealtimeOutboxDispatcherService,
    private readonly walletFundsService: WalletFundsService,
  ) {}

  async processOrder(orderId: string): Promise<void> {
    const eventsWereStored = await this.prismaService.$transaction<boolean>(
      async (transactionClient) => {
        const taker = await this.orderLockingService.lockAndLoadOrder(
          transactionClient,
          orderId,
        );

        if (!taker) {
          throw new NotFoundException(`Order ${orderId} not found`);
        }

        if (taker.status !== OrderStatus.QUEUED) {
          this.logger.log(
            `Skipping order ${taker.id} because status is ${taker.status}`,
          );
          return false;
        }

        const makers =
          await this.matchingOrderBookService.findAndLockEligibleMakers(
            transactionClient,
            taker,
          );

        if (makers.length === 0) {
          const occurredAt = new Date().toISOString();

          await transactionClient.order.update({
            where: {
              id: taker.id,
            },
            data: {
              status: OrderStatus.OPEN,
            },
          });
          await this.realtimeOutboxService.appendEvents(transactionClient, [
            {
              type: 'market.changed',
              reason: 'order-opened',
              occurredAt,
              orderId: taker.id,
            },
            {
              type: 'account.changed',
              reason: 'order-opened',
              occurredAt,
              orderId: taker.id,
              userId: taker.userId,
            },
          ]);

          this.logger.log(`Order ${taker.id} moved from QUEUED to OPEN`);
          return true;
        }

        let takerRemaining = new Prisma.Decimal(taker.remainingAmount);
        let matchedAmount = new Prisma.Decimal(0);
        const affectedUserIds = new Set<string>([taker.userId]);
        const tradeIds: string[] = [];

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

          const lockedWallets =
            await this.tradeSettlementService.lockAndLoadWallets(
              transactionClient,
              [taker.userId, maker.userId],
            );
          const takerWallet = lockedWallets.get(taker.userId);
          const makerWallet = lockedWallets.get(maker.userId);

          if (!takerWallet || !makerWallet) {
            throw new NotFoundException('Wallet not found for matched order');
          }

          affectedUserIds.add(maker.userId);

          await this.tradeSettlementService.applyTradeBalances(
            transactionClient,
            taker,
            maker,
            takerWallet,
            makerWallet,
            tradeAmount,
            tradePrice,
          );

          const feeDetails = this.tradeSettlementService.buildFeeDetails(
            taker.side,
            tradeAmount,
            tradePrice,
          );

          const nextMakerRemaining = makerRemaining.sub(tradeAmount);
          const buyOrderId = taker.side === OrderSide.BUY ? taker.id : maker.id;
          const sellOrderId =
            taker.side === OrderSide.SELL ? taker.id : maker.id;

          const trade = await transactionClient.trade.create({
            data: {
              makerOrderId: maker.id,
              takerOrderId: taker.id,
              buyOrderId,
              sellOrderId,
              takerSide: taker.side,
              makerFeeRate: feeDetails.makerFeeRate,
              makerFeeAmount: feeDetails.makerFeeAmount,
              makerFeeAsset: feeDetails.makerFeeAsset,
              takerFeeRate: feeDetails.takerFeeRate,
              takerFeeAmount: feeDetails.takerFeeAmount,
              takerFeeAsset: feeDetails.takerFeeAsset,
              price: tradePrice,
              amount: tradeAmount,
            },
          });

          tradeIds.push(trade.id);

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
        const occurredAt = new Date().toISOString();

        await transactionClient.order.update({
          where: {
            id: taker.id,
          },
          data: {
            remainingAmount: takerRemaining,
            status: takerStatus,
          },
        });
        await this.realtimeOutboxService.appendEvents(transactionClient, [
          {
            type: 'market.changed',
            reason: 'trade-executed',
            occurredAt,
            orderId: taker.id,
            tradeIds,
          },
          ...[...affectedUserIds].map((userId) => ({
            type: 'account.changed' as const,
            reason: 'trade-executed' as const,
            occurredAt,
            orderId: taker.id,
            tradeIds,
            userId,
          })),
        ]);

        this.logger.log(
          `Processed order ${taker.id} with final status ${takerStatus} and remaining amount ${takerRemaining.toFixed(8)}`,
        );

        return true;
      },
    );

    if (eventsWereStored) {
      await this.dispatchRealtimeOutbox();
    }
  }

  async rejectOrderAfterFailedProcessing(orderId: string): Promise<void> {
    const eventWasStored = await this.prismaService.$transaction<boolean>(
      async (transactionClient) => {
        const order = await this.orderLockingService.lockAndLoadOrder(
          transactionClient,
          orderId,
        );

        if (!order || order.status !== OrderStatus.QUEUED) {
          return false;
        }

        await transactionClient.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.REJECTED },
        });
        await this.walletFundsService.releaseFunds(transactionClient, order);
        await this.realtimeOutboxService.appendEvent(transactionClient, {
          type: 'account.changed',
          reason: 'order-rejected',
          occurredAt: new Date().toISOString(),
          orderId: order.id,
          userId: order.userId,
        });

        this.logger.error(
          `Rejected order ${order.id} after matching retries were exhausted`,
        );
        return true;
      },
    );

    if (eventWasStored) {
      await this.dispatchRealtimeOutbox();
    }
  }

  private async dispatchRealtimeOutbox(): Promise<void> {
    try {
      await this.realtimeOutboxDispatcherService.dispatchPending();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown realtime error';
      this.logger.warn(`Realtime outbox dispatch failed: ${message}`);
    }
  }
}
