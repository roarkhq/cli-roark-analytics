/**
 * Where the config is written, and in which form.
 *
 * One object rather than a loose directory string, because the format decides three things that
 * must agree: where files land, what to call the config when pointing at it, and what
 * `config diff` / `config apply` should be given. They were separate once, and a config module
 * chosen at the prompt got written to one path and loaded from another.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { CONFIG_MODULE_FILE } from './module';
import type { Prompter } from './prompt';
import type { ConfigFormat } from './resources';

export const DEFAULT_DIR = './roark';

/**
 * Where the config is written, and in which form.
 *
 * YAML needs nothing installed, so it is the default and the only thing offered to someone who
 * reached the CLI through a global install. TypeScript gives types and editor completion, but its
 * `define*` helpers are imported from the SDK, so it is only usable in a project that has the SDK
 * to import from - which is why it is offered rather than assumed.
 */
export interface Target {
  format: ConfigFormat;
  /** The directory for YAML, the containing directory for a config module. */
  dir: string;
  /** What to print when pointing at the config: a directory, or the file. */
  label: string;
  /** What `config diff` / `config apply` should be given. */
  argument: string;
}

export const targetFor = (format: ConfigFormat, dir: string): Target =>
  format === 'yaml' ?
    { format, dir, label: `${dir}/`, argument: dir }
  : {
      format,
      dir,
      label: join(dir, CONFIG_MODULE_FILE),
      // `config apply` finds `roark.config.ts` in the working directory on its own, so the
      // common case is given no argument at all.
      argument: dir === '.' ? '' : join(dir, CONFIG_MODULE_FILE),
    };

/** The command that applies this target, spelled the way a person would type it. */
export const applyCommand = (binaryName: string, target: Target): string =>
  `${binaryName} config apply${target.argument === '' ? '' : ` ${target.argument}`}`;

/**
 * Whether a config module could actually be loaded from here.
 *
 * `roark.config.ts` imports its helpers from the SDK, and jiti resolves that from the config
 * file's own project. Offering TypeScript where the import cannot resolve would hand someone a
 * config that fails on the next command, so the question is only asked where it can work.
 */
export const sdkIsInstalled = (dir: string): boolean => {
  // Installed, not merely declared in a package.json: the difference decides whether the config
  // loads or throws, and a dependency somebody has not run an install for yet would offer a
  // format that breaks on the very next step, after every question has been answered.
  //
  // Walked upwards because a workspace hoists its dependencies to the repository root, where a
  // package in `packages/x` has no `node_modules` of its own.
  let root = resolve(dir);
  for (;;) {
    const sdk = join(root, 'node_modules', '@roarkanalytics', 'sdk');
    if (existsSync(sdk)) {
      // The subpath, not just the package: `lib/config` arrived in a later release, so an older
      // SDK satisfies "installed" and then fails on the import. Checking what is actually
      // imported is the difference between offering a format and offering a broken one.
      return existsSync(join(sdk, 'lib', 'config.js')) || existsSync(join(sdk, 'lib', 'config.mjs'));
    }
    const parent = dirname(root);
    if (parent === root) return false;
    root = parent;
  }
};

/**
 * Which form to write, when the flags did not say.
 *
 * Asked only where it is a real choice: a project that cannot import the helpers cannot load a
 * config module, so offering one would hand someone a config that fails on the very next step,
 * after every question had been answered.
 */
export const chooseFormat = async (
  prompter: Prompter,
  chosenDir: string | undefined,
  current: Target,
): Promise<Target> => {
  if (!sdkIsInstalled(current.dir)) return current;

  const picked = await prompter.select(
    'How should the config be written?',
    [
      { value: 'yaml', label: `YAML files in ${chosenDir ?? DEFAULT_DIR}`, hint: 'no dependencies' },
      {
        value: 'ts',
        label: `TypeScript in ${join(chosenDir ?? '.', CONFIG_MODULE_FILE)}`,
        hint: 'typed helpers, imported from the SDK',
      },
    ],
    'yaml',
  );

  const format = picked === 'ts' ? 'ts' : 'yaml';
  return targetFor(format, chosenDir ?? (format === 'ts' ? '.' : DEFAULT_DIR));
};
