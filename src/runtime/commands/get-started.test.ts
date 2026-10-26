import { mkdtempSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { Command } from 'commander';
import { parse } from 'yaml';
import type Roark from '@roarkanalytics/sdk';

import { UsageError } from '../errors';
import { registerGetStartedCommand } from './get-started';

const tempDir = (): string => mkdtempSync(join(tmpdir(), 'roark-get-started-'));

interface Recorded {
  calls: string[];
  diffBodies: unknown[];
  runBodies: unknown[];
}

/** A client that answers every call `get-started` makes, and records the ones that matter. */
const stubClient = (overrides: Partial<Record<string, unknown>> = {}) => {
  const recorded: Recorded = { calls: [], diffBodies: [], runBodies: [] };
  const note = (name: string) => recorded.calls.push(name);

  const client = {
    get: async (path: string) => {
      note(`get ${path}`);
      return { data: { tokenScope: 'PROJECT', user: { email: 'o@test' }, defaultProject: { id: 'proj_1' } } };
    },
    agent: {
      list: async () => {
        note('agent.list');
        if (overrides['agentsFail'] === true) throw new Error('agent list unavailable');
        return {
          data: (overrides['agents'] as { id: string; name: string }[]) ?? [],
          pagination: { hasMore: overrides['agentsTruncated'] === true },
        };
      },
    },
    agentEndpoint: {
      list: async () => {
        note('agentEndpoint.list');
        if (overrides['endpointsFail'] === true) throw new Error('endpoint list unavailable');
        return { data: (overrides['endpoints'] as unknown[]) ?? [] };
      },
    },
    metric: {
      listDefinitions: async () => {
        note('metric.listDefinitions');
        return {
          data: [
            { metricId: 'agent_responsive', name: 'Agent responsive' },
            { metricId: 'call_ended_cleanly', name: 'Call ended cleanly' },
            { metricId: 'scenario_adherence', name: 'Flow adherence' },
          ],
        };
      },
    },
    config: {
      diff: async (body: unknown) => {
        note('config.diff');
        recorded.diffBodies.push(body);
        if (overrides['emptyDiff'] === true) {
          return { data: { changes: [], summary: { create: 0, update: 0, delete: 0, noop: 4 } } };
        }
        return {
          data: {
            changes: [{ op: 'create', configKey: 'agent/frontdesk' }],
            summary: { create: 4, update: 0, delete: 0, noop: 0 },
          },
        };
      },
      apply: async (body: unknown) => {
        note('config.apply');
        return {
          data: {
            changes: [
              { op: 'create', configKey: 'agent/frontdesk', status: 'applied', id: 'agent_1' },
              { op: 'create', configKey: 'simulationPlan/first-run', status: 'applied', id: 'plan_1' },
            ],
            summary: { create: 4, update: 0, delete: 0, noop: 0, failed: 0 },
          },
        };
      },
    },
    simulation: {
      run: async (body: unknown) => {
        note('simulation.run');
        recorded.runBodies.push(body);
        return {
          data: {
            simulationRunPlanId: 'plan_1',
            simulationRunPlanJobId: 'job_1',
            simulationJobCount: 1,
            status: 'PENDING',
          },
        };
      },
    },
    simulationRunPlanJob: {
      getByID: async () => {
        note('simulationRunPlanJob.getByID');
        return {
          data: {
            status: 'COMPLETED',
            verdict: { passed: true, score: 92 },
            simulationJobs: [{ status: 'COMPLETED' }],
          },
        };
      },
    },
    simulationRunPlan: {
      list: async () => {
        note('simulationRunPlan.list');
        return { data: (overrides['plans'] as { id: string; name: string }[]) ?? [] };
      },
    },
  } as unknown as Roark;

  return { recorded, client };
};

let savedStdin: PropertyDescriptor | undefined;
let savedStdinTty: PropertyDescriptor | undefined;
let savedStdoutTty: PropertyDescriptor | undefined;
let stderr: jest.SpyInstance;
let stdout: jest.SpyInstance;
let pending: string[] = [];
let stdin: PassThrough | undefined;

/**
 * One answer per question. readline drops a line that arrives with nothing waiting for it, and a
 * prompt is the only thing written to stderr without a trailing newline (`output.ts#write` always
 * adds one), so that is the cue to supply the next answer.
 */
const feed = (chunk: unknown): void => {
  if (String(chunk).endsWith('\n')) return;
  const answer = pending.shift();
  if (answer === undefined) return;
  setImmediate(() => stdin?.write(`${answer}\n`));
};

const setTty = (value: boolean): void => {
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true });
};

beforeEach(() => {
  savedStdin = Object.getOwnPropertyDescriptor(process, 'stdin');
  savedStdinTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  savedStdoutTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  pending = [];
  stdin = undefined;
  stderr = jest.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    feed(chunk);
    return true;
  });
  stdout = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
});

afterEach(() => {
  if (savedStdin) Object.defineProperty(process, 'stdin', savedStdin);
  if (savedStdinTty) Object.defineProperty(process.stdin, 'isTTY', savedStdinTty);
  else delete (process.stdin as { isTTY?: boolean }).isTTY;
  if (savedStdoutTty) Object.defineProperty(process.stdout, 'isTTY', savedStdoutTty);
  else delete (process.stdout as { isTTY?: boolean }).isTTY;
  stderr.mockRestore();
  stdout.mockRestore();
});

const said = (): string => stderr.mock.calls.map((call) => String(call[0])).join('');
const printed = (): string => stdout.mock.calls.map((call) => String(call[0])).join('');

interface RunOptions {
  argv: string[];
  answers?: string[];
  interactive?: boolean;
  overrides?: Partial<Record<string, unknown>>;
}

const run = async ({ argv, answers = [], interactive = true, overrides = {} }: RunOptions) => {
  const stub = stubClient(overrides);
  if (interactive) {
    stdin = new PassThrough();
    pending = [...answers];
    Object.defineProperty(process, 'stdin', { value: stdin, configurable: true });
  }
  // After the swap, so the flag lands on the stream the command will actually read.
  setTty(interactive);

  const program = new Command();
  program.exitOverride();
  registerGetStartedCommand(
    program,
    'roark',
    () => stub.client,
    () => ({ format: 'auto' as const, color: false }),
  );
  for (const child of program.commands) child.exitOverride();

  await program.parseAsync(['node', 'roark', ...argv]);
  return stub.recorded;
};

/** Every answer the happy path needs, in order. An empty string takes that question's default. */
const HAPPY_PATH_ANSWERS = [
  'frontdesk', // agent name
  '1', // reachable at a phone number
  '+15551234567', // the number
  'curious-caller', // persona name
  '', // language: EN
  '', // accent: US
  '', // voice: FEMALE
  'You call to rebook a cancelled cleaning.', // the scenario
  '', // scenario name: first-scenario
  '', // expectation: skipped
  '', // metrics: the recommended ones
  '', // no metric of my own
  '', // plan name: first-run
  '', // yes, apply
  '', // yes, start the run
];

/** Everything up to the apply confirmation, which `--yes` answers on its own. */
const UP_TO_APPLY = HAPPY_PATH_ANSWERS.slice(0, -2);

describe('roark get-started --scaffold-only', () => {
  it('writes a complete config directory without touching the API', async () => {
    const dir = tempDir();

    const recorded = await run({
      argv: ['get-started', '--dir', dir, '--scaffold-only'],
      interactive: false,
    });

    expect(recorded.calls).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(['agents', 'flows', 'personas', 'simulation-plans']);
    expect(readFileSync(join(dir, 'agents/my-agent.yaml'), 'utf8')).toContain('kind: agent');
    expect(readFileSync(join(dir, 'simulation-plans/first-run.yaml'), 'utf8')).toContain(
      'kind: simulationPlan',
    );
  });

  it('says which placeholders have to be replaced', async () => {
    const dir = tempDir();
    await run({ argv: ['get-started', '--dir', dir, '--scaffold-only'], interactive: false });
    expect(said()).toContain('TODO');
  });

  it('leaves a file that is already there alone', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'agents'), { recursive: true });
    writeFileSync(join(dir, 'agents/my-agent.yaml'), 'kind: agent # mine\n');

    await run({ argv: ['get-started', '--dir', dir, '--scaffold-only'], interactive: false });

    expect(readFileSync(join(dir, 'agents/my-agent.yaml'), 'utf8')).toBe('kind: agent # mine\n');
  });
});

describe('roark get-started', () => {
  it('refuses to ask questions when there is nobody to answer them', async () => {
    // Hanging on a pipe, or half-prompting into a CI log, is the failure this prevents.
    const dir = tempDir();
    await expect(run({ argv: ['get-started', '--dir', dir], interactive: false })).rejects.toThrow(
      UsageError,
    );
    expect(readdirSync(dir)).toEqual([]);
  });

  it('names --scaffold-only in that refusal, so there is somewhere to go', async () => {
    const dir = tempDir();
    await expect(run({ argv: ['get-started', '--dir', dir], interactive: false })).rejects.toThrow(
      /--scaffold-only/,
    );
  });

  it('walks the whole flow: files, diff, apply, run, verdict', async () => {
    const dir = tempDir();

    const recorded = await run({
      argv: ['get-started', '--dir', dir],
      answers: HAPPY_PATH_ANSWERS,
    });

    expect(recorded.calls).toEqual([
      'get /v1/me',
      'agent.list',
      'metric.listDefinitions',
      'config.diff',
      'config.apply',
      'simulation.run',
      'simulationRunPlanJob.getByID',
    ]);
    expect(recorded.runBodies).toEqual([{ planId: 'plan_1' }]);
    expect(said()).toContain('Passed, score 92/100');
    // The job id goes to stdout so a script can capture it; everything else is stderr.
    expect(printed().trim()).toBe('job_1');
  });

  it('applies the directory it wrote, with the answers in it', async () => {
    const dir = tempDir();

    await run({ argv: ['get-started', '--dir', dir], answers: HAPPY_PATH_ANSWERS });

    const flow = readFileSync(join(dir, 'flows/first-scenario.yaml'), 'utf8');
    expect(flow).toContain('You call to rebook a cancelled cleaning.');
    expect(flow).toContain('persona: curious-caller');
    const plan = readFileSync(join(dir, 'simulation-plans/first-run.yaml'), 'utf8');
    expect(plan).toContain('direction: INBOUND');
    expect(plan).toContain('agent_responsive');
  });

  it('never prunes, because the directory it builds is a subset of a real one', async () => {
    const dir = tempDir();

    const recorded = await run({ argv: ['get-started', '--dir', dir], answers: HAPPY_PATH_ANSWERS });

    expect(recorded.diffBodies).toHaveLength(1);
    expect((recorded.diffBodies[0] as { prune?: boolean }).prune).toBe(false);
  });

  it('stops at the confirmation without applying, leaving the files in place', async () => {
    const dir = tempDir();

    const recorded = await run({
      argv: ['get-started', '--dir', dir],
      answers: [...UP_TO_APPLY, 'n'],
    });

    expect(recorded.calls).toContain('config.diff');
    expect(recorded.calls).not.toContain('config.apply');
    expect(said()).toContain('config apply');
    expect(readdirSync(dir)).toContain('agents');
  });

  it('sets everything up but starts nothing for --no-run', async () => {
    const dir = tempDir();

    const recorded = await run({
      argv: ['get-started', '--dir', dir, '--no-run'],
      answers: HAPPY_PATH_ANSWERS,
    });

    expect(recorded.calls).toContain('config.apply');
    expect(recorded.calls).not.toContain('simulation.run');
  });

  it('applies without asking for --yes', async () => {
    const dir = tempDir();

    const recorded = await run({
      argv: ['get-started', '--dir', dir, '--yes'],
      answers: UP_TO_APPLY,
    });

    expect(recorded.calls).toContain('config.apply');
    expect(recorded.calls).toContain('simulation.run');
  });

  it('asks before placing a call, and saves the plan when the answer is no', async () => {
    // A run dials a real line and is billed, so it is confirmed on its own rather than riding
    // on the apply the user already agreed to.
    const dir = tempDir();

    const recorded = await run({
      argv: ['get-started', '--dir', dir],
      answers: [...HAPPY_PATH_ANSWERS.slice(0, -1), 'n'],
    });

    expect(recorded.calls).toContain('config.apply');
    expect(recorded.calls).not.toContain('simulation.run');
    expect(said()).toContain('places a real call to +15551234567');
    expect(printed().trim()).toBe('plan_1');
  });

  it('writes no plan, and runs nothing, when the agent has no line to call', async () => {
    // Half a setup is still worth having: the agent, caller and scenario land, and re-running
    // after adding an endpoint finishes the job.
    const dir = tempDir();

    const recorded = await run({
      argv: ['get-started', '--dir', dir],
      answers: [
        'frontdesk', // agent name
        '2', // not reachable yet
        'curious-caller', // persona name
        '', // language
        '', // accent
        '', // voice
        'You call to rebook a cancelled cleaning.', // the scenario
        '', // scenario name
        '', // expectation: skipped
        '', // metrics
        '', // no metric of my own
        '', // apply (no plan step: there is no line to call)
      ],
    });

    expect(readdirSync(dir).sort()).toEqual(['agents', 'flows', 'personas']);
    expect(recorded.calls).not.toContain('simulation.run');
    expect(said()).toContain('run this again');
  });

  it('skips the steps the directory already declares, and never rewrites their files', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'agents'), { recursive: true });
    writeFileSync(
      join(dir, 'agents/frontdesk.yaml'),
      'kind: agent\nname: frontdesk\nendpoints:\n  - value: "+15550001111"\n    direction: INCOMING\n',
    );

    await run({
      argv: ['get-started', '--dir', dir],
      answers: [
        // No agent questions: it is already declared.
        'curious-caller', // persona name
        '', // language
        '', // accent
        '', // voice
        'You call to rebook a cancelled cleaning.', // the scenario
        '', // scenario name
        '', // expectation: skipped
        '', // metrics
        '', // no metric of my own
        '', // plan name
        '', // apply
        '', // start the run
      ],
    });

    expect(readFileSync(join(dir, 'agents/frontdesk.yaml'), 'utf8')).toContain('+15550001111');
    expect(said()).toContain('already declared');
    expect(readFileSync(join(dir, 'flows/first-scenario.yaml'), 'utf8')).toContain('agents:\n  - frontdesk');
  });

  it('adopts an agent that is already in Roark rather than creating a second one', async () => {
    const dir = tempDir();

    await run({
      argv: ['get-started', '--dir', dir],
      overrides: {
        agents: [{ id: 'agent_1', name: 'Dental Clinic' }],
        endpoints: [{ value: '+15559998888', direction: 'INCOMING' }],
      },
      answers: [
        '1', // the existing agent
        'curious-caller', // persona name
        '', // language
        '', // accent
        '', // voice
        'You call to rebook a cancelled cleaning.', // the scenario
        '', // scenario name
        '', // expectation: skipped
        '', // metrics
        '', // no metric of my own
        '', // plan name
        '', // apply
        '', // start the run
      ],
    });

    const agent = parse(readFileSync(join(dir, 'agents/dental-clinic.yaml'), 'utf8')) as Record<
      string,
      unknown
    >;
    // `displayName` is what adopts the existing agent in place rather than creating a duplicate,
    // and declaring no endpoints is what leaves the ones Roark holds alone.
    expect(agent['displayName']).toBe('Dental Clinic');
    expect(agent['name']).toBe('dental-clinic');
    expect('endpoints' in agent).toBe(false);
    const plan = parse(readFileSync(join(dir, 'simulation-plans/first-run.yaml'), 'utf8')) as Record<
      string,
      unknown
    >;
    // The line IS named here: Roark may hold several endpoints for an adopted agent, and apply
    // refuses to guess between them rather than dial the wrong one.
    expect(plan['agentEndpoints']).toEqual([
      { agent: 'dental-clinic', value: '+15559998888', direction: 'INCOMING' },
    ]);
  });
});

describe('roark get-started, run again', () => {
  /** A directory that is already complete and already applied: the second-run case. */
  const seedApplied = (dir: string): void => {
    mkdirSync(join(dir, 'agents'), { recursive: true });
    mkdirSync(join(dir, 'personas'), { recursive: true });
    mkdirSync(join(dir, 'flows'), { recursive: true });
    mkdirSync(join(dir, 'simulation-plans'), { recursive: true });
    writeFileSync(
      join(dir, 'agents/frontdesk.yaml'),
      'kind: agent\nname: frontdesk\nendpoints:\n  - value: "+15550001111"\n    direction: INCOMING\n',
    );
    writeFileSync(
      join(dir, 'personas/caller.yaml'),
      'kind: persona\nname: caller\nlanguage: EN\naccent: US\ngender: FEMALE\n',
    );
    writeFileSync(
      join(dir, 'flows/first-scenario.yaml'),
      'kind: flow\ntype: improv\nname: first-scenario\nagents:\n  - frontdesk\nhappyPath:\n  persona: caller\n  environment: Quiet line\n  prompt: You call about a booking.\n',
    );
    writeFileSync(
      join(dir, 'simulation-plans/first-run.yaml'),
      'kind: simulationPlan\nname: first-run\ndirection: INBOUND\nagentEndpoints:\n  - agent: frontdesk\nmetrics:\n  - agent_responsive\nflows:\n  - flow: first-scenario\nmaxDurationSeconds: 300\n',
    );
  };

  it('still offers the run when there is nothing left to apply', async () => {
    // The whole "safe to re-run, it finishes the job" story depends on this: someone who stopped
    // at --no-run, or declined the call, comes back and the diff is empty. Gating the run on
    // there being changes made the command unable to do the thing it tells you to re-run it for.
    const dir = tempDir();
    seedApplied(dir);

    const recorded = await run({
      argv: ['get-started', '--dir', dir],
      overrides: { emptyDiff: true, plans: [{ id: 'plan_1', name: 'first-run' }] },
      answers: ['' /* yes, start the run */],
    });

    expect(said()).toContain('Nothing to apply');
    expect(recorded.calls).not.toContain('config.apply');
    // The plan id came from a lookup, because no apply result carried one.
    expect(recorded.calls).toContain('simulationRunPlan.list');
    expect(recorded.runBodies).toEqual([{ planId: 'plan_1' }]);
  });

  it('does not ask about metrics when the plan that would use them already exists', async () => {
    // Step 5 used to prompt, collect the picks, and then drop them: the plan file is left alone,
    // so there was nothing for the answers to attach to.
    const dir = tempDir();
    seedApplied(dir);

    const recorded = await run({
      argv: ['get-started', '--dir', dir, '--no-run'],
      overrides: { emptyDiff: true },
      answers: [],
    });

    expect(recorded.calls).not.toContain('metric.listDefinitions');
    expect(said()).toContain('already names the metrics it grades on');
  });

  it("says so when the project's agents cannot be read", async () => {
    const dir = tempDir();

    await run({
      argv: ['get-started', '--dir', dir, '--no-run'],
      overrides: { agentsFail: true },
      answers: [
        'frontdesk', // agent name: asked because the list could not be read
        '2', // not reachable yet
        'curious-caller',
        '',
        '',
        '',
        'You call about a booking.',
        '',
        '',
        '',
        '',
        '', // apply
      ],
    });

    expect(said()).toContain("Could not read this project's agents");
  });

  it('warns when a reused flow does not target the agent it just declared', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'flows'), { recursive: true });
    writeFileSync(
      join(dir, 'flows/first-scenario.yaml'),
      'kind: flow\ntype: improv\nname: first-scenario\nagents:\n  - somebody-else\nhappyPath:\n  persona: caller\n  environment: Quiet line\n  prompt: You call about a booking.\n',
    );

    await run({
      argv: ['get-started', '--dir', dir, '--no-run'],
      answers: [
        'frontdesk', // agent name
        '1', // reachable at a phone number
        '+15551234567',
        'curious-caller',
        '',
        '',
        '',
        // No scenario questions: the flow is already declared.
        '', // metrics
        '', // no metric of my own
        '', // plan name
        '', // apply
      ],
    });

    expect(said()).toContain('does not list frontdesk');
  });

  it("stops before the plan when an adopted agent's lines cannot be read", async () => {
    // Distinct from an agent with no endpoint: treating a failed read as "no line" would skip
    // the plan and the run over a blip, with nothing said about why.
    const dir = tempDir();

    await run({
      argv: ['get-started', '--dir', dir],
      overrides: { agents: [{ id: 'agent_1', name: 'frontdesk' }], endpointsFail: true },
      answers: [
        '1', // the existing agent
        'curious-caller',
        '',
        '',
        '',
        'You call about a booking.',
        '',
        '',
        '',
        '',
        '', // apply
      ],
    });

    expect(said()).toContain("Could not read frontdesk's lines");
    // Stopping early is a pause, not a dead end: the agent, caller and scenario still apply,
    // so the message has to say how to finish rather than just what went wrong.
    expect(said()).toContain('again to finish');
    expect(readdirSync(dir)).not.toContain('simulation-plans');
  });

  it('asks which line to call when the declared agent has several', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'agents'), { recursive: true });
    writeFileSync(
      join(dir, 'agents/frontdesk.yaml'),
      'kind: agent\nname: frontdesk\nendpoints:\n  - value: "+15550001111"\n    direction: INCOMING\n  - value: "+15550001111"\n    direction: OUTGOING\n',
    );

    await run({
      argv: ['get-started', '--dir', dir, '--no-run'],
      answers: [
        '2', // the outgoing line, not the first one
        'curious-caller',
        '',
        '',
        '',
        'You call about a booking.',
        '',
        '',
        '',
        '',
        '', // plan name
        '', // apply
      ],
    });

    expect(said()).toContain('declares several lines');
    const plan = parse(readFileSync(join(dir, 'simulation-plans/first-run.yaml'), 'utf8')) as Record<
      string,
      unknown
    >;
    // One number, two endpoints: the direction is what tells them apart, and picking the wrong
    // one runs the opposite test.
    expect(plan['agentEndpoints']).toEqual([
      { agent: 'frontdesk', value: '+15550001111', direction: 'OUTGOING' },
    ]);
    expect(plan['direction']).toBe('OUTBOUND');
  });
});

/**
 * A minimal `@roarkanalytics/sdk` in the project, so a config module can actually be loaded.
 *
 * A stub rather than the real package: these tests are about `get-started` writing a module and
 * driving it through diff and apply, and the helpers are thin enough that a real one would only
 * slow the suite down. `src/runtime/get-started/module.test.ts` pins the source they are given,
 * and the generated file was type-checked against the published SDK by hand.
 */
const installStubSdk = (dir: string): void => {
  const root = join(dir, 'node_modules', '@roarkanalytics', 'sdk');
  mkdirSync(join(root, 'lib'), { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: '@roarkanalytics/sdk', version: '5.16.0', exports: { './lib/*': './lib/*.js' } }),
  );
  const define = (kind: string): string =>
    `exports.define${kind[0]!.toUpperCase()}${kind.slice(
      1,
    )} = (resource) => ({ kind: '${kind}', ...resource });`;
  writeFileSync(
    join(root, 'lib', 'config.js'),
    [
      define('agent'),
      define('persona'),
      define('metric'),
      "exports.defineImprovFlow = (resource) => ({ kind: 'flow', type: 'improv', ...resource });",
      define('simulationPlan'),
      'exports.defineConfig = (bundle) => bundle;',
    ].join('\n'),
  );
};

describe('roark get-started --ts', () => {
  it('writes one TypeScript config in the working directory, not a YAML tree', async () => {
    // `roark.config.ts` in the cwd is what `config apply` finds with no argument, which is why
    // --ts defaults there rather than to ./roark.
    const dir = tempDir();

    await run({ argv: ['get-started', '--dir', dir, '--ts', '--scaffold-only'], interactive: false });

    expect(readdirSync(dir)).toEqual(['roark.config.ts']);
    const source = readFileSync(join(dir, 'roark.config.ts'), 'utf8');
    expect(source).toContain("from '@roarkanalytics/sdk/lib/config'");
    expect(source).toContain('export default defineConfig(');
  });

  it('says so when the project cannot import the helpers', async () => {
    // The file is still written: the fix is one `npm install`, and a config that is right but
    // not yet loadable beats no config at all.
    const dir = tempDir();

    await run({ argv: ['get-started', '--dir', dir, '--ts', '--scaffold-only'], interactive: false });

    expect(said()).toContain('does not have');
    expect(readdirSync(dir)).toEqual(['roark.config.ts']);
  });

  it('refuses both formats at once rather than picking one', async () => {
    const dir = tempDir();

    await expect(
      run({ argv: ['get-started', '--dir', dir, '--ts', '--yaml'], interactive: false }),
    ).rejects.toThrow(UsageError);
  });

  it('walks the whole flow and applies the module it wrote', async () => {
    const dir = tempDir();
    installStubSdk(dir);

    const recorded = await run({
      argv: ['get-started', '--dir', dir, '--ts'],
      answers: HAPPY_PATH_ANSWERS,
    });

    expect(readdirSync(dir).sort()).toEqual(['node_modules', 'roark.config.ts']);
    expect(recorded.calls).toContain('config.apply');
    expect(recorded.runBodies).toEqual([{ planId: 'plan_1' }]);
  });

  it('offers the choice only where a config module could actually load', async () => {
    // Asked: the project declares the SDK, so both forms work.
    const withSdk = tempDir();
    installStubSdk(withSdk);
    await run({
      argv: ['get-started', '--dir', withSdk, '--no-run'],
      answers: ['1', ...HAPPY_PATH_ANSWERS],
    });
    expect(said()).toContain('How should the config be written?');

    // Not asked: nothing to import from, so TypeScript is not a real option.
    stderr.mockClear();
    const withoutSdk = tempDir();
    await run({ argv: ['get-started', '--dir', withoutSdk, '--no-run'], answers: HAPPY_PATH_ANSWERS });
    expect(said()).not.toContain('How should the config be written?');
  });

  it('will not half-author a config module somebody already wrote', async () => {
    // One file holds everything, so there is no way to add a resource to it without editing
    // code someone wrote. Asking questions whose answers have nowhere to go is the alternative.
    const dir = tempDir();
    writeFileSync(
      join(dir, 'roark.config.ts'),
      "export default { resources: [{ kind: 'agent', name: 'frontdesk' }] }\n",
    );

    await expect(run({ argv: ['get-started', '--dir', dir, '--ts'], answers: [] })).rejects.toThrow(
      /already exists/,
    );
    // And it stops before asking anything, rather than collecting answers it cannot write.
    expect(said()).not.toContain('What should we call the caller?');
  });

  it('runs an existing config module that is already complete', async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, 'roark.config.ts'),
      [
        'export default {',
        '  resources: [',
        "    { kind: 'agent', name: 'frontdesk' },",
        "    { kind: 'persona', name: 'caller' },",
        "    { kind: 'flow', name: 'first-scenario' },",
        "    { kind: 'simulationPlan', name: 'first-run' },",
        '  ],',
        '}',
      ].join('\n'),
    );

    const recorded = await run({
      argv: ['get-started', '--dir', dir, '--ts'],
      overrides: { emptyDiff: true, plans: [{ id: 'plan_1', name: 'first-run' }] },
      answers: ['' /* yes, start the run */],
    });

    expect(said()).toContain('already declares everything');
    expect(recorded.calls).not.toContain('config.apply');
    expect(recorded.runBodies).toEqual([{ planId: 'plan_1' }]);
  });
});
