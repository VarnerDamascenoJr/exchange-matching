import { OrderSide } from './orders';

export type UserTradeHistoryItem = {
  id: string;
  price: string;
  amount: string;
  side: OrderSide;
  role: 'MAKER' | 'TAKER';
  feeAmount: string;
  feeAsset: 'BTC' | 'USD';
  createdAt: string;
};
