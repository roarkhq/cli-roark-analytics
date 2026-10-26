import { CONFIG_MODULE_FILE, CONFIG_MODULE_IMPORT, setupModule } from './module';
import type { Setup } from './resources';

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

const render = (setup: Setup = baseSetup()): string => setupModule(setup).contents;

describe('setupModule', () => {
  it('writes the file `config apply` finds by name', () => {
    expect(setupModule(baseSetup()).path).toBe(CONFIG_MODULE_FILE);
  });

  it('imports exactly the helpers it uses, and no others', () => {
    const setup = baseSetup();
    setup.customMetric = { name: 'booking_confirmed', question: 'did the agent confirm the date?' };

    const imports = /import \{([^}]*)\} from '([^']*)';/.exec(render(setup));

    expect(imports?.[2]).toBe(CONFIG_MODULE_IMPORT);
    expect(
      imports?.[1]
        ?.split(',')
        .map((name) => name.trim())
        .filter((name) => name.length > 0),
    ).toEqual([
      'defineAgent',
      'defineConfig',
      'defineImprovFlow',
      'defineMetric',
      'definePersona',
      'defineSimulationPlan',
    ]);
  });

  it('leaves out a helper for a resource this setup does not have', () => {
    // No custom metric here, so importing `defineMetric` would be an unused import in a file
    // somebody is about to run their linter over.
    expect(render()).not.toContain('defineMetric');
  });

  it('exports every resource, in apply order', () => {
    const setup = baseSetup();
    setup.customMetric = { name: 'booking_confirmed', question: 'did it?' };

    expect(render(setup)).toContain(
      'resources: [bookingConfirmed, curiousCaller, frontdesk, rebooking, firstRun]',
    );
  });

  it('keeps `type` on a metric and drops it from a flow', () => {
    // The helper is chosen per flow type (`defineImprovFlow`), so a flow's `type` is implied.
    // A metric's is a required field, and stripping it produces a config that will not compile.
    const setup = baseSetup();
    setup.customMetric = { name: 'booking_confirmed', question: 'did it?' };
    const source = render(setup);

    expect(source).toContain("type: 'BOOLEAN'");
    expect(source).not.toContain("type: 'improv'");
  });

  it('never writes `kind`, which the helpers supply', () => {
    expect(render()).not.toContain('kind:');
  });

  it('escapes a quote in a prompt rather than ending the string early', () => {
    const setup = baseSetup();
    setup.flow = { ...setup.flow, goal: "You call because you're owed a refund." };

    expect(render(setup)).toContain("prompt: 'You call because you\\'re owed a refund.'");
  });

  it('keeps short values on one line and breaks only what does not fit', () => {
    // Close to what a formatter would do, so running prettier over the file is not a rewrite of
    // every line somebody then has to read in a diff.
    const source = render();

    expect(source).toContain("agents: ['frontdesk']");
    expect(source).toContain("agentEndpoints: [{ agent: 'frontdesk' }]");
    for (const line of source.split('\n')) expect(line.length).toBeLessThanOrEqual(110);
  });

  it('binds each resource to a camelCase const named after it', () => {
    const setup = baseSetup();
    setup.customMetric = { name: 'booking_confirmed', question: 'did it?' };
    const source = render(setup);

    expect(source).toContain('const bookingConfirmed = defineMetric(');
    expect(source).toContain('const curiousCaller = definePersona(');
    expect(source).toContain('const firstRun = defineSimulationPlan(');
  });

  it('does not collide two consts when two kinds share a name', () => {
    const setup = baseSetup();
    setup.flow = { ...setup.flow, name: 'frontdesk' };

    const source = render(setup);

    expect(source).toContain('const frontdesk = defineAgent(');
    expect(source).toContain('const frontdeskFlow = defineImprovFlow(');
    expect(source).toContain('resources: [curiousCaller, frontdesk, frontdeskFlow, firstRun]');
  });

  it('writes no plan when there is no line to dial', () => {
    const setup = baseSetup();
    setup.agent = { name: 'frontdesk' };
    delete setup.plan;

    const source = render(setup);

    expect(source).not.toContain('defineSimulationPlan');
    expect(source).toContain('resources: [curiousCaller, frontdesk, rebooking]');
  });
});
