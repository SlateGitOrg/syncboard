import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end proof of the full offline -> reconnect -> merge path across
 * two real browser contexts talking through the real relay (started by
 * playwright.config.ts). This is the scenario the whole project exists
 * to demonstrate:
 *
 *   1. Two tabs on the same board, both connected through the relay.
 *   2. Tab B goes offline (simulated network partition).
 *   3. Tab B keeps working — adds a card — entirely from its local
 *      IndexedDB-backed Yjs doc, no network involved.
 *   4. Tab A, still online, does NOT see Tab B's card yet (proving it's
 *      a genuine partition, not a fluke).
 *   5. Tab B reconnects. Tab A converges to include Tab B's card with no
 *      data loss and no manual conflict resolution step.
 *
 * Run with: npm run e2e (requires `npx playwright install chromium`).
 */

async function addCard(page: Page, columnTestId: string, title: string) {
  const column = page.getByTestId(columnTestId);
  await column.getByPlaceholder('Add a card…').fill(title);
  await column.getByPlaceholder('Add a card…').press('Enter');
}

test('offline edits queue locally and merge in once the connection is restored', async ({
  browser,
}) => {
  const boardId = `e2e-${Date.now()}`;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await pageA.goto(`/?board=${boardId}`);
  await pageB.goto(`/?board=${boardId}`);

  await expect(pageA.getByTestId('connection-banner')).toContainText(/Live|Connecting/, {
    timeout: 15_000,
  });
  await expect(pageB.getByTestId('connection-banner')).toContainText(/Live|Connecting/, {
    timeout: 15_000,
  });

  // Wait for both to actually report connected before we start.
  await expect(pageA.getByTestId('connection-banner')).toContainText('Live', { timeout: 15_000 });
  await expect(pageB.getByTestId('connection-banner')).toContainText('Live', { timeout: 15_000 });

  const columns = await pageA.locator('.column').all();
  const firstColumnTestId = await columns[0].getAttribute('data-testid');
  expect(firstColumnTestId).toBeTruthy();

  // Sanity check: an online edit on A shows up on B first.
  await addCard(pageA, firstColumnTestId!, 'Baseline card (online)');
  await expect(pageB.getByText('Baseline card (online)')).toBeVisible({ timeout: 10_000 });

  // Partition B.
  await contextB.setOffline(true);
  await pageB.getByTestId('offline-toggle').click(); // also flips our app-level simulated toggle
  await expect(pageB.getByTestId('connection-banner')).toContainText('Offline');

  await addCard(pageB, firstColumnTestId!, 'Written entirely offline');

  // A must NOT see it yet — this is the actual partition assertion.
  await pageA.waitForTimeout(1500);
  await expect(pageA.getByText('Written entirely offline')).toHaveCount(0);

  // Heal the partition.
  await contextB.setOffline(false);
  await pageB.getByTestId('offline-toggle').click();

  // A converges to include B's offline edit, with zero data loss.
  await expect(pageA.getByText('Written entirely offline')).toBeVisible({ timeout: 15_000 });
  await expect(pageA.getByText('Baseline card (online)')).toBeVisible();
  await expect(pageB.getByText('Baseline card (online)')).toBeVisible();

  await contextA.close();
  await contextB.close();
});

test('a card created offline survives a full page reload before reconnecting', async ({
  browser,
}) => {
  const boardId = `e2e-reload-${Date.now()}`;
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`/?board=${boardId}`);
  await expect(page.getByTestId('connection-banner')).toContainText('Live', { timeout: 15_000 });

  // Use the app-level offline toggle rather than context.setOffline(): the
  // latter blocks ALL browser networking, including the page reload we're
  // about to perform, which would fail for reasons unrelated to what this
  // test is proving. The app-level toggle exercises the exact same
  // ConnectionManager.forceOffline() code path a real network drop would.
  await page.getByTestId('offline-toggle').click();
  await expect(page.getByTestId('connection-banner')).toContainText('Offline');

  const columns = await page.locator('.column').all();
  const firstColumnTestId = await columns[0].getAttribute('data-testid');
  await addCard(page, firstColumnTestId!, 'Queued before reload');

  await page.reload();
  // Still shows the card immediately after reload and before any relay
  // round-trip could have happened — proves IndexedDB, not the relay, is
  // the source of truth for surviving the reload.
  await expect(page.getByText('Queued before reload')).toBeVisible({ timeout: 10_000 });

  await context.close();
});
