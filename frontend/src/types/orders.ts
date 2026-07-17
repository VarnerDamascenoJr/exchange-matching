export type OrderSide = 'BUY' | 'SELL';

export type OrderStatus =
  | 'QUEUED'
  | 'OPEN'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELLED'
  | 'REJECTED';

export type OrderSummary = {
  id: string;
  side: OrderSide;
  status: OrderStatus;
  price: string;
  originalAmount: string;
  remainingAmount: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateOrderPayload = {
  side: OrderSide;
  amount: string;
  price: string;
};
