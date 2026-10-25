/**
 * Load a config-as-code bundle from a TypeScript (or JS) config file.
 *
 * The code-first counterpart to `config-bundle.ts` (which walks a YAML directory). Point the CLI
 * at a `roark.config.ts` and it evaluates the module with jiti — the same zero-build TS loader
 * tools like SST and Vitest use for their `*.config.ts` — and reads its default export: the
 * `{ resources, prune }` bundle a `defineConfig(...)` returns (or a bare array of resources, or a
 * function returning either). The result is the exact same bundle the YAML path produces, so it
 * flows through the identical `config diff` / `config apply` without any new API surface.
 *
 * jiti resolves the config file's own imports (e.g. `@roarkanalytics/sdk/lib/config`) relative to
 * the file, so they come from the user's project, not the CLI's bundled dependencies.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createJiti } from 'jiti';

import type { ConfigBundle } from './config-bundle';
import { UsageError } from './errors';

const MODULE_EXTENSIONS = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'];

/** Whether a path looks like a TypeScript/JS config entrypoint (vs. a YAML directory). */
export const isConfigModulePath = (path: string): boolean =>
  MODULE_EXTENSIONS.some((ext) => path.endsWith(ext));

/** The default config entrypoints to auto-detect in the working directory, in order. */
const DEFAULT_CONFIG_FILES = ['roark.config.ts', 'roark.config.mts', 'roark.config.js', 'roark.config.mjs'];

/** The first `roark.config.*` present in `cwd`, or undefined — like `sst` finding `sst.config.ts`. */
export const findDefaultConfigModule = (cwd: string): string | undefined => {
  for (const name of DEFAULT_CONFIG_FILES) {
    const candidate = resolve(cwd, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
};

/**
 * Evaluate a config module and normalize its export to a bundle. A `--no-prune` flag
 * (`options.prune === false`) overrides whatever the module set; otherwise the module's own
 * `prune` (from `defineConfig`) is kept.
 */
export const loadConfigModule = async (
  file: string,
  options: { prune?: boolean } = {},
): Promise<ConfigBundle> => {
  const abs = resolve(file);
  const jiti = createJiti(pathToFileURL(abs).href);

  let mod: unknown;
  try {
    mod = await jiti.import(abs);
  } catch (error) {
    throw new UsageError(`failed to load config file ${file}: ${(error as Error).message}`);
  }

  // Prefer the default export; accept a bundle object, a bare resources array, or a
  // (possibly async) function returning either.
  const record = mod && typeof mod === 'object' ? (mod as Record<string, unknown>) : {};
  let exported: unknown = 'default' in record ? record['default'] : mod;
  if (typeof exported === 'function') exported = await (exported as () => unknown)();
  exported = await exported;

  const bundle = Array.isArray(exported) ? { resources: exported } : exported;
  if (!bundle || typeof bundle !== 'object' || !Array.isArray((bundle as ConfigBundle).resources)) {
    throw new UsageError(
      `config file ${file} must export (as default) a bundle from defineConfig(...), or an array of resources`,
    );
  }

  const typed = bundle as ConfigBundle;
  const prune = options.prune === false ? false : typed.prune;
  return { resources: typed.resources, ...(prune === undefined ? {} : { prune }) };
};
