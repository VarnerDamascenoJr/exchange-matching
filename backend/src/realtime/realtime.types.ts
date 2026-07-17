export type MarketChangeReason =
  'order-opened' | 'order-cancelled' | 'trade-executed';

export type AccountChangeReason =
  MarketChangeReason | 'order-created' | 'order-rejected';

export type MarketChangedEvent = {
  type: 'market.changed';
  reason: MarketChangeReason;
  occurredAt: string;
  orderId?: string;
  tradeIds?: string[];
};

export type AccountChangedEvent = {
  type: 'account.changed';
  reason: AccountChangeReason;
  occurredAt: string;
  userId: string;
  orderId?: string;
  tradeIds?: string[];
};

export type RealtimeDispatchEvent = MarketChangedEvent | AccountChangedEvent;
