import { Injectable } from '@nestjs/common';
import { OrderSide, OrderStatus, Prisma } from '@prisma/client';
import { buildIdPrefixFilter } from '../common/id-filter';
import { PrismaService } from '../prisma/prisma.service';

type TradeStats = {
  btc_volume_24h: Prisma.Decimal | null;
  usd_volume_24h: Prisma.Decimal | null;
  high_24h: Prisma.Decimal | null;
  low_24h: Prisma.Decimal | null;
};

@Injectable()
export class MarketRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async findStats() {
    const [lastTrade, tradeRows, bestBid, bestAsk] = await Promise.all([
      this.prismaService.trade.findFirst({
        orderBy: [{ createdAt: 'desc' }, { sequence: 'desc' }],
        select: { price: true },
      }),
      this.prismaService.$queryRaw<TradeStats[]>`
        SELECT
          COALESCE(SUM("amount"), 0) AS "btc_volume_24h",
          COALESCE(SUM("amount" * "price"), 0) AS "usd_volume_24h",
          MAX("price") AS "high_24h",
          MIN("price") AS "low_24h"
        FROM "trades"
        WHERE "created_at" >= NOW() - INTERVAL '24 hours'
      `,
      this.prismaService.order.findFirst({
        where: {
          side: OrderSide.BUY,
          status: {
            in: [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED],
          },
        },
        orderBy: [{ price: 'desc' }, { sequence: 'asc' }],
        select: { price: true },
      }),
      this.prismaService.order.findFirst({
        where: {
          side: OrderSide.SELL,
          status: {
            in: [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED],
          },
        },
        orderBy: [{ price: 'asc' }, { sequence: 'asc' }],
        select: { price: true },
      }),
    ]);

    return { lastTrade, tradeStats: tradeRows.at(0), bestBid, bestAsk };
  }

  async findOrderBookLevels(query: {
    side: OrderSide;
    page: number;
    pageSize: number;
    price?: Prisma.Decimal;
  }) {
    const where: Prisma.OrderWhereInput = {
      side: query.side,
      status: {
        in: [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED],
      },
      ...(query.price ? { price: query.price } : {}),
    };

    const baseGroupByArgs = {
      by: ['price'] as ['price'],
      where,
      _count: {
        _all: true as const,
      },
      _sum: {
        remainingAmount: true as const,
      },
    };

    const orderBy =
      query.side === OrderSide.BUY
        ? [{ price: 'desc' as const }]
        : [{ price: 'asc' as const }];

    const [allLevels, levels] = await Promise.all([
      this.prismaService.order.groupBy({
        ...baseGroupByArgs,
        orderBy,
      }),
      this.prismaService.order.groupBy({
        ...baseGroupByArgs,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return { levels, totalItems: allLevels.length };
  }

  async findMatches(page: number, pageSize: number, id?: string) {
    const idFilter = buildIdPrefixFilter(id);
    const where: Prisma.TradeWhereInput = idFilter ? { id: idFilter } : {};

    const [totalItems, trades] = await Promise.all([
      this.prismaService.trade.count({ where }),
      this.prismaService.trade.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { sequence: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          price: true,
          amount: true,
          takerSide: true,
          createdAt: true,
        },
      }),
    ]);

    return { trades, totalItems };
  }
}
