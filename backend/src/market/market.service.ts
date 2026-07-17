import { Injectable } from '@nestjs/common';
import { OrderSide, OrderStatus, Prisma } from '@prisma/client';
import { parsePositiveDecimalInput } from '../common/decimal-input';
import { buildIdPrefixFilter } from '../common/id-filter';
import { buildPaginatedResponse } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import {
  MarketMatchSummary,
  MarketStatsSummary,
  OrderBookLevel,
  toMarketMatchSummary,
  toMarketStatsSummary,
  toOrderBookLevel,
} from './market.mapper';
import { OrderBookQueryDto } from './dto/order-book.query.dto';

@Injectable()
export class MarketService {
  constructor(private readonly prismaService: PrismaService) {}

  async getStats(): Promise<MarketStatsSummary> {
    const [lastTrade, tradeRows, bestBid, bestAsk] = await Promise.all([
      this.prismaService.trade.findFirst({
        orderBy: [{ createdAt: 'desc' }, { sequence: 'desc' }],
      }),
      this.prismaService.$queryRaw<
        {
          btc_volume_24h: Prisma.Decimal | null;
          usd_volume_24h: Prisma.Decimal | null;
          high_24h: Prisma.Decimal | null;
          low_24h: Prisma.Decimal | null;
        }[]
      >`
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

    const tradeStats = tradeRows[0] ?? {
      btc_volume_24h: new Prisma.Decimal(0),
      usd_volume_24h: new Prisma.Decimal(0),
      high_24h: null,
      low_24h: null,
    };

    return toMarketStatsSummary({
      lastPrice: lastTrade?.price ?? null,
      btcVolume24h: tradeStats.btc_volume_24h ?? new Prisma.Decimal(0),
      usdVolume24h: tradeStats.usd_volume_24h ?? new Prisma.Decimal(0),
      high24h: tradeStats.high_24h,
      low24h: tradeStats.low_24h,
      bestBid: bestBid?.price ?? null,
      bestAsk: bestAsk?.price ?? null,
    });
  }

  async getOrderBook(query: OrderBookQueryDto) {
    const where: Prisma.OrderWhereInput = {
      side: query.side,
      status: {
        in: [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED],
      },
    };

    if (query.price) {
      where.price = parsePositiveDecimalInput(query.price, 'price');
    }

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

    const [allLevels, currentPageLevels] = (await Promise.all([
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
    ])) as [
      Array<{
        price: Prisma.Decimal;
        _count: { _all: number };
        _sum: { remainingAmount: Prisma.Decimal | null };
      }>,
      Array<{
        price: Prisma.Decimal;
        _count: { _all: number };
        _sum: { remainingAmount: Prisma.Decimal | null };
      }>,
    ];

    const items: OrderBookLevel[] = currentPageLevels.map((level) =>
      toOrderBookLevel({
        price: level.price,
        amount: level._sum?.remainingAmount ?? new Prisma.Decimal(0),
        orderCount: level._count._all,
        side: query.side,
      }),
    );

    return buildPaginatedResponse(
      items,
      query.page,
      query.pageSize,
      allLevels.length,
    );
  }

  async getMatches(page: number, pageSize: number, id?: string) {
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

    return buildPaginatedResponse<MarketMatchSummary>(
      trades.map(toMarketMatchSummary),
      page,
      pageSize,
      totalItems,
    );
  }
}
