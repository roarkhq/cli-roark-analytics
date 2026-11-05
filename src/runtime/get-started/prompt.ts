/**
 * The questions `get-started` asks.
 *
 * `confirm.ts` covers the only question the rest of the CLI needs ("are you sure?"). A guided
 * setup needs three more shapes - a value, one choice, a set of choices - so they live here
 * instead of growing that file. Same rules as everywhere else: the conversation is written to
 * stderr so stdout stays reserved for the ids a script captures, and it is all line-oriented
 * (no cursor control), so it behaves the same over ssh, in tmux, and in a dumb terminal.
 *
 * `Prompter` is an interface because scripted answers are the only practical way to test a
 * wizard: a real readline needs a TTY, which CI does not have.
 */

import { createInterface } from 'node:readline';

import { UsageError } from '../errors';
import { paint, supportsColor, write } from '../output';

export interface Choice<T extends string> {
  value: T;
  label: string;
  /** A few words on what picking this means; dimmed after the label. */
  hint?: string;
}

export interface AskOptions {
  default?: string;
  /** Returns a message when the answer is unusable, so the same question can be asked again. */
  validate?: (answer: string) => string | undefined;
}

export interface Prompter {
  ask: (question: string, options?: AskOptions) => Promise<string>;
  select: <T extends string>(question: string, choices: readonly Choice<T>[], fallback: T) => Promise<T>;
  /** Returns the chosen values; an empty array is a legitimate answer ("none"). */
  multiSelect: <T extends string>(
    question: string,
    choices: readonly Choice<T>[],
    fallback: readonly T[],
  ) => Promise<T[]>;
  confirm: (question: string, fallback: boolean) => Promise<boolean>;
  close: () => void;
}

/**
 * How many times one question is re-asked before giving up. Looping forever on a pipe that will
 * never answer is how a wizard hangs a CI job; three tries is enough for a typo and no more.
 */
const ATTEMPTS = 3;

const exhausted = (): never => {
  throw new UsageError('No usable answer after three attempts, so nothing was changed.');
};

export const createPrompter = (): Prompter => {
  const out = process.stderr;
  const color = supportsColor(out);
  const rl = createInterface({ input: process.stdin, output: out });

  const line = (text: string): void => write(text, out);
  const question = (text: string): Promise<string> =>
    new Promise<string>((resolve) => rl.question(text, resolve));
  const problem = (text: string): void => line(paint(`  ${text}`, 'yellow', color));
  const asked = (text: string): string => `${paint('?', 'cyan', color)} ${text}`;

  const listChoices = <T extends string>(choices: readonly Choice<T>[], marked: readonly T[]): void => {
    choices.forEach((choice, index) => {
      const mark = marked.includes(choice.value) ? paint('>', 'green', color) : ' ';
      const hint = choice.hint === undefined ? '' : paint(`  ${choice.hint}`, 'dim', color);
      line(`  ${mark} ${index + 1}) ${choice.label}${hint}`);
    });
  };

  const ask = async (text: string, options: AskOptions = {}): Promise<string> => {
    const fallback = options.default;
    const suffix = fallback === undefined ? '' : ` ${paint(`[${fallback}]`, 'dim', color)}`;

    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const raw = (await question(`${asked(text)}${suffix} `)).trim();
      const answer = raw.length > 0 ? raw : fallback ?? '';
      if (answer.length === 0) {
        problem('A value is needed here.');
        continue;
      }
      const invalid = options.validate?.(answer);
      if (invalid !== undefined) {
        problem(invalid);
        continue;
      }
      return answer;
    }
    return exhausted();
  };

  const select = async <T extends string>(
    text: string,
    choices: readonly Choice<T>[],
    fallback: T,
  ): Promise<T> => {
    if (choices.length === 0) throw new UsageError(`nothing to choose from for: ${text}`);
    const fallbackIndex = choices.findIndex((choice) => choice.value === fallback);

    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      line(asked(text));
      listChoices(choices, [fallback]);
      const hint = fallbackIndex < 0 ? '' : paint(`[${fallbackIndex + 1}]`, 'dim', color);
      const raw = (await question(`  ${hint} `)).trim();

      if (raw.length === 0 && fallbackIndex >= 0) return fallback;

      const index = Number(raw);
      if (Number.isInteger(index) && index >= 1 && index <= choices.length) return choices[index - 1]!.value;

      // Typing the answer out is what someone who has run this before will do. Either side counts:
      // the value is what a second run remembers, the label is what is on screen.
      const typed = raw.toLowerCase();
      const named = choices.find(
        (choice) => choice.value.toLowerCase() === typed || choice.label.toLowerCase() === typed,
      );
      if (named) return named.value;

      problem(`Pick a number from 1 to ${choices.length}.`);
    }
    return exhausted();
  };

  const multiSelect = async <T extends string>(
    text: string,
    choices: readonly Choice<T>[],
    fallback: readonly T[],
  ): Promise<T[]> => {
    if (choices.length === 0) return [];

    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      line(asked(text));
      listChoices(choices, fallback);
      line(
        paint('  Numbers, comma separated. Enter keeps the marked ones; "none" picks nothing.', 'dim', color),
      );
      const raw = (await question('  ').then((answer) => answer.trim())).toLowerCase();

      if (raw.length === 0) return [...fallback];
      if (raw === 'none') return [];

      const parts = raw.split(/[\s,]+/).filter((part) => part.length > 0);
      const picked: T[] = [];
      let bad: string | undefined;
      for (const part of parts) {
        const index = Number(part);
        if (!Number.isInteger(index) || index < 1 || index > choices.length) {
          bad = part;
          break;
        }
        const value = choices[index - 1]!.value;
        if (!picked.includes(value)) picked.push(value);
      }
      if (bad === undefined) return picked;

      problem(`"${bad}" is not one of 1 to ${choices.length}.`);
    }
    return exhausted();
  };

  const confirmPrompt = async (text: string, fallback: boolean): Promise<boolean> => {
    const hint = paint(fallback ? '[Y/n]' : '[y/N]', 'dim', color);
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const raw = (await question(`${asked(text)} ${hint} `)).trim();
      if (raw.length === 0) return fallback;
      if (/^y(es)?$/i.test(raw)) return true;
      if (/^no?$/i.test(raw)) return false;
      problem('Answer y or n.');
    }
    return exhausted();
  };

  return { ask, select, multiSelect, confirm: confirmPrompt, close: () => rl.close() };
};
