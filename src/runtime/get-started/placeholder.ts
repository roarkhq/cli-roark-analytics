/**
 * What `--scaffold-only` writes: a complete, valid config with nothing invented about you.
 *
 * Every value here is a placeholder someone is expected to replace, which is why the command
 * prints a TODO per file rather than pretending the result is ready to apply.
 */

import { CONFIG_MODULE_FILE } from './module';
import { DEFAULT_MAX_DURATION_SECONDS, type ConfigFormat, type Setup } from './resources';

export const placeholderSetup = (): Setup => ({
  agent: {
    name: 'my-agent',
    endpoints: [{ value: '+15551234567', direction: 'INCOMING' }],
    dial: { value: '+15551234567', direction: 'INCOMING' },
  },
  persona: { name: 'curious-caller', language: 'EN', accent: 'US', gender: 'FEMALE' },
  flow: {
    name: 'first-scenario',
    goal: 'You call to ask a question you need answered before you can book.',
    expectation: 'The agent answers the question and offers to help further',
  },
  metrics: ['agent_responsive', 'call_ended_cleanly', 'scenario_adherence'],
  plan: { name: 'first-run', maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS },
});

export const placeholderTodos = (format: ConfigFormat): string[] => {
  const agent = format === 'ts' ? CONFIG_MODULE_FILE : 'agents/my-agent.yaml';
  const flow = format === 'ts' ? CONFIG_MODULE_FILE : 'flows/first-scenario.yaml';
  return [
    `Replace the endpoint value in ${agent} with the number Roark should call.`,
    `Rewrite the scenario prompt in ${flow} so it describes a real call.`,
  ];
};
