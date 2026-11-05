/**
 * Step 7: start the run and watch it to a verdict.
 *
 * Where the interesting failure modes live: a plan id that has to be resolved two ways, a
 * billable action that needs its own confirmation, and a wait that can end three different ways.
 */

import type Roark from '@roarkanalytics/sdk';

import { paint, render, write } from '../output';
import { echoCommand, nextSteps, note, stepDone, stepHeader, stepSkipped } from './ladder';
import { sleep, verdictLine, verdictStyle, watchJob, type JobSnapshot } from './watch';
import type { AgentSetup } from './resources';
import type { ConfigChange, ResolveOutput } from './types';
import type { Prompter } from './prompt';

/** How long to wait for the first run, and how often to ask. A simulated call takes a minute or two. */
const WATCH_TIMEOUT_MS = 6 * 60_000;

const POLL_MS = 5_000;

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
export const startRun = async (phase: RunPhase): Promise<boolean> => {
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
