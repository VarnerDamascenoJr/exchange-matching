import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../../app/query-keys';
import { getWalletRequest } from '../../../services/auth-api';

export function useCurrentWallet(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.wallet,
    queryFn: getWalletRequest,
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? 10_000 : false,
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
  });
}
