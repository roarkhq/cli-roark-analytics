/**
 * What the config already declares.
 *
 * Every step consults this to decide whether to ask at all, which is what makes the command safe
 * to re-run: a second pass fills the gaps and leaves the rest alone.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { buildBundle, EmptyConfigDirectoryError } from '../config-bundle';
import { loadConfigModule } from '../config-module';
import { CONFIG_MODULE_FILE } from './module';
import type { Target } from './target';

/**
 * Resources the config directory already declares, so a second run fills the gaps instead of
 * asking everything again. An empty or absent directory is a fresh start; anything else wrong
 * with it (unparseable YAML, a resource with no kind) is raised, because `apply` would hit it
 * two steps later anyway and this is the better place to find out.
 */
export const readExisting = async (target: Target): Promise<Record<string, unknown>[]> => {
  if (target.format === 'ts') {
    const file = join(target.dir, CONFIG_MODULE_FILE);
    if (!existsSync(resolve(file))) return [];
    return (await loadConfigModule(file)).resources;
  }
  if (!existsSync(resolve(target.dir))) return [];
  try {
    return (await buildBundle(target.dir)).resources;
  } catch (error) {
    // An empty directory is a fresh start, not a problem. Anything else (unparseable YAML, a
    // resource with no kind) is a real error the user has to see: apply would hit it two steps
    // later anyway, and this is the better place to find out.
    if (error instanceof EmptyConfigDirectoryError) return [];
    throw error;
  }
};

export const namesOfKind = (resources: readonly Record<string, unknown>[], kind: string): string[] =>
  resources
    .filter((resource) => resource['kind'] === kind)
    .map((resource) => String(resource['name']))
    .filter((name) => name.length > 0);
