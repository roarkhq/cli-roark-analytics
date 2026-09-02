import { createHash } from 'node:crypto';

import { browserLogin, generatePkce, platformOriginFor } from './browser-login';

describe('generatePkce', () => {
  it('produces a challenge that is base64url(sha256(verifier))', () => {
    const { verifier, challenge } = generatePkce();
    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expected);
  });

  it('is different every call', () => {
    expect(generatePkce().verifier).not.toBe(generatePkce().verifier);
  });
});

describe('platformOriginFor', () => {
  it('maps the prod API host to the platform host', () => {
    expect(platformOriginFor('https://api.roark.ai')).toBe('https://platform.roark.ai');
  });

  it('maps an api.<stage> host to platform.<stage>', () => {
    expect(platformOriginFor('https://api.beta.roark.ai')).toBe('https://platform.beta.roark.ai');
  });

  it('honours ROARK_PLATFORM_URL and trims a trailing slash', () => {
    const prev = process.env['ROARK_PLATFORM_URL'];
    process.env['ROARK_PLATFORM_URL'] = 'http://localhost:3000/';
    try {
      expect(platformOriginFor('https://api.roark.ai')).toBe('http://localhost:3000');
    } finally {
      if (prev === undefined) delete process.env['ROARK_PLATFORM_URL'];
      else process.env['ROARK_PLATFORM_URL'] = prev;
    }
  });

  it('falls back to the same origin for an unrecognised host', () => {
    expect(platformOriginFor('http://localhost:6401')).toBe('http://localhost:6401');
  });
});

describe('browserLogin', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  // Intercept only the token exchange; let the loopback callback request hit the real server.
  const stubExchange = (token: unknown, status = 200): void => {
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/v1/cli/auth/token')) {
        return new Response(JSON.stringify(token === undefined ? {} : { data: { token } }), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      }
      return realFetch(input, init);
    }) as typeof fetch;
  };

  // Hit the loopback URL like the browser would, draining the response so no socket lingers.
  const hitCallback = (callback: URL): void => {
    void realFetch(callback.toString())
      .then((r) => r.text())
      .catch(() => undefined);
  };

  // Drive the browser half: read the loopback redirect_uri + state and hit it like the browser would.
  const driveCallback = (params: Record<string, string>) => (authorizeUrl: string) => {
    const url = new URL(authorizeUrl);
    const callback = new URL(url.searchParams.get('redirect_uri')!);
    const state = url.searchParams.get('state')!;
    for (const [k, v] of Object.entries({ state, ...params })) callback.searchParams.set(k, v);
    hitCallback(callback);
  };

  it('returns the minted token after a successful approval', async () => {
    stubExchange('roark-minted-key-1234');
    const token = await browserLogin({
      apiBaseUrl: 'https://api.roark.ai',
      platformOrigin: 'https://platform.roark.ai',
      clientName: 'CLI on test-host',
      timeoutMs: 5000,
      open: driveCallback({ code: 'auth-code-123' }),
    });
    expect(token).toBe('roark-minted-key-1234');
  });

  it('rejects when the browser reports the request was denied', async () => {
    stubExchange('unused');
    await expect(
      browserLogin({
        apiBaseUrl: 'https://api.roark.ai',
        platformOrigin: 'https://platform.roark.ai',
        clientName: 'CLI on test-host',
        timeoutMs: 5000,
        open: driveCallback({ error: 'access_denied' }),
      }),
    ).rejects.toThrow(/access_denied/);
  });

  it('rejects when the state does not match (possible interference)', async () => {
    stubExchange('unused');
    await expect(
      browserLogin({
        apiBaseUrl: 'https://api.roark.ai',
        platformOrigin: 'https://platform.roark.ai',
        clientName: 'CLI on test-host',
        timeoutMs: 5000,
        // Overwrite state with a wrong value after driveCallback seeds the correct one.
        open: (authorizeUrl: string) => {
          const url = new URL(authorizeUrl);
          const callback = new URL(url.searchParams.get('redirect_uri')!);
          callback.searchParams.set('code', 'auth-code-123');
          callback.searchParams.set('state', 'not-the-real-state');
          hitCallback(callback);
        },
      }),
    ).rejects.toThrow(/invalid/);
  });
});
