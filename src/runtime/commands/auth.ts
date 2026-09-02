/**
 * `roark auth login | logout | status`
 *
 * `login` defaults to a browser flow (OAuth authorization-code + PKCE): it opens the platform's
 * consent page, mints a key on approval, and stores it. Non-interactive/piped input, `--paste`, or
 * `--no-browser` fall back to taking a bearer token. A token is never accepted as a flag value:
 * flags land in shell history and the process table, where a bearer token has no business being; it
 * is read from a prompt with echo off, or from stdin so CI can pipe it in.
 */

import { Command } from 'commander';
import type Roark from '@roarkanalytics/sdk';
import { hostname } from 'node:os';
import { createInterface } from 'node:readline';

import { browserLogin, platformOriginFor } from '../browser-login';
import { UsageError } from '../errors';
import {
  clearUserConfig,
  maskToken,
  readUserConfig,
  resolveConfig,
  userConfigPath,
  writeUserConfig,
} from '../config';
import { paint, supportsColor, write } from '../output';
import { isInteractive } from '../confirm';

// The SDK's default when no base URL is configured; the token exchange targets the same host.
const DEFAULT_BASE_URL = 'https://api.roark.ai';

/** How the program builds an authenticated client; injected so tests can stub it (and skip the
 * network entirely by omitting it). Matches the factory the other commands receive. */
type ClientFor = (options: never) => Roark;

// Any authenticated endpoint works as a liveness probe: `requireAuth` runs first, so a bad token is
// a 401 while a valid one that merely lacks this endpoint's permission is a 403 — both prove the
// token authenticates. `/v1/agent` is a stable GET that every project has.
const AUTH_PROBE_PATH = '/v1/agent';

/**
 * Confirm the stored credential actually authenticates, so a mistyped or half-pasted token is caught
 * here instead of on the user's next real command. Best-effort: it never fails the login (the token
 * is already saved) and stays quiet-but-honest when offline.
 */
const verifyCredential = async (clientFor: ClientFor, binaryName: string, color: boolean): Promise<void> => {
  let client: Roark;
  try {
    // Resolve the client the same way a real command would (no forced --token), so the base-url
    // trust guard still applies: we must not send the credential to a host a checked-in .roark.json
    // chose. This verifies the effective credential, which is exactly what the next command will use.
    client = clientFor({} as never);
  } catch (error) {
    // e.g. the trust guard refused, or config is malformed. Don't fail the login, but say the check
    // was skipped so it doesn't look like the feature silently didn't run.
    const reason = (error as Error).message.split('\n')[0];
    write(paint(`Saved, but skipped the token check (${reason}).`, 'dim', color), process.stderr);
    return;
  }

  const verified = (): void =>
    write(`${paint('Verified', 'green', color)} the token authenticates.`, process.stderr);

  try {
    await client.get(AUTH_PROBE_PATH, { query: { limit: '1' } });
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

const readToken = async (binaryName: string): Promise<string> => {
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
        `No token on stdin. Pipe one in (echo "$ROARK_API_BEARER_TOKEN" | ${binaryName} auth login), or run this in a terminal to be prompted.`,
      );
    }
    return token;
  }

  const token = (await promptSecret('Bearer token: ')).trim();
  if (token.length === 0) {
    // The most common cause: a paste that the hidden prompt did not capture. Point at the reliable
    // path rather than just saying "nothing entered".
    throw new UsageError(
      `No token entered. If you pasted and nothing happened, pipe it instead: echo "$ROARK_API_BEARER_TOKEN" | ${binaryName} auth login`,
    );
  }
  return token;
};

// Save the token and report where it went (masked). Shared by the browser and paste paths.
const persistToken = (token: string): { color: boolean } => {
  const path = writeUserConfig({ ...readUserConfig(), bearerToken: token });
  const color = supportsColor(process.stderr);
  write(`${paint('Saved', 'green', color)} ${maskToken(token)} to ${path}`, process.stderr);
  return { color };
};

// A set environment variable outranks the stored token (see the precedence in config.ts), so without
// this a login looks like it "did nothing" when a stale export shadows what we just saved.
const warnEnvShadow = (token: string, color: boolean): void => {
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
};

export const registerAuthCommands = (root: Command, binaryName: string, clientFor?: ClientFor): void => {
  const auth = new Command('auth').description('Manage the stored credential').showHelpAfterError();
  auth.action(() => auth.outputHelp());

  auth
    .command('login')
    .description('Authorize this CLI in your browser, or store a bearer token')
    .option('--no-browser', 'do not open a browser; paste or pipe a token instead')
    .option('--paste', 'paste or pipe a bearer token instead of using the browser')
    .addHelpText(
      'after',
      [
        '',
        'By default an interactive terminal opens your browser to approve access and stores the',
        'minted key. Non-interactive (piped) input always takes a token, so CI keeps working:',
        '',
        `  ${binaryName} auth login`,
        `  ${binaryName} auth login --paste`,
        `  echo "$ROARK_API_BEARER_TOKEN" | ${binaryName} auth login`,
      ].join('\n'),
    )
    .action(async (options: { browser?: boolean; paste?: boolean }) => {
      // Browser flow when we're an interactive terminal and it wasn't opted out. A piped /
      // non-interactive invocation always uses the token path so `echo "$TOKEN" | auth login` works.
      const useBrowser = options.browser !== false && options.paste !== true && isInteractive();

      if (useBrowser) {
        const color = supportsColor(process.stderr);
        const apiBaseUrl = resolveConfig({}).config.baseURL ?? DEFAULT_BASE_URL;
        write(paint('Opening your browser to authorize this CLI…', 'dim', color), process.stderr);
        let token: string;
        try {
          token = await browserLogin({
            apiBaseUrl,
            platformOrigin: platformOriginFor(apiBaseUrl),
            clientName: `CLI on ${hostname()}`,
            onAuthorizeUrl: (url) =>
              write(paint(`If your browser didn't open, visit:\n  ${url}`, 'dim', color), process.stderr),
          });
        } catch (error) {
          throw new UsageError(
            `Browser login failed: ${(error as Error).message}\n` +
              `Run \`${binaryName} auth login --paste\` to paste or pipe a token instead.`,
          );
        }
        const { color: savedColor } = persistToken(token);
        warnEnvShadow(token, savedColor);
        return;
      }

      const token = await readToken(binaryName);
      const { color } = persistToken(token);
      // Confirm the token actually works, so a bad paste surfaces now rather than on the next command.
      if (clientFor) await verifyCredential(clientFor, binaryName, color);
      warnEnvShadow(token, color);
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
