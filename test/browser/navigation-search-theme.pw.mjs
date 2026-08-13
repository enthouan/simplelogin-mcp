import { expect, expectedTheme, openPage, test } from './support/website-test.mjs';

test('Claude Desktop deep link selects a single-line client tab @mobile', async ({
  page,
}, testInfo) => {
  const theme = expectedTheme(testInfo);
  await openPage(page, '/getting-started/#claude-desktop', theme);

  const tab = page.getByRole('tab', { name: 'Claude Desktop', exact: true });
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  const layout = await tab.evaluate((element) => {
    const range = globalThis.document.createRange();
    range.selectNodeContents(element);
    const lineTops = new Set(
      [...range.getClientRects()].map((rectangle) => Math.round(rectangle.top)),
    );
    return {
      lineCount: lineTops.size,
      whiteSpace: globalThis.getComputedStyle(element).whiteSpace,
    };
  });

  expect(layout.whiteSpace).toBe('nowrap');
  expect(layout.lineCount).toBe(1);
});

test('production Pagefind search returns a tool-catalog result', async ({ page }, testInfo) => {
  const theme = expectedTheme(testInfo);
  await openPage(page, '/', theme);

  const searchButton = page
    .locator(
      'site-search button:visible, button[data-open-modal]:visible, button[aria-label*="search" i]:visible',
    )
    .first();
  await expect(searchButton).toBeVisible();
  await searchButton.click();

  await expect(page.locator('dialog[open], [role="dialog"]:visible').first()).toBeVisible();
  const searchInput = page.locator('.pagefind-ui__search-input:visible').first();
  await expect(searchInput).toBeVisible();
  await searchInput.fill('alias_create_random');

  const result = page
    .locator(
      '.pagefind-ui__result-link[href*="/reference/tools/"]:visible, [data-pagefind-ui] a[href*="/reference/tools/"]:visible',
    )
    .first();
  await expect(result).toBeVisible();
  await result.click();
  await expect(page).toHaveURL(/\/reference\/tools\//);
});

test('the generated 404 is useful and unknown routes return 404', async ({
  page,
  request,
}, testInfo) => {
  const response = await request.get('/this-documentation-page-does-not-exist/');
  expect(response.status()).toBe(404);
  expect(await response.text()).toMatch(/(?:404|not found)/i);

  const theme = expectedTheme(testInfo);
  await openPage(page, '/404.html', theme);
  await expect(page.getByRole('heading', { level: 1, name: '404' })).toBeVisible();
  await expect(page.locator('main')).toContainText(/page not found/i);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
});

test('native mobile menu is keyboard operable @mobile @theme', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'This check requires mobile navigation.');

  await openPage(page, '/getting-started/', expectedTheme(testInfo));
  const menu = page.locator('starlight-menu-button').first();
  const menuButton = menu.locator('button');
  await expect(menuButton).toBeVisible();
  await menuButton.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveAttribute('aria-expanded', 'true');

  const toolCatalogLink = page
    .locator('#starlight__sidebar a[href="/reference/tools/"]:visible')
    .first();
  await expect(toolCatalogLink).toBeVisible();
  await toolCatalogLink.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/reference\/tools\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Tool catalog' })).toBeVisible();
});

test('native theme selection persists across reloads', async ({ page }) => {
  await openPage(page, '/', 'light');
  const themeSelect = page
    .locator(
      'starlight-theme-select select:visible, select[name="theme"]:visible, select[aria-label*="theme" i]:visible',
    )
    .first();
  await expect(themeSelect).toBeVisible();

  for (const theme of ['dark', 'light']) {
    await themeSelect.selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  }
});
