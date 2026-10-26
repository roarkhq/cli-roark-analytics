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

export interface WatchResult {
  snapshot: JobSnapshot;
  /** False when the wait was given up on, not when the run failed. */
  settled: boolean;
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

  for (;;) {
    const snapshot = await options.getJob(options.jobId);
    const line = progressLine(snapshot);
    if (line !== last) {
      options.onProgress(line);
      last = line;
    }
    if (TERMINAL_STATUSES.has(snapshot.status)) return { snapshot, settled: true };
    if (options.now() - started >= options.timeoutMs) return { snapshot, settled: false };
    await options.sleep(options.pollMs);
  }
};

/**
 * The headline. A null verdict is not a pass and not a failure: it means the run carried no
 * pass/fail criterion, and saying so is more useful than inventing one.
 */
export const verdictLine = (snapshot: JobSnapshot): string => {
  const verdict = snapshot.verdict;
  if (verdict === undefined || verdict === null) {
    return 'No pass/fail criteria on this run, so there is no verdict. The metric values are on the run.';
  }
  const score = typeof verdict.score === 'number' ? `, score ${Math.round(verdict.score)}/100` : '';
  return verdict.passed ? `Passed${score}` : `Failed${score}`;
};

export const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
