/**
 * `roark config diff [dir]` and `roark config apply [dir]` - config as code.
 *
 * These wrap the generated `config.diff` / `config.apply` SDK methods with the one client-side
 * step they need to be useful: building the `{ resources, prune }` bundle. Point either at a
 * directory of YAML (`*.yaml`, with `file://` references inlined) or at a TypeScript config file
 * (`roark.config.ts`, whose `defineConfig(...)` default export is evaluated with jiti); with no
 * argument it auto-detects `roark.config.ts` in the cwd. `--data`/stdin still take a pre-built
 * bundle for scripting.
 *
 * `apply` previews the diff and asks to confirm before writing (config-managed resources absent
 * from the bundle are deleted unless `--no-prune`), so a destructive apply is never a surprise.
 * These replace the raw generated `config diff`/`apply` (excluded in program.ts) so there's one
 * obvious way to run each.
 */

import { stat } from 'node:fs/promises';

import { Command } from 'commander';
import type Roark from '@roarkanalytics/sdk';

import { confirm } from '../confirm';
import { UsageError } from '../errors';
import { readData, readStdin, stdinIsPiped } from '../input';
import { render, write, type OutputFormat } from '../output';
import { buildBundle, type ConfigBundle } from '../config-bundle';
import { findDefaultConfigModule, isConfigModulePath, loadConfigModule } from '../config-module';

const OP_MARK: Record<string, string> = { create: '+', update: '~', delete: '-', noop: ' ' };

/** One-line-per-change summary for a terminal; `apply` results also carry a status. */
const formatChanges = (data: {
  changes: Array<Record<string, unknown>>;
  summary: Record<string, number>;
}): string => {
  const lines = data.changes.map((change) => {
    const mark = OP_MARK[String(change['op'])] ?? '?';
    const status = change['status'] ? ` (${String(change['status'])})` : '';
    const error = change['error'] ? `  ${String(change['error'])}` : '';
    return `  ${mark} ${String(change['configKey'])}${status}${error}`;
  });
  const s = data.summary;
  const tally = [
    `${s['create'] ?? 0} to create`,
    `${s['update'] ?? 0} to update`,
    `${s['delete'] ?? 0} to delete`,
    ...(s['failed'] === undefined ? [] : [`${s['failed']} failed`]),
  ].join(', ');
  return [...lines, '', tally].join('\n');
};

const changeCount = (summary: Record<string, number>): number =>
  (summary['create'] ?? 0) + (summary['update'] ?? 0) + (summary['delete'] ?? 0);

/**
 * Resolve the bundle from a `path`, `--data`/stdin, or an auto-detected config file:
 *  - a directory          → build it from YAML
 *  - a `.ts`/`.js` file   → evaluate it (the `defineConfig(...)` default export)
 *  - `--data`/piped stdin → a pre-built JSON bundle
 *  - nothing              → auto-detect `roark.config.ts` in the cwd (like `sst.config.ts`)
 */
const resolveBundle = async (
  path: string | undefined,
  options: Record<string, unknown>,
): Promise<ConfigBundle> => {
  const prune = options['prune'] === false ? false : undefined;
  const pruneOpt = prune === undefined ? {} : { prune };

  if (path !== undefined) {
    const info = await stat(path).catch(() => null);
    if (info?.isDirectory()) return buildBundle(path, pruneOpt);
    if (info?.isFile() && isConfigModulePath(path)) return loadConfigModule(path, pruneOpt);
    if (!info) throw new UsageError(`path not found: ${path}`);
    throw new UsageError(`${path} is not a config directory or a .ts/.js config file`);
  }

  const explicit = options['data'] === undefined ? undefined : readData(options['data'] as string);
  const piped =
    explicit === undefined && stdinIsPiped() ?
      (() => {
        const raw = readStdin().trim();
        return raw.length === 0 ? undefined : (JSON.parse(raw) as unknown);
      })()
    : undefined;
  const body = explicit ?? piped;
  if (body !== undefined) {
    if (typeof body !== 'object') throw new UsageError('--data / stdin must be a JSON bundle object');
    const bundle = body as ConfigBundle;
    return prune === undefined ? bundle : { ...bundle, prune };
  }

  // Nothing given: fall back to a config file in the working directory.
  const auto = findDefaultConfigModule(process.cwd());
  if (auto) return loadConfigModule(auto, pruneOpt);

  throw new UsageError(
    'provide a config directory (e.g. `./roark`), a .ts config file, or a bundle via --data / stdin',
  );
};

const configGroup = (root: Command): Command => {
  const existing = root.commands.find((child) => child.name() === 'config');
  if (existing) return existing;
  const created = new Command('config').description('Config as code, and CLI settings').showHelpAfterError();
  created.action(() => created.outputHelp());
  root.addCommand(created);
  return created;
};

const withCommonOptions = (command: Command): Command =>
  command
    .option('--data <json>', 'pre-built bundle as JSON, or @file (@- for stdin); alternative to a directory')
    .option('--no-prune', 'do not delete config-managed resources absent from the bundle')
    .option('--base-url <url>', 'API base URL')
    .option('--token <token>', 'bearer token')
    .option('--timeout <ms>', 'request timeout in milliseconds')
    .option('--max-retries <count>', 'retries for retryable failures')
    .option('--format <format>', 'output format')
    .option('--json', 'shorthand for --format json')
    .option('--no-color', 'disable colour')
    .showHelpAfterError();

export const registerConfigAsCodeCommands = (
  root: Command,
  binaryName: string,
  clientFor: (options: never) => Roark,
  resolveOutput: (options: never) => { format: OutputFormat; color: boolean },
): void => {
  const config = configGroup(root);

  withCommonOptions(config.command('diff [path]'))
    .description('Preview the changes a config directory, .ts config file, or bundle would make. No writes.')
    .addHelpText(
      'after',
      [
        '',
        'Examples:',
        `  ${binaryName} config diff ./roark`,
        `  ${binaryName} config diff roark.config.ts`,
      ].join('\n'),
    )
    .action(async (path: string | undefined, options: Record<string, unknown>) => {
      const bundle = await resolveBundle(path, options);
      const client = clientFor(options as never);
      const result = await client.config.diff(bundle as never);
      const output = resolveOutput(options as never);
      write(
        output.format === 'json' || options['json'] === true ?
          render((result as { data: unknown }).data, output)
        : formatChanges((result as { data: never }).data),
      );
    });

  withCommonOptions(config.command('apply [path]'))
    .description(
      'Reconcile the project to a config directory, .ts config file, or bundle. Previews and confirms first.',
    )
    .option('-y, --yes', 'skip the confirmation prompt')
    .option('--no-input', 'never prompt; fail instead')
    .addHelpText(
      'after',
      [
        '',
        'Examples:',
        `  ${binaryName} config apply ./roark`,
        `  ${binaryName} config apply roark.config.ts`,
      ].join('\n'),
    )
    .action(async (path: string | undefined, options: Record<string, unknown>) => {
      const bundle = await resolveBundle(path, options);
      const client = clientFor(options as never);
      const output = resolveOutput(options as never);
      const json = output.format === 'json' || options['json'] === true;

      // Preview then confirm, so a prune-driven delete is never a surprise.
      const preview = (await client.config.diff(bundle as never)) as unknown as {
        data: { changes: Array<Record<string, unknown>>; summary: Record<string, number> };
      };
      const pending = changeCount(preview.data.summary);
      if (pending === 0) {
        write('No changes; project already matches the config.', process.stderr);
        return;
      }
      if (!json) write(formatChanges(preview.data as never), process.stderr);
      await confirm(`Apply ${pending} change(s)?`, {
        assumeYes: options['yes'] === true,
        noInput: options['input'] === false,
      });

      const result = await client.config.apply(bundle as never);
      write(
        json ?
          render((result as { data: unknown }).data, output)
        : formatChanges((result as { data: never }).data),
      );
    });

  config.addHelpText(
    'after',
    [
      '',
      'Config as code: keep your Roark resources in git (YAML or TypeScript) and sync them.',
      `  ${binaryName} config apply ./roark            # a directory of YAML`,
      `  ${binaryName} config apply roark.config.ts    # a TypeScript config (defineConfig)`,
      `  ${binaryName} config apply                     # auto-detects roark.config.ts in the cwd`,
    ].join('\n'),
  );
};
