import {expect, test} from '@playwright/test';

const BACKEND = 'http://127.0.0.1:3000';

test.beforeEach(async ({page}) => {
  await page.goto('/');
});

test('renders top-10 bids and asks with price, amount and total', async ({
  page,
}) => {
  const bids = page.getByRole('table', {name: 'Bids'});
  const asks = page.getByRole('table', {name: 'Asks'});

  // Best bid row: 64,000.00 × 0.7500 = 48,000.00.
  const bestBid = bids.locator('tbody tr').first();
  await expect(bestBid).toContainText('64,000.00');
  await expect(bestBid).toContainText('0.7500');
  await expect(bestBid).toContainText('48,000.00');

  // Best ask row: 64,001.00 × 0.5000 = 32,000.50.
  const bestAsk = asks.locator('tbody tr').first();
  await expect(bestAsk).toContainText('64,001.00');
  await expect(bestAsk).toContainText('0.5000');
  await expect(bestAsk).toContainText('32,000.50');

  // Exactly 10 levels per side even though the feed carries 12.
  await expect(bids.locator('tbody tr')).toHaveCount(10);
  await expect(asks.locator('tbody tr')).toHaveCount(10);
  await expect(bids).not.toContainText('63,990.50');
  await expect(asks).not.toContainText('64,011.00');

  // Bids left of asks.
  const [bidsBox, asksBox] = [
    await bids.boundingBox(),
    await asks.boundingBox(),
  ];
  expect(bidsBox!.x).toBeLessThan(asksBox!.x);
});

test('shows spread and mid price in the header', async ({page}) => {
  const stats = page.getByLabel('Order book statistics');
  await expect(stats).toContainText('Spread: 1.00');
  await expect(stats).toContainText('Mid Price: 64,000.50');
});

test('applies delta updates: override, remove and insert', async ({page}) => {
  const bids = page.getByRole('table', {name: 'Bids'});
  const asks = page.getByRole('table', {name: 'Asks'});

  // Override: bid 63,999 amount 2 → 5.
  await expect(bids.locator('tr', {hasText: '63,999.00'})).toContainText(
    '5.0000',
  );
  // Removal: bid 63,995 disappears.
  await expect(bids).not.toContainText('63,995.00');
  // Insert: bid 63,994.50 appears.
  await expect(bids).toContainText('63,994.50');
  // Override on the ask side: 64,002 amount 1.4 → 7.
  await expect(asks.locator('tr', {hasText: '64,002.00'})).toContainText(
    '7.0000',
  );
});

test('GET /api/orderbook/stats returns spread and mid price', async ({
  request,
}) => {
  const response = await request.get(`${BACKEND}/api/orderbook/stats`);
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({spread: 1, midPrice: 64000.5});
});

test('keeps the DOM stable across live updates (no flicker)', async ({
  page,
}) => {
  const bids = page.getByRole('table', {name: 'Bids'});
  await expect(bids.locator('tbody tr')).toHaveCount(10);

  // Tag the table and the toggling row's cells, then wait through two
  // scripted update cycles: the nodes must be reused, not re-created.
  await page.evaluate(() => {
    document
      .querySelectorAll('table[aria-label="Bids"], tr')
      .forEach(node => node.setAttribute('data-stable', 'yes'));
  });
  const toggling = bids.locator('tr', {hasText: '63,998.00'});
  await expect(toggling).toContainText('6.5000', {timeout: 5_000});
  await expect(toggling).toContainText('1.2000', {timeout: 5_000});
  await expect(bids).toHaveAttribute('data-stable', 'yes');
  await expect(toggling).toHaveAttribute('data-stable', 'yes');
  await expect(bids.locator('tbody tr')).toHaveCount(10);
});
