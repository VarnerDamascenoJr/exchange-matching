import { Socket, io } from 'socket.io-client';
import { AccountChangedEvent, MarketChangedEvent } from '../types/market';
import { API_BASE_URL } from './http';

export const MARKET_CHANGED_EVENT = 'market:changed';
export const ACCOUNT_CHANGED_EVENT = 'account:changed';

export const createExchangeSocket = (
  accessToken: string,
): Socket<
  Record<string, never>,
  Record<string, never>
> =>
  io(API_BASE_URL, {
    autoConnect: false,
    auth: {
      token: accessToken,
    },
    transports: ['websocket'],
  });

export type MarketChangedListener = (event: MarketChangedEvent) => void;
export type AccountChangedListener = (event: AccountChangedEvent) => void;
