import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../../app/query-keys';
import { getOrderBookRequest } from '../../../services/api';
import { OrderSide } from '../../../types/orders';

type UseOrderBookOptions = {
  side: OrderSide;
  page: number;
  pageSize: number;
  price?: string;
};

export function useOrderBook({
  side,
  page,
  pageSize,
  price,
}: UseOrderBookOptions) {
  return useQuery({
    queryKey: queryKeys.orderBook(side, page, pageSize, price),
    queryFn: () =>
      getOrderBookRequest({
        side,
        page,
        pageSize,
        price,
      }),
    staleTime: 15_000,
  });
}
