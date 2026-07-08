import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {Broadcaster} from '../src/broadcast.js';
import {OrderBook} from '../src/order-book.js';

class FakeClient {
  readyState = 1;
  sent: string[] = [];
  private closeListener: (() => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  on(_event: 'close', listener: () => void): void {
    this.closeListener = listener;
  }

  close(): void {
    this.closeListener?.();
  }

  frames(): Array<{
    bids: unknown[];
    asks: unknown[];
    stats: unknown;
  }> {
    return this.sent.map(raw => JSON.parse(raw));
  }
}

const readyBook = () => {
  const book = new OrderBook();
  book.applySnapshot([{price: 100, amount: 1}], [{price: 101, amount: 2}]);
  return book;
};

describe('Broadcaster', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('primes a new client with the current book when ready', () => {
    const broadcaster = new Broadcaster(readyBook(), 10, 100);
    const client = new FakeClient();
    broadcaster.addClient(client);
    expect(client.frames()).toEqual([
      {
        bids: [{price: 100, amount: 1}],
        asks: [{price: 101, amount: 2}],
        stats: {spread: 1, midPrice: 100.5},
      },
    ]);
  });

  it('sends no priming frame before the first snapshot', () => {
    const broadcaster = new Broadcaster(new OrderBook(), 10, 100);
    const client = new FakeClient();
    broadcaster.addClient(client);
    expect(client.sent).toHaveLength(0);
  });

  it('sends the first update immediately and coalesces bursts', () => {
    const book = readyBook();
    const broadcaster = new Broadcaster(book, 10, 100);
    const client = new FakeClient();
    broadcaster.addClient(client);
    broadcaster.notify();
    expect(client.sent).toHaveLength(2); // prime + immediate
    book.applyDelta([{price: 99, amount: 1}], []);
    broadcaster.notify();
    broadcaster.notify();
    expect(client.sent).toHaveLength(2); // throttled
    vi.advanceTimersByTime(100);
    expect(client.sent).toHaveLength(3); // trailing frame with latest book
    expect(client.frames()[2].bids).toEqual([
      {price: 100, amount: 1},
      {price: 99, amount: 1},
    ]);
    broadcaster.stop();
  });

  it('goes quiet when there is nothing new to send', () => {
    const broadcaster = new Broadcaster(readyBook(), 10, 100);
    const client = new FakeClient();
    broadcaster.addClient(client);
    broadcaster.notify();
    vi.advanceTimersByTime(500);
    expect(client.sent).toHaveLength(2); // no trailing frame without notify
  });

  it('respects the configured depth', () => {
    const book = readyBook();
    book.applyDelta(
      [
        {price: 99, amount: 1},
        {price: 98, amount: 1},
      ],
      [],
    );
    const broadcaster = new Broadcaster(book, 2, 100);
    const client = new FakeClient();
    broadcaster.addClient(client);
    expect(client.frames()[0].bids).toHaveLength(2);
  });

  it('skips sockets that are not open and drops closed clients', () => {
    const broadcaster = new Broadcaster(readyBook(), 10, 100);
    const open = new FakeClient();
    const closing = new FakeClient();
    broadcaster.addClient(open);
    broadcaster.addClient(closing);
    expect(broadcaster.clientCount()).toBe(2);
    closing.readyState = 3; // CLOSED
    broadcaster.notify();
    expect(open.sent).toHaveLength(2);
    expect(closing.sent).toHaveLength(1); // only the priming frame
    closing.close();
    expect(broadcaster.clientCount()).toBe(1);
    broadcaster.stop();
  });

  it('stop() cancels the pending cooldown', () => {
    const broadcaster = new Broadcaster(readyBook(), 10, 100);
    const client = new FakeClient();
    broadcaster.addClient(client);
    broadcaster.notify();
    broadcaster.notify(); // marks dirty
    broadcaster.stop();
    vi.advanceTimersByTime(1_000);
    expect(client.sent).toHaveLength(2);
    broadcaster.stop(); // idempotent
  });

  it('uses default depth and interval', () => {
    const broadcaster = new Broadcaster(readyBook());
    const client = new FakeClient();
    broadcaster.addClient(client);
    broadcaster.notify();
    broadcaster.notify();
    vi.advanceTimersByTime(100); // default interval
    expect(client.sent).toHaveLength(3);
    broadcaster.stop();
  });
});
