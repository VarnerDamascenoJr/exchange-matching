import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateExchangeQueries } from '../../exchange/exchange-query-invalidation';
import { createOrderRequest } from '../../../services/api';

export function useCreateOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createOrderRequest,
    onSuccess: () => {
      void invalidateExchangeQueries(queryClient, 'all');
    },
  });
}
