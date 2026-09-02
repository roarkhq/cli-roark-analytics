/**
 * Browser-based `auth login` (OAuth authorization-code + PKCE over a loopback redirect).
 *
 * The CLI starts a throwaway `127.0.0.1` listener, opens the platform's consent page, and waits for
 * the approved code to come back to that listener. It then exchanges the code (with its PKCE
 * verifier) for a freshly minted API key at the public token endpoint. No token is ever typed or
 * pasted; the secret only exists in the final exchange response.
 */

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const base64url = (buf: Buffer): string => buf.toString('base64url');

// A PKCE pair: a random verifier and its S256 challenge (base64url(sha256(verifier))).
export const generatePkce = (): { verifier: string; challenge: string } => {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
};

/**
 * Where the consent page lives, derived from the API base URL. `api.roark.ai` -> `platform.roark.ai`.
 * `ROARK_PLATFORM_URL` overrides for local/self-hosted stages where the mapping doesn't hold.
 */
export const platformOriginFor = (apiBaseUrl: string): string => {
  const override = process.env['ROARK_PLATFORM_URL'];
  if (override && override.trim().length > 0) return override.replace(/\/+$/, '');
  try {
    const url = new URL(apiBaseUrl);
    if (url.hostname === 'api.roark.ai') return 'https://platform.roark.ai';
    if (url.hostname.startsWith('api.'))
      return `${url.protocol}//platform.${url.hostname.slice('api.'.length)}`;
    // localhost / an unrecognised host: assume the web app shares the origin.
    return url.origin;
  } catch {
    return 'https://platform.roark.ai';
  }
};

const closeHtml = (title: string, body: string): string =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font:15px system-ui;margin:4rem auto;max-width:28rem;text-align:center;color:#222">` +
  `<h2 style="margin:0 0 .5rem">${title}</h2><p style="color:#666">${body}</p></body>`;

// Best-effort browser open. If it fails, the caller has already printed the URL to open by hand.
const openBrowser = (url: string): void => {
  const [command, args] =
    process.platform === 'darwin' ? (['open', [url]] as const)
    : process.platform === 'win32' ? (['cmd', ['/c', 'start', '', url]] as const)
    : (['xdg-open', [url]] as const);
  try {
    const child = spawn(command, [...args], { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    /* the printed URL is the fallback */
  }
};

export interface BrowserLoginOptions {
  // Where the token exchange lives (the API base URL, e.g. https://api.roark.ai).
  apiBaseUrl: string;
  // Where the consent page lives (the platform origin).
  platformOrigin: string;
  // Label for the minted key, shown in the consent screen and the API-keys list.
  clientName: string;
  // How long to wait for the user to approve before giving up.
  timeoutMs?: number;
  // Called with the authorize URL so the caller can print it (in case the browser didn't open).
  onAuthorizeUrl?: (url: string) => void;
  // How to open the browser. Defaults to the OS opener; injected in tests so they don't pop a tab.
  open?: (url: string) => void;
}

// Run the full loopback + PKCE flow and return the minted bearer token.
export const browserLogin = async (options: BrowserLoginOptions): Promise<string> => {
  const { verifier, challenge } = generatePkce();
  const state = base64url(randomBytes(16));

  const code = await new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      // This is a one-shot listener; drop any keep-alive socket so nothing lingers after we're done.
      (server as { closeAllConnections?: () => void }).closeAllConnections?.();
      fn();
    };

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end();
        return;
      }
      const returnedCode = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const errorParam = url.searchParams.get('error');
      const ok = !errorParam && returnedCode && returnedState === state;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        ok ?
          closeHtml('Logged in', 'You can close this tab and return to your terminal.')
        : closeHtml('Login failed', 'You can close this tab and return to your terminal.'),
      );
      if (ok) finish(() => resolve(returnedCode));
      else if (errorParam) finish(() => reject(new Error(`authorization was ${errorParam}`)));
      else finish(() => reject(new Error('authorization response was invalid')));
    });

    const timer = setTimeout(
      () => finish(() => reject(new Error('timed out waiting for authorization in the browser'))),
      options.timeoutMs ?? 300_000,
    );
    timer.unref?.();

    server.on('error', (error) => finish(() => reject(error)));
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      const authorizeUrl =
        `${options.platformOrigin}/cli/authorize?` +
        new URLSearchParams({
          code_challenge: challenge,
          state,
          redirect_uri: redirectUri,
          name: options.clientName,
        }).toString();
      options.onAuthorizeUrl?.(authorizeUrl);
      (options.open ?? openBrowser)(authorizeUrl);
    });
  });

  const response = await fetch(`${options.apiBaseUrl.replace(/\/+$/, '')}/v1/cli/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`token exchange failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  const body = (await response.json()) as { data?: { token?: string } };
  const token = body.data?.token;
  if (!token) throw new Error('token exchange returned no token');
  return token;
};
