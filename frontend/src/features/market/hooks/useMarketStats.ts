import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../../app/query-keys';
import { getMarketStatsRequest } from '../../../services/api';

export function useMarketStats() {
  return useQuery({
    queryKey: queryKeys.marketStats,
    queryFn: getMarketStatsRequest,
    staleTime: 30_000,
  });
}
