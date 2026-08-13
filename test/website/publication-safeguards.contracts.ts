import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { expect, it } from 'vitest';
import { homeHtml, listFiles, outputRoot, readOutputFile, readRepoFile } from './support.js';
import type { PackageJson } from './support.js';

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function ogSourceDigest(template: Uint8Array, renderer: Uint8Array): string {
  const hash = createHash('sha256');
  hash.update('simplelogin-mcp-og-image-v1\0');
  hash.update(template);
  hash.update('\0renderer\0');
  hash.update(renderer);
  return hash.digest('hex');
}

function pngDimensions(image: Buffer): { height: number; width: number } {
  return {
    width: image.readUInt32BE(16),
    height: image.readUInt32BE(20),
  };
}

export function registerPublicationSafeguardsContracts(): void {
  it('renders the open-source Lucide mail icon as a local hero asset', async () => {
    const files = await listFiles(outputRoot);
    const heroMark = await readRepoFile('website/src/assets/simplelogin-mcp-mark.svg');
    const favicon = await readRepoFile('website/public/favicon.svg');
    const socialCard = await readRepoFile('website/og-image.html');
    const notices = await readOutputFile('third-party-notices.txt');

    expect(homeHtml).toMatch(
      /<img[^>]+src="\/_astro\/simplelogin-mcp-mark\.[^"]+\.svg"[^>]+alt="simplelogin-mcp mailbox mark"/,
    );
    expect(files.some((path) => /^_astro\/simplelogin-mcp-mark\..+\.svg$/.test(path))).toBe(true);
    expect(heroMark).toContain('https://lucide.dev/icons/mail');
    expect(heroMark).toContain('ISC License');
    expect(heroMark).toContain('fill="#b72570"');
    expect(heroMark).toContain('d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"');
    expect(favicon).toBe(heroMark);
    expect(socialCard).toContain('data-social-card');
    expect(socialCard).toContain('Full license: public/third-party-notices.txt');
    expect(socialCard).toContain('Manage aliases from');
    expect(socialCard).toContain('Self-hosted, auditable alias automation.');
    expect(socialCard).toContain('27 tools');
    expect(socialCard).toContain('Independent');
    expect(socialCard).toContain('community project');
    expect(socialCard).toContain('--og-canvas: #fff4f9');
    expect(notices).toContain('https://lucide.dev/icons/mail');
    expect(notices).toContain('Copyright (c) 2026 Lucide Icons and Contributors');
    expect(notices).toContain('Permission to use, copy, modify, and/or distribute this software');
  });

  it('keeps the browser-rendered social image synchronized with its sources', async () => {
    const [template, renderer, manifestSource, image] = await Promise.all([
      readFile(join(process.cwd(), 'website/og-image.html')),
      readFile(join(process.cwd(), 'website/scripts/render-og-image.ts')),
      readRepoFile('website/og-image.manifest.json'),
      readFile(join(process.cwd(), 'website/public/og-card.png')),
    ]);
    const manifest = JSON.parse(manifestSource) as {
      height: number;
      imageSha256: string;
      schemaVersion: number;
      sourceSha256: string;
      width: number;
    };

    expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(manifest).toEqual({
      schemaVersion: 1,
      width: 1_200,
      height: 630,
      sourceSha256: ogSourceDigest(template, renderer),
      imageSha256: sha256(image),
    });
    expect(pngDimensions(image)).toEqual({ width: 1_200, height: 630 });
  });

  it('uses local runtime assets and contains no analytics, real secrets, or release-version copy', async () => {
    const websiteSources = (
      await Promise.all(
        [
          'website/src/content/docs',
          'website/src/components',
          'website/src/data',
          'website/src/styles',
        ].map(async (directory) =>
          Promise.all(
            (await listFiles(join(process.cwd(), directory))).map((path) =>
              readRepoFile(posix.join(directory, path)),
            ),
          ),
        ),
      )
    )
      .flat()
      .join('\n');

    expect(homeHtml).not.toMatch(/<script[^>]+src="https?:/i);
    expect(homeHtml).not.toMatch(/<link[^>]+rel="stylesheet"[^>]+href="https?:/i);
    expect(homeHtml).not.toMatch(/googletagmanager|segment\.com|posthog|plausible\.io/i);
    expect(homeHtml).not.toMatch(/sl-[A-Za-z0-9]{20,}/);
    expect(websiteSources).not.toMatch(/(?<![\d.])\d+\.\d+\.\d+(?![\d.])/);
    expect(homeHtml).not.toMatch(/<a[^>]+href="https:\/\/ghcr\.io/);
  });

  it('uses portable Astro commands without custom publication modes', async () => {
    const [
      rootPackage,
      websitePackage,
      playwrightConfig,
      astroConfig,
      robotsSource,
      websiteReadme,
    ] = await Promise.all([
      readRepoFile('package.json'),
      readRepoFile('website/package.json'),
      readRepoFile('playwright.config.mjs'),
      readRepoFile('website/astro.config.mjs'),
      readRepoFile('website/src/pages/robots.txt.ts'),
      readRepoFile('website/README.md'),
    ]);
    const rootPackageJson = JSON.parse(rootPackage) as PackageJson;
    const websitePackageJson = JSON.parse(websitePackage) as PackageJson;

    expect(rootPackageJson.scripts['website:build']).toBe('pnpm --dir website build');
    expect(rootPackageJson.scripts['website:build:test']).toBe(
      'node website/scripts/build-test-fixture.mjs',
    );
    expect(rootPackageJson.scripts['website:dev']).toBe('pnpm --dir website dev');
    expect(rootPackageJson.scripts['website:og']).toBe('tsx website/scripts/render-og-image.ts');
    expect(rootPackageJson.scripts['website:og:check']).toBe(
      'tsx website/scripts/render-og-image.ts --check',
    );
    expect(rootPackageJson.scripts['website:test:built']).toBe(
      'cross-env WEBSITE_TEST_OUTPUT_ROOT=website/.test-dist vitest run test/website.test.ts',
    );
    expect(rootPackageJson.devDependencies['cross-env']).toBe('10.1.0');
    expect(rootPackageJson.scripts['website:check']).toContain('pnpm website:og:check');
    expect(rootPackageJson.scripts['website:check']).toContain('pnpm website:build:test');
    expect(rootPackageJson.scripts['website:check']).toMatch(/pnpm website:build$/);
    expect(rootPackageJson.scripts).not.toHaveProperty(`website:build${':production'}`);
    expect(websitePackageJson.scripts['build']).toBe('astro build');
    expect(websitePackageJson.scripts['dev']).toBe('astro dev --host 127.0.0.1 --port 4173');
    expect(websitePackageJson.scripts['preview']).toBe(
      'astro preview --host 127.0.0.1 --port 4173',
    );
    expect(playwrightConfig).toContain(
      'node website/scripts/preview-test-fixture.mjs --host 127.0.0.1 --port 4174',
    );
    for (const command of Object.values(websitePackageJson.scripts)) {
      expect(command).not.toMatch(/^[A-Z][A-Z0-9_]*=/);
    }
    expect(websitePackageJson.scripts).not.toHaveProperty(`build${':production'}`);
    expect(astroConfig).toContain('site: CANONICAL_WEBSITE_URL');
    expect(astroConfig).toContain("trailingSlash: 'always'");
    expect(astroConfig).not.toContain("from 'node:process'");
    expect(robotsSource).toContain('CANONICAL_WEBSITE_URL');
    expect(websiteReadme).toContain('No website publication or base-URL environment variable');
  });

  it('keeps website packages and output out of the MCP runtime artifact', async () => {
    const [dockerIgnore, dockerfile, packageSource, websitePackageSource] = await Promise.all([
      readRepoFile('.dockerignore'),
      readRepoFile('Dockerfile'),
      readRepoFile('package.json'),
      readRepoFile('website/package.json'),
    ]);
    const packageJson = JSON.parse(packageSource) as PackageJson;
    const websitePackageJson = JSON.parse(websitePackageSource) as PackageJson;

    expect(dockerIgnore.split('\n')).toContain('website');
    expect(packageJson.files).not.toContain('website');
    for (const dependency of [
      '@astrojs/check',
      '@astrojs/starlight',
      '@fortawesome/free-brands-svg-icons',
      '@fortawesome/free-solid-svg-icons',
      'astro',
      'sharp',
    ]) {
      expect(packageJson.dependencies).not.toHaveProperty(dependency);
      expect(packageJson.devDependencies).not.toHaveProperty(dependency);
      expect(websitePackageJson.devDependencies).toHaveProperty(dependency);
    }
    expect(dockerfile).toContain('pnpm install --filter simplelogin-mcp --frozen-lockfile');
    expect(dockerfile).toContain(
      'pnpm install --filter simplelogin-mcp --prod --frozen-lockfile --ignore-scripts',
    );
  });
}
