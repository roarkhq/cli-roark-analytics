/**
 * Preview the config, confirm it, apply it.
 *
 * Its own module for the same reason as the run phase: it is a self-contained step with one
 * decision in it, where the question-asking steps thread one `Setup` through shared state.
 */

import { join } from 'node:path';

import type Roark from '@roarkanalytics/sdk';

import { buildBundle, type ConfigBundle } from '../config-bundle';
import { loadConfigModule } from '../config-module';
import { changeCount, formatChanges } from '../config-changes';
import { write } from '../output';
import { note } from './ladder';
import { CONFIG_MODULE_FILE } from './module';
import { applyCommand, type Target } from './target';
import type { ConfigChange } from './types';
import type { Prompter } from './prompt';

interface ApplyPhase {
  client: Roark;
  prompter: Prompter;
  say: (text: string) => void;
  binaryName: string;
  color: boolean;
  quiet: boolean;
  options: Record<string, unknown>;
  target: Target;
}

/**
 * Preview the config, confirm it, apply it.
 *
 * Its own function for the same reason as `startRun`: it is a self-contained phase with one
 * decision in it, and the steps around it are not - they thread one `Setup` through shared
 * local state. `stopped` carries the one case the caller cannot infer, a user who said no,
 * where the files are written and the right thing is to stop without running anything.
 */
export const applyConfig = async (
  phase: ApplyPhase,
): Promise<{ stopped: true } | { stopped: false; applied: ConfigChange[] | undefined }> => {
  const { client, prompter, say, binaryName, color, quiet, options, target } = phase;

  // `prune: false`, always. What this writes is a subset of a real config, and a quickstart
  // that deleted a resource someone already managed would be indefensible.
  const bundle: ConfigBundle =
    target.format === 'ts' ?
      await loadConfigModule(join(target.dir, CONFIG_MODULE_FILE), { prune: false })
    : await buildBundle(target.dir, { prune: false });

  const preview = await client.config.diff(bundle as never);
  const count = changeCount(preview.data.summary as unknown as Record<string, number>);

  say('');
  if (count === 0) {
    say('Nothing to apply: the project already matches this config.');
    return { stopped: false, applied: undefined };
  }

  say(formatChanges(preview.data as never));
  say(note('Nothing is deleted: this applies without pruning.', color));

  const go = options['yes'] === true || (await prompter.confirm(`Apply ${count} change(s)?`, true));
  if (!go) {
    say('');
    say(
      `Stopped before applying. The config is written; run \`${applyCommand(
        binaryName,
        target,
      )}\` when ready.`,
    );
    if (!quiet) write(target.label);
    return { stopped: true };
  }

  const response = await client.config.apply(bundle as never);
  say(formatChanges(response.data as never));
  return { stopped: false, applied: response.data.changes };
};
