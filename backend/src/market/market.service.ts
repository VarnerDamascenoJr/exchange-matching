import { Injectable } from '@nestjs/common';
import { parsePositiveDecimalInput } from '../common/decimal-input';
import { buildPaginatedResponse } from '../common/pagination';
import {
  MarketMatchSummary,
  MarketStatsSummary,
  OrderBookLevel,
  toMarketMatchSummary,
  toMarketStatsSummary,
  toOrderBookLevel,
} from './market.mapper';
import { OrderBookQueryDto } from './dto/order-book.query.dto';
import { MarketRepository } from './market.repository';

@Injectable()
export class MarketService {
  constructor(private readonly marketRepository: MarketRepository) {}

  async getStats(): Promise<MarketStatsSummary> {
    const { lastTrade, tradeStats, bestBid, bestAsk } =
      await this.marketRepository.findStats();

    return toMarketStatsSummary({
      lastPrice: lastTrade?.price ?? null,
      btcVolume24h: tradeStats?.btc_volume_24h ?? 0,
      usdVolume24h: tradeStats?.usd_volume_24h ?? 0,
      high24h: tradeStats?.high_24h ?? null,
      low24h: tradeStats?.low_24h ?? null,
      bestBid: bestBid?.price ?? null,
      bestAsk: bestAsk?.price ?? null,
    });
  }

  async getOrderBook(query: OrderBookQueryDto) {
    const price = query.price
      ? parsePositiveDecimalInput(query.price, 'price')
      : undefined;
    const { levels, totalItems } =
      await this.marketRepository.findOrderBookLevels({
        side: query.side,
        page: query.page,
        pageSize: query.pageSize,
        price,
      });

    const items: OrderBookLevel[] = levels.map((level) =>
      toOrderBookLevel({
        price: level.price,
        amount: level._sum.remainingAmount ?? 0,
        orderCount: level._count._all,
        side: query.side,
      }),
    );

    return buildPaginatedResponse(
      items,
      query.page,
      query.pageSize,
      totalItems,
    );
  }

  async getMatches(page: number, pageSize: number, id?: string) {
    const { trades, totalItems } = await this.marketRepository.findMatches(
      page,
      pageSize,
      id,
    );

    return buildPaginatedResponse<MarketMatchSummary>(
      trades.map(toMarketMatchSummary),
      page,
      pageSize,
      totalItems,
    );
  }
}
