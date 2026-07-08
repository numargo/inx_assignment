import {generateKeyPairSync, verify} from 'node:crypto';

import {describe, expect, it, vi} from 'vitest';

import {InxAuth} from '../src/inx-auth.js';

const {publicKey, privateKey} = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const privateKeyPem = privateKey
  .export({type: 'pkcs8', format: 'pem'})
  .toString();

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {status});

const makeAuth = (fetchFn: typeof fetch, now: () => number = () => 1_000) =>
  new InxAuth('key-id', privateKeyPem, 'https://rest.test', fetchFn, now);

describe('InxAuth', () => {
  it('builds headers whose signature verifies against the public key', () => {
    const auth = makeAuth(vi.fn<typeof fetch>(), () => 42);
    const headers = auth.buildHeaders();
    expect(headers.apiKeyId).toBe('key-id');
    expect(headers.timestamp).toBe('42');
    const context = {
      nonce: Number(headers.nonce),
      timestamp: 42,
      apiKeyId: 'key-id',
    };
    const ok = verify(
      'sha256',
      Buffer.from(JSON.stringify(context)),
      publicKey,
      Buffer.from(headers.signedContext, 'base64'),
    );
    expect(ok).toBe(true);
  });

  it('uses strictly increasing nonces seeded from the clock', () => {
    const auth = makeAuth(vi.fn<typeof fetch>(), () => 1_000);
    const first = Number(auth.buildHeaders().nonce);
    const second = Number(auth.buildHeaders().nonce);
    expect(first).toBeGreaterThan(1_000 - 1);
    expect(second).toBe(first + 1);
  });

  it('throws a clear error when the private key is missing', () => {
    const auth = new InxAuth('key-id', undefined, 'https://rest.test');
    expect(() => auth.buildHeaders()).toThrow(/INX_PRIVATE_KEY/);
  });

  it('creates a websocket token', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200, {websocketToken: 'tok-1'}));
    const auth = makeAuth(fetchFn);
    await expect(auth.createWsToken()).resolves.toBe('tok-1');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://rest.test/api/createToken');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.apiKeyId).toBe('key-id');
    expect(headers.signedContext).toBeTruthy();
  });

  it('revokes the previous token', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200, {}));
    await makeAuth(fetchFn).revokeWsToken();
    expect(fetchFn.mock.calls[0][0]).toBe('https://rest.test/api/revokeToken');
  });

  it('reports HTTP failures without leaking the response body', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(401, {secret: 'internals'}));
    await expect(makeAuth(fetchFn).createWsToken()).rejects.toThrow(
      /^INX \/api\/createToken failed with HTTP 401$/,
    );
  });

  it('rejects malformed token responses', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200, {nope: true}));
    await expect(makeAuth(fetchFn).createWsToken()).rejects.toThrow();
  });
});
