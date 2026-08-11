import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const width = 1_200;
const height = 630;
const templatePath = fileURLToPath(new URL('../og-image.html', import.meta.url));
const imagePath = fileURLToPath(new URL('../public/og-card.png', import.meta.url));
const manifestPath = fileURLToPath(new URL('../og-image.manifest.json', import.meta.url));
const rendererPath = fileURLToPath(import.meta.url);
const checkOnly = process.argv.includes('--check');

interface OgImageManifest {
  height: number;
  imageSha256: string;
  schemaVersion: 1;
  sourceSha256: string;
  width: number;
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sourceDigest(template: Uint8Array, renderer: Uint8Array): string {
  const hash = createHash('sha256');
  hash.update('simplelogin-mcp-og-image-v1\0');
  hash.update(template);
  hash.update('\0renderer\0');
  hash.update(renderer);
  return hash.digest('hex');
}

function pngDimensions(image: Buffer): { height: number; width: number } {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (image.length < 24 || !image.subarray(0, 8).equals(signature)) {
    throw new Error('website/public/og-card.png is not a valid PNG file');
  }

  return {
    width: image.readUInt32BE(16),
    height: image.readUInt32BE(20),
  };
}

async function writeAtomically(path: string, value: Uint8Array | string) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporaryPath, value);
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function currentSourceSha256(): Promise<string> {
  const [template, renderer] = await Promise.all([readFile(templatePath), readFile(rendererPath)]);
  return sourceDigest(template, renderer);
}

async function checkGeneratedImage() {
  const [manifestSource, image, expectedSourceSha256] = await Promise.all([
    readFile(manifestPath, 'utf8'),
    readFile(imagePath),
    currentSourceSha256(),
  ]);
  const manifest = JSON.parse(manifestSource) as OgImageManifest;
  const dimensions = pngDimensions(image);

  if (
    manifest.schemaVersion !== 1 ||
    manifest.width !== width ||
    manifest.height !== height ||
    dimensions.width !== width ||
    dimensions.height !== height ||
    manifest.sourceSha256 !== expectedSourceSha256 ||
    manifest.imageSha256 !== sha256(image)
  ) {
    throw new Error('The generated Open Graph image is stale. Run `corepack pnpm website:og`.');
  }

  console.log('Open Graph image is current.');
}

async function renderImage() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      colorScheme: 'light',
      deviceScaleFactor: 1,
      locale: 'en-US',
      reducedMotion: 'reduce',
      viewport: { width, height },
    });
    const page = await context.newPage();
    await page.goto(pathToFileURL(templatePath).href, { waitUntil: 'load' });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    const card = page.locator('[data-social-card]');
    const bounds = await card.boundingBox();
    if (
      bounds?.x !== 0 ||
      bounds?.y !== 0 ||
      bounds?.width !== width ||
      bounds?.height !== height
    ) {
      throw new Error(`Expected a ${width}x${height} social card at the viewport origin`);
    }

    const image = await card.screenshot({
      animations: 'disabled',
      caret: 'hide',
      type: 'png',
    });
    const manifest: OgImageManifest = {
      schemaVersion: 1,
      width,
      height,
      sourceSha256: await currentSourceSha256(),
      imageSha256: sha256(image),
    };

    await writeAtomically(imagePath, image);
    await writeAtomically(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Rendered ${width}x${height} Open Graph image to ${imagePath}`);
  } finally {
    await browser.close();
  }
}

if (checkOnly) {
  await checkGeneratedImage();
} else {
  await renderImage();
}
