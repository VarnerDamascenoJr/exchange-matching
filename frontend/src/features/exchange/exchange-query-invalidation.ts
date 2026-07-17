import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../app/query-keys';

export type ExchangeInvalidationScope = 'market' | 'account' | 'all';

const MARKET_QUERY_KEYS = [
  queryKeys.marketStats,
  queryKeys.marketMatchesRoot,
  queryKeys.orderBookRoot,
] as const;

const ACCOUNT_QUERY_KEYS = [
  queryKeys.me,
  queryKeys.wallet,
  queryKeys.activeOrdersRoot,
  queryKeys.tradeHistoryRoot,
] as const;

export async function invalidateExchangeQueries(
  queryClient: QueryClient,
  scope: ExchangeInvalidationScope,
) {
  const keys =
    scope === 'market'
      ? MARKET_QUERY_KEYS
      : scope === 'account'
        ? ACCOUNT_QUERY_KEYS
        : [...MARKET_QUERY_KEYS, ...ACCOUNT_QUERY_KEYS];

  await Promise.all(
    keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}
