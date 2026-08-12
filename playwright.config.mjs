// @ts-check
import { defineConfig } from '@playwright/test';
import { env } from 'node:process';

const previewUrl = 'http://127.0.0.1:4174';

export default defineConfig({
  testDir: './test/browser',
  testMatch: '**/*.pw.mjs',
  fullyParallel: true,
  forbidOnly: Boolean(env.CI),
  retries: env.CI ? 1 : 0,
  reporter: env.CI
    ? [['line'], ['html', { open: 'never', outputFolder: 'test-results/playwright-report' }]]
    : 'list',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  outputDir: 'test-results/playwright',
  use: {
    baseURL: previewUrl,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'cross-env ASTRO_PREVIEW_BACKGROUND=0 pnpm --dir website exec astro preview --host 127.0.0.1 --port 4174',
    url: previewUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'desktop-light',
      grepInvert: /@webkit/,
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 800 },
        colorScheme: 'light',
      },
    },
    {
      name: 'desktop-dark',
      grep: /@theme/,
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 800 },
        colorScheme: 'dark',
      },
    },
    {
      name: 'mobile-light',
      grep: /@mobile/,
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        colorScheme: 'light',
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'mobile-dark',
      grep: /@theme/,
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        colorScheme: 'dark',
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'webkit-desktop-light',
      grep: /@webkit/,
      use: {
        browserName: 'webkit',
        viewport: { width: 1280, height: 800 },
        colorScheme: 'light',
      },
    },
  ],
});
