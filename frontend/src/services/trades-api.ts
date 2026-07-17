import { PaginatedQuery, PaginatedResponse } from '../types/pagination';
import { UserTradeHistoryItem } from '../types/trades';
import { apiClient } from './http';

export const getTradeHistoryRequest = async (
  query: PaginatedQuery,
): Promise<PaginatedResponse<UserTradeHistoryItem>> => {
  const { data } = await apiClient.get<PaginatedResponse<UserTradeHistoryItem>>(
    '/trades/history',
    {
      params: query,
    },
  );

  return data;
};
