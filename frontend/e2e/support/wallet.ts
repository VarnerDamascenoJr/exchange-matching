import { expect, type Page } from '@playwright/test';

type Balances = readonly [available: string, reserved: string, total: string];

export async function expectWalletBalances(
  page: Page,
  btc: Balances,
  usd: Balances,
) {
  const wallet = page.getByRole('region', {
    name: 'Wallet balances',
    exact: true,
  });
  for (const [asset, prefix, balances] of [
    ['BTC', 'BTC', btc],
    ['USD', 'US$', usd],
  ] as const) {
    for (const [index, field] of ['available', 'reserved', 'total'].entries()) {
      await expect(
        wallet.getByLabel(`${asset} ${field} balance`, { exact: true }),
      ).toHaveText(`${prefix} ${balances[index]}`);
    }
  }
}
