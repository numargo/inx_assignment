import {randomUUID} from 'node:crypto';

import WebSocket from 'ws';
import {z} from 'zod';

import {OrderBook} from './order-book.js';

const levelSchema = z.object({
  price: z.number().finite().positive(),
  // The UAT feed has been observed sending negative amounts (not covered by
  // the docs); the book treats any amount <= 0 as removal of the tier.
  amount: z.number().finite(),
});

const messageSchema = z.object({event: z.string()}).passthrough();

const orderBookEventSchema = z
  .object({
    event: z.literal('ORDER_BOOK'),
    marketName: z.string(),
    buy: z.array(levelSchema).default([]),
    sell: z.array(levelSchema).default([]),
  })
  .passthrough();

/** Minimal logger contract so tests can observe/silence output. */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** The subset of InxAuth the feed needs (narrow for testability). */
export interface TokenSource {
  createWsToken(): Promise<string>;
  revokeWsToken(): Promise<void>;
}

/** Constructor shape of `ws` — injectable so tests can fake the transport. */
export type WebSocketFactory = (
  url: string,
  headers: Record<string, string>,
) => WebSocket;

export interface FeedOptions {
  wsUrl: string;
  marketName: string;
  depth: number;
  apiKeyId: string;
  auth: TokenSource;
  book: OrderBook;
  /** Called after every applied snapshot/delta. */
  onUpdate?: () => void;
  logger?: Logger;
  /** Base reconnect delay; doubles per attempt, capped at 30 s. */
  reconnectDelayMs?: number;
  /** Feed-silence window after which the connection is considered dead. */
  watchdogMs?: number;
  webSocketFactory?: WebSocketFactory;
}

const defaultFactory: WebSocketFactory = (url, headers) =>
  new WebSocket(url, {headers});

const MAX_RECONNECT_DELAY_MS = 30_000;

/**
 * Maintains the INX order-book subscription: token → connect → subscribe →
 * snapshot → deltas. Any anomaly (disconnect, malformed message, feed
 * silence) triggers a full resync: the book is reset and the first message
 * after resubscribing is treated as a fresh snapshot.
 */
export class InxFeed {
  private socket: WebSocket | null = null;
  private stopped = true;
  private awaitingSnapshot = true;
  private attempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: FeedOptions) {}

  /** Connects and keeps the subscription alive until `stop()` is called. */
  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  /** Closes the connection and cancels all timers. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.clearTimers();
    this.socket?.terminate();
    this.socket = null;
    await this.options.auth.revokeWsToken().catch(() => {
      // Best-effort cleanup; the token dies with the connection anyway.
    });
  }

  private get logger(): Logger {
    return this.options.logger ?? console;
  }

  private async connect(): Promise<void> {
    let token: string;
    try {
      // INX allows a single token per connection: revoke the previous one
      // (best-effort) before requesting a fresh token.
      await this.options.auth.revokeWsToken().catch(() => {});
      token = await this.options.auth.createWsToken();
    } catch (error) {
      this.logger.error(`INX token creation failed: ${String(error)}`);
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) {
      return;
    }

    const factory = this.options.webSocketFactory ?? defaultFactory;
    const socket = factory(this.options.wsUrl, {
      authorization: token,
      apiKey: this.options.apiKeyId,
    });
    this.socket = socket;
    this.awaitingSnapshot = true;

    socket.on('open', () => {
      this.logger.info('INX feed connected; subscribing');
      socket.send(
        JSON.stringify({
          event: 'orderBook/subscribeOrderBook',
          data: {
            marketName: this.options.marketName,
            depth: this.options.depth,
            clientRequestId: randomUUID(),
          },
        }),
      );
      this.armWatchdog();
    });
    socket.on('message', data => {
      this.armWatchdog();
      this.handleMessage(String(data));
    });
    socket.on('ping', () => this.armWatchdog());
    socket.on('error', error => {
      this.logger.error(`INX feed socket error: ${String(error)}`);
    });
    socket.on('close', () => {
      if (!this.stopped) {
        this.logger.warn('INX feed disconnected');
        this.scheduleReconnect();
      }
    });
  }

  private handleMessage(raw: string): void {
    let message: z.infer<typeof messageSchema>;
    try {
      message = messageSchema.parse(JSON.parse(raw));
    } catch {
      this.logger.error('INX feed sent an unparseable message; resyncing');
      this.resync();
      return;
    }
    if (message.event !== 'ORDER_BOOK') {
      return; // Subscription acks and other events are irrelevant here.
    }
    const parsed = orderBookEventSchema.safeParse(message);
    if (!parsed.success) {
      this.logger.error('INX ORDER_BOOK message failed validation; resyncing');
      this.resync();
      return;
    }
    if (parsed.data.marketName !== this.options.marketName) {
      return;
    }
    if (this.awaitingSnapshot) {
      this.options.book.applySnapshot(parsed.data.buy, parsed.data.sell);
      this.awaitingSnapshot = false;
      this.attempts = 0;
      this.logger.info('INX order book snapshot applied');
    } else {
      this.options.book.applyDelta(parsed.data.buy, parsed.data.sell);
    }
    this.options.onUpdate?.();
  }

  /** Tears the connection down; `close` triggers the reconnect path. */
  private resync(): void {
    this.socket?.terminate();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) {
      return;
    }
    this.clearTimers();
    this.options.book.reset();
    // Fan the not-ready state out immediately: clients must not keep
    // rendering a stale book while we resync (can take up to 30 s).
    this.options.onUpdate?.();
    const base = this.options.reconnectDelayMs ?? 1_000;
    const delay = Math.min(base * 2 ** this.attempts, MAX_RECONNECT_DELAY_MS);
    this.attempts += 1;
    this.logger.warn(`INX feed reconnecting in ${delay} ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private armWatchdog(): void {
    if (this.watchdogTimer !== null) {
      clearTimeout(this.watchdogTimer);
    }
    const timeout = this.options.watchdogMs ?? 30_000;
    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = null;
      this.logger.warn('INX feed silent for too long; resyncing');
      this.resync();
    }, timeout);
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.watchdogTimer !== null) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }
}
