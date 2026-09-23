// `scripts/check-sdk-resolution.cjs` is the last thing standing between a
// regenerated command table and a published CLI whose commands throw, and until
// now the only thing exercising it was CI doing real `npm install`s. That covers
// the happy path on one machine at one moment and gives no way to ask what
// happens when a method is missing - the case the script exists for - without
// publishing a broken SDK to find out.
//
// So: fixture packages on disk, no registry. The script is run as a child
// process rather than imported, because its contract IS the process contract -
// `::error::` on stderr, the missing commands listed one per line above it, and
// a non-zero exit. Importing it would test a function nothing calls.
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SCRIPT = path.join(__dirname, '..', 'scripts', 'check-sdk-resolution.cjs');

/**
 * The fake command table. Shaped like the entries `src/commands.ts` generates,
 * carrying only the three fields the script reads: where the SDK method lives
 * and what to call the command in the failure list.
 */
const TABLE = [
  { commandPath: ['agent', 'create'], clientProperty: 'agent', methodName: 'create' },
  { commandPath: ['agent', 'build'], clientProperty: 'agent', methodName: 'build' },
  { commandPath: ['agent-config', 'list'], clientProperty: 'agentConfig', methodName: 'list' },
] as const;

/** `resource.method` for each entry, the form the SDK fixtures are built from. */
const ALL_METHODS = TABLE.map((command) => `${command.clientProperty}.${command.methodName}`);

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-resolution-'));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const write = (file: string, contents: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
};

/**
 * A directory that resolves `@roarkanalytics/sdk` to a client exposing exactly
 * `methods`. No `exports` map, so subpath resolution stays on the legacy file
 * path rules and the fixture does not have to restate npm's.
 */
const makeSdk = (dir: string, version: string, methods: readonly string[]) => {
  const base = path.join(dir, 'node_modules', '@roarkanalytics', 'sdk');
  write(
    path.join(base, 'package.json'),
    JSON.stringify({ name: '@roarkanalytics/sdk', version, main: 'index.js' }),
  );

  // Assigned in the constructor rather than on the prototype: the script reads
  // `client[resource][method]` off an instance, because in the real SDK the
  // resource accessors are instance getters.
  const resources = new Map<string, string[]>();
  for (const method of methods) {
    const [resource, name] = method.split('.');
    if (resource === undefined || name === undefined) throw new Error(`malformed fixture method: ${method}`);
    resources.set(resource, [...(resources.get(resource) ?? []), name]);
  }
  const assignments = [...resources]
    .map(
      ([resource, names]) => `    this.${resource} = { ${names.map((n) => `${n}: () => {}`).join(', ')} };`,
    )
    .join('\n');

  write(
    path.join(base, 'index.js'),
    [
      'class Roark {',
      '  constructor(options) {',
      "    if (!options || !options.bearerToken) throw new Error('missing credentials');",
      assignments,
      '  }',
      '}',
      'module.exports = Roark;',
      '',
    ].join('\n'),
  );
};

/**
 * A probe directory as the workflows build one: the packed CLI installed with an
 * SDK beside it.
 */
const makeProbe = (name: string, sdkVersion: string, sdkMethods: readonly string[]) => {
  const dir = path.join(root, name);
  const cli = path.join(dir, 'node_modules', '@roarkanalytics', 'cli');
  write(
    path.join(cli, 'package.json'),
    JSON.stringify({ name: '@roarkanalytics/cli', version: '0.0.0-fixture', main: 'index.js' }),
  );
  write(path.join(cli, 'index.js'), 'module.exports = {};\n');
  write(path.join(cli, 'commands.js'), `exports.COMMANDS = ${JSON.stringify(TABLE)};\n`);
  makeSdk(dir, sdkVersion, sdkMethods);
  return dir;
};

/** A bare directory holding only an SDK, as the floor check installs one. */
const makeSdkOnly = (name: string, version: string, methods: readonly string[]) => {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  makeSdk(dir, version, methods);
  return dir;
};

const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

const runOk = (...args: string[]) => execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

describe('with no second argument, it judges the SDK the probe resolved', () => {
  test('passes when every method in the table is present', () => {
    const probe = makeProbe('complete', '4.2.0', ALL_METHODS);

    const output = runOk(probe);

    expect(output).toContain('all 3 commands resolve');
    // The version is named, so a green log still says what it was green against.
    expect(output).toContain('4.2.0');
  });

  test('fails, lists each missing command by its CLI path, and blames the pinned SDK', () => {
    const probe = makeProbe('pinned-too-old', '4.0.0', ['agent.create']);

    const { status, stderr } = run(probe);

    expect(status).toBe(1);
    // The user-facing command, not just the SDK method: the reader has to know
    // which `roark ...` invocation breaks.
    expect(stderr).toContain('roark agent build -> agent.build');
    expect(stderr).toContain('roark agent-config list -> agentConfig.list');
    expect(stderr).toContain('2 of 3 commands do not resolve on the SDK this build ships against');
    expect(stderr).toContain('4.0.0');
    // The floor wording belongs to the other caller and would be wrong here.
    expect(stderr).not.toContain('the oldest version the range');
  });

  test('a resource missing entirely is treated the same as a missing method', () => {
    // `agentConfig` does not exist at all, rather than existing without `list`.
    const probe = makeProbe('resource-absent', '4.0.0', ['agent.create', 'agent.build']);

    const { status, stderr } = run(probe);

    expect(status).toBe(1);
    expect(stderr).toContain('roark agent-config list -> agentConfig.list');
    expect(stderr).toContain('1 of 3 commands');
  });
});

describe('with a second argument, it judges the SDK in that directory', () => {
  test('passes when the floor carries the whole table', () => {
    const probe = makeProbe('floor-ok-probe', '4.2.0', ALL_METHODS);
    const floor = makeSdkOnly('floor-ok', '4.2.0', ALL_METHODS);

    expect(runOk(probe, floor)).toContain(
      'all 3 commands resolve on @roarkanalytics/sdk@4.2.0, the oldest the range admits',
    );
  });

  test('fails against the floor even when the probe resolved a newer SDK that would pass', () => {
    // The regression this argument exists for. The probe holds 4.2.0, which has
    // everything - that is the answer `publish.yml` gets, and the answer that
    // let v0.25.0 be cut declaring `^4.0.0`. Reading the floor has to override
    // it, or the split does nothing.
    const probe = makeProbe('newer-probe', '4.2.0', ALL_METHODS);
    const floor = makeSdkOnly('older-floor', '4.0.0', ['agent.create']);

    expect(runOk(probe)).toContain('all 3 commands resolve');

    const { status, stderr } = run(probe, floor);

    expect(status).toBe(1);
    expect(stderr).toContain('2 of 3 commands do not resolve on @roarkanalytics/sdk@4.0.0');
    expect(stderr).toContain('the oldest version the range in package.json admits');
    expect(stderr).toContain('Raise the floor');
  });

  test('the table still comes from the probe, not from the floor directory', () => {
    // The floor directory holds no CLI at all. If the script read the table from
    // there it would fail to resolve rather than report commands, so a clean
    // pass proves the two resolutions stay separate.
    const probe = makeProbe('table-source-probe', '4.2.0', ALL_METHODS);
    const floor = makeSdkOnly('table-source-floor', '4.2.0', ALL_METHODS);

    expect(fs.existsSync(path.join(floor, 'node_modules', '@roarkanalytics', 'cli'))).toBe(false);
    expect(runOk(probe, floor)).toContain('all 3 commands');
  });
});

describe('argument handling', () => {
  test('refuses to run with no probe directory, and says what it wanted', () => {
    const { status, stderr } = run();

    expect(status).toBe(1);
    expect(stderr).toContain('::error::');
    expect(stderr).toContain('usage: check-sdk-resolution.cjs');
  });

  test('a probe with no installed CLI fails loudly rather than reporting zero commands', () => {
    const empty = path.join(root, 'empty');
    fs.mkdirSync(empty, { recursive: true });

    const { status, stderr } = run(empty);

    expect(status).toBe(1);
    expect(stderr).toContain('::error::');
    // Whatever the message, it must not be a green "all 0 commands resolve".
    expect(stderr).not.toContain('all 0 commands resolve');
  });
});
