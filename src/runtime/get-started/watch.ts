/**
 * Watching the first run finish.
 *
 * A simulated call takes a minute or two, and the one thing someone wants from their first run is
 * the verdict, so the command waits for it rather than printing a job id and leaving. It is a
 * plain poll of `GET /v1/simulation/plan/job/{id}`: no websocket, no spinner, one line per status
 * change so a pipe or a CI log stays readable.
 *
 * Waiting is bounded. Timing out is reported as "still running, here is how to check", never as a
 * failure: the run is perfectly fine, it is this command's patience that ran out.
 */

/** Statuses a run never leaves. Anything else is still in flight. */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'COMPLETED',
  'FAILED',
  'TIMED_OUT',
  'CANCELLED',
]);

/** How many polls in a row may fail before the wait is given up on. */
const ERROR_TOLERANCE = 3;

/** Stands in for a run we never managed to read, so the caller still has something to print. */
const UNREADABLE: JobSnapshot = { status: 'UNKNOWN' };

export interface JobVerdict {
  passed: boolean;
  score?: number | null;
}

export interface JobSnapshot {
  status: string;
  verdict?: JobVerdict | null;
  simulationJobs?: readonly { status: string }[];
}

export interface WatchOptions {
  jobId: string;
  getJob: (jobId: string) => Promise<JobSnapshot>;
  /** Called whenever the rendered progress line changes, so an unchanged status stays quiet. */
  onProgress: (line: string) => void;
  timeoutMs: number;
  pollMs: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/**
 * How the wait ended. `settled` is the run reaching a terminal status; the other two are this
 * command giving up, which is not a failed run and must not be reported as one.
 */
export type WatchOutcome = 'settled' | 'timeout' | 'unreachable';

export interface WatchResult {
  snapshot: JobSnapshot;
  outcome: WatchOutcome;
}

export const progressLine = (snapshot: JobSnapshot): string => {
  const jobs = snapshot.simulationJobs ?? [];
  if (jobs.length === 0) return snapshot.status;
  const done = jobs.filter((job) => TERMINAL_STATUSES.has(job.status)).length;
  return `${snapshot.status}  ${done}/${jobs.length} calls finished`;
};

export const watchJob = async (options: WatchOptions): Promise<WatchResult> => {
  const started = options.now();
  let last: string | undefined;
  let latest: JobSnapshot | undefined;
  let failures = 0;

  for (;;) {
    // A poll that throws must not take the command down with it. The run has already started by
    // the time we are here, so an exception would lose the job id and the "check it later" line
    // over one network blip. A few in a row is a different matter: then we stop waiting and say so.
    let snapshot: JobSnapshot | undefined;
    try {
      snapshot = await options.getJob(options.jobId);
      failures = 0;
    } catch {
      failures += 1;
      if (failures >= ERROR_TOLERANCE) return { snapshot: latest ?? UNREADABLE, outcome: 'unreachable' };
    }

    if (snapshot !== undefined) {
      latest = snapshot;
      const line = progressLine(snapshot);
      if (line !== last) {
        options.onProgress(line);
        last = line;
      }
      if (TERMINAL_STATUSES.has(snapshot.status)) return { snapshot, outcome: 'settled' };
    }

    if (options.now() - started >= options.timeoutMs) {
      return { snapshot: latest ?? UNREADABLE, outcome: 'timeout' };
    }
    await options.sleep(options.pollMs);
  }
};

/**
 * The headline.
 *
 * Two different absences of a verdict, and conflating them is a lie either way. A COMPLETED run
 * with no verdict carried no pass/fail criterion, so there was nothing to judge. A run that ended
 * FAILED, TIMED_OUT or CANCELLED also has no verdict, but there "no pass/fail criteria on this
 * run" would read as reassurance about a run that fell over.
 */
export const verdictLine = (snapshot: JobSnapshot): string => {
  if (snapshot.status !== 'COMPLETED') {
    return `The run ended ${snapshot.status}, so nothing was graded.`;
  }
  const verdict = snapshot.verdict;
  if (verdict === undefined || verdict === null) {
    return 'No pass/fail criteria on this run, so there is no verdict. The metric values are on the run.';
  }
  const score = typeof verdict.score === 'number' ? `, score ${Math.round(verdict.score)}/100` : '';
  return verdict.passed ? `Passed${score}` : `Failed${score}`;
};

/** Green for a pass, red for a failed check or a run that fell over, yellow for nothing judged. */
export const verdictStyle = (snapshot: JobSnapshot): 'green' | 'red' | 'yellow' => {
  if (snapshot.status !== 'COMPLETED') return 'red';
  const passed = snapshot.verdict?.passed;
  if (passed === undefined) return 'yellow';
  return passed ? 'green' : 'red';
};

export const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
