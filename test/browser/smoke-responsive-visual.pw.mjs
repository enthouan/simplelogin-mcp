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
  const metadataRequests = [];
  page.on('request', (request) => {
    if (/api\.github\.com|shields\.io|\/stargazers\b/i.test(request.url())) {
      metadataRequests.push(request.url());
    }
  });
  await openPage(page, '/', theme);

  await expect(
    page.getByRole('heading', { level: 1, name: /Manage SimpleLogin from your MCP client/i }),
  ).toBeVisible();

  const githubAction = page.locator('[data-repository-action]');
  const getStartedAction = page.getByRole('link', { name: 'Get started' });
  const actions = [getStartedAction, githubAction];

  await expect(githubAction).toHaveAccessibleName('View on GitHub · 1.2K stars');
  await expect(githubAction).toHaveAttribute('href', 'https://github.com/enthouan/simplelogin-mcp');
  await expect(githubAction).toHaveAttribute('rel', 'external');
  await expect(githubAction).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(githubAction.locator('svg')).toBeVisible();

  const githubGeometry = await githubAction.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      viewportWidth: globalThis.innerWidth,
      whiteSpace: globalThis.getComputedStyle(element).whiteSpace,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    };
  });
  expect(githubGeometry.whiteSpace).toBe('nowrap');
  expect(githubGeometry.left).toBeGreaterThanOrEqual(0);
  expect(githubGeometry.right).toBeLessThanOrEqual(githubGeometry.viewportWidth + 1);
  expect(githubGeometry.scrollWidth).toBeLessThanOrEqual(githubGeometry.clientWidth + 1);

  const [getStartedRect, githubRect] = await Promise.all([
    getStartedAction.boundingBox(),
    githubAction.boundingBox(),
  ]);
  expect(getStartedRect).not.toBeNull();
  expect(githubRect).not.toBeNull();
  const overlapWidth =
    Math.min(getStartedRect.x + getStartedRect.width, githubRect.x + githubRect.width) -
    Math.max(getStartedRect.x, githubRect.x);
  const overlapHeight =
    Math.min(getStartedRect.y + getStartedRect.height, githubRect.y + githubRect.height) -
    Math.max(getStartedRect.y, githubRect.y);
  expect(overlapWidth > 1 && overlapHeight > 1).toBe(false);
  expect(metadataRequests).toEqual([]);

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
  await expect(page.locator('[data-repository-action]')).toBeVisible();
});
