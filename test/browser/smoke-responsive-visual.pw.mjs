import {
  expect,
  expectedTheme,
  expectVisibleFocus,
  focusWithKeyboard,
  openPage,
  test,
} from './support/website-test.mjs';

test('repository links retain responsive, theme, hover, and keyboard behavior @mobile @theme', async ({
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

  const githubAction = page.locator('[data-github-action]');
  const getStartedAction = page.getByRole('link', { name: 'Get started' });
  const actions = [getStartedAction, githubAction];

  await expect(githubAction).toHaveAccessibleName('View on GitHub');
  await expect(githubAction).toHaveAttribute('href', 'https://github.com/enthouan/simplelogin-mcp');
  await expect(githubAction).toHaveAttribute('rel', 'external');
  await expect(githubAction).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(githubAction.locator('svg')).toBeVisible();
  await expect(githubAction).not.toContainText(/\bstars?\b/);

  const githubGeometry = await githubAction.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      viewportWidth: globalThis.innerWidth,
    };
  });
  expect(githubGeometry.left).toBeGreaterThanOrEqual(0);
  expect(githubGeometry.right).toBeLessThanOrEqual(githubGeometry.viewportWidth + 1);

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

  let repositoryNavigation;
  if (isDesktop) {
    repositoryNavigation = page.locator('header [data-repository-navigation]:visible').first();
  } else {
    await expect(page.locator('header [data-repository-navigation]')).toBeHidden();
    await openPage(page, '/getting-started/', theme);
    const mobileMenu = page.locator('starlight-menu-button').first();
    await mobileMenu.locator('button').click();
    await expect(mobileMenu).toHaveAttribute('aria-expanded', 'true');
    repositoryNavigation = page
      .locator('#starlight__sidebar [data-repository-navigation]:visible')
      .first();
    await repositoryNavigation.scrollIntoViewIfNeeded();
  }

  await expect(repositoryNavigation).toBeVisible();
  await expect(repositoryNavigation).toHaveAccessibleName(
    'simplelogin-mcp source repository, 1.2K stars',
  );
  await expect(repositoryNavigation).toHaveAttribute(
    'href',
    'https://github.com/enthouan/simplelogin-mcp',
  );
  await expect(repositoryNavigation).toHaveAttribute('rel', 'me external');
  await expect(repositoryNavigation).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(repositoryNavigation.locator('svg')).toHaveCount(2);
  for (const icon of await repositoryNavigation.locator('svg').all()) {
    await expect(icon).toHaveAttribute('aria-hidden', 'true');
  }
  await expect(repositoryNavigation.locator('.star-count')).toHaveAttribute('aria-hidden', 'true');
  await expect(repositoryNavigation.locator('.star-count')).toHaveText('1.2K');
  const navigationText = await repositoryNavigation.locator('.star-count').innerText();
  const navigationAccessibleName = await repositoryNavigation.getAttribute('aria-label');
  expect(navigationAccessibleName).toContain(navigationText);

  const navigationGeometry = await repositoryNavigation.evaluate((element) => {
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
  expect(navigationGeometry.whiteSpace).toBe('nowrap');
  expect(navigationGeometry.left).toBeGreaterThanOrEqual(0);
  expect(navigationGeometry.right).toBeLessThanOrEqual(navigationGeometry.viewportWidth + 1);
  expect(navigationGeometry.scrollWidth).toBeLessThanOrEqual(navigationGeometry.clientWidth + 1);

  if (isDesktop) {
    const [navigationRect, searchRect, themeRect] = await Promise.all([
      repositoryNavigation.boundingBox(),
      page.locator('header site-search button:visible').first().boundingBox(),
      page.locator('header starlight-theme-select:visible').first().boundingBox(),
    ]);
    expect(navigationRect).not.toBeNull();
    for (const controlRect of [searchRect, themeRect]) {
      expect(controlRect).not.toBeNull();
      const overlaps =
        navigationRect.x < controlRect.x + controlRect.width &&
        navigationRect.x + navigationRect.width > controlRect.x &&
        navigationRect.y < controlRect.y + controlRect.height &&
        navigationRect.y + navigationRect.height > controlRect.y;
      expect(overlaps).toBe(false);
    }
  }

  await focusWithKeyboard(page, repositoryNavigation);
  await expectVisibleFocus(repositoryNavigation);
  expect(metadataRequests).toEqual([]);
});

test('repository navigation fits at Starlight’s desktop breakpoint', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await openPage(page, '/', 'light');

  const repositoryNavigation = page.locator('header [data-repository-navigation]:visible').first();
  const searchButton = page.locator('header site-search button:visible').first();
  await expect(repositoryNavigation).toBeVisible();
  await expect(searchButton).toBeVisible();

  const [repositoryRect, searchRect] = await Promise.all([
    repositoryNavigation.boundingBox(),
    searchButton.boundingBox(),
  ]);
  expect(repositoryRect).not.toBeNull();
  expect(searchRect).not.toBeNull();
  expect(repositoryRect.x).toBeGreaterThanOrEqual(searchRect.x + searchRect.width);
});

test('homepage renders without runtime or layout errors @webkit', async ({ page }) => {
  await openPage(page, '/', 'light');
  await expect(
    page.getByRole('heading', { level: 1, name: /Manage SimpleLogin from your MCP client/i }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Get started' })).toBeVisible();
  await expect(page.locator('[data-github-action]')).toHaveAccessibleName('View on GitHub');
  await expect(page.locator('header [data-repository-navigation]:visible')).toHaveAccessibleName(
    'simplelogin-mcp source repository, 1.2K stars',
  );
});
