import { URL } from 'node:url';

import { expect, expectedTheme, openPage, test } from './support/website-test.mjs';

test('tool catalog deep links and filters without losing its target @mobile', async ({
  page,
}, testInfo) => {
  const theme = expectedTheme(testInfo);
  await openPage(page, '/reference/tools/#alias_create_random', theme);

  const target = page.locator('#alias_create_random');
  await expect(target).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search tools' }).fill('alias_create_random');
  await expect(page.getByRole('status')).toHaveText(/1 of \d+ tools shown/);
  await expect(page.locator('[data-tool-card]:visible')).toHaveCount(1);
  await expect(target).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#alias_create_random');
});

test('code blocks copy their complete source and announce success', async ({ context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openPage(page, '/getting-started/', 'light');

  const copyButton = page.locator('main .expressive-code .copy button[data-code]').first();
  const encodedSource = await copyButton.getAttribute('data-code');
  expect(encodedSource, 'Copy control must expose its source code').toBeTruthy();

  const liveRegion = copyButton.locator('xpath=..').locator('[aria-live]');
  await copyButton.click();
  await expect(liveRegion.getByText('Copied!', { exact: true })).toBeVisible();

  const copiedSource = await page.evaluate(() => globalThis.navigator.clipboard.readText());
  const normalize = (value) => value.replaceAll('\r\n', '\n').trimEnd();
  expect(normalize(copiedSource)).toBe(normalize((encodedSource ?? '').replaceAll('\u007f', '\n')));
  await expect(copyButton).not.toHaveAttribute('data-copy-error', 'true');
});

test('clipboard failures are announced once and then cleared', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new globalThis.DOMException('Clipboard write rejected', 'NotAllowedError');
        },
      },
    });
    Object.defineProperty(globalThis.Document.prototype, 'execCommand', {
      configurable: true,
      value: () => false,
    });
  });
  await openPage(page, '/getting-started/', 'light');

  const copyButton = page.locator('main .expressive-code .copy button[data-code]').first();
  const liveRegion = copyButton.locator('xpath=..').locator('[aria-live]');
  await copyButton.click();

  const failure = liveRegion.locator('.feedback.copy-error');
  await expect(failure).toHaveCount(1);
  await expect(failure).toHaveText('Copy failed. Select the code and copy it manually.');
  await expect(failure).toBeVisible();
  await expect(copyButton).toHaveAttribute('data-copy-error', 'true');

  await expect(failure).toHaveCount(0, { timeout: 6_000 });
  await expect(copyButton).not.toHaveAttribute('data-copy-error', 'true');
});
