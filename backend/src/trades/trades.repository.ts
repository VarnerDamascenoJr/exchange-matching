import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildIdPrefixFilter } from '../common/id-filter';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TradesRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async findUserHistory(
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

    return { trades, totalItems };
  }
}
