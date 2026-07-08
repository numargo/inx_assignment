import {sign} from 'node:crypto';

import {z} from 'zod';

const tokenResponseSchema = z.object({websocketToken: z.string().min(1)});

/** Headers required by every authenticated INX REST request. */
export interface AuthHeaders {
  nonce: string;
  timestamp: string;
  apiKeyId: string;
  signedContext: string;
  [header: string]: string;
}

/**
 * INX REST authentication: signs a `{nonce, timestamp, apiKeyId}` context
 * with the account's RSA private key (SHA-256, base64) and exchanges it for
 * short-lived WebSocket tokens via `/api/createToken`.
 */
export class InxAuth {
  private nonce: number;

  constructor(
    private readonly apiKeyId: string,
    private readonly privateKeyPem: string | undefined,
    private readonly restUrl: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    // Nonces must be strictly increasing per API key, across restarts too —
    // seeding from the clock keeps every run ahead of the previous one.
    this.nonce = this.now();
  }

  /** Builds signed headers for one request. Each call consumes a new nonce. */
  buildHeaders(): AuthHeaders {
    if (this.privateKeyPem === undefined) {
      throw new Error(
        'INX_PRIVATE_KEY is not configured; cannot sign INX API requests',
      );
    }
    const context = {
      nonce: ++this.nonce,
      timestamp: this.now(),
      apiKeyId: this.apiKeyId,
    };
    const signedContext = sign(
      'sha256',
      Buffer.from(JSON.stringify(context)),
      this.privateKeyPem,
    ).toString('base64');
    return {
      nonce: String(context.nonce),
      timestamp: String(context.timestamp),
      apiKeyId: context.apiKeyId,
      signedContext,
    };
  }

  /**
   * Creates a WebSocket token. INX allows one token per connection and it
   * must be used within 30 seconds.
   */
  async createWsToken(): Promise<string> {
    const body = await this.post('/api/createToken');
    return tokenResponseSchema.parse(body).websocketToken;
  }

  /** Revokes the previous token; required before creating a new one. */
  async revokeWsToken(): Promise<void> {
    await this.post('/api/revokeToken');
  }

  private async post(path: string): Promise<unknown> {
    const response = await this.fetchFn(`${this.restUrl}${path}`, {
      method: 'POST',
      headers: this.buildHeaders(),
    });
    if (!response.ok) {
      // Never surface the response body: it may echo internals.
      throw new Error(`INX ${path} failed with HTTP ${response.status}`);
    }
    return response.json();
  }
}
