import { Injectable } from '@nestjs/common';
import { Order, OrderSide, OrderStatus, PrismaClient } from '@prisma/client';

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class MatchingOrderBookService {
  async findAndLockEligibleMakers(
    transactionClient: TransactionClient,
    taker: Order,
  ): Promise<Order[]> {
    const candidateIds = await transactionClient.order.findMany({
      where: {
        side: taker.side === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY,
        userId: {
          not: taker.userId,
        },
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

      if (!maker || !this.isEligibleMaker(taker, maker)) {
        continue;
      }

      makers.push(maker);
    }

    return makers;
  }

  private isEligibleMaker(taker: Order, maker: Order): boolean {
    if (maker.userId === taker.userId) {
      return false;
    }

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
}
