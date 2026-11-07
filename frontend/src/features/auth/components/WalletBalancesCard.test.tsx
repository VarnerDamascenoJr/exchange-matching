import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WalletBalancesCard } from './WalletBalancesCard';

afterEach(cleanup);

describe('wallet balance breakdown', () => {
  it('shows both assets with an explanation of available, reserved and total', () => {
    render(
      <WalletBalancesCard
        user={{ id: 'alice', username: 'alice' }}
        wallet={{
          availableBtc: '99.75000000',
          reservedBtc: '0.15000000',
          availableUsd: '102985.00000000',
          reservedUsd: '0.00000000',
        }}
      />,
    );
    const card = within(
      screen.getByRole('region', { name: 'Wallet balances' }),
    );
    expect(card.getByRole('heading', { name: 'alice balances' })).toBeVisible();
    expect(card.getByRole('region', { name: 'BTC balances' })).toBeVisible();
    expect(card.getByRole('region', { name: 'USD balances' })).toBeVisible();
    expect(
      card.getByText(/Available can be used for new orders/),
    ).toHaveTextContent(
      'Reserved is committed to active orders. Total is available plus reserved.',
    );
    for (const [name, value] of [
      ['BTC available balance', 'BTC 99.75'],
      ['BTC reserved balance', 'BTC 0.15'],
      ['BTC total balance', 'BTC 99.90'],
      ['USD available balance', 'US$ 102985.00'],
      ['USD reserved balance', 'US$ 0.00'],
      ['USD total balance', 'US$ 102985.00'],
    ])
      expect(card.getByLabelText(name).textContent).toBe(value);
  });

  it.each([
    ['0.00000001', '0.00000001', '0.00000002'],
    ['0.10000000', '0.20000000', '0.30'],
    [
      '99999999999999999999.12345678',
      '0.00000001',
      '99999999999999999999.12345679',
    ],
    ['99999999999999999999.12345678', '0.87654322', '100000000000000000000.00'],
    ['0.00000000', '0.00000000', '0.00'],
  ])('adds %s and %s exactly for both assets', (available, reserved, total) => {
    render(
      <WalletBalancesCard
        wallet={{
          availableBtc: available,
          reservedBtc: reserved,
          availableUsd: available,
          reservedUsd: reserved,
        }}
      />,
    );
    expect(screen.getByLabelText('BTC total balance').textContent).toBe(
      `BTC ${total}`,
    );
    expect(screen.getByLabelText('USD total balance').textContent).toBe(
      `US$ ${total}`,
    );
  });

  it('keeps missing balances and totals unknown until wallet data arrives', () => {
    render(<WalletBalancesCard />);
    expect(
      screen.getByRole('heading', { name: 'Your balances' }),
    ).toBeVisible();
    for (const asset of ['BTC', 'USD']) {
      for (const field of ['available', 'reserved', 'total']) {
        expect(
          screen.getByLabelText(`${asset} ${field} balance`),
        ).toHaveTextContent(/^-$/);
      }
    }
  });
});
