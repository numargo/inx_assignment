import {generateKeyPairSync} from 'node:crypto';

import {defineConfig} from '@playwright/test';

// Throwaway keypair for the run: the server signs its (mock) INX requests
// with a real RSA key, so the production code path is exercised unchanged.
const {privateKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
const privateKeyPem = privateKey
  .export({type: 'pkcs8', format: 'pem'})
  .toString();

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://127.0.0.1:5173',
  },
  webServer: [
    {
      command: 'pnpm run mock-inx',
      port: 9101,
      reuseExistingServer: false,
    },
    {
      command: 'pnpm --filter @inx-orderbook/server exec tsx src/index.ts',
      cwd: '..',
      port: 3000,
      reuseExistingServer: false,
      env: {
        PORT: '3000',
        INX_REST_URL: 'http://127.0.0.1:9101',
        INX_WS_URL: 'ws://127.0.0.1:9102',
        INX_MARKET_NAME: 'BTC-USD',
        INX_API_KEY_ID: 'e2e-key-id',
        INX_PRIVATE_KEY: privateKeyPem,
      },
    },
    {
      command: 'pnpm --filter @inx-orderbook/web run dev',
      cwd: '..',
      port: 5173,
      reuseExistingServer: false,
    },
  ],
});
