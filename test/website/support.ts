import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

export interface PackageJson {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  files?: string[];
  scripts: Record<string, string>;
}

export let outputRoot = '';
export let homeHtml = '';
export let fallbackHomeHtml = '';
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

const temporaryOutputRoots: string[] = [];
const execFileAsync = promisify(execFile);
const builtWebsiteOutput = process.env['WEBSITE_TEST_OUTPUT_ROOT'];

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

async function buildWebsiteInFreshProcess(
  outputDir: string,
  fixture: 'fallback' | 'populated',
): Promise<void> {
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
      join(websiteRoot, 'scripts/build-test-fixture.mjs'),
      '--out-dir',
      outputDir,
      '--fixture',
      fixture,
    ],
    {
      cwd: websiteRoot,
      env: childEnv,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
}

export async function setupWebsiteFixture(): Promise<void> {
  if (builtWebsiteOutput) {
    outputRoot = resolve(process.cwd(), builtWebsiteOutput);
    await stat(join(outputRoot, 'index.html')).catch(() => {
      throw new Error(
        'WEBSITE_TEST_OUTPUT_ROOT requires a completed `pnpm website:build:test` artifact.',
      );
    });
  } else {
    outputRoot = await mkdtemp(join(tmpdir(), 'simplelogin-mcp-starlight-'));
    temporaryOutputRoots.push(outputRoot);
    await buildWebsiteInFreshProcess(outputRoot, 'populated');
  }
  const fallbackOutputRoot = await mkdtemp(join(tmpdir(), 'simplelogin-mcp-starlight-fallback-'));
  temporaryOutputRoots.push(fallbackOutputRoot);
  await buildWebsiteInFreshProcess(fallbackOutputRoot, 'fallback');

  [
    homeHtml,
    fallbackHomeHtml,
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
    readOutputFile('index.html', fallbackOutputRoot),
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
  await Promise.all(temporaryOutputRoots.map((root) => rm(root, { recursive: true, force: true })));
}

export function repositoryActionFromHtml(html: string): string {
  return (
    [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)]
      .map((match) => match[0])
      .find(
        (action) =>
          action.includes('data-repository-action') &&
          action.includes('href="https://github.com/enthouan/simplelogin-mcp"'),
      ) ?? ''
  );
}
