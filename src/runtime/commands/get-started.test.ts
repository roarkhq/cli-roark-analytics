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
        return { data: (overrides['agents'] as { id: string; name: string }[]) ?? [] };
      },
    },
    agentEndpoint: {
      list: async () => {
        note('agentEndpoint.list');
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
      list: async () => ({ data: [] }),
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
