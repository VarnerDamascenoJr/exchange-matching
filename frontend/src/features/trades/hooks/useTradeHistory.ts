import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../../app/query-keys';
import { getTradeHistoryRequest } from '../../../services/api';
import { PaginatedQuery } from '../../../types/pagination';

export function useTradeHistory(query: PaginatedQuery) {
  return useQuery({
    queryKey: queryKeys.tradeHistory(query),
    queryFn: () => getTradeHistoryRequest(query),
    staleTime: 15_000,
  });
}
