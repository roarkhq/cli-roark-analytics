import { PassThrough } from 'node:stream';

import { UsageError } from '../errors';
import { createPrompter, type Prompter } from './prompt';

let savedStdin: PropertyDescriptor | undefined;
let stderr: jest.SpyInstance;

/** Answers still to be given, and the stream they are written to. */
let pending: string[] = [];
let stdin: PassThrough | undefined;

/**
 * Feed one answer per prompt, rather than writing them all up front.
 *
 * readline drops a line that arrives with no pending `question`, so a single write of every
 * answer only ever satisfies the first one - and every re-ask case would hang. A prompt is the
 * one thing written to stderr WITHOUT a trailing newline (`output.ts#write` always adds one), so
 * that is the signal that something is waiting for a line.
 */
const feed = (chunk: unknown): void => {
  if (String(chunk).endsWith('\n')) return;
  const answer = pending.shift();
  if (answer === undefined) return;
  setImmediate(() => stdin?.write(`${answer}\n`));
};

beforeEach(() => {
  savedStdin = Object.getOwnPropertyDescriptor(process, 'stdin');
  pending = [];
  stdin = undefined;
  stderr = jest.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    feed(chunk);
    return true;
  });
});

afterEach(() => {
  if (savedStdin) Object.defineProperty(process, 'stdin', savedStdin);
  stderr.mockRestore();
});

/** A prompter that answers each question it asks, in order. */
const answering = (...answers: string[]): Prompter => {
  stdin = new PassThrough();
  pending = [...answers];
  Object.defineProperty(process, 'stdin', { value: stdin, configurable: true });
  return createPrompter();
};

const printed = (): string => stderr.mock.calls.map((call) => String(call[0])).join('');

const CHOICES = [
  { value: 'phone', label: 'A phone number' },
  { value: 'later', label: 'Not yet' },
] as const;

describe('ask', () => {
  it('takes what was typed', async () => {
    const prompter = answering('frontdesk');
    await expect(prompter.ask('Name?')).resolves.toBe('frontdesk');
    prompter.close();
  });

  it('takes the default on an empty line, and shows it', async () => {
    const prompter = answering('');
    await expect(prompter.ask('Name?', { default: 'my-agent' })).resolves.toBe('my-agent');
    expect(printed()).toContain('[my-agent]');
    prompter.close();
  });

  it('re-asks with the reason when the answer is rejected', async () => {
    const prompter = answering('Not A Slug', 'a-slug');
    const validate = (answer: string) => (/^[a-z-]+$/.test(answer) ? undefined : 'Lowercase only.');

    await expect(prompter.ask('Name?', { validate })).resolves.toBe('a-slug');
    expect(printed()).toContain('Lowercase only.');
    prompter.close();
  });

  it('gives up rather than looping forever on input that never satisfies it', async () => {
    // A wizard that loops on a pipe which will never answer is how a CI job hangs.
    const prompter = answering('no', 'no', 'no', 'no');
    await expect(prompter.ask('Name?', { validate: () => 'never' })).rejects.toThrow(UsageError);
    prompter.close();
  });
});

describe('select', () => {
  it('takes a number', async () => {
    const prompter = answering('2');
    await expect(prompter.select('Reachable?', CHOICES, 'phone')).resolves.toBe('later');
    prompter.close();
  });

  it('takes the marked default on an empty line', async () => {
    const prompter = answering('');
    await expect(prompter.select('Reachable?', CHOICES, 'later')).resolves.toBe('later');
    prompter.close();
  });

  it('takes the value itself, which is what a second run types', async () => {
    const prompter = answering('PHONE');
    await expect(prompter.select('Reachable?', CHOICES, 'later')).resolves.toBe('phone');
    prompter.close();
  });

  it('takes the label, which is what is on screen', async () => {
    // The agent picker labels its choices with agent names and values with ids, so the label is
    // the only thing a person could reasonably type.
    const prompter = answering('a phone number');
    await expect(prompter.select('Reachable?', CHOICES, 'later')).resolves.toBe('phone');
    prompter.close();
  });

  it('re-asks on a number outside the list', async () => {
    const prompter = answering('9', '1');
    await expect(prompter.select('Reachable?', CHOICES, 'later')).resolves.toBe('phone');
    expect(printed()).toContain('Pick a number from 1 to 2.');
    prompter.close();
  });
});

describe('multiSelect', () => {
  it('takes a comma separated list, in any spacing', async () => {
    const prompter = answering('1, 2');
    await expect(prompter.multiSelect('Metrics?', CHOICES, [])).resolves.toEqual(['phone', 'later']);
    prompter.close();
  });

  it('keeps the marked set on an empty line', async () => {
    const prompter = answering('');
    await expect(prompter.multiSelect('Metrics?', CHOICES, ['later'])).resolves.toEqual(['later']);
    prompter.close();
  });

  it('takes none as an answer', async () => {
    const prompter = answering('none');
    await expect(prompter.multiSelect('Metrics?', CHOICES, ['later'])).resolves.toEqual([]);
    prompter.close();
  });

  it('does not return the same choice twice', async () => {
    const prompter = answering('1 1 2');
    await expect(prompter.multiSelect('Metrics?', CHOICES, [])).resolves.toEqual(['phone', 'later']);
    prompter.close();
  });

  it('rejects the whole answer when one entry is out of range', async () => {
    // Half-applying a list would silently drop a choice the user made.
    const prompter = answering('1,9', '2');
    await expect(prompter.multiSelect('Metrics?', CHOICES, [])).resolves.toEqual(['later']);
    expect(printed()).toContain('"9" is not one of 1 to 2.');
    prompter.close();
  });

  it('returns nothing when there is nothing to offer, without asking', async () => {
    const prompter = answering();
    await expect(prompter.multiSelect('Metrics?', [], [])).resolves.toEqual([]);
    prompter.close();
  });
});

describe('confirm', () => {
  it('reads yes and no in their short forms', async () => {
    const yes = answering('y');
    await expect(yes.confirm('Apply?', false)).resolves.toBe(true);
    yes.close();

    const no = answering('n');
    await expect(no.confirm('Apply?', true)).resolves.toBe(false);
    no.close();
  });

  it('takes the default on an empty line, and shows which way it goes', async () => {
    const prompter = answering('');
    await expect(prompter.confirm('Apply?', true)).resolves.toBe(true);
    expect(printed()).toContain('[Y/n]');
    prompter.close();
  });

  it('re-asks on anything else', async () => {
    const prompter = answering('maybe', 'y');
    await expect(prompter.confirm('Apply?', false)).resolves.toBe(true);
    expect(printed()).toContain('Answer y or n.');
    prompter.close();
  });
});
