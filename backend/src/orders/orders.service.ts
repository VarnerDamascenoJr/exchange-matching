import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OrderSide, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginatedResponse } from '../common/pagination';
import { parsePositiveDecimalInput } from '../common/decimal-input';
import { buildIdPrefixFilter } from '../common/id-filter';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { OrderMatchingOutboxDispatcherService } from '../queue/order-matching-outbox-dispatcher.service';
import { OrderMatchingOutboxService } from '../queue/order-matching-outbox.service';
import { RealtimeOutboxDispatcherService } from '../realtime/realtime-outbox-dispatcher.service';
import { RealtimeOutboxService } from '../realtime/realtime-outbox.service';
import { OrderSummary, toOrderSummary } from './order.mapper';
import { WalletFundsService } from '../wallets/wallet-funds.service';
import { OrderLockingService } from './order-locking.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly orderMatchingOutboxService: OrderMatchingOutboxService,
    private readonly orderMatchingOutboxDispatcherService: OrderMatchingOutboxDispatcherService,
    private readonly walletFundsService: WalletFundsService,
    private readonly orderLockingService: OrderLockingService,
    private readonly realtimeOutboxService: RealtimeOutboxService,
    private readonly realtimeOutboxDispatcherService: RealtimeOutboxDispatcherService,
  ) {}

  private readonly activeStatuses = [
    OrderStatus.QUEUED,
    OrderStatus.OPEN,
    OrderStatus.PARTIALLY_FILLED,
  ] as const;

  async createOrder(
    userId: string,
    side: OrderSide,
    amountInput: string,
    priceInput: string,
  ): Promise<OrderSummary> {
    const amount = parsePositiveDecimalInput(amountInput, 'amount');
    const price = parsePositiveDecimalInput(priceInput, 'price');

    const order = await this.prismaService.$transaction(
      async (transactionClient) => {
        const wallet = await transactionClient.wallet.findUnique({
          where: { userId },
        });

        if (!wallet) {
          throw new NotFoundException('Wallet not found');
        }

        await this.walletFundsService.reserveFunds(
          transactionClient,
          wallet,
          side,
          amount,
          price,
        );

        const order = await transactionClient.order.create({
          data: {
            userId,
            side,
            status: OrderStatus.QUEUED,
            price,
            originalAmount: amount,
            remainingAmount: amount,
          },
        });

        await this.orderMatchingOutboxService.appendOrder(
          transactionClient,
          order.id,
        );
        await this.realtimeOutboxService.appendEvent(transactionClient, {
          type: 'account.changed',
          reason: 'order-created',
          occurredAt: new Date().toISOString(),
          orderId: order.id,
          userId,
        });

        return order;
      },
    );

    await this.dispatchOrderMatchingOutbox();
    await this.dispatchRealtimeOutbox();
    return toOrderSummary(order);
  }

  async getActiveOrders(userId: string, query: PaginationQueryDto) {
    const idFilter = buildIdPrefixFilter(query.id);

    const where: Prisma.OrderWhereInput = {
      userId,
      status: {
        in: [...this.activeStatuses],
      },
      ...(idFilter ? { id: idFilter } : {}),
    };

    const [totalItems, orders] = await Promise.all([
      this.prismaService.order.count({ where }),
      this.prismaService.order.findMany({
        where,
        orderBy: [
          {
            createdAt: 'desc',
          },
          {
            sequence: 'desc',
          },
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return buildPaginatedResponse(
      orders.map(toOrderSummary),
      query.page,
      query.pageSize,
      totalItems,
    );
  }

  async cancelOrder(userId: string, orderId: string): Promise<OrderSummary> {
    const cancelledOrder = await this.prismaService.$transaction(
      async (transactionClient) => {
        const order = await this.orderLockingService.lockAndLoadOrder(
          transactionClient,
          orderId,
          userId,
        );

        if (!order) {
          throw new NotFoundException('Order not found');
        }

        if (!this.isActiveStatus(order.status)) {
          throw new BadRequestException('Order cannot be cancelled');
        }

        const wallet = await transactionClient.wallet.findUnique({
          where: { userId },
        });

        if (!wallet) {
          throw new NotFoundException('Wallet not found');
        }

        await transactionClient.order.update({
          where: {
            id: orderId,
          },
          data: {
            status: OrderStatus.CANCELLED,
          },
        });

        await this.walletFundsService.releaseFunds(transactionClient, order);
        await this.realtimeOutboxService.appendEvents(transactionClient, [
          {
            type: 'market.changed',
            reason: 'order-cancelled',
            occurredAt: new Date().toISOString(),
            orderId,
          },
          {
            type: 'account.changed',
            reason: 'order-cancelled',
            occurredAt: new Date().toISOString(),
            orderId,
            userId,
          },
        ]);

        return toOrderSummary({
          ...order,
          status: OrderStatus.CANCELLED,
          updatedAt: new Date(),
        });
      },
    );

    await this.dispatchRealtimeOutbox();
    return cancelledOrder;
  }

  private isActiveStatus(
    status: OrderStatus,
  ): status is (typeof this.activeStatuses)[number] {
    return (
      status === OrderStatus.QUEUED ||
      status === OrderStatus.OPEN ||
      status === OrderStatus.PARTIALLY_FILLED
    );
  }

  private async dispatchOrderMatchingOutbox(): Promise<void> {
    try {
      await this.orderMatchingOutboxDispatcherService.dispatchPending();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown matching queue error';

      this.logger.warn(`Order matching outbox dispatch failed: ${message}`);
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
