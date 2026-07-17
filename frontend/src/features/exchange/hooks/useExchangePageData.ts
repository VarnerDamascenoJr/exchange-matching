import { isAxiosError } from 'axios';
import { useEffect, useState } from 'react';
import { useCurrentUser } from '../../auth/hooks/useCurrentUser';
import { useCurrentWallet } from '../../auth/hooks/useCurrentWallet';
import { useMarketMatches } from '../../market/hooks/useMarketMatches';
import { useMarketStats } from '../../market/hooks/useMarketStats';
import { useOrderBook } from '../../market/hooks/useOrderBook';
import { useActiveOrders } from '../../orders/hooks/useActiveOrders';
import { useTradeHistory } from '../../trades/hooks/useTradeHistory';
import { useExchangeRealtime } from '../../../hooks/useExchangeRealtime';
import { usePaginatedTableState } from '../../../hooks/usePaginatedTableState';
import { OrderBookLevel } from '../../../types/market';
import { toDisplayDecimal } from '../../../utils/format';

type PrefillValues = {
  amount: string;
  price: string;
} | null;

type UseExchangePageDataParams = {
  accessToken: string | null;
  onUnauthorized: () => void;
};

export function useExchangePageData({
  accessToken,
  onUnauthorized,
}: UseExchangePageDataParams) {
  const [buyPrefill, setBuyPrefill] = useState<PrefillValues>(null);
  const [sellPrefill, setSellPrefill] = useState<PrefillValues>(null);

  const meQuery = useCurrentUser(Boolean(accessToken));
  const walletQuery = useCurrentWallet(Boolean(accessToken));
  const marketStatsQuery = useMarketStats();
  const bidBookState = usePaginatedTableState();
  const askBookState = usePaginatedTableState();
  const matchesState = usePaginatedTableState();
  const activeOrdersState = usePaginatedTableState();
  const historyState = usePaginatedTableState();

  const bidBookQuery = useOrderBook({
    side: 'BUY',
    page: bidBookState.page,
    pageSize: bidBookState.pageSize,
    price: bidBookState.deferredSearch || undefined,
  });
  const askBookQuery = useOrderBook({
    side: 'SELL',
    page: askBookState.page,
    pageSize: askBookState.pageSize,
    price: askBookState.deferredSearch || undefined,
  });
  const marketMatchesQuery = useMarketMatches(matchesState.query);
  const activeOrdersQuery = useActiveOrders(activeOrdersState.query);
  const historyQuery = useTradeHistory(historyState.query);

  useExchangeRealtime(Boolean(accessToken), accessToken ?? undefined);

  const authErrors = [
    meQuery.error,
    walletQuery.error,
    marketStatsQuery.error,
    bidBookQuery.error,
    askBookQuery.error,
    marketMatchesQuery.error,
    activeOrdersQuery.error,
    historyQuery.error,
  ];

  const hasAuthFailure = authErrors.some(
    (error) => isAxiosError(error) && error.response?.status === 401,
  );

  useEffect(() => {
    if (hasAuthFailure) {
      onUnauthorized();
    }
  }, [hasAuthFailure, onUnauthorized]);

  const handleBidSelect = (level: OrderBookLevel) => {
    setSellPrefill({
      amount: toDisplayDecimal(level.amount),
      price: toDisplayDecimal(level.price),
    });
  };

  const handleAskSelect = (level: OrderBookLevel) => {
    setBuyPrefill({
      amount: toDisplayDecimal(level.amount),
      price: toDisplayDecimal(level.price),
    });
  };

  return {
    buyPrefill,
    sellPrefill,
    meQuery,
    walletQuery,
    marketStatsQuery,
    bidBookState,
    askBookState,
    matchesState,
    activeOrdersState,
    historyState,
    bidBookQuery,
    askBookQuery,
    marketMatchesQuery,
    activeOrdersQuery,
    historyQuery,
    authErrors,
    hasAuthFailure,
    isLoading:
      meQuery.isLoading || walletQuery.isLoading || marketStatsQuery.isLoading,
    hasPageError: authErrors.some(Boolean) && !hasAuthFailure,
    handleBidSelect,
    handleAskSelect,
  };
}
