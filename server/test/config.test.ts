import {describe, expect, it} from 'vitest';

import {loadConfig} from '../src/config.js';

const REQUIRED = {INX_API_KEY_ID: 'key-id'};

describe('loadConfig', () => {
  it('applies documented defaults', () => {
    const config = loadConfig(REQUIRED);
    expect(config).toEqual({
      port: 3000,
      inxRestUrl: 'https://gw-client-api-rest.uat.inx.co',
      inxWsUrl: 'wss://gw-client-api-ws.uat.inx.co',
      marketName: 'BTC-USD',
      depth: 20,
      apiKeyId: 'key-id',
      privateKeyPem: undefined,
    });
  });

  it('honours overrides', () => {
    const config = loadConfig({
      ...REQUIRED,
      PORT: '4000',
      INX_REST_URL: 'http://localhost:9001',
      INX_WS_URL: 'ws://localhost:9002',
      INX_MARKET_NAME: 'ETH-USD',
      INX_BOOK_DEPTH: '10',
    });
    expect(config.port).toBe(4000);
    expect(config.inxRestUrl).toBe('http://localhost:9001');
    expect(config.inxWsUrl).toBe('ws://localhost:9002');
    expect(config.marketName).toBe('ETH-USD');
    expect(config.depth).toBe(10);
  });

  it('unescapes \\n sequences in the private key', () => {
    const config = loadConfig({
      ...REQUIRED,
      INX_PRIVATE_KEY: '-----BEGIN\\nAAA\\n-----END',
    });
    expect(config.privateKeyPem).toBe('-----BEGIN\nAAA\n-----END');
  });

  it('rejects a missing API key id', () => {
    expect(() => loadConfig({})).toThrow();
  });

  it('rejects invalid values', () => {
    expect(() => loadConfig({...REQUIRED, PORT: 'nope'})).toThrow();
    expect(() =>
      loadConfig({...REQUIRED, INX_REST_URL: 'not-a-url'}),
    ).toThrow();
    expect(() => loadConfig({...REQUIRED, INX_BOOK_DEPTH: '0'})).toThrow();
  });
});
