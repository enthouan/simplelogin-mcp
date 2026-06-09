/**
 * @module version
 * Resolves the package version at runtime from package.json so the value stays in
 * sync with the published artifact without a build-time copy step. Works both from
 * `src/` (tsx dev) and `dist/` (compiled), since package.json sits one level up.
 */
import { readFileSync } from 'node:fs';

interface PackageManifest {
  version: string;
}

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as PackageManifest;

/** The current package version (e.g. "0.3.0"). */
export const VERSION: string = manifest.version;
