import { parse } from 'yaml';

import {
  DEFAULT_ENVIRONMENT,
  SCHEMA_HEADER,
  directionFor,
  setupFiles,
  slugify,
  titleize,
  type Setup,
} from './resources';

const baseSetup = (): Setup => ({
  agent: {
    name: 'frontdesk',
    endpoints: [{ value: '+15551234567', direction: 'INCOMING' }],
    dial: { value: '+15551234567', direction: 'INCOMING' },
  },
  persona: { name: 'curious-caller', language: 'EN', accent: 'US', gender: 'FEMALE' },
  flow: { name: 'rebooking', goal: 'You call to rebook a cancelled appointment.' },
  metrics: ['agent_responsive'],
  plan: { name: 'first-run', maxDurationSeconds: 300 },
});

const fileNamed = (setup: Setup, path: string) => {
  const file = setupFiles(setup).find((candidate) => candidate.path === path);
  if (!file)
    throw new Error(
      `no file at ${path}; got ${setupFiles(setup)
        .map((f) => f.path)
        .join(', ')}`,
    );
  return { ...file, parsed: parse(file.contents) as Record<string, unknown> };
};

describe('slugify', () => {
  it('produces a name the config DSL accepts', () => {
    expect(slugify('Rebook a cancelled cleaning!')).toBe('rebook-a-cancelled-cleaning');
    expect(slugify('  Dental Clinic  ')).toBe('dental-clinic');
  });

  it('returns empty rather than an invalid name when there is nothing to slug', () => {
    expect(slugify('!!!')).toBe('');
  });
});

describe('titleize', () => {
  it('reads a slug back as a display name', () => {
    expect(titleize('refund_policy_accuracy')).toBe('Refund Policy Accuracy');
  });
});

describe('directionFor', () => {
  // The run direction is derived from the line, not asked: inbound means Roark places the call,
  // which is the only direction that needs nothing but a number.
  it('is outbound only for an outgoing-only line', () => {
    expect(directionFor('OUTGOING')).toBe('OUTBOUND');
    expect(directionFor('INCOMING')).toBe('INBOUND');
    expect(directionFor('INCOMING_AND_OUTGOING')).toBe('INBOUND');
    expect(directionFor(undefined)).toBe('INBOUND');
  });
});

describe('setupFiles', () => {
  it('writes every resource in apply order', () => {
    const setup = baseSetup();
    setup.customMetric = { name: 'booking_confirmed', question: 'did the agent confirm the date?' };

    expect(setupFiles(setup).map((file) => file.path)).toEqual([
      'metrics/booking_confirmed.yaml',
      'personas/curious-caller.yaml',
      'agents/frontdesk.yaml',
      'flows/rebooking.yaml',
      'simulation-plans/first-run.yaml',
    ]);
  });

  it('puts the schema header on every file', () => {
    for (const file of setupFiles(baseSetup())) {
      expect(file.contents.startsWith(SCHEMA_HEADER)).toBe(true);
    }
  });

  it('keeps a phone number a string', () => {
    // E.164 parses as a YAML integer unquoted, and an endpoint value has to stay a string.
    const agent = fileNamed(baseSetup(), 'agents/frontdesk.yaml');
    const endpoints = agent.parsed['endpoints'] as { value: unknown }[];
    expect(typeof endpoints[0]!.value).toBe('string');
    expect(endpoints[0]!.value).toBe('+15551234567');
  });

  it('declares no endpoints for an adopted agent, so Roark keeps the ones it has', () => {
    const setup = baseSetup();
    setup.agent = {
      name: 'dental-clinic',
      displayName: 'Dental Clinic',
      dial: { value: '+15550000000', direction: 'OUTGOING' },
    };

    const agent = fileNamed(setup, 'agents/dental-clinic.yaml');
    expect('endpoints' in agent.parsed).toBe(false);
    expect(agent.parsed['displayName']).toBe('Dental Clinic');
  });

  it('names the line in the plan only when the agent declares more than its own single endpoint', () => {
    const single = fileNamed(baseSetup(), 'simulation-plans/first-run.yaml');
    expect(single.parsed['agentEndpoints']).toEqual([{ agent: 'frontdesk' }]);

    const adopted = baseSetup();
    adopted.agent = { name: 'frontdesk', dial: { value: '+15550000000', direction: 'OUTGOING' } };
    const named = fileNamed(adopted, 'simulation-plans/first-run.yaml');
    expect(named.parsed['agentEndpoints']).toEqual([
      { agent: 'frontdesk', value: '+15550000000', direction: 'OUTGOING' },
    ]);
    expect(named.parsed['direction']).toBe('OUTBOUND');
  });

  it('points the flow at the persona and a system environment', () => {
    const flow = fileNamed(baseSetup(), 'flows/rebooking.yaml');
    expect(flow.parsed['type']).toBe('improv');
    expect(flow.parsed['agents']).toEqual(['frontdesk']);
    expect(flow.parsed['happyPath']).toEqual({
      persona: 'curious-caller',
      environment: DEFAULT_ENVIRONMENT,
      prompt: 'You call to rebook a cancelled appointment.',
    });
    // Optional, and absent rather than null when it was skipped.
    expect('expectations' in flow.parsed).toBe(false);
  });

  it('adds the expectation when one was given', () => {
    const setup = baseSetup();
    setup.flow = { ...setup.flow, expectation: 'Agent offers the next available slot' };
    expect(fileNamed(setup, 'flows/rebooking.yaml').parsed['expectations']).toEqual([
      'Agent offers the next available slot',
    ]);
  });

  it('wraps a custom metric question into a prompt the server accepts', () => {
    const setup = baseSetup();
    setup.customMetric = { name: 'booking_confirmed', question: 'did the agent confirm the date?' };

    const metric = fileNamed(setup, 'metrics/booking_confirmed.yaml');
    // A grading prompt that references neither a transcript source nor the world context is
    // rejected on apply, so the question is wrapped rather than used as written.
    expect(metric.parsed['prompt']).toContain('{{transcript}}');
    expect(metric.parsed['prompt']).toContain('{{world_context}}');
    expect(metric.parsed['prompt']).toContain('did the agent confirm the date?');
    expect(metric.parsed['type']).toBe('BOOLEAN');
    expect(metric.parsed['displayName']).toBe('Booking Confirmed');
  });

  it('writes no plan when there is no line to dial', () => {
    const setup = baseSetup();
    setup.agent = { name: 'frontdesk' };
    delete setup.plan;

    expect(setupFiles(setup).map((file) => file.path)).not.toContain('simulation-plans/first-run.yaml');
  });

  it('keeps the metric list in the plan', () => {
    const setup = baseSetup();
    setup.metrics = ['agent_responsive', 'call_ended_cleanly', 'booking_confirmed'];
    expect(fileNamed(setup, 'simulation-plans/first-run.yaml').parsed['metrics']).toEqual([
      'agent_responsive',
      'call_ended_cleanly',
      'booking_confirmed',
    ]);
  });
});
