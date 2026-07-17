import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../../app/query-keys';
import { getMeRequest } from '../../../services/auth-api';

export function useCurrentUser(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: getMeRequest,
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? 30_000 : false,
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
  });
}
