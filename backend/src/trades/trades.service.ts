import { Injectable } from '@nestjs/common';
import { OrderSide } from '@prisma/client';
import { buildPaginatedResponse } from '../common/pagination';
import { TradesRepository } from './trades.repository';
import { UserTradeHistoryItem, toUserTradeHistoryItem } from './trade.mapper';

@Injectable()
export class TradesService {
  constructor(private readonly tradesRepository: TradesRepository) {}

  async getUserHistory(
    userId: string,
    page: number,
    pageSize: number,
    id?: string,
  ) {
    const { trades, totalItems } = await this.tradesRepository.findUserHistory(
      userId,
      page,
      pageSize,
      id,
    );

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
