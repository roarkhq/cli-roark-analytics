/**
 * Which metrics a first run is graded by.
 *
 * Roark ships system metrics that work on any agent with no setup, so the opening question is a
 * pick list rather than an essay. The list below is curated: these are the ones that say something
 * useful about a call nobody has configured anything for yet.
 *
 * The project's real metrics are fetched and the curated list is intersected with them, so a slug
 * that would be rejected on apply is never offered. If that intersection comes back thin (an older
 * stage, a trimmed project), the project's own metrics are offered instead of a list of names that
 * do not exist there.
 */

import type { Choice } from './prompt';

export interface StarterMetric {
  slug: string;
  label: string;
  hint: string;
  /** Pre-marked, so pressing Enter gives a run that is actually graded. */
  recommended: boolean;
}

export const STARTER_METRICS: readonly StarterMetric[] = [
  {
    slug: 'agent_responsive',
    label: 'Agent responsive',
    hint: 'did the agent hold up its end of the call',
    recommended: true,
  },
  {
    slug: 'call_ended_cleanly',
    label: 'Call ended cleanly',
    hint: 'closed deliberately, not in dead air or an error',
    recommended: true,
  },
  {
    slug: 'scenario_adherence',
    label: 'Flow adherence',
    hint: 'how closely the call followed the scenario',
    recommended: true,
  },
  {
    slug: 'call_outcome',
    label: 'Call outcome',
    hint: 'what the call actually achieved',
    recommended: false,
  },
  {
    slug: 'instruction_follow',
    label: 'Instruction following',
    hint: 'did the agent do what it was told',
    recommended: false,
  },
  {
    slug: 'frustration_score',
    label: 'Caller frustration',
    hint: 'how frustrated the caller got',
    recommended: false,
  },
  { slug: 'sentiment_score', label: 'Sentiment', hint: 'the tone of the conversation', recommended: false },
  {
    slug: 'response_time',
    label: 'Response time',
    hint: 'how long the agent took to answer',
    recommended: false,
  },
];

/** Below this many curated matches, the project's own metrics are better than a curated guess. */
const MIN_CURATED_MATCHES = 2;

/** How many of the project's metrics to offer when falling back. A pick list has to stay readable. */
const FALLBACK_LIMIT = 6;

export interface AvailableMetric {
  metricId?: string | null;
  name?: string | null;
}

export interface MetricOptions {
  choices: Choice<string>[];
  /** Pre-marked slugs. Always at least one when there is anything to offer. */
  recommended: string[];
  /** False when the list could not be checked against the project, so it may contain a slug it lacks. */
  verified: boolean;
}

const toChoice = (metric: StarterMetric): Choice<string> => ({
  value: metric.slug,
  label: metric.label,
  hint: metric.hint,
});

export const metricOptions = (available: readonly AvailableMetric[] | undefined): MetricOptions => {
  // The list could not be read (offline, or the credential lacks metric:read). Offer the curated
  // set unverified rather than nothing: apply will reject a slug the project lacks, clearly.
  if (available === undefined) {
    return {
      choices: STARTER_METRICS.map(toChoice),
      recommended: STARTER_METRICS.filter((metric) => metric.recommended).map((metric) => metric.slug),
      verified: false,
    };
  }

  const slugs = new Set(
    available.map((metric) => metric.metricId).filter((slug): slug is string => typeof slug === 'string'),
  );
  const curated = STARTER_METRICS.filter((metric) => slugs.has(metric.slug));

  if (curated.length >= MIN_CURATED_MATCHES) {
    const recommended = curated.filter((metric) => metric.recommended).map((metric) => metric.slug);
    return {
      choices: curated.map(toChoice),
      // Never empty: a plan needs at least one metric, and Enter has to produce a valid plan.
      recommended: recommended.length > 0 ? recommended : [curated[0]!.slug],
      verified: true,
    };
  }

  const fallback = available
    .filter(
      (metric): metric is { metricId: string; name?: string | null } => typeof metric.metricId === 'string',
    )
    .slice(0, FALLBACK_LIMIT);

  return {
    choices: fallback.map((metric) => ({
      value: metric.metricId,
      label: typeof metric.name === 'string' && metric.name.length > 0 ? metric.name : metric.metricId,
      hint: metric.metricId,
    })),
    recommended: fallback.slice(0, MIN_CURATED_MATCHES).map((metric) => metric.metricId),
    verified: true,
  };
};
