import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { Command } from 'commander';

import { registerAuthCommands } from './auth';
import { userConfigPath, type CliConfig } from '../config';

let saved: Record<string, string | undefined>;
let savedStdin: PropertyDescriptor | undefined;
let savedStdinTty: PropertyDescriptor | undefined;
let savedStdoutTty: PropertyDescriptor | undefined;
let root: string;
let stderr: jest.SpyInstance;

const written = (): string => (stderr.mock.calls as unknown[][]).map((call) => String(call[0])).join('');

const writeUser = (config: CliConfig): void => {
  mkdirSync(join(root, 'config', 'roark'), { recursive: true });
  writeFileSync(join(root, 'config', 'roark', 'config.json'), JSON.stringify(config));
};

/** Not a terminal, so `auth login` takes the token from stdin the way CI does. */
const pipeToken = (token: string): void => {
  const stream = new PassThrough();
  Object.defineProperty(process, 'stdin', { value: stream, configurable: true });
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  setImmediate(() => stream.end(token));
};

const invoke = async (...argv: string[]): Promise<void> => {
  const root_ = new Command();
  root_.exitOverride();
  registerAuthCommands(root_, 'roark');
  for (const child of root_.commands) child.exitOverride();
  await root_.parseAsync(['node', 'roark', ...argv]);
};

type ProbeBehavior = 'ok' | { status: number } | { networkError: string };

/** A fake client factory whose probe GET behaves as configured, so login-time verification is
 * exercised without a network. */
const clientStub = (
  behavior: ProbeBehavior,
  me?: { tokenScope: string; user?: { email: string } | null },
): Parameters<typeof registerAuthCommands>[2] =>
  ((): unknown => ({
    get: async (path: string): Promise<unknown> => {
      // `auth status` asks /v1/me first; an older API 404s it and the caller falls back.
      if (path === '/v1/me') {
        if (me) return { data: me };
        throw Object.assign(new Error('HTTP 404'), { status: 404 });
      }
      if (behavior === 'ok') return {};
      if ('status' in behavior)
        throw Object.assign(new Error(`HTTP ${behavior.status}`), { status: behavior.status });
      throw new Error(behavior.networkError);
    },
  })) as unknown as Parameters<typeof registerAuthCommands>[2];

const invokeVerified = async (behavior: ProbeBehavior, ...argv: string[]): Promise<void> => {
  const root_ = new Command();
  root_.exitOverride();
  registerAuthCommands(root_, 'roark', clientStub(behavior));
  for (const child of root_.commands) child.exitOverride();
  await root_.parseAsync(['node', 'roark', ...argv]);
};

/** Same, but the API answers /v1/me, so `auth status` can describe the credential. */
const invokeDescribed = async (
  me: { tokenScope: string; user?: { email: string } | null },
  ...argv: string[]
): Promise<void> => {
  const root_ = new Command();
  root_.exitOverride();
  registerAuthCommands(root_, 'roark', clientStub('ok', me));
  for (const child of root_.commands) child.exitOverride();
  await root_.parseAsync(['node', 'roark', ...argv]);
};

beforeEach(() => {
  saved = {
    XDG_CONFIG_HOME: process.env['XDG_CONFIG_HOME'],
    ROARK_API_BEARER_TOKEN: process.env['ROARK_API_BEARER_TOKEN'],
  };
  delete process.env['ROARK_API_BEARER_TOKEN'];

  root = mkdtempSync(join(tmpdir(), 'roark-auth-'));
  process.env['XDG_CONFIG_HOME'] = join(root, 'config');

  savedStdin = Object.getOwnPropertyDescriptor(process, 'stdin');
  savedStdinTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  savedStdoutTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  stderr = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  process.exitCode = undefined;
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (savedStdin) Object.defineProperty(process, 'stdin', savedStdin);
  if (savedStdinTty) Object.defineProperty(process.stdin, 'isTTY', savedStdinTty);
  if (savedStdoutTty) Object.defineProperty(process.stdout, 'isTTY', savedStdoutTty);
  stderr.mockRestore();
  process.exitCode = undefined;
});

describe('auth login', () => {
  it('stores a token piped on stdin', async () => {
    pipeToken('roark-secret-token-1364\n');
    await invoke('auth', 'login');

    expect(JSON.parse(readFileSync(userConfigPath(), 'utf8'))).toEqual({
      bearerToken: 'roark-secret-token-1364',
    });
  });

  it('reports the token masked, never in full', async () => {
    pipeToken('roark-secret-token-1364');
    await invoke('auth', 'login');

    expect(written()).toContain('roar...1364');
    expect(written()).not.toContain('roark-secret-token-1364');
  });

  it('keeps the other settings already in the file', async () => {
    writeUser({ baseURL: 'https://api.example', timeout: 42 });
    pipeToken('new-token-value');
    await invoke('auth', 'login');

    expect(JSON.parse(readFileSync(userConfigPath(), 'utf8'))).toEqual({
      baseURL: 'https://api.example',
      timeout: 42,
      bearerToken: 'new-token-value',
    });
  });

  it('refuses an empty stdin rather than storing nothing', async () => {
    pipeToken('   \n');
    await expect(invoke('auth', 'login')).rejects.toThrow(/No token on stdin/);
    expect(existsSync(userConfigPath())).toBe(false);
  });
});

describe('auth login verification', () => {
  it('confirms a token that authenticates', async () => {
    pipeToken('good-token-value');
    await invokeVerified('ok', 'auth', 'login');
    expect(written()).toContain('Verified');
  });

  it('treats a 403 (valid token, missing permission) as authenticated', async () => {
    pipeToken('scoped-token-value');
    await invokeVerified({ status: 403 }, 'auth', 'login');
    expect(written()).toContain('Verified');
  });

  it('warns when the token is rejected with 401, but still keeps it saved', async () => {
    pipeToken('bad-token-value');
    await invokeVerified({ status: 401 }, 'auth', 'login');
    expect(written()).toContain('rejected (401)');
    expect(JSON.parse(readFileSync(userConfigPath(), 'utf8')).bearerToken).toBe('bad-token-value');
  });

  it('stays honest when it cannot verify (offline)', async () => {
    pipeToken('any-token-value');
    await invokeVerified({ networkError: 'getaddrinfo ENOTFOUND api.roark.ai' }, 'auth', 'login');
    expect(written()).toContain('could not verify');
  });
});

describe('auth login environment shadow', () => {
  it('warns that ROARK_API_BEARER_TOKEN overrides the stored token', async () => {
    process.env['ROARK_API_BEARER_TOKEN'] = 'env-token-value';
    pipeToken('stored-token-value');
    await invokeVerified('ok', 'auth', 'login');
    expect(written()).toContain('overrides this stored token');
  });
});

describe('auth logout', () => {
  it('removes the file and says so', async () => {
    writeUser({ bearerToken: 'stored' });
    await invoke('auth', 'logout');

    expect(existsSync(userConfigPath())).toBe(false);
    expect(written()).toContain('Removed');
  });

  it('is a no-op when there was nothing stored', async () => {
    await invoke('auth', 'logout');
    expect(written()).toContain('Nothing to remove');
  });
});

describe('auth status', () => {
  it('names the stored credential and exits 0', async () => {
    writeUser({ bearerToken: 'roark-stored-token-abcd' });
    await invokeVerified('ok', 'auth', 'status');

    expect(written()).toContain('Authenticated');
    expect(written()).toContain('roar...abcd');
    expect(written()).not.toContain('roark-stored-token-abcd');
    expect(process.exitCode).toBeUndefined();
  });

  it('says the environment variable wins, and mentions the file it shadows', async () => {
    writeUser({ bearerToken: 'roark-stored-token-abcd' });
    process.env['ROARK_API_BEARER_TOKEN'] = 'roark-environment-token-wxyz';
    await invokeVerified('ok', 'auth', 'status');

    expect(written()).toContain('ROARK_API_BEARER_TOKEN');
    expect(written()).toContain('roar...wxyz');
    expect(written()).toContain('the environment variable wins');
  });

  it('reports a revoked credential as rejected, and exits 3', async () => {
    // The bug this replaced: status answered from the config file, so a credential revoked in the
    // web UI still read as "Authenticated" on the machine holding it. A user-scoped credential is
    // revoked somewhere else by design, so the CLI is routinely the last to know.
    writeUser({ bearerToken: 'roark-stored-token-abcd' });
    await invokeVerified({ status: 401 }, 'auth', 'status');

    expect(written()).toContain('Rejected');
    expect(written()).not.toContain('Authenticated');
    expect(written()).toContain('revoked');
    expect(process.exitCode).toBe(3);
  });

  it('says unverified, not authenticated, when the API cannot be reached', async () => {
    // Offline is not the same as authenticated, and claiming otherwise is the same lie in a
    // quieter voice. Exit stays 0: nothing is known to be wrong.
    writeUser({ bearerToken: 'roark-stored-token-abcd' });
    await invokeVerified({ networkError: 'connect ECONNREFUSED' }, 'auth', 'status');

    expect(written()).toContain('Unverified');
    expect(written()).not.toContain('Authenticated');
    expect(process.exitCode).toBeUndefined();
  });

  it('treats a 403 as authenticated, since only authentication is being tested', async () => {
    writeUser({ bearerToken: 'roark-stored-token-abcd' });
    await invokeVerified({ status: 403 }, 'auth', 'status');

    expect(written()).toContain('Authenticated');
    expect(process.exitCode).toBeUndefined();
  });

  it('names who a user credential acts as, and which project it acts on', async () => {
    // For a user credential the project is half the answer: the same token behaves differently
    // depending on it, so `auth status` that omitted it would be telling half the truth.
    writeUser({ bearerToken: 'roark-stored-token-abcd', project: 'proj_123' });
    await invokeDescribed({ tokenScope: 'USER', user: { email: 'someone@example.com' } }, 'auth', 'status');

    expect(written()).toContain('Authenticated as someone@example.com');
    expect(written()).toContain('Acting on project proj_123');
  });

  it('warns when a user credential has no project selected', async () => {
    writeUser({ bearerToken: 'roark-stored-token-abcd' });
    await invokeDescribed({ tokenScope: 'USER', user: { email: 'someone@example.com' } }, 'auth', 'status');

    expect(written()).toContain('No project selected');
    expect(written()).toContain('config set project');
  });

  it('says nothing about projects for a project-scoped key, which names its own', async () => {
    writeUser({ bearerToken: 'roark-stored-token-abcd' });
    await invokeDescribed({ tokenScope: 'PROJECT', user: null }, 'auth', 'status');

    expect(written()).toContain('Authenticated');
    expect(written()).not.toContain('project');
  });

  it('exits 3 when there is no credential, so a script can branch on it', async () => {
    await invoke('auth', 'status');

    expect(written()).toContain('Not authenticated.');
    expect(process.exitCode).toBe(3);
  });
});
