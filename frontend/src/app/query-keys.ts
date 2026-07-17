import { PaginatedQuery } from '../types/pagination';
import { OrderSide } from '../types/orders';

export const queryKeys = {
  me: ['me'] as const,
  wallet: ['wallet'] as const,
  market: ['market'] as const,
  marketStats: ['market', 'stats'] as const,
  marketMatchesRoot: ['market', 'matches'] as const,
  marketMatches: (query: PaginatedQuery) =>
    ['market', 'matches', query] as const,
  orderBookRoot: ['market', 'order-book'] as const,
  orderBook: (side: OrderSide, page: number, pageSize: number, price?: string) =>
    ['market', 'order-book', side, page, pageSize, price ?? ''] as const,
  orders: ['orders'] as const,
  activeOrdersRoot: ['orders', 'active'] as const,
  activeOrders: (query: PaginatedQuery) => ['orders', 'active', query] as const,
  trades: ['trades'] as const,
  tradeHistoryRoot: ['trades', 'history'] as const,
  tradeHistory: (query: PaginatedQuery) => ['trades', 'history', query] as const,
};
