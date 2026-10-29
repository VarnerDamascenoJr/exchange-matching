import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {
  AxiosError,
  type AxiosAdapter,
  type InternalAxiosRequestConfig,
} from 'axios';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../features/auth/context/AuthProvider';
import { ExchangePage } from '../pages/ExchangePage';
import { LoginPage } from '../pages/LoginPage';
import { apiClient } from '../services/http';
import {
  getStoredAuthState,
  storeAuthState,
} from '../services/session-storage';
import { ProtectedRoute } from './ProtectedRoute';
import { queryKeys } from './query-keys';

// Keep routing, auth, query caches, services, forms and mutations real. Only
// replace network transport; the browser journey covers the actual servers.
vi.mock('../hooks/useExchangeRealtime', () => ({
  useExchangeRealtime: vi.fn(),
}));

const originalAdapter = apiClient.defaults.adapter;
const clients: QueryClient[] = [];
const user = { id: 'alice-id', username: 'alice' };
const wallet = {
  availableBtc: '100.00000000',
  reservedBtc: '0.00000000',
  availableUsd: '100000.00000000',
  reservedUsd: '0.00000000',
};
const session = { accessToken: 'session-token', user, wallet };
const order = {
  id: 'order-1',
  side: 'SELL',
  status: 'OPEN',
  price: '10000.00000000',
  originalAmount: '0.25000000',
  remainingAmount: '0.25000000',
  createdAt: '2026-10-28T12:00:00Z',
  updatedAt: '2026-10-28T12:00:00Z',
};
const page = (items: unknown[]) => ({
  items,
  pagination: {
    page: 1,
    pageSize: 10,
    totalItems: items.length,
    totalPages: items.length ? 1 : 0,
  },
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  apiClient.defaults.adapter = originalAdapter;
  localStorage.clear();
  vi.restoreAllMocks();
});

function fail(
  config: InternalAxiosRequestConfig,
  status: number,
  message: string,
): never {
  throw new AxiosError(message, 'ERR_BAD_RESPONSE', config, undefined, {
    config,
    status,
    statusText: 'Error',
    headers: {},
    data: { message },
  });
}

function RouteLocation() {
  return <output aria-label="Current route">{useLocation().pathname}</output>;
}

function renderApplication(
  transport?: (
    config: InternalAxiosRequestConfig,
  ) => unknown | Promise<unknown>,
  authenticated = false,
) {
  if (authenticated) storeAuthState({ accessToken: session.accessToken });
  const requests: {
    method: string;
    url: string;
    data: unknown;
    authorization: unknown;
  }[] = [];
  const adapter: AxiosAdapter = async (config) => {
    requests.push({
      method: config.method ?? 'get',
      url: config.url ?? '',
      data:
        typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
      authorization: config.headers.get('Authorization'),
    });
    let data = await transport?.(config);
    if (data === undefined) {
      switch (config.url) {
        case '/auth/login':
          data = session;
          break;
        case '/me':
          data = user;
          break;
        case '/wallet':
          data = wallet;
          break;
        case '/market/stats':
          data = {
            lastPrice: null,
            btcVolume24h: '0',
            usdVolume24h: '0',
            high24h: null,
            low24h: null,
            bestBid: null,
            bestAsk: null,
          };
          break;
        case '/market/order-book':
        case '/market/matches':
        case '/orders/active':
        case '/trades/history':
          data = page([]);
          break;
        default:
          throw new Error(`Unexpected request: ${config.method} ${config.url}`);
      }
    }
    return { config, data, status: 200, statusText: 'OK', headers: {} };
  };
  apiClient.defaults.adapter = adapter;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/exchange']}>
          <RouteLocation />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/exchange" element={<ExchangePage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { requests, client };
}

describe('application user journeys', () => {
  it('protects the desk, validates login, displays server errors, and authenticates on retry', async () => {
    let attempts = 0;
    const { requests, client } = renderApplication((config) => {
      if (config.url === '/auth/login' && ++attempts === 1)
        fail(config, 503, 'Authentication temporarily unavailable');
    });
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/login');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Username is required')).toBeVisible();
    expect(requests).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Username'), {
      target: { value: ' alice ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Authentication temporarily unavailable',
    );
    expect(getStoredAuthState()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'alice' })).toBeVisible();
    expect(screen.getByLabelText('Current route')).toHaveTextContent(
      '/exchange',
    );
    expect(getStoredAuthState()).toEqual({ accessToken: 'session-token' });
    expect(
      requests
        .filter((request) => request.url === '/auth/login')
        .map((request) => request.data),
    ).toEqual([{ username: 'alice' }, { username: 'alice' }]);
    await waitFor(() =>
      expect(
        requests.find((request) => request.url === '/market/stats')
          ?.authorization,
      ).toBe('Bearer session-token'),
    );
    expect(client.getQueryData(queryKeys.me)).toEqual(user);
    expect(client.getQueryData(queryKeys.wallet)).toEqual(wallet);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(
      await screen.findByRole('button', { name: 'Sign in' }),
    ).toBeVisible();
    expect(getStoredAuthState()).toBeNull();
    expect(client.getQueryData(queryKeys.me)).toBeUndefined();
    expect(client.getQueryData(queryKeys.wallet)).toBeUndefined();
  }, 30_000);

  it('validates the order, preserves inputs after insufficient balance, and clears them after an accepted retry', async () => {
    let attempts = 0;
    let accept!: (data: unknown) => void;
    const pending = new Promise((resolve) => {
      accept = resolve;
    });
    const { requests } = renderApplication((config) => {
      if (config.method === 'post' && config.url === '/orders') {
        if (++attempts === 1) fail(config, 400, 'Insufficient BTC balance');
        return pending;
      }
    }, true);
    await screen.findByRole('heading', { name: 'alice' });
    const button = screen.getByRole('button', { name: 'Submit sell order' });
    const form = within(button.closest('form')!);
    fireEvent.click(button);
    expect(await form.findByText('Amount is required')).toBeVisible();
    expect(form.getByText('Price is required')).toBeVisible();
    expect(requests.some((request) => request.url === '/orders')).toBe(false);
    fireEvent.change(form.getByLabelText('Amount (BTC)'), {
      target: { value: '101' },
    });
    fireEvent.change(form.getByLabelText('Price (USD)'), {
      target: { value: '10000.00000000' },
    });
    fireEvent.click(button);
    expect(await form.findByRole('alert')).toHaveTextContent(
      'Insufficient BTC balance',
    );
    expect(form.getByLabelText('Amount (BTC)')).toHaveValue('101');
    expect(form.getByLabelText('Price (USD)')).toHaveValue('10000.00000000');
    fireEvent.change(form.getByLabelText('Amount (BTC)'), {
      target: { value: '0.25000000' },
    });
    fireEvent.click(button);
    expect(
      await form.findByRole('button', { name: 'Submitting...' }),
    ).toBeDisabled();
    expect(form.getByLabelText('Amount (BTC)')).toBeDisabled();
    expect(form.getByLabelText('Price (USD)')).toBeDisabled();
    accept({ ...order, status: 'QUEUED' });
    await waitFor(() =>
      expect(form.getByLabelText('Amount (BTC)')).toHaveValue(''),
    );
    expect(form.getByLabelText('Price (USD)')).toHaveValue('');
    expect(await form.findByRole('alert')).toHaveTextContent(
      'Order accepted with status QUEUED.',
    );
    expect(
      requests
        .filter((request) => request.url === '/orders')
        .map((request) => request.data),
    ).toEqual([
      { side: 'SELL', amount: '101', price: '10000.00000000' },
      { side: 'SELL', amount: '0.25000000', price: '10000.00000000' },
    ]);
  }, 30_000);

  it('retains a row after cancellation fails and refreshes the active list after a successful retry', async () => {
    let cancelled = false;
    let attempts = 0;
    const { requests } = renderApplication((config) => {
      if (config.url === '/orders/active')
        return page(cancelled ? [] : [order]);
      if (config.method === 'delete' && config.url === '/orders/order-1') {
        if (++attempts === 1)
          fail(config, 409, 'Order could not be cancelled; try again');
        cancelled = true;
        return { ...order, status: 'CANCELLED' };
      }
    }, true);
    const table = within(
      await screen.findByRole('table', { name: 'Active orders' }),
    );
    fireEvent.click(await table.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Order could not be cancelled; try again',
    );
    expect(table.getByRole('cell', { name: 'OPEN' })).toBeVisible();
    fireEvent.click(table.getByRole('button', { name: 'Cancel' }));
    expect(
      await table.findByText('No active orders for this filter.'),
    ).toBeVisible();
    expect(
      table.queryByRole('button', { name: 'Cancel' }),
    ).not.toBeInTheDocument();
    expect(
      requests
        .filter((request) => request.method === 'delete')
        .map((request) => request.url),
    ).toEqual(['/orders/order-1', '/orders/order-1']);
  }, 30_000);

  it('clears an expired session and its account cache when the API responds with 401', async () => {
    let rejectMe!: () => void;
    const expired = new Promise((_resolve, reject) => {
      rejectMe = () =>
        reject(
          new AxiosError(
            'Unauthorized',
            'ERR_BAD_REQUEST',
            undefined,
            undefined,
            {
              status: 401,
              data: { message: 'Unauthorized' },
              statusText: 'Unauthorized',
              headers: {},
              config: {} as InternalAxiosRequestConfig,
            },
          ),
        );
    });
    const { client } = renderApplication(
      (config) => (config.url === '/me' ? expired : undefined),
      true,
    );
    await waitFor(() =>
      expect(client.getQueryData(queryKeys.wallet)).toEqual(wallet),
    );
    rejectMe();
    expect(
      await screen.findByRole('button', { name: 'Sign in' }),
    ).toBeVisible();
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/login');
    expect(getStoredAuthState()).toBeNull();
    expect(client.getQueryData(queryKeys.wallet)).toBeUndefined();
    expect(
      screen.queryByRole('table', { name: 'Trade history' }),
    ).not.toBeInTheDocument();
  }, 30_000);
});
