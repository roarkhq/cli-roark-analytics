/**
 * The config-as-code files `get-started` writes.
 *
 * The wizard's output is a config directory, not a sequence of create calls. That is deliberate:
 * the YAML is the thing we want someone to own and commit, `config apply` is idempotent so a
 * second run is safe, and the whole flow then rides on one endpoint pair instead of six resource
 * APIs. The wizard is disposable; the files are not.
 *
 * Everything here is pure - answers in, file contents out - so the shape of what we write is
 * tested without a terminal or a network.
 */

import { stringify } from 'yaml';

/** Editor autocomplete and validation for anyone who opens these files afterwards. */
export const SCHEMA_HEADER = '# yaml-language-server: $schema=https://roark.ai/roark-config.schema.json';

/**
 * A Roark-managed environment that exists in every project, so a first run needs no environment
 * of its own. Flows reference an environment by its display name.
 */
export const DEFAULT_ENVIRONMENT = 'Quiet line';

/** How long a simulated call may run before Roark ends it. */
export const DEFAULT_MAX_DURATION_SECONDS = 300;

/** The config DSL's local key: lowercase, and the same regex the server validates. */
export const NAME_PATTERN = /^[a-z0-9][a-z0-9-_.]*$/;

/** E.164, which is what a PHONE endpoint's value has to be. */
export const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/;

export type EndpointDirection = 'INCOMING' | 'OUTGOING' | 'INCOMING_AND_OUTGOING';

export interface EndpointSetup {
  value: string;
  direction: EndpointDirection;
}

export interface AgentSetup {
  name: string;
  /** The agent's name in Roark when it is not slug-shaped. Set when adopting an existing agent. */
  displayName?: string;
  /**
   * Endpoints to declare. Left out when adopting an agent whose endpoints Roark already holds:
   * an absent `endpoints` key leaves them untouched, where an empty list would detach every one.
   */
  endpoints?: readonly EndpointSetup[];
  /** The line the run dials. Absent when the agent has nothing reachable yet. */
  dial?: EndpointSetup | { direction: EndpointDirection };
}

export interface PersonaSetup {
  name: string;
  language: string;
  accent: string;
  gender: string;
}

export interface FlowSetup {
  name: string;
  /** What the caller is calling about, in their own terms. */
  goal: string;
  /** One thing the agent has to do for the call to count as a pass. */
  expectation?: string;
}

export interface CustomMetricSetup {
  name: string;
  /** A yes/no question about the call, which becomes the grading prompt. */
  question: string;
}

export interface PlanSetup {
  name: string;
  maxDurationSeconds: number;
}

export interface Setup {
  agent: AgentSetup;
  persona: PersonaSetup;
  flow: FlowSetup;
  /** Metric slugs the run is graded by: Roark's own, plus the custom one when there is one. */
  metrics: readonly string[];
  customMetric?: CustomMetricSetup;
  /** Absent when there is no endpoint to dial, so there is nothing a plan could run against. */
  plan?: PlanSetup;
}

export interface ScaffoldFile {
  /** Relative to the config directory, always posix-style. */
  path: string;
  contents: string;
}

/** Best-effort config name from free text, so a name can be suggested rather than demanded. */
export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

/** `refund_policy_accuracy` -> `Refund Policy Accuracy`, for a readable display name. */
export const titleize = (name: string): string =>
  name
    .split(/[-_.]+/)
    .filter((word) => word.length > 0)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');

/** A run is outbound only when the line it dials is outgoing-only; everything else is inbound. */
export const directionFor = (endpointDirection: EndpointDirection | undefined): 'INBOUND' | 'OUTBOUND' =>
  endpointDirection === 'OUTGOING' ? 'OUTBOUND' : 'INBOUND';

const document = (notes: readonly string[], resource: Record<string, unknown>): string =>
  [
    SCHEMA_HEADER,
    ...notes.map((note) => `# ${note}`),
    '',
    // No line wrapping: a folded prompt is valid YAML but miserable to edit.
    stringify(resource, { lineWidth: 0 }),
  ].join('\n');

/** Which serialization the config is written in. The resources are the same either way. */
export type ConfigFormat = 'yaml' | 'ts';

export interface ResourceEntry {
  /** The config `kind`, which the TypeScript helpers supply themselves. */
  kind: string;
  /** Where the YAML form puts it, relative to the config directory. */
  path: string;
  resource: Record<string, unknown>;
  /** Comments to write above it. A few differ by format, because the escape hatches do. */
  notes: string[];
}

const agentEntry = (agent: AgentSetup, format: ConfigFormat): ResourceEntry => ({
  kind: 'agent',
  path: `agents/${agent.name}.yaml`,
  notes: [
    'The agent under test. Roark does not run it; this is how Roark reaches it.',
    ...(agent.endpoints === undefined ?
      ['Its endpoints live in Roark already, so they are not declared here.']
    : format === 'ts' ?
      ["Add `prompt: readFileSync('./prompts/<name>.md', 'utf8')` to keep its system prompt here too."]
    : ['Add `prompt: file://prompts/<name>.md` to keep its system prompt in git too.']),
  ],
  resource: {
    kind: 'agent',
    name: agent.name,
    ...(agent.displayName === undefined ? {} : { displayName: agent.displayName }),
    ...(agent.endpoints === undefined ?
      {}
    : {
        endpoints: agent.endpoints.map((endpoint) => ({
          value: endpoint.value,
          direction: endpoint.direction,
        })),
      }),
  },
});

const personaEntry = (persona: PersonaSetup): ResourceEntry => ({
  kind: 'persona',
  path: `personas/${persona.name}.yaml`,
  notes: [
    'The simulated caller. Everything else about them has a sensible default:',
    'baseEmotion, speechPace, backgroundNoise, interruption and more.',
  ],
  resource: {
    kind: 'persona',
    name: persona.name,
    language: persona.language,
    accent: persona.accent,
    gender: persona.gender,
  },
});

const flowEntry = (flow: FlowSetup, agentName: string, personaName: string): ResourceEntry => ({
  kind: 'flow',
  path: `flows/${flow.name}.yaml`,
  notes: [
    'What the call is about. `improv` means the caller is given a goal and talks freely;',
    'a scripted flow is the other kind, for an exact turn-by-turn script.',
    'Add `edgeCases` to test the same call going wrong in a specific way.',
  ],
  resource: {
    kind: 'flow',
    type: 'improv',
    name: flow.name,
    agents: [agentName],
    happyPath: {
      persona: personaName,
      environment: DEFAULT_ENVIRONMENT,
      prompt: flow.goal,
    },
    ...(flow.expectation === undefined ? {} : { expectations: [flow.expectation] }),
  },
});

const metricEntry = (metric: CustomMetricSetup): ResourceEntry => ({
  kind: 'metric',
  path: `metrics/${metric.name}.yaml`,
  notes: [
    'A custom metric, graded by an LLM against the transcript.',
    '`name` is the slug a plan references. `type` and `name` are fixed once created.',
  ],
  resource: {
    kind: 'metric',
    name: metric.name,
    displayName: titleize(metric.name).slice(0, 100),
    type: 'BOOLEAN',
    // The grading prompt has to reference a transcript source and the world context, so the
    // question is wrapped rather than used raw: a prompt that names neither is rejected.
    prompt: `Using {{transcript}} and {{world_context}}, ${metric.question}`,
    trueLabel: 'Yes',
    falseLabel: 'No',
  },
});

const planEntry = (setup: Setup, plan: PlanSetup): ResourceEntry => {
  const dial = setup.agent.dial;
  // The line is named only when it could be ambiguous. An agent whose config declares exactly one
  // endpoint has nothing to disambiguate, and naming it there would mean the same number lived in
  // two places that could drift apart. An adopted agent is the other case: Roark may hold several
  // endpoints for it, and apply refuses to guess rather than dial the wrong one.
  const declaresOneEndpoint = setup.agent.endpoints?.length === 1;
  const value = !declaresOneEndpoint && dial !== undefined && 'value' in dial ? dial.value : undefined;

  return {
    kind: 'simulationPlan',
    path: `simulation-plans/${plan.name}.yaml`,
    notes: [
      'The saved run: which line to call, which flows to run, and what grades them.',
      'Applying this declares the plan. Starting a run is a separate, deliberate step.',
      'Add `schedule` to run it on a cadence, or `iterations` to run each case more than once.',
    ],
    resource: {
      kind: 'simulationPlan',
      name: plan.name,
      direction: directionFor(dial?.direction),
      agentEndpoints: [
        {
          agent: setup.agent.name,
          ...(value === undefined ? {} : { value, direction: dial?.direction }),
        },
      ],
      metrics: [...setup.metrics],
      flows: [{ flow: setup.flow.name }],
      maxDurationSeconds: plan.maxDurationSeconds,
    },
  };
};

/**
 * Every resource this setup implies, in apply order (which is also a sensible reading order).
 *
 * Shared by both serializations, so the YAML and the TypeScript forms cannot describe different
 * projects: they are the same objects, written two ways.
 */
export const resourcesFor = (setup: Setup, format: ConfigFormat = 'yaml'): ResourceEntry[] => [
  ...(setup.customMetric === undefined ? [] : [metricEntry(setup.customMetric)]),
  personaEntry(setup.persona),
  agentEntry(setup.agent, format),
  flowEntry(setup.flow, setup.agent.name, setup.persona.name),
  ...(setup.plan === undefined ? [] : [planEntry(setup, setup.plan)]),
];

/** The YAML form: one file per resource, under the config directory. */
export const setupFiles = (setup: Setup): ScaffoldFile[] =>
  resourcesFor(setup, 'yaml').map((entry) => ({
    path: entry.path,
    contents: document(entry.notes, entry.resource),
  }));
