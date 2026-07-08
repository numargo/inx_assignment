import {z} from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  INX_REST_URL: z
    .string()
    .url()
    .default('https://gw-client-api-rest.uat.inx.co'),
  INX_WS_URL: z.string().url().default('wss://gw-client-api-ws.uat.inx.co'),
  INX_MARKET_NAME: z.string().min(1).default('BTC-USD'),
  INX_BOOK_DEPTH: z.coerce.number().int().positive().max(100).default(20),
  INX_API_KEY_ID: z.string().min(1),
  INX_PRIVATE_KEY: z.string().min(1).optional(),
});

/** Runtime configuration, parsed and validated from environment variables. */
export interface Config {
  port: number;
  inxRestUrl: string;
  inxWsUrl: string;
  marketName: string;
  depth: number;
  apiKeyId: string;
  privateKeyPem?: string;
}

/**
 * Parses configuration from an environment map. `INX_PRIVATE_KEY` supports
 * `\n`-escaped newlines so a PEM key fits on one .env line.
 */
export const loadConfig = (env: Record<string, string | undefined>): Config => {
  const parsed = envSchema.parse(env);
  return {
    port: parsed.PORT,
    inxRestUrl: parsed.INX_REST_URL,
    inxWsUrl: parsed.INX_WS_URL,
    marketName: parsed.INX_MARKET_NAME,
    depth: parsed.INX_BOOK_DEPTH,
    apiKeyId: parsed.INX_API_KEY_ID,
    privateKeyPem: parsed.INX_PRIVATE_KEY?.replaceAll('\\n', '\n'),
  };
};
