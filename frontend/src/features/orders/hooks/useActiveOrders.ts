import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../../app/query-keys';
import { getActiveOrdersRequest } from '../../../services/api';
import { PaginatedQuery } from '../../../types/pagination';

export function useActiveOrders(query: PaginatedQuery) {
  return useQuery({
    queryKey: queryKeys.activeOrders(query),
    queryFn: () => getActiveOrdersRequest(query),
    staleTime: 15_000,
    refetchInterval: 8_000,
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
  });
}
