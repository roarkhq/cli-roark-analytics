/**
 * `roark get-started` - the guided first run.
 *
 * Seven steps from an installed CLI to a graded simulation: who you are, the agent, the caller,
 * the scenario, the metrics, the saved plan, the run. Each step asks the fewest questions it can,
 * echoes the command it is shorthand for, and writes a YAML file into a config directory.
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
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { Command } from 'commander';
import type Roark from '@roarkanalytics/sdk';

import { buildBundle, EmptyConfigDirectoryError, type ConfigBundle } from '../config-bundle';
import { loadConfigModule } from '../config-module';
import { changeCount, formatChanges } from '../config-changes';
import { isInteractive } from '../confirm';
import { AuthRequiredError, UsageError } from '../errors';
import { paint, render, supportsColor, write, type OutputFormat } from '../output';
import {
  echoCommand,
  intro,
  nextSteps,
  note,
  stepDone,
  stepHeader,
  stepSkipped,
} from '../get-started/ladder';
import { createPrompter, type Choice, type Prompter } from '../get-started/prompt';
import {
  DEFAULT_MAX_DURATION_SECONDS,
  NAME_PATTERN,
  PHONE_PATTERN,
  setupFiles,
  slugify,
  type AgentSetup,
  type ConfigFormat,
  type CustomMetricSetup,
  type FlowSetup,
  type PersonaSetup,
  type EndpointDirection,
  type EndpointSetup,
  type Setup,
} from '../get-started/resources';
import { CONFIG_MODULE_FILE, CONFIG_MODULE_IMPORT, setupModule } from '../get-started/module';
import { writeScaffold } from '../get-started/scaffold';
import { metricOptions, type AvailableMetric } from '../get-started/starter-metrics';
import { sleep, verdictLine, verdictStyle, watchJob, type JobSnapshot } from '../get-started/watch';

const DEFAULT_DIR = './roark';

/**
 * Where the config is written, and in which form.
 *
 * YAML needs nothing installed, so it is the default and the only thing offered to someone who
 * reached the CLI through a global install. TypeScript gives types and editor completion, but its
 * `define*` helpers are imported from the SDK, so it is only usable in a project that has the SDK
 * to import from - which is why it is offered rather than assumed.
 */
interface Target {
  format: ConfigFormat;
  /** The directory for YAML, the containing directory for a config module. */
  dir: string;
  /** What to print when pointing at the config: a directory, or the file. */
  label: string;
  /** What `config diff` / `config apply` should be given. */
  argument: string;
}

const targetFor = (format: ConfigFormat, dir: string): Target =>
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
const applyCommand = (binaryName: string, target: Target): string =>
  `${binaryName} config apply${target.argument === '' ? '' : ` ${target.argument}`}`;

/**
 * Whether a config module could actually be loaded from here.
 *
 * `roark.config.ts` imports its helpers from the SDK, and jiti resolves that from the config
 * file's own project. Offering TypeScript where the import cannot resolve would hand someone a
 * config that fails on the next command, so the question is only asked where it can work.
 */
const sdkIsInstalled = (dir: string): boolean => {
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

/** How long to wait for the first run, and how often to ask. A simulated call takes a minute or two. */
const WATCH_TIMEOUT_MS = 6 * 60_000;
const POLL_MS = 5_000;

/** A plan needs at least one metric, so an empty pick list still has to produce a valid plan. */
const FALLBACK_METRIC = 'agent_responsive';

/** How many of the project's own agents to offer. A pick list has to stay readable. */
const AGENT_PAGE = 10;

/** One agent's lines. More than this is not a picker, and no agent under test has that many. */
const ENDPOINT_PAGE = 50;

type ClientFor = (options: never) => Roark;

/** One entry of an apply result, which is where a created resource's id comes back. */
type ConfigChange = { configKey: string; id?: string };
type ResolveOutput = (options: never) => { format: OutputFormat; color: boolean };

const nameRules = (what: string) => (answer: string) =>
  NAME_PATTERN.test(answer) ? undefined : (
    `A ${what} is lowercase letters, numbers, - _ . (e.g. ${slugify(`my ${what}`) || 'my-name'}).`
  );

const phoneRules = (answer: string): string | undefined =>
  PHONE_PATTERN.test(answer) ? undefined : 'Use E.164: a + and the country code, e.g. +15551234567.';

const enumRules = (answer: string): string | undefined =>
  /^[A-Z][A-Z_]*$/.test(answer) ? undefined : 'Use the upper-case code, e.g. EN or US_X_SOUTH.';

const LANGUAGES: readonly Choice<string>[] = [
  { value: 'EN', label: 'English' },
  { value: 'ES', label: 'Spanish' },
  { value: 'FR', label: 'French' },
  { value: 'DE', label: 'German' },
  { value: 'other', label: 'Something else', hint: 'type the code, e.g. HI, NL, PT' },
];

const ACCENTS: readonly Choice<string>[] = [
  { value: 'US', label: 'US' },
  { value: 'GB', label: 'British' },
  { value: 'IN', label: 'Indian' },
  { value: 'AU', label: 'Australian' },
  { value: 'other', label: 'Something else', hint: 'type the code, e.g. ES, DE, PH' },
];

const GENDERS: readonly Choice<string>[] = [
  { value: 'FEMALE', label: 'Female' },
  { value: 'MALE', label: 'Male' },
];

/** `other` defers to a typed code rather than listing every value the DSL accepts. */
const pickCode = async (
  prompter: Prompter,
  question: string,
  choices: readonly Choice<string>[],
  fallback: string,
): Promise<string> => {
  const picked = await prompter.select(question, choices, fallback);
  if (picked !== 'other') return picked;
  return (await prompter.ask('Which code?', { validate: enumRules })).toUpperCase();
};

/**
 * Resources the config directory already declares, so a second run fills the gaps instead of
 * asking everything again. An empty or absent directory is a fresh start; anything else wrong
 * with it (unparseable YAML, a resource with no kind) is raised, because `apply` would hit it
 * two steps later anyway and this is the better place to find out.
 */
const readExisting = async (target: Target): Promise<Record<string, unknown>[]> => {
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

const namesOfKind = (resources: readonly Record<string, unknown>[], kind: string): string[] =>
  resources
    .filter((resource) => resource['kind'] === kind)
    .map((resource) => String(resource['name']))
    .filter((name) => name.length > 0);

interface Credential {
  email?: string;
  scope?: string;
  defaultProject?: string;
}

/**
 * What the credential says it is, so step one can name the account and project rather than
 * announcing that something unspecified worked. Only a 401 stops the flow: anything else (an
 * older API with no `/v1/me`, a key without the permission) is a thin answer, not a broken one.
 */
const describeCredential = async (client: Roark, binaryName: string): Promise<Credential> => {
  try {
    const me = (await client.get('/v1/me')) as {
      data?: {
        tokenScope?: string;
        user?: { email?: string } | null;
        defaultProject?: { id?: string } | null;
      };
    };
    const email = me.data?.user?.email;
    const scope = me.data?.tokenScope;
    const defaultProject = me.data?.defaultProject?.id;
    return {
      ...(email === undefined ? {} : { email }),
      ...(scope === undefined ? {} : { scope }),
      ...(defaultProject === undefined ? {} : { defaultProject }),
    };
  } catch (error) {
    if ((error as { status?: number }).status === 401) {
      throw new AuthRequiredError(
        `The stored credential was rejected (401). Run \`${binaryName} auth login\`, then \`${binaryName} get-started\` again.`,
      );
    }
    return {};
  }
};

interface AgentChoice {
  id: string;
  name: string;
}

interface AgentList {
  agents: AgentChoice[];
  /** The project has more than one page of them, so the picker is not the whole truth. */
  truncated: boolean;
}

/** The project's existing agents, or undefined when they could not be read. */
const listAgents = async (client: Roark): Promise<AgentList | undefined> => {
  try {
    const response = await client.agent.list({ limit: AGENT_PAGE });
    return {
      agents: response.data.map((agent) => ({ id: agent.id, name: agent.name })),
      // Not paged through. A picker with fifty entries is not a picker, so the honest move is
      // to say the list is partial rather than to make it longer or to pretend it is complete.
      truncated: response.pagination?.hasMore === true,
    };
  } catch {
    return undefined;
  }
};

interface EndpointChoice {
  value: string;
  direction: EndpointDirection;
}

/** The agent's lines, or undefined when they could not be read: that is not the same as none. */
const listEndpoints = async (client: Roark, agentId: string): Promise<EndpointChoice[] | undefined> => {
  try {
    const response = await client.agentEndpoint.list({ agentId, limit: ENDPOINT_PAGE });
    return response.data.map((endpoint) => ({ value: endpoint.value, direction: endpoint.direction }));
  } catch {
    return undefined;
  }
};

/**
 * Step 2. Three ways in: adopt an agent that is already in Roark (the common case, and the one
 * that stops the flow creating a duplicate), declare a new one with a number to call, or declare
 * one with nothing reachable yet and come back to it.
 */
const chooseAgent = async (
  client: Roark,
  prompter: Prompter,
  say: (text: string) => void,
  binaryName: string,
  color: boolean,
): Promise<AgentSetup> => {
  const listed = await listAgents(client);
  const CREATE = '\u0000create';

  if (listed === undefined) {
    // Said out loud rather than swallowed: without it, a project full of agents looks empty and
    // the obvious next step is to create a duplicate of one that already exists.
    say(note("Could not read this project's agents, so this will declare a new one.", color, 'yellow'));
  }

  const existing = listed?.agents ?? [];
  if (existing.length > 0) {
    const choices: Choice<string>[] = [
      ...existing.map((agent) => ({ value: agent.id, label: agent.name, hint: 'already in Roark' })),
      { value: CREATE, label: 'A new agent', hint: 'not in Roark yet' },
    ];
    if (listed?.truncated === true) {
      say(
        note(
          `Showing the first ${AGENT_PAGE} agents. If the one you want is not here, pick "A new agent" and give it the same name to adopt it.`,
          color,
        ),
      );
    }
    const picked = await prompter.select('Which agent are we testing?', choices, existing[0]!.id);

    if (picked !== CREATE) {
      const agent = existing.find((candidate) => candidate.id === picked)!;
      const slug = slugify(agent.name) || 'agent';
      const endpoints = await listEndpoints(client, agent.id);

      // Endpoints are deliberately NOT declared for an adopted agent: an absent `endpoints` key
      // leaves what Roark holds untouched, where an empty list would detach every one of them.
      const base: AgentSetup = {
        name: slug,
        ...(slug === agent.name ? {} : { displayName: agent.name }),
      };

      if (endpoints === undefined) {
        // Distinct from "it has none": reporting a read failure as an agent with no line would
        // skip the plan and the run over what may be a blip. Both say how to finish, because
        // stopping early here is a pause, not a dead end.
        say(
          note(
            `Could not read ${agent.name}'s lines, so this stops before the plan. Run \`${binaryName} get-started\` again to finish it.`,
            color,
            'yellow',
          ),
        );
        return base;
      }
      if (endpoints.length === 0) {
        say(
          note(
            `That agent has no endpoint yet, so there is no line to call. Add one, then run \`${binaryName} get-started\` again to finish.`,
            color,
            'yellow',
          ),
        );
        return base;
      }
      if (endpoints.length === 1) return { ...base, dial: endpoints[0]! };

      const line = await prompter.select(
        'Which of its lines should the run call?',
        endpoints.map((endpoint) => ({
          value: endpoint.value,
          label: endpoint.value,
          hint: endpoint.direction.toLowerCase().replace(/_/g, ' '),
        })),
        endpoints[0]!.value,
      );
      return { ...base, dial: endpoints.find((endpoint) => endpoint.value === line)! };
    }
  }

  const name = await prompter.ask('What should we call the agent?', {
    default: 'my-agent',
    validate: nameRules('name'),
  });
  const reachable = await prompter.select(
    'Can Roark call it right now?',
    [
      { value: 'phone', label: 'Yes, at a phone number I own', hint: 'Roark dials it and plays the caller' },
      { value: 'later', label: 'Not yet', hint: 'write the files now, add the number later' },
    ],
    'phone',
  );

  if (reachable === 'later') {
    say(echoCommand(`${binaryName} agent create --name ${name}`, color));
    return { name };
  }

  const value = await prompter.ask('Phone number for Roark to call', { validate: phoneRules });
  say(
    echoCommand(
      `${binaryName} agent endpoint create --agent-id <id> --value ${value} --direction INCOMING`,
      color,
    ),
  );
  // INCOMING, so the run is inbound: Roark places the call and it runs the moment it is started.
  // An outgoing-only line makes the run outbound, which needs your system to dial Roark.
  return { name, endpoints: [{ value, direction: 'INCOMING' }], dial: { value, direction: 'INCOMING' } };
};

/** Placeholders for `--scaffold-only`: a complete, valid set of files with nothing invented about you. */
const placeholderSetup = (): Setup => ({
  agent: {
    name: 'my-agent',
    endpoints: [{ value: '+15551234567', direction: 'INCOMING' }],
    dial: { value: '+15551234567', direction: 'INCOMING' },
  },
  persona: { name: 'curious-caller', language: 'EN', accent: 'US', gender: 'FEMALE' },
  flow: {
    name: 'first-scenario',
    goal: 'You call to ask a question you need answered before you can book.',
    expectation: 'The agent answers the question and offers to help further',
  },
  metrics: ['agent_responsive', 'call_ended_cleanly', 'scenario_adherence'],
  plan: { name: 'first-run', maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS },
});

const placeholderTodos = (format: ConfigFormat): string[] => {
  const agent = format === 'ts' ? CONFIG_MODULE_FILE : 'agents/my-agent.yaml';
  const flow = format === 'ts' ? CONFIG_MODULE_FILE : 'flows/first-scenario.yaml';
  return [
    `Replace the endpoint value in ${agent} with the number Roark should call.`,
    `Rewrite the scenario prompt in ${flow} so it describes a real call.`,
  ];
};

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
      // A TypeScript config defaults to the working directory rather than `./roark`, because
      // `config apply` finds `roark.config.ts` there by itself and then needs no argument.
      const dir = chosenDir ?? (wantsTs ? '.' : DEFAULT_DIR);
      // Settled up front for the non-interactive paths; the question below can still change it.
      let target = targetFor(wantsTs ? 'ts' : 'yaml', dir);

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
        if (target.format !== 'ts' || sdkIsInstalled(dir)) return;
        say(
          note(
            `${CONFIG_MODULE_FILE} imports ${CONFIG_MODULE_IMPORT}, which this project cannot resolve. Install a recent @roarkanalytics/sdk here, or use --yaml.`,
            color,
            'yellow',
          ),
        );
      };

      if (scaffoldOnly) {
        say(intro(binaryName, target.label, target.format, color));
        warnIfUnimportable();
        const placeholder = placeholderSetup();
        const files = target.format === 'ts' ? [setupModule(placeholder)] : setupFiles(placeholder);
        const result = await writeScaffold(dir, files);
        for (const path of result.written) say(`${paint('+', 'green', color)} ${path}`);
        for (const path of result.skipped)
          say(`${paint('·', 'yellow', color)} ${path} (already there, left alone)`);
        say('');
        for (const todo of placeholderTodos(target.format)) say(note(`TODO: ${todo}`, color, 'yellow'));
        say(
          nextSteps(
            {
              binaryName,
              dir: target.label,
              apply: applyCommand(binaryName, target),
              lines: [
                `${paint(
                  `${binaryName} config diff${target.argument === '' ? '' : ` ${target.argument}`}`,
                  'cyan',
                  color,
                )}  preview what it would create`,
              ],
            },
            color,
          ),
        );
        if (!quiet) write(target.label);
        return;
      }

      const prompter = createPrompter();

      try {
        // Only where it is a real choice. A project without the SDK cannot load a config module,
        // and someone who passed --ts or --yaml has already answered.
        if (!wantsTs && !wantsYaml && sdkIsInstalled(dir)) {
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
          target = targetFor(
            picked === 'ts' ? 'ts' : 'yaml',
            chosenDir ?? (picked === 'ts' ? '.' : DEFAULT_DIR),
          );
        }

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
          say(stepSkipped(1, `${agent.name}, already declared in ${dir}`, color));
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
          say(stepSkipped(5, `${planName}, already declared in ${dir}`, color));
        } else if (agent.dial === undefined) {
          say(
            stepSkipped(
              5,
              `waiting on a line to call. Add an endpoint to ${dir}/agents/${agent.name}.yaml and run this again`,
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
        const result = await writeScaffold(dir, pending);
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
interface Steps {
  prompter: Prompter;
  say: (text: string) => void;
  color: boolean;
  binaryName: string;
  /** Resources the config already declares, which is what a step skips itself for. */
  existing: Record<string, unknown>[];
  /** What to call the config when pointing at it. */
  label: string;
}

/** A step's answer, plus whether this run authored it or read it back out of the config. */
type Authored<T> = T & { authored: boolean };

/** Step 3: who calls the agent. */
const chooseCaller = async (steps: Steps): Promise<Authored<PersonaSetup>> => {
  const { prompter, say, color, binaryName } = steps;
  const declared = namesOfKind(steps.existing, 'persona')[0];

  if (declared !== undefined) {
    say(stepSkipped(2, `${declared}, already declared in ${steps.label}`, color));
    // The declared file is the source of truth for the rest of its fields; nothing here reads
    // them, because nothing here writes that file again.
    return { name: declared, language: 'EN', accent: 'US', gender: 'FEMALE', authored: false };
  }

  say(stepHeader(2, color));
  const name = await prompter.ask('What should we call the caller?', {
    default: 'curious-caller',
    validate: nameRules('name'),
  });
  const language = await pickCode(prompter, 'What language do they speak?', LANGUAGES, 'EN');
  const accent = await pickCode(prompter, 'With which accent?', ACCENTS, 'US');
  const gender = await prompter.select('Voice?', GENDERS, 'FEMALE');

  say(stepDone(2, `${name} (${language}/${accent}/${gender.toLowerCase()})`, color));
  say(
    echoCommand(
      `${binaryName} simulation persona create --name ${name} --language ${language} --accent ${accent} --gender ${gender}`,
      color,
    ),
  );
  return { name, language, accent, gender, authored: true };
};

/** Step 4: what the call is about. */
const chooseScenario = async (
  steps: Steps,
  agent: AgentSetup,
  agentIsNew: boolean,
): Promise<Authored<FlowSetup>> => {
  const { prompter, say, color } = steps;
  const declared = namesOfKind(steps.existing, 'flow')[0];

  if (declared !== undefined) {
    say(stepSkipped(3, `${declared}, already declared in ${steps.label}`, color));

    // A flow names the agents it is written for. Reusing one that does not name the agent we
    // just declared produces a plan whose flow targets somebody else, which apply accepts and
    // the run then does something unexpected with.
    const resource = steps.existing.find((entry) => entry['kind'] === 'flow' && entry['name'] === declared);
    const targets = Array.isArray(resource?.['agents']) ? resource['agents'] : [];
    if (agentIsNew && !targets.includes(agent.name)) {
      say(
        note(
          `${declared} does not list ${agent.name} under \`agents\`. Add it, or the run will exercise a scenario written for a different agent.`,
          color,
          'yellow',
        ),
      );
    }
    return { name: declared, goal: '', authored: false };
  }

  say(stepHeader(3, color));
  const goal = await prompter.ask('What is the caller calling about? Say it as you would to them');
  const name = await prompter.ask('Short name for that scenario?', {
    // Not derived from the sentence above: a slug of "You call to rebook a cancelled cleaning"
    // reads as `you-call-to-rebook-a`, which is worse than a plain default.
    default: 'first-scenario',
    validate: nameRules('name'),
  });
  const written = await prompter.ask('What must the agent do for this call to pass? (Enter to skip)', {
    default: '-',
  });

  say(stepDone(3, name, color));
  return { name, goal, ...(written === '-' ? {} : { expectation: written }), authored: true };
};

/** Step 5: how the call is graded. */
const chooseMetrics = async (
  steps: Steps,
  client: Roark,
  declaredPlan: string | undefined,
): Promise<{ metrics: string[]; customMetric?: CustomMetricSetup }> => {
  const { prompter, say, color } = steps;

  // A plan names the metrics, so when one is already declared there is nothing these answers
  // could attach to: that plan is left alone, and the picks would be collected and then quietly
  // dropped. Not asking is better than asking and ignoring.
  if (declaredPlan !== undefined) {
    say(stepSkipped(4, `${declaredPlan} already names the metrics it grades on`, color));
    return { metrics: [] };
  }

  say(stepHeader(4, color));

  let available: AvailableMetric[] | undefined;
  try {
    const response = await client.metric.listDefinitions({ limit: 500 });
    available = response.data.map((metric) => ({ metricId: metric.metricId, name: metric.name }));
  } catch {
    available = undefined;
  }

  const offered = metricOptions(available);
  if (!offered.verified) {
    say(note("Could not read this project's metrics, so these are Roark's usual ones.", color, 'yellow'));
  }

  const metrics = await prompter.multiSelect(
    'Which metrics should grade the run?',
    offered.choices,
    offered.recommended,
  );

  let customMetric: CustomMetricSetup | undefined;
  if (await prompter.confirm('Add a metric of your own?', false)) {
    const name = await prompter.ask('Short name for it', {
      default: 'my_metric',
      validate: nameRules('slug'),
    });
    const question = await prompter.ask(
      'The yes/no question Roark should judge, e.g. "did the agent confirm the booking date?"',
    );
    customMetric = { name, question };
    metrics.push(name);
  }

  if (metrics.length === 0) {
    metrics.push(FALLBACK_METRIC);
    say(note(`A run needs at least one metric, so ${FALLBACK_METRIC} was kept.`, color, 'yellow'));
  }
  say(stepDone(4, metrics.join(', '), color));

  return { metrics, ...(customMetric === undefined ? {} : { customMetric }) };
};

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
const applyConfig = async (
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

interface RunPhase {
  client: Roark;
  prompter: Prompter;
  say: (text: string) => void;
  binaryName: string;
  color: boolean;
  quiet: boolean;
  options: Record<string, unknown>;
  planName: string;
  /** What to call the config in the closing "what next" block. */
  dir: string;
  /** The apply command for that config, which differs between YAML and a config module. */
  apply: string;
  /** The line the run will dial, quoted back in the confirmation. */
  dial: AgentSetup['dial'];
  /** The apply result, when there was one. Absent when the project already matched the files. */
  applied: ConfigChange[] | undefined;
  resolveOutput: ResolveOutput;
}

/**
 * Step 7: start the run and watch it to a verdict.
 *
 * Its own function because it is the one phase that stands alone (everything it needs is a plan
 * id and a line), and because it is where the interesting failure modes live: a plan id that has
 * to be resolved two ways, a billable action that needs its own confirmation, and a wait that can
 * end three different ways.
 *
 * Returns true when it has reported the outcome and the command is finished, false when it could
 * not start and the caller should print its own closing text.
 */
const startRun = async (phase: RunPhase): Promise<boolean> => {
  const { client, prompter, say, binaryName, color, quiet, options, planName } = phase;
  say(stepHeader(6, color));

  // Two ways to the id, because there are two ways to get here: an apply that just created the
  // plan carries it, and a re-run over an already-applied directory has no apply result at all.
  const planId =
    phase.applied?.find((entry) => entry.configKey === `simulationPlan/${planName}`)?.id ??
    (await findPlanId(client, planName));

  if (planId === undefined) {
    say(
      note(
        `Could not work out the plan's id. Find it with \`${binaryName} simulation plan list\` and run \`${binaryName} simulation run --data '{"planId":"<id>"}'\`.`,
        color,
        'yellow',
      ),
    );
    return false;
  }

  // A run places a real call on a real line and is billed, so it is confirmed on its own rather
  // than riding on the apply. `--yes` covers both, `--no-run` skips it.
  const dialled = phase.dial !== undefined && 'value' in phase.dial ? phase.dial.value : 'your agent';
  const start =
    options['yes'] === true ||
    (await prompter.confirm(`Start the run? It places a real call to ${dialled}.`, true));
  if (!start) {
    say(stepSkipped(6, 'not started', color));
    say('');
    say(
      `The plan is saved. Start it whenever you like: \`${binaryName} simulation run --data '{"planId":"${planId}"}'\`.`,
    );
    if (!quiet) write(planId);
    return true;
  }

  const run = await client.simulation.run({ planId });
  const jobId = run.data.simulationRunPlanJobId;
  say(echoCommand(`${binaryName} simulation run --data '{"planId":"${planId}"}'`, color));
  say(
    `Started ${paint(jobId, 'cyan', color)}: ${
      run.data.simulationJobCount
    } call(s). Waiting for the verdict...`,
  );

  const watched = await watchJob({
    jobId,
    getJob: async (id) => (await client.simulationRunPlanJob.getByID(id)).data as JobSnapshot,
    onProgress: (line) => say(`  ${paint(line, 'dim', color)}`),
    timeoutMs: WATCH_TIMEOUT_MS,
    pollMs: POLL_MS,
    sleep,
    now: () => Date.now(),
  });

  if (watched.outcome === 'settled') {
    say(stepDone(6, paint(verdictLine(watched.snapshot), verdictStyle(watched.snapshot), color), color));
  } else {
    // Neither of these is a failed run: the run is fine, it is this command that stopped watching,
    // so it is reported as a skipped step rather than as a verdict.
    say(
      stepSkipped(
        6,
        watched.outcome === 'unreachable' ?
          'could not read the run from the API. It is still going'
        : `still running after ${Math.round(WATCH_TIMEOUT_MS / 60_000)} minutes. It will finish on its own`,
        color,
      ),
    );
  }

  say(
    nextSteps(
      {
        binaryName,
        dir: phase.dir,
        apply: phase.apply,
        lines: [
          `${paint(
            `${binaryName} simulation plan job get ${jobId}`,
            'cyan',
            color,
          )}  every call, with its metrics`,
          `${paint(
            `${binaryName} simulation run --data '{"planId":"${planId}"}'`,
            'cyan',
            color,
          )}  run it again`,
        ],
      },
      color,
    ),
  );

  if (!quiet) {
    const output = phase.resolveOutput(options as never);
    write(
      output.format === 'json' || options['json'] === true ?
        render({ planId, jobId, status: watched.snapshot.status }, output)
      : jobId,
    );
  }
  return true;
};

/** The plan's id when the apply result did not carry one, e.g. because nothing about it changed. */
const findPlanId = async (client: Roark, name: string): Promise<string | undefined> => {
  try {
    const response = await client.simulationRunPlan.list({ searchText: name, limit: 50 });
    return response.data.find((plan) => plan.name === name)?.id;
  } catch {
    return undefined;
  }
};
