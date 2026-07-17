import { MarketMatchSummary, MarketStatsSummary, OrderBookLevel } from '../types/market';
import { PaginatedQuery, PaginatedResponse } from '../types/pagination';
import { OrderSide } from '../types/orders';
import { apiClient } from './http';

export type OrderBookQuery = {
  page: number;
  pageSize: number;
  side: OrderSide;
  price?: string;
};

export const getMarketStatsRequest = async (): Promise<MarketStatsSummary> => {
  const { data } = await apiClient.get<MarketStatsSummary>('/market/stats');
  return data;
};

export const getOrderBookRequest = async (
  query: OrderBookQuery,
): Promise<PaginatedResponse<OrderBookLevel>> => {
  const { data } = await apiClient.get<PaginatedResponse<OrderBookLevel>>(
    '/market/order-book',
    {
      params: query,
    },
  );

  return data;
};

export const getMarketMatchesRequest = async (
  query: PaginatedQuery,
): Promise<PaginatedResponse<MarketMatchSummary>> => {
  const { data } = await apiClient.get<PaginatedResponse<MarketMatchSummary>>(
    '/market/matches',
    {
      params: query,
    },
  );

  return data;
};
