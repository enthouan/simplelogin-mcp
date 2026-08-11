import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { URL } from 'node:url';

const runtimeErrors = new WeakMap();

test.beforeEach(async ({ page }) => {
  const errors = [];
  runtimeErrors.set(page, errors);
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
});

test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page) ?? [], 'The page emitted browser errors').toEqual([]);
});

async function openPage(page, path, expectedTheme) {
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-theme', expectedTheme);
  await page.evaluate(() => globalThis.document.fonts.ready);

  const widths = await page.evaluate(() => ({
    clientWidth: globalThis.document.documentElement.clientWidth,
    scrollWidth: globalThis.document.documentElement.scrollWidth,
  }));
  expect(
    widths.scrollWidth,
    `Document overflowed horizontally by ${widths.scrollWidth - widths.clientWidth}px`,
  ).toBeLessThanOrEqual(widths.clientWidth + 1);
}

async function focusWithKeyboard(page, target) {
  for (let index = 0; index < 24; index += 1) {
    if (await target.evaluate((element) => globalThis.document.activeElement === element)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

async function expectVisibleFocus(target) {
  const indicator = await target.evaluate((element) => {
    const style = globalThis.getComputedStyle(element);
    return {
      boxShadow: style.boxShadow,
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(
    indicator.boxShadow !== 'none' ||
      (indicator.outlineStyle !== 'none' && indicator.outlineWidth > 0),
    `Focused action had no visible indicator: ${JSON.stringify(indicator)}`,
  ).toBe(true);
}

test('homepage actions retain responsive, theme, hover, and keyboard behavior @mobile @theme', async ({
  page,
}, testInfo) => {
  const expectedTheme = testInfo.project.name.endsWith('dark') ? 'dark' : 'light';
  const isDesktop = !testInfo.project.name.startsWith('mobile');
  await openPage(page, '/', expectedTheme);

  await expect(
    page.getByRole('heading', { level: 1, name: /Manage SimpleLogin from your MCP client/i }),
  ).toBeVisible();

  const actions = [
    page.getByRole('link', { name: 'Get started' }),
    page.getByRole('link', { name: 'View on GitHub' }),
  ];

  if (isDesktop) {
    for (const action of actions) {
      const before = await action.evaluate(
        (element) => globalThis.getComputedStyle(element).boxShadow,
      );
      await action.hover();
      const after = await action.evaluate(
        (element) => globalThis.getComputedStyle(element).boxShadow,
      );
      expect(after).not.toBe('none');
      expect(after).not.toBe(before);
    }
    await page.mouse.move(0, 0);
  }

  for (const action of actions) {
    await focusWithKeyboard(page, action);
    await expectVisibleFocus(action);
  }
});

test('homepage renders without runtime or layout errors @webkit', async ({ page }) => {
  await openPage(page, '/', 'light');
  await expect(
    page.getByRole('heading', { level: 1, name: /Manage SimpleLogin from your MCP client/i }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Get started' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View on GitHub' })).toBeVisible();
});

test('Claude Desktop deep link selects a single-line client tab @mobile', async ({
  page,
}, testInfo) => {
  const expectedTheme = testInfo.project.name.endsWith('dark') ? 'dark' : 'light';
  await openPage(page, '/getting-started/#claude-desktop', expectedTheme);

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

test('tool catalog deep links and filters without losing its target @mobile', async ({
  page,
}, testInfo) => {
  const expectedTheme = testInfo.project.name.endsWith('dark') ? 'dark' : 'light';
  await openPage(page, '/reference/tools/#alias_create_random', expectedTheme);

  const target = page.locator('#alias_create_random');
  await expect(target).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search tools' }).fill('alias_create_random');
  await expect(page.getByRole('status')).toHaveText(/1 of \d+ tools shown/);
  await expect(page.locator('[data-tool-card]:visible')).toHaveCount(1);
  await expect(target).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#alias_create_random');
});

test('key pages have no serious automated accessibility violations @mobile @theme', async ({
  page,
}, testInfo) => {
  const expectedTheme = testInfo.project.name.endsWith('dark') ? 'dark' : 'light';

  for (const path of ['/', '/getting-started/', '/guides/operations/', '/reference/tools/']) {
    await openPage(page, path, expectedTheme);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const violations = results.violations
      .filter(({ impact }) => impact === 'critical' || impact === 'serious')
      .map(({ id, impact, nodes }) => ({
        id,
        impact,
        targets: nodes.map(({ target }) => target.join(' ')),
      }));

    expect(violations, `${path} has serious accessibility violations`).toEqual([]);
  }
});

test('production Pagefind search returns a tool-catalog result', async ({ page }, testInfo) => {
  const expectedTheme = testInfo.project.name.endsWith('dark') ? 'dark' : 'light';
  await openPage(page, '/', expectedTheme);

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

  const expectedTheme = testInfo.project.name.endsWith('dark') ? 'dark' : 'light';
  await openPage(page, '/404.html', expectedTheme);
  await expect(page.getByRole('heading', { level: 1, name: '404' })).toBeVisible();
  await expect(page.locator('main')).toContainText(/page not found/i);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
});

test('native mobile menu is keyboard operable @mobile', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'This check requires mobile navigation.');

  await openPage(page, '/getting-started/', 'light');
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

test('key pages reflow at 320px and a 200%-zoom equivalent', async ({ page }) => {
  test.setTimeout(60_000);
  const routes = [
    '/',
    '/getting-started/',
    '/getting-started/clients/',
    '/guides/how-it-works/',
    '/reference/tools/',
  ];

  for (const viewport of [
    { width: 320, height: 720 },
    { width: 720, height: 450 },
  ]) {
    await page.setViewportSize(viewport);
    for (const route of routes) {
      await openPage(page, route, 'light');
      await expect(page.locator('main h1')).toBeVisible();
    }
  }
});

test('reduced-motion preference suppresses nonessential motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openPage(page, '/', 'light');

  const motion = await page.evaluate(() => {
    const toMilliseconds = (value) =>
      value
        .split(',')
        .map((part) => part.trim())
        .map((part) =>
          part.endsWith('ms') ? Number.parseFloat(part) : Number.parseFloat(part) * 1_000,
        )
        .filter(Number.isFinite);
    const visibleElements = [...globalThis.document.querySelectorAll('body *')].filter(
      (element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0;
      },
    );
    const durations = visibleElements.flatMap((element) => {
      const style = globalThis.getComputedStyle(element);
      return [
        ...toMilliseconds(style.animationDuration),
        ...toMilliseconds(style.transitionDuration),
      ];
    });

    return {
      matches: globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches,
      maximumDuration: Math.max(0, ...durations),
      scrollBehavior: globalThis.getComputedStyle(globalThis.document.documentElement)
        .scrollBehavior,
    };
  });

  expect(motion.matches).toBe(true);
  expect(motion.maximumDuration).toBeLessThanOrEqual(0.01);
  expect(motion.scrollBehavior).not.toBe('smooth');
});

test('Markdown tables are focusable and wide tables support keyboard scrolling @mobile', async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'This check requires a narrow viewport.');

  await openPage(page, '/reference/configuration/', 'light');
  const markdownTable = page.locator('main table').first();
  await expect(markdownTable).toHaveAttribute('tabindex', '0');
  await markdownTable.focus();
  await expect(markdownTable).toBeFocused();
  await expectVisibleFocus(markdownTable);

  await openPage(page, '/reference/api-coverage/', 'light');
  const scrollRegion = page.locator('.api-coverage-table').first();
  await expect(scrollRegion).toHaveAttribute('tabindex', '0');

  const initial = await scrollRegion.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollLeft: element.scrollLeft,
    scrollWidth: element.scrollWidth,
  }));
  expect(initial.scrollWidth).toBeGreaterThan(initial.clientWidth);

  await scrollRegion.focus();
  await expect(scrollRegion).toBeFocused();
  await expectVisibleFocus(scrollRegion);
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => scrollRegion.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(initial.scrollLeft);
});
