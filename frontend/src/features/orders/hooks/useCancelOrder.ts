import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateExchangeQueries } from '../../exchange/exchange-query-invalidation';
import { cancelOrderRequest } from '../../../services/api';

export function useCancelOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: cancelOrderRequest,
    onSuccess: () => {
      void invalidateExchangeQueries(queryClient, 'all');
    },
  });
}
