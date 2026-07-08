import {EventEmitter} from 'node:events';

import {WebSocketServer} from 'ws';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type WebSocket from 'ws';

import {InxFeed} from '../src/inx-feed.js';
import {OrderBook} from '../src/order-book.js';

class FakeSocket extends EventEmitter {
  sent: string[] = [];
  terminated = false;

  send(data: string): void {
    this.sent.push(data);
  }

  terminate(): void {
    this.terminated = true;
    this.emit('close');
  }
}

const orderBookMessage = (
  buy: Array<{price: number; amount: number}>,
  sell: Array<{price: number; amount: number}>,
  marketName = 'BTC-USD',
) => JSON.stringify({event: 'ORDER_BOOK', sentTime: 1, marketName, buy, sell});

const makeHarness = (
  overrides: Partial<ConstructorParameters<typeof InxFeed>[0]> = {},
) => {
  const sockets: FakeSocket[] = [];
  const headersSeen: Array<Record<string, string>> = [];
  const auth = {
    createWsToken: vi.fn().mockResolvedValue('tok'),
    revokeWsToken: vi.fn().mockResolvedValue(undefined),
  };
  const book = new OrderBook();
  const logger = {info: vi.fn(), warn: vi.fn(), error: vi.fn()};
  const onUpdate = vi.fn();
  const feed = new InxFeed({
    wsUrl: 'ws://feed.test',
    marketName: 'BTC-USD',
    depth: 20,
    apiKeyId: 'key-id',
    auth,
    book,
    logger,
    onUpdate,
    reconnectDelayMs: 100,
    watchdogMs: 1_000,
    webSocketFactory: (url, headers) => {
      headersSeen.push(headers);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    ...overrides,
  });
  return {feed, sockets, headersSeen, auth, book, logger, onUpdate};
};

describe('InxFeed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('authenticates and subscribes on open', async () => {
    const {feed, sockets, headersSeen, auth} = makeHarness();
    await feed.start();
    expect(auth.revokeWsToken).toHaveBeenCalled();
    expect(auth.createWsToken).toHaveBeenCalledOnce();
    expect(headersSeen[0]).toEqual({authorization: 'tok', apiKey: 'key-id'});
    sockets[0].emit('open');
    const subscribe = JSON.parse(sockets[0].sent[0]);
    expect(subscribe.event).toBe('orderBook/subscribeOrderBook');
    expect(subscribe.data.marketName).toBe('BTC-USD');
    expect(subscribe.data.depth).toBe(20);
    expect(subscribe.data.clientRequestId).toMatch(/[0-9a-f-]{36}/);
    await feed.stop();
  });

  it('treats the first message as snapshot and later ones as deltas', async () => {
    const {feed, sockets, book, onUpdate} = makeHarness();
    await feed.start();
    sockets[0].emit('open');
    sockets[0].emit(
      'message',
      orderBookMessage([{price: 100, amount: 1}], [{price: 101, amount: 2}]),
    );
    expect(book.topN(10)).toEqual({
      bids: [{price: 100, amount: 1}],
      asks: [{price: 101, amount: 2}],
    });
    sockets[0].emit(
      'message',
      orderBookMessage([{price: 99, amount: 3}], [{price: 101, amount: 0}]),
    );
    expect(book.topN(10)).toEqual({
      bids: [
        {price: 100, amount: 1},
        {price: 99, amount: 3},
      ],
      asks: [],
    });
    expect(onUpdate).toHaveBeenCalledTimes(2);
    await feed.stop();
  });

  it('ignores other events and other markets', async () => {
    const {feed, sockets, book, onUpdate} = makeHarness();
    await feed.start();
    sockets[0].emit('open');
    sockets[0].emit('message', JSON.stringify({event: 'ACK', ok: true}));
    sockets[0].emit(
      'message',
      orderBookMessage([{price: 1, amount: 1}], [], 'ETH-USD'),
    );
    expect(book.isReady()).toBe(false);
    expect(onUpdate).not.toHaveBeenCalled();
    await feed.stop();
  });

  it('resyncs on unparseable messages', async () => {
    const {feed, sockets, logger} = makeHarness();
    await feed.start();
    sockets[0].emit('open');
    sockets[0].emit('message', 'not-json');
    expect(sockets[0].terminated).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(
      'INX feed sent an unparseable message; resyncing',
    );
    await feed.stop();
  });

  it('accepts negative amounts (UAT quirk) and routes them as removals', async () => {
    const {feed, sockets, book} = makeHarness();
    await feed.start();
    sockets[0].emit('open');
    sockets[0].emit(
      'message',
      orderBookMessage(
        [
          {price: 100, amount: 1},
          {price: 99, amount: 2},
        ],
        [{price: 101, amount: 1}],
      ),
    );
    sockets[0].emit(
      'message',
      orderBookMessage([{price: 99, amount: -0.5}], []),
    );
    expect(sockets[0].terminated).toBe(false); // no resync
    expect(book.topN(10).bids).toEqual([{price: 100, amount: 1}]);
    await feed.stop();
  });

  it('resyncs on ORDER_BOOK messages that fail validation', async () => {
    const {feed, sockets} = makeHarness();
    await feed.start();
    sockets[0].emit('open');
    sockets[0].emit(
      'message',
      JSON.stringify({
        event: 'ORDER_BOOK',
        marketName: 'BTC-USD',
        buy: [{price: -5, amount: 1}],
        sell: [],
      }),
    );
    expect(sockets[0].terminated).toBe(true);
    await feed.stop();
  });

  it('reconnects with a fresh snapshot after a disconnect', async () => {
    const {feed, sockets, book} = makeHarness();
    await feed.start();
    sockets[0].emit('open');
    sockets[0].emit(
      'message',
      orderBookMessage([{price: 100, amount: 1}], [{price: 101, amount: 1}]),
    );
    sockets[0].emit('close');
    expect(book.isReady()).toBe(false); // book reset while disconnected
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(2);
    sockets[1].emit('open');
    sockets[1].emit(
      'message',
      orderBookMessage([{price: 55, amount: 5}], [{price: 56, amount: 6}]),
    );
    expect(book.topN(10)).toEqual({
      bids: [{price: 55, amount: 5}],
      asks: [{price: 56, amount: 6}],
    });
    await feed.stop();
  });

  it('broadcasts the reset (not-ready) state after a disconnect', async () => {
    const {feed, sockets, book, onUpdate} = makeHarness();
    await feed.start();
    sockets[0].emit('open');
    sockets[0].emit(
      'message',
      orderBookMessage([{price: 100, amount: 1}], [{price: 101, amount: 1}]),
    );
    expect(onUpdate).toHaveBeenCalledTimes(1);
    sockets[0].emit('close');
    // Clients are told immediately that the book is stale/not ready.
    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(book.isReady()).toBe(false);
    expect(book.getStats()).toBeNull();
    await feed.stop();
  });

  it('backs off exponentially and caps the reconnect delay', async () => {
    const {feed, logger, auth} = makeHarness({
      webSocketFactory: () => {
        throw new Error('unreachable');
      },
    });
    auth.createWsToken.mockRejectedValue(new Error('rest down'));
    await feed.start();
    const delays = () =>
      logger.warn.mock.calls
        .map(([msg]) => /reconnecting in (\d+) ms/.exec(msg)?.[1])
        .filter(Boolean)
        .map(Number);
    expect(delays()).toEqual([100]);
    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
    }
    const seen = delays();
    expect(seen).toContain(30_000); // capped
    expect(Math.max(...seen)).toBe(30_000);
    await feed.stop();
  });

  it('resets the backoff after a successful snapshot', async () => {
    const {feed, sockets, logger} = makeHarness();
    await feed.start();
    sockets[0].emit('close'); // failure 1 → 100 ms
    await vi.advanceTimersByTimeAsync(100);
    sockets[1].emit('open');
    sockets[1].emit('message', orderBookMessage([{price: 1, amount: 1}], []));
    sockets[1].emit('close'); // after snapshot: backoff starts over
    const delays = logger.warn.mock.calls
      .map(([msg]) => /reconnecting in (\d+) ms/.exec(msg)?.[1])
      .filter(Boolean)
      .map(Number);
    expect(delays).toEqual([100, 100]);
    await feed.stop();
  });

  it('does not double-schedule reconnects', async () => {
    const {feed, sockets} = makeHarness();
    await feed.start();
    sockets[0].emit('close');
    sockets[0].emit('close');
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(2);
    await feed.stop();
  });

  it('resyncs when the feed goes silent (watchdog)', async () => {
    const {feed, sockets} = makeHarness();
    await feed.start();
    sockets[0].emit('open');
    await vi.advanceTimersByTimeAsync(999);
    expect(sockets[0].terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets[0].terminated).toBe(true);
    await feed.stop();
  });

  it('keeps the watchdog fed by messages and pings', async () => {
    const {feed, sockets} = makeHarness();
    await feed.start();
    sockets[0].emit('open');
    await vi.advanceTimersByTimeAsync(900);
    sockets[0].emit('ping');
    await vi.advanceTimersByTimeAsync(900);
    sockets[0].emit('message', orderBookMessage([], []));
    await vi.advanceTimersByTimeAsync(900);
    expect(sockets[0].terminated).toBe(false);
    await feed.stop();
  });

  it('logs socket errors without crashing', async () => {
    const {feed, sockets, logger} = makeHarness();
    await feed.start();
    sockets[0].emit('error', new Error('boom'));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('boom'));
    await feed.stop();
  });

  it('stop() prevents reconnects and revokes the token', async () => {
    const {feed, sockets, auth} = makeHarness();
    await feed.start();
    sockets[0].emit('open');
    await feed.stop();
    expect(sockets[0].terminated).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
    expect(auth.revokeWsToken).toHaveBeenCalled();
  });

  it('tolerates revoke failures during stop()', async () => {
    const {feed, auth} = makeHarness();
    auth.revokeWsToken.mockRejectedValue(new Error('nope'));
    await feed.start();
    await expect(feed.stop()).resolves.toBeUndefined();
  });

  it('aborts a connect that resolves after stop()', async () => {
    const {feed, sockets, auth} = makeHarness();
    let release: (value: string) => void = () => {};
    auth.createWsToken.mockReturnValue(
      new Promise<string>(resolve => {
        release = resolve;
      }),
    );
    const starting = feed.start();
    await feed.stop();
    release('tok');
    await starting;
    expect(sockets).toHaveLength(0);
  });

  it('does not schedule a reconnect for failures after stop()', async () => {
    const {feed, sockets, auth, logger} = makeHarness();
    let fail: (error: Error) => void = () => {};
    auth.createWsToken.mockReturnValue(
      new Promise<string>((_resolve, reject) => {
        fail = reject;
      }),
    );
    const starting = feed.start();
    await feed.stop();
    fail(new Error('too late'));
    await starting;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(0);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('falls back to console logging and default timings', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const {feed, sockets} = makeHarness({
      logger: undefined,
      reconnectDelayMs: undefined,
      watchdogMs: undefined,
    });
    await feed.start();
    sockets[0].emit('open');
    expect(info).toHaveBeenCalledWith('INX feed connected; subscribing');
    sockets[0].emit('message', 'not-json');
    expect(error).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000); // default reconnect delay
    expect(sockets).toHaveLength(2);
    expect(warn).toHaveBeenCalled();
    await feed.stop();
    info.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });

  it('connects through the real ws transport by default', async () => {
    vi.useRealTimers();
    const server = new WebSocketServer({port: 0});
    const port = (server.address() as {port: number}).port;
    const received = new Promise<Record<string, unknown>>(resolve => {
      server.on('connection', (socket, request) => {
        expect(request.headers.authorization).toBe('tok');
        expect(request.headers.apikey).toBe('key-id');
        socket.on('message', data => resolve(JSON.parse(String(data))));
      });
    });
    const {feed} = makeHarness({
      wsUrl: `ws://127.0.0.1:${port}`,
      webSocketFactory: undefined,
    });
    await feed.start();
    const subscribe = await received;
    expect(subscribe.event).toBe('orderBook/subscribeOrderBook');
    await feed.stop();
    server.close();
  });
});
