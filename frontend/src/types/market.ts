import { OrderSide } from './orders';

export type MarketStatsSummary = {
  lastPrice: string | null;
  btcVolume24h: string;
  usdVolume24h: string;
  high24h: string | null;
  low24h: string | null;
  bestBid: string | null;
  bestAsk: string | null;
};

export type OrderBookLevel = {
  price: string;
  amount: string;
  orderCount: number;
  side: OrderSide;
};

export type MarketMatchSummary = {
  id: string;
  price: string;
  amount: string;
  takerSide: OrderSide;
  createdAt: string;
};

export type MarketChangedEvent = {
  type: 'market.changed';
  reason: 'order-opened' | 'order-cancelled' | 'trade-executed';
  occurredAt: string;
  orderId?: string;
  tradeIds?: string[];
};

export type AccountChangedEvent = {
  type: 'account.changed';
  reason:
    | 'order-created'
    | 'order-rejected'
    | 'order-opened'
    | 'order-cancelled'
    | 'trade-executed';
  occurredAt: string;
  userId: string;
  orderId?: string;
  tradeIds?: string[];
};
