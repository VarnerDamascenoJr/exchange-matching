import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../features/auth/context/auth-context';
import { apiClient } from '../services/http';
import type { OrderBookLevel } from '../types/market';
import type { CreateOrderPayload, OrderSide } from '../types/orders';
import { ExchangePage } from './ExchangePage';

vi.mock('../hooks/useExchangeRealtime', () => ({ useExchangeRealtime: vi.fn() }));

const timestamp = '2026-10-22T12:00:00.000Z';
const largeValue = '99999999999999999999.12345678';
const originalAdapter = apiClient.defaults.adapter;
let queryClient: QueryClient;

afterEach(() => {
  cleanup();
  queryClient.clear();
  apiClient.defaults.adapter = originalAdapter;
});

const paginated = <T,>(items: T[]) => ({
  items,
  pagination: { page: 1, pageSize: 10, totalItems: items.length, totalPages: 1 },
});

// Keep the real queries, API services, page, book, forms and mutations. Only
// replace HTTP transport and realtime, so assertions include the serialized POST.
function renderExchange(values: Pick<OrderBookLevel, 'amount' | 'price'>[] = [
  { amount: '0.00000001', price: '0.00000001' },
]) {
  const submittedOrders: CreateOrderPayload[] = [];
  const levels = (side: OrderSide): OrderBookLevel[] => values.map((value) => ({
    ...value, side, orderCount: 1,
  }));
  const order = {
    id: 'order-1', side: 'BUY', status: 'OPEN', price: largeValue,
    originalAmount: '0.00000001', remainingAmount: '0.00000001',
    createdAt: timestamp, updatedAt: timestamp,
  };
  const adapter: AxiosAdapter = async (config) => {
    let data: unknown;
    if (config.method === 'post' && config.url === '/orders') {
      const payload = JSON.parse(config.data as string) as CreateOrderPayload;
      submittedOrders.push(payload);
      data = { ...order, ...payload, status: 'QUEUED' };
    } else {
      switch (config.url) {
        case '/me':
          data = { id: 'user-1', username: 'alice' };
          break;
        case '/wallet':
          data = {
            availableBtc: '0.00000001', availableUsd: largeValue,
            reservedBtc: '0.00000000', reservedUsd: '0.00000000',
          };
          break;
        case '/market/stats':
          data = {
            lastPrice: largeValue, btcVolume24h: '0.00000001',
            usdVolume24h: '0.00000000', high24h: null, low24h: null,
            bestBid: '0.00000001', bestAsk: '1.23456789',
          };
          break;
        case '/market/order-book':
          data = paginated(levels(config.params.side));
          break;
        case '/market/matches':
          data = paginated([{
            id: 'match-1', price: largeValue, amount: '0.00000001',
            takerSide: 'BUY', createdAt: timestamp,
          }]);
          break;
        case '/orders/active':
          data = paginated([order]);
          break;
        case '/trades/history':
          data = paginated([
            {
              id: 'trade-btc', price: largeValue, amount: '0.00000001',
              side: 'BUY', role: 'TAKER', feeAmount: '0.00150000',
              feeAsset: 'BTC', createdAt: timestamp,
            },
            {
              id: 'trade-usd', price: '0.00000001', amount: '1.23456789',
              side: 'SELL', role: 'MAKER', feeAmount: '0.00000001',
              feeAsset: 'USD', createdAt: timestamp,
            },
          ]);
          break;
        default:
          throw new Error(`Unexpected request: ${config.method} ${config.url}`);
      }
    }
    return { config, data, status: 200, statusText: 'OK', headers: {} };
  };
  apiClient.defaults.adapter = adapter;
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={{
        accessToken: 'test-token', isAuthenticated: true, login: vi.fn(), logout: vi.fn(),
      }}>
        <ExchangePage />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { submittedOrders };
}

describe('exchange financial precision', () => {
  it('shows the rounded-down total and rejects a zero-cost book selection before sending', async () => {
    const { submittedOrders } = renderExchange([{ amount: '0.5', price: '0.00000001' }]);
    const table = within(await screen.findByRole('table', { name: 'Ask book levels' }));
    fireEvent.click(await table.findByText('US$ 0.00000001'));
    const button = screen.getByRole('button', { name: 'Submit buy order' });
    const form = within(button.closest('form')!);
    expect(form.getByText('US$ 0.00')).toBeVisible();
    fireEvent.click(button);
    expect(await form.findByText('Order cost must be at least 0.00000001 USD')).toBeVisible();
    expect(submittedOrders).toEqual([]);
  }, 30_000);

  it('displays exact balances, stats, book levels, orders, matches and fees', async () => {
    renderExchange();

    expect(await screen.findByText(`BTC 0.00000001 / US$ ${largeValue}`)).toBeVisible();
    expect(screen.getByRole('heading', { name: `US$ ${largeValue}` })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'BTC 0.00000001' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'US$ 0.00', level: 5 })).toBeVisible();
    expect(screen.getAllByRole('heading', { name: '-' })).toHaveLength(2);

    for (const name of ['Bid book levels', 'Ask book levels']) {
      const table = within(screen.getByRole('table', { name }));
      expect(table.getByRole('cell', { name: 'US$ 0.00000001' })).toBeVisible();
      expect(table.getByRole('cell', { name: 'BTC 0.00000001' })).toBeVisible();
    }
    for (const name of ['Active orders', 'Market matches', 'Trade history']) {
      const table = within(screen.getByRole('table', { name }));
      expect(table.getByRole('cell', { name: `US$ ${largeValue}` })).toBeVisible();
      expect(table.getByRole('cell', { name: 'BTC 0.00000001' })).toBeVisible();
    }
    const history = within(screen.getByRole('table', { name: 'Trade history' }));
    expect(history.getByRole('cell', { name: 'BTC 0.0015' })).toBeVisible();
    expect(history.getByRole('cell', { name: 'BTC 1.23456789' })).toBeVisible();
    expect(history.getAllByRole('cell', { name: 'US$ 0.00000001' })).toHaveLength(2);
  }, 30_000);

  it.each(['BUY', 'SELL'] as const)(
    'selects %s levels and submits the original strings from the opposite form',
    async (bookSide) => {
      const cases = [
        ['1.2', '1.20'],
        ['1.23', '1.23'],
        ['1.234', '1.234'],
        ['1.2345', '1.2345'],
        ['1.23456', '1.23456'],
        ['1.234567', '1.234567'],
        ['1.2345678', '1.2345678'],
        ['1.23456789', '1.23456789'],
        ['0.00000001', '0.00000001'],
        ['0.10000000', '0.10'],
        [largeValue, largeValue],
      ];
      // Rotate amounts to exercise independent quantity and price values.
      const levels = cases.map(([price, display], index) => ({
        price, display, amount: price === '0.00000001' ? '1.23456789'
          : price === largeValue ? '0.00000001' : cases[(index + 1) % cases.length][0],
      }));
      const { submittedOrders } = renderExchange(levels);
      const bookName = bookSide === 'BUY' ? 'Bid book levels' : 'Ask book levels';
      const targetSide = bookSide === 'BUY' ? 'sell' : 'buy';
      const otherSide = bookSide === 'BUY' ? 'buy' : 'sell';
      const table = within(await screen.findByRole('table', { name: bookName }));
      await table.findByRole('cell', { name: `US$ ${largeValue}` });
      const submitButton = screen.getByRole('button', { name: `Submit ${targetSide} order` });
      const form = within(submitButton.closest('form')!);
      const otherForm = within(screen.getByRole('button', {
        name: `Submit ${otherSide} order`,
      }).closest('form')!);

      for (const { amount, price, display } of levels) {
        fireEvent.click(table.getByText(`US$ ${display}`));
        expect(form.getByLabelText('Amount (BTC)')).toHaveValue(amount);
        expect(form.getByLabelText('Price (USD)')).toHaveValue(price);
        expect(otherForm.getByLabelText('Amount (BTC)')).toHaveValue('');
        expect(otherForm.getByLabelText('Price (USD)')).toHaveValue('');

        const previousCount = submittedOrders.length;
        fireEvent.click(submitButton);
        await waitFor(() => expect(submittedOrders).toHaveLength(previousCount + 1));
        expect(submittedOrders[previousCount]).toEqual({
          side: bookSide === 'BUY' ? 'SELL' : 'BUY', amount, price,
        });
        await waitFor(() => {
          expect(form.getByLabelText('Amount (BTC)')).toHaveValue('');
          expect(submitButton).toBeEnabled();
        });
      }
    },
    30_000,
  );
});
