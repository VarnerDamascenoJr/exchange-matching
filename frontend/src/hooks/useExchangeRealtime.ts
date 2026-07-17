import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateExchangeQueries } from '../features/exchange/exchange-query-invalidation';
import {
  ACCOUNT_CHANGED_EVENT,
  MARKET_CHANGED_EVENT,
  createExchangeSocket,
} from '../services/realtime';

export function useExchangeRealtime(enabled: boolean, accessToken?: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !accessToken) {
      return;
    }

    const socket = createExchangeSocket(accessToken);

    const invalidateMarketQueries = () => {
      void invalidateExchangeQueries(queryClient, 'market');
    };

    const invalidateAccountQueries = () => {
      void invalidateExchangeQueries(queryClient, 'account');
    };

    socket.on(MARKET_CHANGED_EVENT, invalidateMarketQueries);
    socket.on(ACCOUNT_CHANGED_EVENT, invalidateAccountQueries);
    socket.connect();

    return () => {
      socket.off(MARKET_CHANGED_EVENT, invalidateMarketQueries);
      socket.off(ACCOUNT_CHANGED_EVENT, invalidateAccountQueries);
      socket.disconnect();
    };
  }, [accessToken, enabled, queryClient]);
}
