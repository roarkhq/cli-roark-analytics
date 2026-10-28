/**
 * Step 2: which agent is under test, and how Roark reaches it.
 *
 * The longest step, because it has the most ways to be right: adopt one that already exists in
 * Roark (and do not create a duplicate of it), declare a new one with a line to call, or declare
 * one with nothing reachable yet and come back later.
 */

import type Roark from '@roarkanalytics/sdk';

import { echoCommand, note } from './ladder';
import { nameRules, phoneRules } from './answers';
import { slugify, type AgentSetup, type EndpointDirection } from './resources';
import type { Choice, Prompter } from './prompt';

/** How many of the project's own agents to offer. A pick list has to stay readable. */
const AGENT_PAGE = 10;

/** One agent's lines. More than this is not a picker, and no agent under test has that many. */
const ENDPOINT_PAGE = 50;

interface AgentChoice {
  id: string;
  name: string;
}

interface AgentList {
  agents: AgentChoice[];
  /** The project has more than one page of them, so the picker is not the whole truth. */
  truncated: boolean;
}

/** The project's existing agents, or undefined when they could not be read. */
const listAgents = async (client: Roark): Promise<AgentList | undefined> => {
  try {
    const response = await client.agent.list({ limit: AGENT_PAGE });
    return {
      agents: response.data.map((agent) => ({ id: agent.id, name: agent.name })),
      // Not paged through. A picker with fifty entries is not a picker, so the honest move is
      // to say the list is partial rather than to make it longer or to pretend it is complete.
      truncated: response.pagination?.hasMore === true,
    };
  } catch {
    return undefined;
  }
};

interface EndpointChoice {
  value: string;
  direction: EndpointDirection;
}

/** The agent's lines, or undefined when they could not be read: that is not the same as none. */
const listEndpoints = async (client: Roark, agentId: string): Promise<EndpointChoice[] | undefined> => {
  try {
    const response = await client.agentEndpoint.list({ agentId, limit: ENDPOINT_PAGE });
    return response.data.map((endpoint) => ({ value: endpoint.value, direction: endpoint.direction }));
  } catch {
    return undefined;
  }
};

/**
 * Step 2. Three ways in: adopt an agent that is already in Roark (the common case, and the one
 * that stops the flow creating a duplicate), declare a new one with a number to call, or declare
 * one with nothing reachable yet and come back to it.
 */
export const chooseAgent = async (
  client: Roark,
  prompter: Prompter,
  say: (text: string) => void,
  binaryName: string,
  color: boolean,
): Promise<AgentSetup> => {
  const listed = await listAgents(client);
  const CREATE = '\u0000create';

  if (listed === undefined) {
    // Said out loud rather than swallowed: without it, a project full of agents looks empty and
    // the obvious next step is to create a duplicate of one that already exists.
    say(note("Could not read this project's agents, so this will declare a new one.", color, 'yellow'));
  }

  const existing = listed?.agents ?? [];
  if (existing.length > 0) {
    const choices: Choice<string>[] = [
      ...existing.map((agent) => ({ value: agent.id, label: agent.name, hint: 'already in Roark' })),
      { value: CREATE, label: 'A new agent', hint: 'not in Roark yet' },
    ];
    if (listed?.truncated === true) {
      say(
        note(
          `Showing the first ${AGENT_PAGE} agents. If the one you want is not here, pick "A new agent" and give it the same name to adopt it.`,
          color,
        ),
      );
    }
    const picked = await prompter.select('Which agent are we testing?', choices, existing[0]!.id);

    if (picked !== CREATE) {
      const agent = existing.find((candidate) => candidate.id === picked)!;
      const slug = slugify(agent.name) || 'agent';
      const endpoints = await listEndpoints(client, agent.id);

      // Endpoints are deliberately NOT declared for an adopted agent: an absent `endpoints` key
      // leaves what Roark holds untouched, where an empty list would detach every one of them.
      const base: AgentSetup = {
        name: slug,
        ...(slug === agent.name ? {} : { displayName: agent.name }),
      };

      if (endpoints === undefined) {
        // Distinct from "it has none": reporting a read failure as an agent with no line would
        // skip the plan and the run over what may be a blip. Both say how to finish, because
        // stopping early here is a pause, not a dead end.
        say(
          note(
            `Could not read ${agent.name}'s lines, so this stops before the plan. Run \`${binaryName} get-started\` again to finish it.`,
            color,
            'yellow',
          ),
        );
        return base;
      }
      if (endpoints.length === 0) {
        say(
          note(
            `That agent has no endpoint yet, so there is no line to call. Add one, then run \`${binaryName} get-started\` again to finish.`,
            color,
            'yellow',
          ),
        );
        return base;
      }
      if (endpoints.length === 1) return { ...base, dial: endpoints[0]! };

      const line = await prompter.select(
        'Which of its lines should the run call?',
        endpoints.map((endpoint) => ({
          value: endpoint.value,
          label: endpoint.value,
          hint: endpoint.direction.toLowerCase().replace(/_/g, ' '),
        })),
        endpoints[0]!.value,
      );
      return { ...base, dial: endpoints.find((endpoint) => endpoint.value === line)! };
    }
  }

  const name = await prompter.ask('What should we call the agent?', {
    default: 'my-agent',
    validate: nameRules('name'),
  });
  const reachable = await prompter.select(
    'Can Roark call it right now?',
    [
      { value: 'phone', label: 'Yes, at a phone number I own', hint: 'Roark dials it and plays the caller' },
      { value: 'later', label: 'Not yet', hint: 'write the files now, add the number later' },
    ],
    'phone',
  );

  if (reachable === 'later') {
    say(echoCommand(`${binaryName} agent create --name ${name}`, color));
    return { name };
  }

  const value = await prompter.ask('Phone number for Roark to call', { validate: phoneRules });
  say(
    echoCommand(
      `${binaryName} agent endpoint create --agent-id <id> --value ${value} --direction INCOMING`,
      color,
    ),
  );
  // INCOMING, so the run is inbound: Roark places the call and it runs the moment it is started.
  // An outgoing-only line makes the run outbound, which needs your system to dial Roark.
  return { name, endpoints: [{ value, direction: 'INCOMING' }], dial: { value, direction: 'INCOMING' } };
};

/** Placeholders for `--scaffold-only`: a complete, valid set of files with nothing invented about you. */
