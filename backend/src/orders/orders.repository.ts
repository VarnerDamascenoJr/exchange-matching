import { Injectable } from '@nestjs/common';
import { OrderSide, OrderStatus, Prisma } from '@prisma/client';
import { buildIdPrefixFilter } from '../common/id-filter';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrdersRepository {
  constructor(private readonly prismaService: PrismaService) {}

  runInTransaction<T>(
    operation: (transactionClient: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prismaService.$transaction(operation);
  }

  findWalletByUserId(
    transactionClient: Prisma.TransactionClient,
    userId: string,
  ) {
    return transactionClient.wallet.findUnique({ where: { userId } });
  }

  createOrder(
    transactionClient: Prisma.TransactionClient,
    input: {
      userId: string;
      side: OrderSide;
      amount: Prisma.Decimal;
      price: Prisma.Decimal;
    },
  ) {
    return transactionClient.order.create({
      data: {
        userId: input.userId,
        side: input.side,
        status: OrderStatus.QUEUED,
        price: input.price,
        originalAmount: input.amount,
        remainingAmount: input.amount,
      },
    });
  }

  async findActiveOrders(userId: string, query: PaginationQueryDto) {
    const idFilter = buildIdPrefixFilter(query.id);
    const where: Prisma.OrderWhereInput = {
      userId,
      status: {
        in: [
          OrderStatus.QUEUED,
          OrderStatus.OPEN,
          OrderStatus.PARTIALLY_FILLED,
        ],
      },
      ...(idFilter ? { id: idFilter } : {}),
    };

    const [totalItems, orders] = await Promise.all([
      this.prismaService.order.count({ where }),
      this.prismaService.order.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { sequence: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return { orders, totalItems };
  }

  cancelOrder(transactionClient: Prisma.TransactionClient, orderId: string) {
    return transactionClient.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CANCELLED },
    });
  }

  async lockAndLoadOrder(
    transactionClient: Prisma.TransactionClient,
    orderId: string,
    userId?: string,
  ) {
    const lockedRows = userId
      ? await transactionClient.$queryRaw<{ id: string }[]>`
          SELECT "id"
          FROM "orders"
          WHERE "id" = ${orderId}
            AND "user_id" = ${userId}
          FOR UPDATE
        `
      : await transactionClient.$queryRaw<{ id: string }[]>`
          SELECT "id"
          FROM "orders"
          WHERE "id" = ${orderId}
          FOR UPDATE
        `;

    if (lockedRows.length === 0) {
      return null;
    }

    return userId
      ? transactionClient.order.findFirst({
          where: {
            id: orderId,
            userId,
          },
        })
      : transactionClient.order.findUnique({
          where: {
            id: orderId,
          },
        });
  }
}
