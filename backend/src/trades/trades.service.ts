import { Injectable } from '@nestjs/common';
import { OrderSide, Prisma } from '@prisma/client';
import { buildIdPrefixFilter } from '../common/id-filter';
import { buildPaginatedResponse } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { UserTradeHistoryItem, toUserTradeHistoryItem } from './trade.mapper';

@Injectable()
export class TradesService {
  constructor(private readonly prismaService: PrismaService) {}

  async getUserHistory(
    userId: string,
    page: number,
    pageSize: number,
    id?: string,
  ) {
    const idFilter = buildIdPrefixFilter(id);

    const where: Prisma.TradeWhereInput = {
      ...(idFilter ? { id: idFilter } : {}),
      OR: [{ buyOrder: { userId } }, { sellOrder: { userId } }],
    };

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
          createdAt: true,
          makerFeeAmount: true,
          makerFeeAsset: true,
          takerFeeAmount: true,
          takerFeeAsset: true,
          buyOrder: {
            select: {
              userId: true,
            },
          },
          takerOrder: {
            select: {
              userId: true,
            },
          },
        },
      }),
    ]);

    const items: UserTradeHistoryItem[] = trades.map((trade) => {
      const side =
        trade.buyOrder.userId === userId ? OrderSide.BUY : OrderSide.SELL;
      const role = trade.takerOrder.userId === userId ? 'TAKER' : 'MAKER';

      return toUserTradeHistoryItem({
        id: trade.id,
        price: trade.price,
        amount: trade.amount,
        side,
        role,
        feeAmount:
          role === 'TAKER' ? trade.takerFeeAmount : trade.makerFeeAmount,
        feeAsset: role === 'TAKER' ? trade.takerFeeAsset : trade.makerFeeAsset,
        createdAt: trade.createdAt,
      });
    });

    return buildPaginatedResponse(items, page, pageSize, totalItems);
  }
}
