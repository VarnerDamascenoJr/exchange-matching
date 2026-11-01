import { expect, test, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const orderForm = (page: Page, side: 'buy' | 'sell') =>
  page.locator('form').filter({
    has: page.getByRole('button', { name: `Submit ${side} order` }),
  });

async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: username, exact: true }),
  ).toBeVisible();
}

async function placeOrder(page: Page, side: 'buy' | 'sell', amount: string) {
  const form = orderForm(page, side);
  await form.getByLabel('Amount (BTC)').fill(amount);
  await form.getByLabel('Price (USD)').fill('30000');
  await form.getByRole('button', { name: `Submit ${side} order` }).click();
  await expect(form.getByRole('alert')).toHaveText(
    'Order accepted with status QUEUED.',
  );
}

async function expectWithinPage(element: Locator, width: number) {
  const bounds = await element.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(-1);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
}

test('mobile forms fit the page while populated tables scroll within their cards', async ({
  browser,
  baseURL,
}, testInfo) => {
  const viewport = { width: 390, height: 844 };
  const sellerContext = await browser.newContext({ baseURL, viewport });
  const buyerContext = await browser.newContext({ baseURL, viewport });
  const seller = await sellerContext.newPage();
  const buyer = await buyerContext.newPage();
  const errors: string[] = [];
  for (const page of [seller, buyer]) {
    page.on('pageerror', (error) => errors.push(error.message));
  }

  try {
    const suffix = randomUUID().slice(0, 8);
    await login(seller, `mobile-seller-${suffix}`);
    await placeOrder(seller, 'sell', '0.25');
    const active = seller.getByRole('table', {
      name: 'Active orders',
      exact: true,
    });
    await expect(
      active.getByRole('cell', { name: 'OPEN', exact: true }),
    ).toBeVisible();

    await login(buyer, `mobile-buyer-${suffix}`);
    await placeOrder(buyer, 'buy', '0.1');
    await expect(
      active.getByRole('cell', { name: 'PARTIALLY_FILLED', exact: true }),
    ).toBeVisible();
    await expect(
      buyer
        .getByRole('table', { name: 'Trade history' })
        .getByRole('cell', { name: 'TAKER', exact: true }),
    ).toBeVisible();

    for (const width of [390, 320, 768, 1600]) {
      for (const page of [seller, buyer]) {
        await page.setViewportSize({ width, height: 844 });
        await page.evaluate(() => window.scrollTo(0, window.scrollY));
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width + 1);

        for (const side of ['buy', 'sell'] as const) {
          const form = orderForm(page, side);
          await expectWithinPage(form.getByLabel('Amount (BTC)'), width);
          await expectWithinPage(form.getByLabel('Price (USD)'), width);
          await expectWithinPage(
            form.getByRole('button', { name: `Submit ${side} order` }),
            width,
          );
        }
        for (const name of [
          'Active orders',
          'Market matches',
          'Trade history',
        ]) {
          const container = page
            .getByRole('table', { name, exact: true })
            .locator('..');
          await expectWithinPage(container, width);
          await expect(container).toHaveCSS('overflow-x', 'auto');
        }
      }
    }

    await seller.setViewportSize(viewport);
    const scrollContainer = active.locator('..');
    const dimensions = await scrollContainer.evaluate((element) => ({
      content: element.scrollWidth,
      visible: element.clientWidth,
    }));
    expect(dimensions.content).toBeGreaterThan(dimensions.visible);
    await scrollContainer.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    const cancel = active.getByRole('button', { name: 'Cancel', exact: true });
    await cancel.scrollIntoViewIfNeeded();
    await expectWithinPage(cancel, viewport.width);
    await cancel.click();
    await expect(
      active.getByText('No active orders for this filter.'),
    ).toBeVisible();
    expect(
      await seller.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width + 1);

    const form = orderForm(seller, 'sell');
    await form.scrollIntoViewIfNeeded();
    await testInfo.attach('mobile-order-form', {
      body: await form.screenshot(),
      contentType: 'image/png',
    });
    expect(errors).toEqual([]);
  } finally {
    await sellerContext.close();
    await buyerContext.close();
  }
});
