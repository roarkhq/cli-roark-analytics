import {
  TERMINAL_STATUSES,
  progressLine,
  verdictLine,
  verdictStyle,
  watchJob,
  type JobSnapshot,
} from './watch';

/** A snapshot that throws instead of answering, for the transient-failure cases. */
const BLIP = 'blip' as const;

const watcher = (snapshots: (JobSnapshot | typeof BLIP)[], timeoutMs = 60_000) => {
  const progress: string[] = [];
  let clock = 0;
  let index = 0;
  return {
    progress,
    run: () =>
      watchJob({
        jobId: 'job_1',
        getJob: async () => {
          const next = snapshots[Math.min(index++, snapshots.length - 1)]!;
          if (next === BLIP) throw new Error('socket hang up');
          return next;
        },
        onProgress: (line) => progress.push(line),
        timeoutMs,
        pollMs: 5_000,
        // Time only moves when the watcher waits, so the test never actually sleeps.
        sleep: async (ms) => {
          clock += ms;
        },
        now: () => clock,
      }),
  };
};

describe('progressLine', () => {
  it('counts the calls that have finished', () => {
    expect(
      progressLine({
        status: 'RUNNING_SIMULATIONS',
        simulationJobs: [{ status: 'COMPLETED' }, { status: 'RUNNING_SIMULATIONS' }],
      }),
    ).toBe('RUNNING_SIMULATIONS  1/2 calls finished');
  });

  it('is just the status before there are calls to count', () => {
    expect(progressLine({ status: 'PENDING' })).toBe('PENDING');
  });
});

describe('watchJob', () => {
  it('returns as soon as the run settles', async () => {
    const { run, progress } = watcher([
      { status: 'PENDING' },
      { status: 'RUNNING_SIMULATIONS' },
      { status: 'COMPLETED', verdict: { passed: true, score: 92 } },
    ]);

    const result = await run();

    expect(result.outcome).toBe('settled');
    expect(result.snapshot.status).toBe('COMPLETED');
    expect(progress).toEqual(['PENDING', 'RUNNING_SIMULATIONS', 'COMPLETED']);
  });

  it('reports an unchanged status once, not once per poll', async () => {
    const { run, progress } = watcher([
      { status: 'RUNNING_SIMULATIONS' },
      { status: 'RUNNING_SIMULATIONS' },
      { status: 'RUNNING_SIMULATIONS' },
      { status: 'COMPLETED' },
    ]);

    await run();

    expect(progress).toEqual(['RUNNING_SIMULATIONS', 'COMPLETED']);
  });

  it('gives up without calling the run a failure', async () => {
    // Running out of patience is this command's limit, not the run's: the run is fine and will
    // finish on its own, which is why `settled` is separate from the status.
    const { run } = watcher([{ status: 'RUNNING_SIMULATIONS' }], 10_000);

    const result = await run();

    expect(result.outcome).toBe('timeout');
    expect(result.snapshot.status).toBe('RUNNING_SIMULATIONS');
  });

  it('treats every terminal status as settled', async () => {
    for (const status of TERMINAL_STATUSES) {
      const { run } = watcher([{ status }]);
      await expect(run()).resolves.toMatchObject({ outcome: 'settled' });
    }
  });

  it('rides out a transient poll failure', async () => {
    // The run has already started by the time we are polling, so throwing here would lose the
    // job id and the "check it later" line over one network blip.
    const { run } = watcher([{ status: 'PENDING' }, BLIP, { status: 'COMPLETED' }]);

    await expect(run()).resolves.toMatchObject({ outcome: 'settled' });
  });

  it('gives up as unreachable after several failures in a row, and keeps the last snapshot', async () => {
    const { run } = watcher([{ status: 'RUNNING_SIMULATIONS' }, BLIP, BLIP, BLIP]);

    const result = await run();

    expect(result.outcome).toBe('unreachable');
    expect(result.snapshot.status).toBe('RUNNING_SIMULATIONS');
  });

  it('reports an unknown status rather than throwing when the very first poll never lands', async () => {
    const { run } = watcher([BLIP]);

    await expect(run()).resolves.toEqual({ outcome: 'unreachable', snapshot: { status: 'UNKNOWN' } });
  });
});

describe('verdictLine', () => {
  it('reads the pass and the score', () => {
    expect(verdictLine({ status: 'COMPLETED', verdict: { passed: true, score: 91.6 } })).toBe(
      'Passed, score 92/100',
    );
    expect(verdictLine({ status: 'COMPLETED', verdict: { passed: false, score: 40 } })).toBe(
      'Failed, score 40/100',
    );
  });

  it('says there is no verdict rather than calling an unjudged run a pass', () => {
    // An absent verdict means nothing was judged. Reporting it as a pass is the one thing this
    // line must never do.
    expect(verdictLine({ status: 'COMPLETED', verdict: null })).toContain('no verdict');
    expect(verdictLine({ status: 'COMPLETED' })).toContain('no verdict');
  });

  it('does not read a run that fell over as "nothing to judge"', () => {
    // FAILED, TIMED_OUT and CANCELLED also carry no verdict, but "no pass/fail criteria on this
    // run" there would be reassurance about a run that never produced a result.
    for (const status of ['FAILED', 'TIMED_OUT', 'CANCELLED']) {
      const line = verdictLine({ status, verdict: null });
      expect(line).toContain(status);
      expect(line).not.toContain('no verdict');
    }
  });

  it('omits the score when nothing was scored', () => {
    expect(verdictLine({ status: 'COMPLETED', verdict: { passed: true, score: null } })).toBe('Passed');
  });
});

describe('verdictStyle', () => {
  it('is red for a failed check and for a run that fell over, never yellow', () => {
    expect(verdictStyle({ status: 'COMPLETED', verdict: { passed: true } })).toBe('green');
    expect(verdictStyle({ status: 'COMPLETED', verdict: { passed: false } })).toBe('red');
    expect(verdictStyle({ status: 'FAILED', verdict: null })).toBe('red');
    expect(verdictStyle({ status: 'TIMED_OUT' })).toBe('red');
    // Nothing judged, which is neither good news nor bad.
    expect(verdictStyle({ status: 'COMPLETED', verdict: null })).toBe('yellow');
  });
});
