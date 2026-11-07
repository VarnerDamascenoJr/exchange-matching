import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { expectWalletBalances } from './support/wallet.js';

const sessionKey = 'exchange-matching.auth-session';
const orderForm = (page: Page, side: 'buy' | 'sell') =>
  page.locator('form').filter({
    has: page.getByRole('button', { name: `Submit ${side} order` }),
  });

async function login(page: Page, username: string) {
  await page.goto('/exchange');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/exchange$/);
  await expect(
    page.getByRole('heading', { name: username, exact: true }),
  ).toBeVisible();
  await expectWalletBalances(
    page,
    ['100.00', '0.00', '100.00'],
    ['100000.00', '0.00', '100000.00'],
  );
}

async function placeOrder(
  page: Page,
  side: 'buy' | 'sell',
  amount: string,
  price: string,
) {
  const form = orderForm(page, side);
  await form.getByLabel('Amount (BTC)').fill(amount);
  await form.getByLabel('Price (USD)').fill(price);
  await form.getByRole('button', { name: `Submit ${side} order` }).click();
  await expect(form.getByRole('alert')).toHaveText(
    'Order accepted with status QUEUED.',
  );
  await expect(form.getByLabel('Amount (BTC)')).toHaveValue('');
}

test('two users see available, reserved and total balances through fills and cancellation, then sign out', async ({
  browser,
  baseURL,
}) => {
  const sellerContext = await browser.newContext({ baseURL });
  const buyerContext = await browser.newContext({ baseURL });
  const seller = await sellerContext.newPage();
  const buyer = await buyerContext.newPage();
  const errors: string[] = [];
  seller.on('pageerror', (error) => errors.push(error.message));
  buyer.on('pageerror', (error) => errors.push(error.message));
  const suffix = randomUUID().slice(0, 8);
  try {
    await login(seller, `seller-${suffix}`);
    await placeOrder(seller, 'sell', '0.25000000', '10000.00000000');
    const sellerOrders = seller.getByRole('table', {
      name: 'Active orders',
      exact: true,
    });
    await expect(
      sellerOrders.getByRole('cell', { name: 'OPEN', exact: true }),
    ).toBeVisible();
    await expectWalletBalances(
      seller,
      ['99.75', '0.25', '100.00'],
      ['100000.00', '0.00', '100000.00'],
    );

    await login(buyer, `buyer-${suffix}`);
    const buy = orderForm(buyer, 'buy');
    const posts: string[] = [];
    buyer.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname === '/orders'
      )
        posts.push(request.postData() ?? '');
    });
    await buy.getByRole('button', { name: 'Submit buy order' }).click();
    await expect(
      buy.getByText('Amount is required', { exact: true }),
    ).toBeVisible();
    expect(posts).toHaveLength(0);
    const asks = buyer.getByRole('table', { name: 'Ask book levels' });
    await asks.getByRole('cell', { name: 'US$ 10000.00', exact: true }).click();
    await expect(buy.getByLabel('Amount (BTC)')).toHaveValue('0.25000000');
    await expect(buy.getByLabel('Price (USD)')).toHaveValue('10000.00000000');
    await buy.getByRole('button', { name: 'Submit buy order' }).click();

    const buyerHistory = buyer.getByRole('table', { name: 'Trade history' });
    const sellerHistory = seller.getByRole('table', { name: 'Trade history' });
    await expect(
      buyerHistory.getByRole('cell', { name: 'TAKER', exact: true }),
    ).toBeVisible();
    await expect(
      buyerHistory.getByRole('cell', { name: 'BUY', exact: true }),
    ).toBeVisible();
    await expect(
      buyerHistory.getByRole('cell', { name: 'BTC 0.00075', exact: true }),
    ).toBeVisible();
    await expect(
      sellerHistory.getByRole('cell', { name: 'MAKER', exact: true }),
    ).toBeVisible();
    await expect(
      sellerHistory.getByRole('cell', { name: 'SELL', exact: true }),
    ).toBeVisible();
    await expect(
      sellerHistory.getByRole('cell', { name: 'US$ 12.50', exact: true }),
    ).toBeVisible();
    for (const page of [buyer, seller]) {
      await expect(
        page
          .getByRole('table', { name: 'Trade history' })
          .getByRole('cell', { name: 'BTC 0.25', exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByRole('table', { name: 'Market matches' })
          .getByRole('cell', { name: 'BTC 0.25', exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByRole('table', { name: 'Active orders', exact: true })
          .getByText('No active orders for this filter.'),
      ).toBeVisible();
    }
    await expectWalletBalances(
      buyer,
      ['100.24925', '0.00', '100.24925'],
      ['97500.00', '0.00', '97500.00'],
    );
    await expectWalletBalances(
      seller,
      ['99.75', '0.00', '99.75'],
      ['102487.50', '0.00', '102487.50'],
    );
    expect(JSON.parse(posts[0])).toEqual({
      side: 'BUY',
      amount: '0.25000000',
      price: '10000.00000000',
    });

    await placeOrder(buyer, 'buy', '0.10000000', '9000.00000000');
    const active = buyer.getByRole('table', {
      name: 'Active orders',
      exact: true,
    });
    await expect(
      active.getByRole('cell', { name: 'OPEN', exact: true }),
    ).toBeVisible();
    await expectWalletBalances(
      buyer,
      ['100.24925', '0.00', '100.24925'],
      ['96600.00', '900.00', '97500.00'],
    );

    await placeOrder(seller, 'sell', '0.04000000', '9000.00000000');
    await expect(
      active.getByRole('cell', { name: 'PARTIALLY_FILLED', exact: true }),
    ).toBeVisible();
    await expectWalletBalances(
      buyer,
      ['100.28905', '0.00', '100.28905'],
      ['96600.00', '540.00', '97140.00'],
    );
    await expectWalletBalances(
      seller,
      ['99.71', '0.00', '99.71'],
      ['102846.42', '0.00', '102846.42'],
    );
    await active.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(
      active.getByText('No active orders for this filter.'),
    ).toBeVisible();
    await expectWalletBalances(
      buyer,
      ['100.28905', '0.00', '100.28905'],
      ['97140.00', '0.00', '97140.00'],
    );

    await buy.getByLabel('Amount (BTC)').fill('100');
    await buy.getByLabel('Price (USD)').fill('10000');
    await buy.getByRole('button', { name: 'Submit buy order' }).click();
    await expect(buy.getByRole('alert')).toHaveText('Insufficient USD balance');
    await expect(buy.getByLabel('Amount (BTC)')).toHaveValue('100');
    await expectWalletBalances(
      buyer,
      ['100.28905', '0.00', '100.28905'],
      ['97140.00', '0.00', '97140.00'],
    );

    for (const page of [seller, buyer]) {
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await expect(page).toHaveURL(/\/login$/);
      expect(
        await page.evaluate((key) => localStorage.getItem(key), sessionKey),
      ).toBeNull();
      await page.goto('/exchange');
      await expect(page).toHaveURL(/\/login$/);
      await expect(
        page.getByRole('button', { name: 'Sign in', exact: true }),
      ).toBeVisible();
    }
    expect(errors).toEqual([]);
  } finally {
    await sellerContext.close();
    await buyerContext.close();
  }
});
