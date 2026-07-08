import {once} from 'node:events';

import WebSocket from 'ws';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {FastifyInstance} from 'fastify';

import {buildApp} from '../src/app.js';
import {Broadcaster} from '../src/broadcast.js';
import {OrderBook} from '../src/order-book.js';

let app: FastifyInstance | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
});

const makeApp = async (book = new OrderBook()) => {
  const broadcaster = new Broadcaster(book, 10, 5);
  app = await buildApp({book, broadcaster});
  return {app, book, broadcaster};
};

describe('GET /api/orderbook/stats', () => {
  it('returns 503 before the first snapshot', async () => {
    const {app} = await makeApp();
    const response = await app.inject({url: '/api/orderbook/stats'});
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({error: 'order book not ready'});
  });

  it('returns 503 when the book is ready but one side is empty', async () => {
    const book = new OrderBook();
    book.applySnapshot([{price: 100, amount: 1}], []);
    const {app} = await makeApp(book);
    const response = await app.inject({url: '/api/orderbook/stats'});
    expect(response.statusCode).toBe(503);
  });

  it('returns cached spread and mid price', async () => {
    const book = new OrderBook();
    book.applySnapshot([{price: 100, amount: 1}], [{price: 102, amount: 1}]);
    const {app} = await makeApp(book);
    const response = await app.inject({url: '/api/orderbook/stats'});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({spread: 2, midPrice: 101});
  });

  it('answers errors with a generic message (no internals)', async () => {
    const book = new OrderBook();
    vi.spyOn(book, 'getStats').mockImplementation(() => {
      throw new Error('secret database string');
    });
    const {app} = await makeApp(book);
    const response = await app.inject({url: '/api/orderbook/stats'});
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({error: 'internal server error'});
    expect(response.body).not.toContain('secret');
  });
});

describe('/ws fan-out', () => {
  it('streams priming frame and throttled updates to clients', async () => {
    const book = new OrderBook();
    book.applySnapshot([{price: 100, amount: 1}], [{price: 101, amount: 2}]);
    const {app, broadcaster} = await makeApp(book);
    const address = await app.listen({port: 0, host: '127.0.0.1'});

    const socket = new WebSocket(`${address.replace('http', 'ws')}/ws`);
    const frames: Array<Record<string, unknown>> = [];
    socket.on('message', data => frames.push(JSON.parse(String(data))));
    await once(socket, 'open');

    // Priming frame arrives on connect.
    await vi.waitFor(() => expect(frames).toHaveLength(1));
    expect(frames[0]).toEqual({
      bids: [{price: 100, amount: 1}],
      asks: [{price: 101, amount: 2}],
      stats: {spread: 1, midPrice: 100.5},
    });

    book.applyDelta([{price: 99, amount: 5}], []);
    broadcaster.notify();
    await vi.waitFor(() => expect(frames).toHaveLength(2));
    expect(frames[1].bids).toEqual([
      {price: 100, amount: 1},
      {price: 99, amount: 5},
    ]);

    socket.close();
    await once(socket, 'close');
    await vi.waitFor(() => expect(broadcaster.clientCount()).toBe(0));
    broadcaster.stop();
  });
});
