/**
 * `--scaffold-only`: write the config with placeholders and stop.
 *
 * A complete alternative mode rather than a step of the guided flow: it asks nothing, calls no
 * endpoint, and ends with a directory someone fills in by hand. The path for a script, a
 * dotfiles repo, or anyone who would rather read the config format than answer questions about
 * it, which is why it has to work with no terminal and no credential.
 */

import { paint, write } from '../output';
import { applyCommand, type Target } from './target';
import { nextSteps, note } from './ladder';
import { setupModule } from './module';
import { placeholderSetup, placeholderTodos } from './placeholder';
import { setupFiles } from './resources';
import { writeScaffold } from './scaffold';

export interface ScaffoldOnlyRun {
  binaryName: string;
  target: Target;
  color: boolean;
  quiet: boolean;
  say: (text: string) => void;
  /** Said here too: a config module nobody can import is worth flagging before it is written. */
  warnIfUnimportable: () => void;
}

export const scaffoldOnlyRun = async (run: ScaffoldOnlyRun): Promise<void> => {
  const { binaryName, target, color, quiet, say } = run;
  run.warnIfUnimportable();

  const placeholder = placeholderSetup();
  const files = target.format === 'ts' ? [setupModule(placeholder)] : setupFiles(placeholder);
  const result = await writeScaffold(target.dir, files);

  for (const path of result.written) say(`${paint('+', 'green', color)} ${path}`);
  for (const path of result.skipped) {
    say(`${paint('·', 'yellow', color)} ${path} (already there, left alone)`);
  }

  say('');
  for (const todo of placeholderTodos(target.format)) say(note(`TODO: ${todo}`, color, 'yellow'));

  const diff = `${binaryName} config diff${target.argument === '' ? '' : ` ${target.argument}`}`;
  say(
    nextSteps(
      {
        binaryName,
        dir: target.label,
        apply: applyCommand(binaryName, target),
        lines: [`${paint(diff, 'cyan', color)}  preview what it would create`],
      },
      color,
    ),
  );

  if (!quiet) write(target.label);
};
