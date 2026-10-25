import { Injectable } from '@nestjs/common';
import {
  Order,
  OrderSide,
  OrderStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { multiplyScaled, subtractScaled } from '../common/decimal.utils';

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

type MakerCursor = Pick<Order, 'price' | 'sequence'>;

@Injectable()
export class MatchingOrderBookService {
  async findAndLockEligibleMakers(
    transactionClient: TransactionClient,
    taker: Order,
  ): Promise<Order[]> {
    const makers: Order[] = [];
    let remaining = new Prisma.Decimal(taker.remainingAmount);
    let cursor: MakerCursor | undefined;

    // Select the required order locks before settlement acquires wallet locks.
    while (remaining.gt(0)) {
      const candidate = await this.findNextCandidate(
        transactionClient,
        taker,
        cursor,
      );

      if (!candidate) {
        break;
      }

      // Advance even if this candidate is cancelled or deleted while we wait.
      cursor = candidate;

      const lockedRows = await transactionClient.$queryRaw<{ id: string }[]>`
        SELECT "id"
        FROM "orders"
        WHERE "id" = ${candidate.id}
        FOR UPDATE
      `;

      if (lockedRows.length === 0) {
        continue;
      }

      const maker = await transactionClient.order.findUnique({
        where: { id: candidate.id },
      });

      if (!maker || !this.isEligibleMaker(taker, maker)) {
        continue;
      }

      makers.push(maker);
      const amount = remaining.lt(maker.remainingAmount)
        ? remaining
        : maker.remainingAmount;

      // Dust cannot cover the taker: settlement skips zero-cost fragments.
      if (multiplyScaled(amount, maker.price).gt(0)) {
        remaining = subtractScaled(remaining, amount);
      }
    }

    return makers;
  }

  private findNextCandidate(
    transactionClient: TransactionClient,
    taker: Order,
    cursor?: MakerCursor,
  ) {
    const buying = taker.side === OrderSide.BUY;
    return transactionClient.order.findFirst({
      where: {
        side: buying ? OrderSide.SELL : OrderSide.BUY,
        userId: {
          not: taker.userId,
        },
        status: {
          in: [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED],
        },
        price: buying
          ? {
              lte: taker.price,
            }
          : {
              gte: taker.price,
            },
        ...(cursor
          ? {
              OR: [
                { price: buying ? { gt: cursor.price } : { lt: cursor.price } },
                { price: cursor.price, sequence: { gt: cursor.sequence } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        price: true,
        sequence: true,
      },
      orderBy: buying
        ? [{ price: 'asc' }, { sequence: 'asc' }]
        : [{ price: 'desc' }, { sequence: 'asc' }],
    });
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
