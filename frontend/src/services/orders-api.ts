import { PaginatedQuery, PaginatedResponse } from '../types/pagination';
import { CreateOrderPayload, OrderSummary } from '../types/orders';
import { apiClient } from './http';

export const getActiveOrdersRequest = async (
  query: PaginatedQuery,
): Promise<PaginatedResponse<OrderSummary>> => {
  const { data } = await apiClient.get<PaginatedResponse<OrderSummary>>(
    '/orders/active',
    {
      params: query,
    },
  );

  return data;
};

export const createOrderRequest = async (
  payload: CreateOrderPayload,
): Promise<OrderSummary> => {
  const { data } = await apiClient.post<OrderSummary>('/orders', payload);
  return data;
};

export const cancelOrderRequest = async (
  orderId: string,
): Promise<OrderSummary> => {
  const { data } = await apiClient.delete<OrderSummary>(`/orders/${orderId}`);
  return data;
};
