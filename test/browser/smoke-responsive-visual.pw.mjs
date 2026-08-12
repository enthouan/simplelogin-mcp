import {
  expect,
  expectedTheme,
  expectVisibleFocus,
  focusWithKeyboard,
  openPage,
  test,
} from './support/website-test.mjs';

test('homepage actions retain responsive, theme, hover, and keyboard behavior @mobile @theme', async ({
  page,
}, testInfo) => {
  const theme = expectedTheme(testInfo);
  const isDesktop = !testInfo.project.name.startsWith('mobile');
  await openPage(page, '/', theme);

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
