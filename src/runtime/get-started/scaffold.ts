/**
 * Writing the config directory.
 *
 * A file that already exists is left exactly as it is and reported as skipped, never merged and
 * never overwritten: someone who has edited their config and runs `get-started` again is asking
 * to fill the gaps, not to lose their edits. That is also what makes the command safe to re-run,
 * which is how a half-finished setup gets finished.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { ScaffoldFile } from './resources';

export interface ScaffoldResult {
  /** Paths as given to the command, so they are copy-pasteable. */
  written: string[];
  skipped: string[];
}

export const writeScaffold = async (dir: string, files: readonly ScaffoldFile[]): Promise<ScaffoldResult> => {
  const root = resolve(dir);
  const result: ScaffoldResult = { written: [], skipped: [] };

  for (const file of files) {
    const absolute = join(root, file.path);
    await mkdir(dirname(absolute), { recursive: true });
    const shown = join(dir, file.path);
    try {
      // `wx` rather than an exists check: the check-then-write race is exactly how a concurrent
      // run would clobber a file this function promises never to touch.
      await writeFile(absolute, file.contents, { encoding: 'utf8', flag: 'wx' });
      result.written.push(shown);
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') throw error;
      result.skipped.push(shown);
    }
  }

  return result;
};
