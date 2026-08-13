import { preview } from 'astro';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const websiteRoot = fileURLToPath(new URL('../', import.meta.url));
const defaultOutDir = fileURLToPath(new URL('../.test-dist', import.meta.url));

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const port = Number.parseInt(readOption('--port') ?? '4174', 10);
const host = readOption('--host') ?? '127.0.0.1';
const outDir = resolve(readOption('--out-dir') ?? defaultOutDir);

const server = await preview({
  root: websiteRoot,
  outDir,
  server: { host, port },
});

const stop = () => void server.stop();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

await server.closed();
