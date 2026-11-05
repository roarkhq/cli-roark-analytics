/**
 * What an answer is allowed to be, and the choices offered for the ones that are codes.
 *
 * The validators exist so a bad answer is caught at the prompt, where it can simply be asked
 * again, rather than at apply time with the whole config already written.
 */

import { NAME_PATTERN, PHONE_PATTERN, slugify } from './resources';
import type { Choice, Prompter } from './prompt';

export const nameRules = (what: string) => (answer: string) =>
  NAME_PATTERN.test(answer) ? undefined : (
    `A ${what} is lowercase letters, numbers, - _ . (e.g. ${slugify(`my ${what}`) || 'my-name'}).`
  );

export const phoneRules = (answer: string): string | undefined =>
  PHONE_PATTERN.test(answer) ? undefined : 'Use E.164: a + and the country code, e.g. +15551234567.';

export const enumRules = (answer: string): string | undefined =>
  /^[A-Z][A-Z_]*$/.test(answer) ? undefined : 'Use the upper-case code, e.g. EN or US_X_SOUTH.';

export const LANGUAGES: readonly Choice<string>[] = [
  { value: 'EN', label: 'English' },
  { value: 'ES', label: 'Spanish' },
  { value: 'FR', label: 'French' },
  { value: 'DE', label: 'German' },
  { value: 'other', label: 'Something else', hint: 'type the code, e.g. HI, NL, PT' },
];

export const ACCENTS: readonly Choice<string>[] = [
  { value: 'US', label: 'US' },
  { value: 'GB', label: 'British' },
  { value: 'IN', label: 'Indian' },
  { value: 'AU', label: 'Australian' },
  { value: 'other', label: 'Something else', hint: 'type the code, e.g. ES, DE, PH' },
];

export const GENDERS: readonly Choice<string>[] = [
  { value: 'FEMALE', label: 'Female' },
  { value: 'MALE', label: 'Male' },
];

/** `other` defers to a typed code rather than listing every value the DSL accepts. */
export const pickCode = async (
  prompter: Prompter,
  question: string,
  choices: readonly Choice<string>[],
  fallback: string,
): Promise<string> => {
  const picked = await prompter.select(question, choices, fallback);
  if (picked !== 'other') return picked;
  return (await prompter.ask('Which code?', { validate: enumRules })).toUpperCase();
};
