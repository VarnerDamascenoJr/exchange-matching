import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../../app/query-keys';
import { getMarketMatchesRequest } from '../../../services/api';
import { PaginatedQuery } from '../../../types/pagination';

export function useMarketMatches(query: PaginatedQuery) {
  return useQuery({
    queryKey: queryKeys.marketMatches(query),
    queryFn: () => getMarketMatchesRequest(query),
    staleTime: 15_000,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
  });
}
