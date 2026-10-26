/**
 * The TypeScript form of the config `get-started` writes.
 *
 * Same resources as the YAML, serialized differently: `roark.config.ts` exporting
 * `defineConfig({ resources })`, with one `define*` helper per kind. The DSL is a mirror of the
 * YAML one (cross-references are names, not object references), so this takes the resource
 * objects the YAML path already builds and only changes how they reach the page.
 *
 * Worth the second emitter because the two are not interchangeable in practice: YAML needs
 * nothing installed and works for anyone who reached the CLI through a global install, while the
 * TypeScript form gives types, editor completion and real code around the values - but only in a
 * project that has `@roarkanalytics/sdk` to import from.
 */

import { resourcesFor, type ScaffoldFile, type Setup } from './resources';

/** The file `config apply` auto-detects when it is given no path, which is why this name. */
export const CONFIG_MODULE_FILE = 'roark.config.ts';

/** The package the helpers come from. Absent from the project, the config cannot be loaded. */
export const CONFIG_MODULE_IMPORT = '@roarkanalytics/sdk/lib/config';

const HELPERS: Readonly<Record<string, string>> = {
  metric: 'defineMetric',
  persona: 'definePersona',
  agent: 'defineAgent',
  flow: 'defineImprovFlow',
  simulationPlan: 'defineSimulationPlan',
};

const omit = (value: Record<string, unknown>, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));

/** `my-agent` -> `myAgent`, for the const each resource is bound to. */
const camelize = (name: string): string => {
  const camel = name
    .split(/[-_.]+/)
    .filter((part) => part.length > 0)
    .map((part, index) => (index === 0 ? part : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
    .join('');
  // A config name may start with a digit, which an identifier may not.
  return /^[0-9]/.test(camel) ? `_${camel}` : camel;
};

const quote = (value: string): string => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/**
 * How wide a line may get before the literal breaks across several.
 *
 * Roughly what a formatter would do, so running prettier over the generated file is close to a
 * no-op rather than a rewrite of every line someone would then see in a diff.
 */
const WIDTH = 88;

const key = (name: string): string => (/^[a-zA-Z_$][\w$]*$/.test(name) ? name : quote(name));

const entriesOf = (value: object): [string, unknown][] =>
  Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined);

/** The whole value on one line. Used when it fits; the multi-line form is the fallback. */
const compact = (value: unknown): string => {
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(compact).join(', ')}]`;
  if (typeof value === 'object') {
    const entries = entriesOf(value);
    if (entries.length === 0) return '{}';
    return `{ ${entries.map(([name, entry]) => `${key(name)}: ${compact(entry)}`).join(', ')} }`;
  }
  return 'undefined';
};

/**
 * A TypeScript object literal.
 *
 * Hand-rolled rather than `JSON.stringify`: the output is code someone will read and edit, so it
 * wants single quotes, unquoted keys, trailing commas and short values kept on one line, none of
 * which JSON can produce.
 */
const literal = (value: unknown, indent: string, used = 0): string => {
  const inline = compact(value);
  // `used` is what the line already spent before this value: `const x = defineAgent(` and the
  // closing `);`. Without it a one-line literal that fits on its own overflows once its
  // declaration is in front of it.
  if (indent.length + used + inline.length <= WIDTH) return inline;

  if (Array.isArray(value)) {
    const inner = `${indent}  `;
    const entries = value.map((entry) => `${inner}${literal(entry, inner)},`).join('\n');
    return `[\n${entries}\n${indent}]`;
  }

  if (value !== null && typeof value === 'object') {
    const inner = `${indent}  `;
    const lines = entriesOf(value)
      .map(([name, entry]) => `${inner}${key(name)}: ${literal(entry, inner)},`)
      .join('\n');
    return `{\n${lines}\n${indent}}`;
  }

  return inline;
};

/** The resources, as `const <name> = define<Kind>({ ... })` blocks, in apply order. */
const declarations = (setup: Setup): { source: string; helpers: string[]; bindings: string[] } => {
  const used = new Set<string>();
  const helpers: string[] = [];
  const bindings: string[] = [];
  const blocks: string[] = [];

  for (const { kind, resource, notes } of resourcesFor(setup, 'ts')) {
    const helper = HELPERS[kind];
    if (helper === undefined) continue;
    if (!helpers.includes(helper)) helpers.push(helper);

    // `kind` is the helper's job. `type` is too, but ONLY for a flow, where the helper is chosen
    // per type (`defineImprovFlow`): a metric's `type` is a required field of its own, and
    // stripping that one produces a config that does not compile.
    const { kind: _kind, name, ...fields } = resource as Record<string, unknown>;
    const rest = kind === 'flow' ? omit(fields, 'type') : fields;
    let binding = camelize(String(name));
    // Two kinds may legitimately share a name, and two consts may not.
    if (used.has(binding)) binding = `${binding}${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
    used.add(binding);
    bindings.push(binding);

    const opening = `const ${binding} = ${helper}(`;
    const body = literal({ name, ...rest }, '', opening.length + ');'.length);
    blocks.push([...notes.map((note) => `// ${note}`), `${opening}${body});`].join('\n'));
  }

  return { source: blocks.join('\n\n'), helpers, bindings };
};

/** The whole `roark.config.ts`, or undefined when the setup has nothing to write. */
export const setupModule = (setup: Setup): ScaffoldFile => {
  const { source, helpers, bindings } = declarations(setup);
  const imported = [...helpers, 'defineConfig'].sort();

  return {
    path: CONFIG_MODULE_FILE,
    contents: [
      '// Roark config as code. Everything this project declares in Roark lives here.',
      '//',
      `// \`roark config apply\` finds this file by name, so it needs no argument. The YAML form is`,
      '// equivalent: see https://roark.ai/documentation/config-as-code/overview',
      '',
      `import {\n${imported.map((helper) => `  ${helper},`).join('\n')}\n} from '${CONFIG_MODULE_IMPORT}';`,
      '',
      source,
      '',
      `export default defineConfig({\n  resources: [${bindings.join(', ')}],\n});`,
      '',
    ].join('\n'),
  };
};
