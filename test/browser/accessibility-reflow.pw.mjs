import AxeBuilder from '@axe-core/playwright';

import {
  expect,
  expectedTheme,
  expectVisibleFocus,
  focusWithKeyboard,
  openPage,
  test,
} from './support/website-test.mjs';

test('key pages have no serious automated accessibility violations @mobile @theme', async ({
  page,
}, testInfo) => {
  const theme = expectedTheme(testInfo);

  for (const path of ['/', '/getting-started/', '/guides/operations/', '/reference/tools/']) {
    await openPage(page, path, theme);
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

test('the skip link reaches the main content with a visible keyboard focus indicator', async ({
  page,
}) => {
  await openPage(page, '/getting-started/', 'light');

  const skipLink = page.getByRole('link', { name: 'Skip to content', exact: true });
  await focusWithKeyboard(page, skipLink);
  await expect(skipLink).toBeVisible();
  await expectVisibleFocus(skipLink);

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#_top$/);
  await expect(page.locator('main h1#_top')).toBeVisible();
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
