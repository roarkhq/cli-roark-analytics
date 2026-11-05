/**
 * `roark get-started` - the guided first run.
 *
 * Seven steps from an installed CLI to a graded simulation: who you are, the agent, the caller,
 * the scenario, the metrics, the saved plan, the run. Each step asks the fewest questions it can,
 * echoes the command it is shorthand for, and writes a config file.
 *
 * Two decisions shape everything here:
 *
 *  - It writes config as code and applies it, rather than making six create calls. The user ends
 *    up owning the files, a second run is idempotent, and the whole flow rides on `config diff` /
 *    `config apply` plus one run endpoint instead of every resource API.
 *  - It never prunes. A quickstart that deleted a config-managed resource someone already had
 *    would be unforgivable, and the directory it builds is deliberately a subset of a real one.
 *
 * Not interactive-only by accident: `--scaffold-only` writes the same files with placeholders and
 * makes no network call, which is the path for CI, dotfiles, and anyone who would rather read
 * YAML than answer questions.
 *
 * This file is the orchestrator and nothing else: the flags, the order of the steps, and what
 * each one does with the answer. Every step and phase lives in `../get-started/`, one module
 * apiece, so this reads as the shape of the flow rather than its details.
 */

import { Command } from 'commander';
import type Roark from '@roarkanalytics/sdk';

import { isInteractive } from '../confirm';
import { AuthRequiredError, UsageError } from '../errors';
import { paint, supportsColor, write } from '../output';
import { describeCredential } from '../get-started/account';
import { chooseAgent } from '../get-started/agent';
import { applyConfig } from '../get-started/apply';
import { namesOfKind, readExisting } from '../get-started/existing';
import { intro, nextSteps, note, stepDone, stepHeader, stepSkipped } from '../get-started/ladder';
import { CONFIG_MODULE_FILE, CONFIG_MODULE_IMPORT, setupModule } from '../get-started/module';
import { createPrompter } from '../get-started/prompt';
import {
  DEFAULT_MAX_DURATION_SECONDS,
  setupFiles,
  type AgentSetup,
  type EndpointDirection,
  type EndpointSetup,
  type Setup,
} from '../get-started/resources';
import { startRun } from '../get-started/run';
import { scaffoldOnlyRun } from '../get-started/scaffold-only';
import { writeScaffold } from '../get-started/scaffold';
import { chooseCaller, chooseMetrics, chooseScenario, type Steps } from '../get-started/steps';
import { applyCommand, chooseFormat, DEFAULT_DIR, sdkIsInstalled, targetFor } from '../get-started/target';
import { nameRules } from '../get-started/answers';
import type { ClientFor, ResolveOutput } from '../get-started/types';

const withCommonOptions = (command: Command): Command =>
  command
    .option('--base-url <url>', 'API base URL')
    .option('--project <id>', 'project to act on')
    .option('--token <token>', 'bearer token')
    .option('--timeout <ms>', 'request timeout in milliseconds')
    .option('--max-retries <count>', 'retries for retryable failures')
    .option('--format <format>', 'output format')
    .option('--json', 'shorthand for --format json')
    .option('--no-color', 'disable colour')
    .option('-q, --quiet', 'suppress non-essential output')
    .showHelpAfterError();

export const registerGetStartedCommand = (
  root: Command,
  binaryName: string,
  clientFor: ClientFor,
  resolveOutput: ResolveOutput,
): void => {
  withCommonOptions(root.command('get-started'))
    .alias('init')
    .description('Guided setup: an agent, a caller, a scenario, metrics, and your first graded run')
    // No commander default: the default depends on the format (`./roark` for YAML, the working
    // directory for a config module, where `config apply` finds it by name), and a default here
    // would make "was --dir given?" unanswerable.
    .option('--dir <path>', `where to write the config (default: ${DEFAULT_DIR}, or . for --ts)`)
    .option('--ts', `write TypeScript (${CONFIG_MODULE_FILE}) instead of YAML`)
    .option('--yaml', 'write YAML, without asking')
    .option('--scaffold-only', 'write the files with placeholder values and stop: no questions, no API calls')
    .option('--no-run', 'apply the config but do not start a simulation')
    .option('-y, --yes', 'skip both confirmations: the apply, and placing the call')
    .option('--no-input', 'never prompt; fail instead')
    .addHelpText(
      'after',
      [
        '',
        'Seven steps: account, agent, caller, scenario, metrics, plan, run. Each one writes a YAML',
        'file you own, and the whole directory is applied with `config apply`, so re-running is safe',
        'and nothing is ever pruned.',
        '',
        `  ${binaryName} get-started                  # answer the questions`,
        `  ${binaryName} get-started --scaffold-only  # just write the files`,
        `  ${binaryName} get-started --no-run         # set everything up, run it later`,
        `  ${binaryName} get-started --ts             # TypeScript config instead of YAML`,
        '',
        'Two things are confirmed before they happen: the apply, and the run. `--yes` skips both,',
        'so in a script it will place a real, billed call. Pair it with `--no-run` if that is not',
        'what you want.',
      ].join('\n'),
    )
    .action(async (options: Record<string, unknown>) => {
      const color = supportsColor(process.stderr);
      const scaffoldOnly = options['scaffoldOnly'] === true;
      const quiet = options['quiet'] === true;
      const say = (text: string): void => {
        if (!quiet) write(text, process.stderr);
      };

      const wantsTs = options['ts'] === true;
      const wantsYaml = options['yaml'] === true;
      if (wantsTs && wantsYaml) {
        throw new UsageError('--ts and --yaml ask for two different files. Pick one.');
      }
      const chosenDir = typeof options['dir'] === 'string' ? options['dir'] : undefined;
      // Settled up front for the non-interactive paths; the question below can still change it,
      // which is why nothing else keeps its own copy of the directory. It did once, and a
      // TypeScript config chosen at the prompt was written to `./roark` and then loaded from the
      // working directory, because only one of the two had been recomputed.
      //
      // A TypeScript config defaults to the working directory rather than `./roark`, because
      // `config apply` finds `roark.config.ts` there by itself and then needs no argument.
      let target = targetFor(wantsTs ? 'ts' : 'yaml', chosenDir ?? (wantsTs ? '.' : DEFAULT_DIR));

      if (!scaffoldOnly && (options['input'] === false || !isInteractive())) {
        throw new UsageError(
          [
            `${binaryName} get-started asks questions, so it needs a terminal.`,
            '',
            `Run it in one, or use --scaffold-only to write ${target.label} with placeholder values`,
            `and fill them in by hand (then \`${applyCommand(binaryName, target)}\`).`,
          ].join('\n'),
        );
      }

      /** Said once the target is settled, because a config module that cannot import is useless. */
      const warnIfUnimportable = (): void => {
        if (target.format !== 'ts' || sdkIsInstalled(target.dir)) return;
        say(
          note(
            `${CONFIG_MODULE_FILE} imports ${CONFIG_MODULE_IMPORT}, which this project cannot resolve. Install a recent @roarkanalytics/sdk here, or use --yaml.`,
            color,
            'yellow',
          ),
        );
      };

      if (scaffoldOnly) {
        await scaffoldOnlyRun({ binaryName, target, color, quiet, say, warnIfUnimportable });
        return;
      }

      const prompter = createPrompter();

      try {
        // Only where the flags left it open; `chooseFormat` decides whether to ask at all.
        if (!wantsTs && !wantsYaml) target = await chooseFormat(prompter, chosenDir, target);

        say(intro(binaryName, target.label, target.format, color));
        warnIfUnimportable();
        const existing = await readExisting(target);

        // A config module is one file holding everything, so there is no way to add a resource
        // to one without editing code somebody wrote. The YAML form has no such problem: a
        // missing resource is a missing file, and writing it touches nothing else.
        //
        // So when the module already exists it is taken as final. Complete (it declares a plan)
        // means the useful re-run still works: skip the questions, apply, offer the run. Partial
        // means stopping, rather than asking questions whose answers have nowhere to go.
        if (target.format === 'ts' && existing.length > 0) {
          // Every kind, not just the plan: a module with no persona would still send step 3 to
          // the prompt, and its answer could not be written. Complete means nothing left to ask.
          const missing = (
            [
              ['an agent', 'agent'],
              ['a caller', 'persona'],
              ['a scenario', 'flow'],
              ['a run plan', 'simulationPlan'],
            ] as const
          ).filter(([, kind]) => namesOfKind(existing, kind).length === 0);

          if (missing.length > 0) {
            throw new UsageError(
              [
                `${target.label} already exists, and ${binaryName} get-started writes that file whole`,
                'rather than editing one you wrote.',
                '',
                `Add what it is missing yourself (${missing.map(([label]) => label).join(', ')}), then`,
                `\`${applyCommand(binaryName, target)}\`. Or start a YAML config beside it with --yaml.`,
              ].join('\n'),
            );
          }
          say(note(`${target.label} already declares everything, so this only runs it.`, color));
        }

        // ---- 1. Account ------------------------------------------------------------------
        say(stepHeader(0, color));
        let client: Roark;
        try {
          client = clientFor(options as never);
        } catch (error) {
          if (error instanceof AuthRequiredError) {
            throw new AuthRequiredError(`${error.message}\nThen run \`${binaryName} get-started\` again.`);
          }
          throw error;
        }
        const credential = await describeCredential(client, binaryName);
        const project = credential.defaultProject;
        say(
          stepDone(
            0,
            [
              credential.email ?? 'credential accepted',
              project === undefined ? undefined : `project ${project}`,
            ]
              .filter((part) => part !== undefined)
              .join(', '),
            color,
          ),
        );
        if (credential.scope === 'USER' && project === undefined) {
          say(
            note(
              `No project selected. Run \`${binaryName} config set project <id>\` (\`${binaryName} project list\` shows the ids) if the next step fails.`,
              color,
              'yellow',
            ),
          );
        }

        const steps: Steps = { prompter, say, color, binaryName, existing, label: target.label };

        // ---- 2. Agent --------------------------------------------------------------------
        const configuredAgents = namesOfKind(existing, 'agent');
        let agent: AgentSetup;
        if (configuredAgents.length > 0) {
          agent = { name: configuredAgents[0]! };
          say(stepSkipped(1, `${agent.name}, already declared in ${target.label}`, color));
          // The declared file is the source of truth for its endpoints, and reading them back out
          // of YAML to re-derive a direction would just duplicate what apply already resolves.
          const declared = existing.find(
            (resource) => resource['kind'] === 'agent' && resource['name'] === agent.name,
          );
          const endpoints = ((declared?.['endpoints'] ?? []) as { value?: unknown; direction?: unknown }[])
            .filter((endpoint): endpoint is { value: string; direction?: unknown } => {
              return typeof endpoint['value'] === 'string';
            })
            .map((endpoint) => ({
              value: endpoint.value,
              // The DSL's own default when the file leaves it out, so this reads the file rather
              // than guessing at it.
              direction: (typeof endpoint.direction === 'string' ?
                endpoint.direction
              : 'INCOMING') as EndpointDirection,
            }));

          if (endpoints.length === 1) {
            agent = { ...agent, dial: endpoints[0]! };
          } else if (endpoints.length > 1) {
            // Several declared lines, and they are not interchangeable: one may be the inbound
            // number and another the outbound one, which run opposite tests. Picking the first
            // would quietly call the wrong line.
            // Keyed on value AND direction: one number routinely carries an inbound endpoint and
            // an outbound one, so the number alone does not identify a line.
            const key = (endpoint: EndpointSetup): string => `${endpoint.value}::${endpoint.direction}`;
            const line = await prompter.select(
              `${agent.name} declares several lines. Which should the run call?`,
              endpoints.map((endpoint) => ({
                value: key(endpoint),
                label: endpoint.value,
                hint: endpoint.direction.toLowerCase().replace(/_/g, ' '),
              })),
              key(endpoints[0]!),
            );
            agent = { ...agent, dial: endpoints.find((endpoint) => key(endpoint) === line)! };
          }
        } else {
          say(stepHeader(1, color));
          agent = await chooseAgent(client, prompter, say, binaryName, color);
          say(
            stepDone(1, agent.dial === undefined ? `${agent.name}, no line to call yet` : agent.name, color),
          );
        }

        // ---- 3. Caller -------------------------------------------------------------------
        const persona = await chooseCaller(steps);

        // ---- 4. Scenario -----------------------------------------------------------------
        const flow = await chooseScenario(steps, agent, configuredAgents.length === 0);

        // ---- 5. Metrics ------------------------------------------------------------------
        const configuredPlans = namesOfKind(existing, 'simulationPlan');
        const graded = await chooseMetrics(steps, client, configuredPlans[0]);
        const metrics = graded.metrics;
        const customMetric = graded.customMetric;

        // ---- 6. Plan ---------------------------------------------------------------------
        let planName: string | undefined;
        if (configuredPlans.length > 0) {
          planName = configuredPlans[0]!;
          say(stepSkipped(5, `${planName}, already declared in ${target.label}`, color));
        } else if (agent.dial === undefined) {
          say(
            stepSkipped(
              5,
              `waiting on a line to call. Add an endpoint to ${agent.name}'s config and run this again`,
              color,
            ),
          );
        } else {
          say(stepHeader(5, color));
          planName = await prompter.ask('Name for the saved run?', {
            default: 'first-run',
            validate: nameRules('name'),
          });
          say(stepDone(5, planName, color));
        }

        const setup: Setup = {
          agent,
          persona,
          flow,
          metrics,
          ...(customMetric === undefined ? {} : { customMetric }),
          ...(planName === undefined ?
            {}
          : { plan: { name: planName, maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS } }),
        };

        // Only the files for steps that actually ran: a step read back out of the directory is
        // already on disk, and rewriting it is how an edit gets lost.
        const pending =
          target.format === 'ts' ?
            // One file, written whole or not at all. The guard above means we only reach a write
            // when there was nothing there before.
            existing.length === 0 ?
              [setupModule(setup)]
            : []
          : setupFiles(setup).filter((file) => {
              if (file.path.startsWith('agents/')) return configuredAgents.length === 0;
              if (file.path.startsWith('personas/')) return persona.authored;
              if (file.path.startsWith('flows/')) return flow.authored;
              if (file.path.startsWith('simulation-plans/')) return configuredPlans.length === 0;
              return true;
            });

        say('');
        const result = await writeScaffold(target.dir, pending);
        for (const path of result.written) say(`${paint('+', 'green', color)} ${path}`);
        for (const path of result.skipped)
          say(`${paint('·', 'yellow', color)} ${path} (already there, left alone)`);

        // ---- Apply -----------------------------------------------------------------------
        const outcome = await applyConfig({
          client,
          prompter,
          say,
          binaryName,
          color,
          quiet,
          options,
          target,
        });
        if (outcome.stopped) return;
        const applied = outcome.applied;

        // ---- 7. Run ----------------------------------------------------------------------
        if (planName !== undefined && options['run'] !== false) {
          const started = await startRun({
            client,
            prompter,
            say,
            binaryName,
            color,
            quiet,
            options,
            planName,
            dir: target.label,
            apply: applyCommand(binaryName, target),
            dial: agent.dial,
            applied,
            resolveOutput,
          });
          if (started) return;
        }

        // Everything that did not start a run: no plan yet, `--no-run`, or a plan whose id we
        // could not resolve. The directory is still the useful result, so it goes to stdout.
        say(
          nextSteps(
            {
              binaryName,
              dir: target.label,
              apply: applyCommand(binaryName, target),
              lines:
                planName === undefined ?
                  [
                    `${paint(
                      `${binaryName} get-started`,
                      'cyan',
                      color,
                    )}  run this again to finish the plan and the run`,
                  ]
                : [`${paint(`${binaryName} get-started`, 'cyan', color)}  run this again to start the run`],
            },
            color,
          ),
        );
        if (!quiet) write(target.label);
      } finally {
        prompter.close();
      }
    });
};

/**
 * What every step needs to ask its questions: somewhere to read from, somewhere to write to, and
 * what is already declared.
 *
 * One object rather than six parameters apiece, and one per step rather than one giant handler:
 * `chooseAgent` was already written this way, so the rest being inline made the file read as two
 * different programs.
 */
