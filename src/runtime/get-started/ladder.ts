/**
 * How the flow narrates itself.
 *
 * Seven steps, each announced before it is asked about and summarised once it is done, so the
 * terminal reads as a list someone is working down rather than a wall of questions. Printed, not
 * redrawn: no cursor control means the scrollback is still readable afterwards, and a copied
 * terminal still makes sense in a bug report.
 *
 * Pure string builders, so the wording is tested without a terminal.
 */

import { paint, type Style } from '../output';

export interface LadderStep {
  title: string;
  /** One line on why this step exists, which is the part a newcomer is missing. */
  why: string;
}

/**
 * The order is the dependency order the server applies in (metric, persona, agent, flow, plan),
 * so what the flow teaches is also how config as code actually works.
 */
export const STEPS: readonly LadderStep[] = [
  { title: 'Account', why: 'who you are, and the project this lands in' },
  { title: 'Agent', why: 'the voice agent being tested, and how Roark reaches it' },
  { title: 'Caller', why: 'the persona that calls it: language, accent, voice' },
  { title: 'Scenario', why: 'what the caller is calling about' },
  { title: 'Metrics', why: 'how the call gets graded' },
  { title: 'Plan', why: 'the saved, repeatable run' },
  { title: 'Run', why: 'place the call, then read the verdict' },
];

const label = (index: number): string => `${index + 1}/${STEPS.length}`;

export const intro = (binaryName: string, target: string, format: 'yaml' | 'ts', color: boolean): string =>
  [
    '',
    paint(`${binaryName}: let's get your first graded simulation running.`, 'bold', color),
    paint(
      `${STEPS.length} steps. Everything is written to ${target} as ${
        format === 'ts' ? 'TypeScript' : 'YAML'
      } you own and can commit.`,
      'dim',
      color,
    ),
    '',
  ].join('\n');

export const stepHeader = (index: number, color: boolean): string => {
  const step = STEPS[index]!;
  return [
    '',
    `${paint(label(index), 'cyan', color)} ${paint(step.title, 'bold', color)}`,
    paint(`    ${step.why}`, 'dim', color),
    '',
  ].join('\n');
};

export const stepDone = (index: number, summary: string, color: boolean): string => {
  const step = STEPS[index]!;
  return `${paint('✓', 'green', color)} ${paint(label(index), 'dim', color)} ${step.title}: ${summary}`;
};

export const stepSkipped = (index: number, summary: string, color: boolean): string => {
  const step = STEPS[index]!;
  return `${paint('·', 'yellow', color)} ${paint(label(index), 'dim', color)} ${step.title}: ${summary}`;
};

/** The command a step is shorthand for, so the wizard teaches the CLI instead of hiding it. */
export const echoCommand = (command: string, color: boolean): string =>
  paint(`    same as: ${command}`, 'dim', color);

export const note = (text: string, color: boolean, style: Style = 'dim'): string =>
  paint(`    ${text}`, style, color);

export interface NextSteps {
  binaryName: string;
  /** What to call the config when pointing at it: a directory, or a file. */
  dir: string;
  /** The apply command for this config, spelled the way a person would type it. */
  apply: string;
  lines: readonly string[];
}

export const nextSteps = ({ dir, apply, lines }: NextSteps, color: boolean): string =>
  [
    '',
    paint('What next:', 'bold', color),
    ...lines.map((line) => `  ${line}`),
    `  ${paint(`git add ${dir}`, 'cyan', color)}  keep it in git; CI can run the same two commands`,
    `  ${paint(apply, 'cyan', color)}  redeploy after you edit the config`,
    '',
  ].join('\n');
