/**
 * Steps 3 to 5: the caller, the scenario, and what grades the call.
 *
 * One function per step, each taking the same `Steps` context and returning its own slice of the
 * `Setup`. Step 2 is its own module (`agent.ts`) only because it is several times the size of
 * these; it has the same shape.
 */

import type Roark from '@roarkanalytics/sdk';

import { note, stepDone, stepHeader, stepSkipped, echoCommand } from './ladder';
import { ACCENTS, GENDERS, LANGUAGES, nameRules, pickCode } from './answers';
import { namesOfKind } from './existing';
import { metricOptions, type AvailableMetric } from './starter-metrics';
import type { AgentSetup, CustomMetricSetup, FlowSetup, PersonaSetup } from './resources';
import type { Prompter } from './prompt';

/** A plan needs at least one metric, so an empty pick list still has to produce a valid plan. */
const FALLBACK_METRIC = 'agent_responsive';

export interface Steps {
  prompter: Prompter;
  say: (text: string) => void;
  color: boolean;
  binaryName: string;
  /** Resources the config already declares, which is what a step skips itself for. */
  existing: Record<string, unknown>[];
  /** What to call the config when pointing at it. */
  label: string;
}

/** A step's answer, plus whether this run authored it or read it back out of the config. */
export type Authored<T> = T & { authored: boolean };

/** Step 3: who calls the agent. */
export const chooseCaller = async (steps: Steps): Promise<Authored<PersonaSetup>> => {
  const { prompter, say, color, binaryName } = steps;
  const declared = namesOfKind(steps.existing, 'persona')[0];

  if (declared !== undefined) {
    say(stepSkipped(2, `${declared}, already declared in ${steps.label}`, color));
    // The declared file is the source of truth for the rest of its fields; nothing here reads
    // them, because nothing here writes that file again.
    return { name: declared, language: 'EN', accent: 'US', gender: 'FEMALE', authored: false };
  }

  say(stepHeader(2, color));
  const name = await prompter.ask('What should we call the caller?', {
    default: 'curious-caller',
    validate: nameRules('name'),
  });
  const language = await pickCode(prompter, 'What language do they speak?', LANGUAGES, 'EN');
  const accent = await pickCode(prompter, 'With which accent?', ACCENTS, 'US');
  const gender = await prompter.select('Voice?', GENDERS, 'FEMALE');

  say(stepDone(2, `${name} (${language}/${accent}/${gender.toLowerCase()})`, color));
  say(
    echoCommand(
      `${binaryName} simulation persona create --name ${name} --language ${language} --accent ${accent} --gender ${gender}`,
      color,
    ),
  );
  return { name, language, accent, gender, authored: true };
};

/** Step 4: what the call is about. */
export const chooseScenario = async (
  steps: Steps,
  agent: AgentSetup,
  agentIsNew: boolean,
): Promise<Authored<FlowSetup>> => {
  const { prompter, say, color } = steps;
  const declared = namesOfKind(steps.existing, 'flow')[0];

  if (declared !== undefined) {
    say(stepSkipped(3, `${declared}, already declared in ${steps.label}`, color));

    // A flow names the agents it is written for. Reusing one that does not name the agent we
    // just declared produces a plan whose flow targets somebody else, which apply accepts and
    // the run then does something unexpected with.
    const resource = steps.existing.find((entry) => entry['kind'] === 'flow' && entry['name'] === declared);
    const targets = Array.isArray(resource?.['agents']) ? resource['agents'] : [];
    if (agentIsNew && !targets.includes(agent.name)) {
      say(
        note(
          `${declared} does not list ${agent.name} under \`agents\`. Add it, or the run will exercise a scenario written for a different agent.`,
          color,
          'yellow',
        ),
      );
    }
    return { name: declared, goal: '', authored: false };
  }

  say(stepHeader(3, color));
  const goal = await prompter.ask('What is the caller calling about? Say it as you would to them');
  const name = await prompter.ask('Short name for that scenario?', {
    // Not derived from the sentence above: a slug of "You call to rebook a cancelled cleaning"
    // reads as `you-call-to-rebook-a`, which is worse than a plain default.
    default: 'first-scenario',
    validate: nameRules('name'),
  });
  const written = await prompter.ask('What must the agent do for this call to pass? (Enter to skip)', {
    default: '-',
  });

  say(stepDone(3, name, color));
  return { name, goal, ...(written === '-' ? {} : { expectation: written }), authored: true };
};

/** Step 5: how the call is graded. */
export const chooseMetrics = async (
  steps: Steps,
  client: Roark,
  declaredPlan: string | undefined,
): Promise<{ metrics: string[]; customMetric?: CustomMetricSetup }> => {
  const { prompter, say, color } = steps;

  // A plan names the metrics, so when one is already declared there is nothing these answers
  // could attach to: that plan is left alone, and the picks would be collected and then quietly
  // dropped. Not asking is better than asking and ignoring.
  if (declaredPlan !== undefined) {
    say(stepSkipped(4, `${declaredPlan} already names the metrics it grades on`, color));
    return { metrics: [] };
  }

  say(stepHeader(4, color));

  let available: AvailableMetric[] | undefined;
  try {
    const response = await client.metric.listDefinitions({ limit: 500 });
    available = response.data.map((metric) => ({ metricId: metric.metricId, name: metric.name }));
  } catch {
    available = undefined;
  }

  const offered = metricOptions(available);
  if (!offered.verified) {
    say(note("Could not read this project's metrics, so these are Roark's usual ones.", color, 'yellow'));
  }

  const metrics = await prompter.multiSelect(
    'Which metrics should grade the run?',
    offered.choices,
    offered.recommended,
  );

  let customMetric: CustomMetricSetup | undefined;
  if (await prompter.confirm('Add a metric of your own?', false)) {
    const name = await prompter.ask('Short name for it', {
      default: 'my_metric',
      validate: nameRules('slug'),
    });
    const question = await prompter.ask(
      'The yes/no question Roark should judge, e.g. "did the agent confirm the booking date?"',
    );
    customMetric = { name, question };
    metrics.push(name);
  }

  if (metrics.length === 0) {
    metrics.push(FALLBACK_METRIC);
    say(note(`A run needs at least one metric, so ${FALLBACK_METRIC} was kept.`, color, 'yellow'));
  }
  say(stepDone(4, metrics.join(', '), color));

  return { metrics, ...(customMetric === undefined ? {} : { customMetric }) };
};
