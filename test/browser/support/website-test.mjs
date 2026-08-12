import { expect, test as base } from '@playwright/test';

export const test = base.extend({
  browserErrors: [
    async ({ page }, use) => {
      const errors = [];
      const handleConsole = (message) => {
        if (message.type() === 'error') errors.push(`console: ${message.text()}`);
      };
      const handlePageError = (error) => errors.push(`page: ${error.message}`);

      page.on('console', handleConsole);
      page.on('pageerror', handlePageError);
      await use();
      page.off('console', handleConsole);
      page.off('pageerror', handlePageError);

      expect(errors, 'The page emitted browser errors').toEqual([]);
    },
    { auto: true, scope: 'test' },
  ],
});

export { expect };

export function expectedTheme(testInfo) {
  return testInfo.project.name.endsWith('dark') ? 'dark' : 'light';
}

export async function openPage(page, path, theme) {
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
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

export async function focusWithKeyboard(page, target) {
  for (let index = 0; index < 24; index += 1) {
    if (await target.evaluate((element) => globalThis.document.activeElement === element)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

export async function expectVisibleFocus(target) {
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
