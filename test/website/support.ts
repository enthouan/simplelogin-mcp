import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

export interface PackageJson {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  files?: string[];
  scripts: Record<string, string>;
}

export let outputRoot = '';
export let homeHtml = '';
export let installHtml = '';
export let apiKeyHtml = '';
export let howItWorksHtml = '';
export let securityHtml = '';
export let operationsHtml = '';
export let toolsHtml = '';
export let apiCoverageHtml = '';
export let workflowsHtml = '';
export let clientsHtml = '';
export let compatibilityHtml = '';
export let configurationHtml = '';
export let troubleshootingHtml = '';
export let faqHtml = '';
export let referenceHtml = '';
export let contributingHtml = '';
export let reportingIssuesHtml = '';
export let securityPolicyHtml = '';

let removeOutputRootAfterTests = false;
const execFileAsync = promisify(execFile);
const useBuiltWebsite = process.env['WEBSITE_TEST_USE_DIST'] === '1';

export async function readRepoFile(path: string): Promise<string> {
  return readFile(join(process.cwd(), path), 'utf8');
}

export async function readOutputFile(path: string, root = outputRoot): Promise<string> {
  return readFile(join(root, path), 'utf8');
}

export async function listFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) return listFiles(root, absolutePath);
      return [relative(root, absolutePath).split(sep).join('/')];
    }),
  );
  return files.flat().sort();
}

async function buildWebsiteInFreshProcess(outputDir: string): Promise<void> {
  const websiteRoot = join(process.cwd(), 'website');
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
  };
  delete childEnv['VITEST'];
  delete childEnv['VITEST_POOL_ID'];
  delete childEnv['VITEST_WORKER_ID'];
  delete childEnv['TEST'];

  await execFileAsync(
    process.execPath,
    [
      join(websiteRoot, 'node_modules/astro/bin/astro.mjs'),
      'build',
      '--outDir',
      outputDir,
      '--force',
    ],
    {
      cwd: websiteRoot,
      env: childEnv,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
}

export async function setupWebsiteFixture(): Promise<void> {
  if (useBuiltWebsite) {
    outputRoot = join(process.cwd(), 'website', 'dist');
    await stat(join(outputRoot, 'index.html')).catch(() => {
      throw new Error(
        'WEBSITE_TEST_USE_DIST=1 requires a completed `pnpm website:build` in website/dist.',
      );
    });
  } else {
    outputRoot = await mkdtemp(join(tmpdir(), 'simplelogin-mcp-starlight-'));
    removeOutputRootAfterTests = true;
    await buildWebsiteInFreshProcess(outputRoot);
  }
  [
    homeHtml,
    installHtml,
    apiKeyHtml,
    howItWorksHtml,
    securityHtml,
    operationsHtml,
    toolsHtml,
    apiCoverageHtml,
    workflowsHtml,
    clientsHtml,
    compatibilityHtml,
    configurationHtml,
    troubleshootingHtml,
    faqHtml,
    referenceHtml,
    contributingHtml,
    reportingIssuesHtml,
    securityPolicyHtml,
  ] = await Promise.all([
    readOutputFile('index.html'),
    readOutputFile('getting-started/index.html'),
    readOutputFile('getting-started/simplelogin-api-key/index.html'),
    readOutputFile('guides/how-it-works/index.html'),
    readOutputFile('guides/security/index.html'),
    readOutputFile('guides/operations/index.html'),
    readOutputFile('reference/tools/index.html'),
    readOutputFile('reference/api-coverage/index.html'),
    readOutputFile('guides/workflows/index.html'),
    readOutputFile('getting-started/clients/index.html'),
    readOutputFile('getting-started/compatibility/index.html'),
    readOutputFile('reference/configuration/index.html'),
    readOutputFile('guides/troubleshooting/index.html'),
    readOutputFile('guides/faq/index.html'),
    readOutputFile('reference/index.html'),
    readOutputFile('reference/contributing/index.html'),
    readOutputFile('reference/reporting-issues/index.html'),
    readOutputFile('reference/security-policy/index.html'),
  ]);
}

export async function cleanupWebsiteFixture(): Promise<void> {
  if (removeOutputRootAfterTests && outputRoot) {
    await rm(outputRoot, { recursive: true, force: true });
  }
}
