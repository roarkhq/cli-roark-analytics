/**
 * `roark auth login | logout | status`
 *
 * The token is never accepted as a flag value: flags land in shell history and
 * in the process table, where a bearer token has no business being. It is read
 * from a prompt with echo off, or from stdin so CI can pipe it in.
 */

import { Command } from 'commander';
import type Roark from '@roarkanalytics/sdk';
import { createInterface } from 'node:readline';

import { UsageError } from '../errors';
import { clearUserConfig, maskToken, readUserConfig, userConfigPath, writeUserConfig } from '../config';
import { paint, supportsColor, write } from '../output';
import { isInteractive } from '../confirm';

/** How the program builds an authenticated client; injected so tests can stub it (and skip the
 * network entirely by omitting it). Matches the factory the other commands receive. */
type ClientFor = (options: never) => Roark;

// Any authenticated endpoint works as a liveness probe: `requireAuth` runs first, so a bad token is
// a 401 while a valid one that merely lacks this endpoint's permission is a 403 — both prove the
// token authenticates. `/v1/agent` is a stable GET that every project has.
const AUTH_PROBE_PATH = '/v1/agent';

/**
 * Confirm the just-saved token actually authenticates, so a mistyped or half-pasted token is caught
 * here instead of on the user's next real command. Best-effort: it never fails the login (the token
 * is already saved) and stays quiet-but-honest when offline.
 */
const verifyCredential = async (
  clientFor: ClientFor,
  token: string,
  binaryName: string,
  color: boolean,
): Promise<void> => {
  let client: Roark;
  try {
    // Verify the token we just saved specifically (pass it as the flag layer so a set
    // ROARK_API_BEARER_TOKEN can't shadow it here).
    client = clientFor({ token } as never);
  } catch {
    // e.g. the base-url trust guard refused; don't turn that into a login failure.
    return;
  }

  const verified = (): void =>
    write(`${paint('Verified', 'green', color)} the token authenticates.`, process.stderr);

  try {
    await (client as unknown as { get: (path: string, opts?: unknown) => Promise<unknown> }).get(
      AUTH_PROBE_PATH,
      { query: { limit: '1' } },
    );
    verified();
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401) {
      write(
        paint(
          `Warning: the token was rejected (401). It may be wrong, expired, or revoked. It is still saved; run \`${binaryName} auth login\` again to replace it.`,
          'yellow',
          color,
        ),
        process.stderr,
      );
    } else if (status !== undefined && status < 500) {
      // 403 (authenticated, lacks agent:read) or any other client-level response: auth succeeded.
      verified();
    } else {
      write(
        paint(
          `Saved, but could not verify it right now (${(error as Error).message}). It will be used as-is.`,
          'dim',
          color,
        ),
        process.stderr,
      );
    }
  }
};

/** Reads a secret without echoing it, so it is not left on screen or in a scrollback. */
const promptSecret = async (prompt: string): Promise<string> => {
  const input = process.stdin;
  const output = process.stderr;
  const rl = createInterface({ input, output, terminal: true });

  const onData = (chunk: Buffer | string): void => {
    // Redraw the prompt without the typed characters.
    const text = chunk.toString();
    if (text.includes('\n') || text.includes('\r')) return;
    output.write(`[2K[200D${prompt}`);
  };

  output.write(prompt);
  input.on('data', onData);
  try {
    return await new Promise<string>((resolve) => {
      rl.question('', (answer) => resolve(answer));
    });
  } finally {
    input.off('data', onData);
    rl.close();
    output.write('\n');
  }
};

const readToken = async (): Promise<string> => {
  if (!isInteractive()) {
    const piped = await new Promise<string>((resolve, reject) => {
      let buffer = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => (buffer += chunk));
      process.stdin.on('end', () => resolve(buffer));
      process.stdin.on('error', reject);
    });
    const token = piped.trim();
    if (token.length === 0) {
      throw new UsageError(
        'No token on stdin. Pipe one in (echo "$ROARK_API_BEARER_TOKEN" | roark auth login), or run this in a terminal to be prompted.',
      );
    }
    return token;
  }

  const token = (await promptSecret('Bearer token: ')).trim();
  if (token.length === 0) {
    // The most common cause: a paste that the hidden prompt did not capture. Point at the reliable
    // path rather than just saying "nothing entered".
    throw new UsageError(
      'No token entered. If you pasted and nothing happened, pipe it instead: echo "$ROARK_API_BEARER_TOKEN" | roark auth login',
    );
  }
  return token;
};

export const registerAuthCommands = (root: Command, binaryName: string, clientFor?: ClientFor): void => {
  const auth = new Command('auth').description('Manage the stored credential').showHelpAfterError();
  auth.action(() => auth.outputHelp());

  auth
    .command('login')
    .description('Store a bearer token for future commands')
    .addHelpText(
      'after',
      [
        '',
        'The token is read from a hidden prompt, or from stdin when not a terminal:',
        '',
        `  ${binaryName} auth login`,
        `  echo "$ROARK_API_BEARER_TOKEN" | ${binaryName} auth login`,
      ].join('\n'),
    )
    .action(async () => {
      const token = await readToken();
      const path = writeUserConfig({ ...readUserConfig(), bearerToken: token });
      const color = supportsColor(process.stderr);
      write(`${paint('Saved', 'green', color)} ${maskToken(token)} to ${path}`, process.stderr);

      // Confirm the token actually works, so a bad paste surfaces now rather than on the next command.
      if (clientFor) await verifyCredential(clientFor, token, binaryName, color);

      // A set environment variable outranks the stored token (see the precedence in config.ts), so
      // without this the login looks like it "did nothing" when a stale export shadows it.
      const fromEnv = process.env['ROARK_API_BEARER_TOKEN'];
      if (fromEnv && fromEnv !== token) {
        write(
          paint(
            `Note: ROARK_API_BEARER_TOKEN is set and overrides this stored token. Unset it to use the credential you just saved.`,
            'yellow',
            color,
          ),
          process.stderr,
        );
      }
    });

  auth
    .command('logout')
    .description('Delete the stored credential')
    .action(() => {
      const removed = clearUserConfig();
      write(
        removed ? `Removed ${userConfigPath()}` : `Nothing to remove at ${userConfigPath()}`,
        process.stderr,
      );
    });

  auth
    .command('status')
    .description('Show which credential would be used, and where it came from')
    .action(() => {
      const color = supportsColor(process.stderr);
      const fromEnv = process.env['ROARK_API_BEARER_TOKEN'];
      const stored = readUserConfig().bearerToken;

      if (fromEnv) {
        write(
          `${paint('Authenticated', 'green', color)} via ROARK_API_BEARER_TOKEN (${maskToken(fromEnv)})`,
          process.stderr,
        );
        if (stored) {
          write(
            paint(
              `A token is also stored in ${userConfigPath()}; the environment variable wins.`,
              'dim',
              color,
            ),
            process.stderr,
          );
        }
        return;
      }

      if (stored) {
        write(
          `${paint('Authenticated', 'green', color)} via ${userConfigPath()} (${maskToken(stored)})`,
          process.stderr,
        );
        return;
      }

      write(
        `${paint('Not authenticated.', 'yellow', color)} Run \`${binaryName} auth login\`.`,
        process.stderr,
      );
      process.exitCode = 3;
    });

  root.addCommand(auth);
};
