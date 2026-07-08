import {act, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {App} from '../src/app.js';
import {BroadcastFrame} from '../src/types.js';

import {MockWebSocket} from './mock-web-socket.js';

let rafQueue: FrameRequestCallback[] = [];
const flushRaf = () => {
  const queue = [...rafQueue];
  rafQueue = [];
  act(() => queue.forEach(callback => callback(0)));
};

beforeEach(() => {
  MockWebSocket.reset();
  rafQueue = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal(
    'requestAnimationFrame',
    (callback: FrameRequestCallback): number => {
      rafQueue.push(callback);
      return rafQueue.length;
    },
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const level = (price: number, amount = 1) => ({price, amount});

const emitFrame = (frame: BroadcastFrame) => {
  act(() => MockWebSocket.instances[0].emit(frame));
  flushRaf();
};

const openSocket = () => {
  act(() => MockWebSocket.instances[0].open());
};

describe('App', () => {
  it('shows a connecting state before the first frame', () => {
    render(<App wsUrl="ws://test/ws" />);
    expect(screen.getByText('Connecting to order book…')).toBeTruthy();
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('renders stats, bids left and asks right once frames arrive', () => {
    render(<App wsUrl="ws://test/ws" />);
    openSocket();
    emitFrame({
      bids: [level(64000, 0.5)],
      asks: [level(64001, 0.25)],
      stats: {spread: 1, midPrice: 64000.5},
    });
    expect(screen.getByText('1.00')).toBeTruthy(); // spread
    expect(screen.getByText('64,000.50')).toBeTruthy(); // mid price
    const [bids, asks] = screen.getAllByRole('table');
    expect(bids.getAttribute('aria-label')).toBe('Bids');
    expect(asks.getAttribute('aria-label')).toBe('Asks');
    expect(bids.textContent).toContain('64,000.00');
    expect(asks.textContent).toContain('64,001.00');
    // Connected: no stale banner, book not dimmed.
    expect(screen.queryByText(/Disconnected/)).toBeNull();
    expect(document.querySelector('.book.stale')).toBeNull();
  });

  it('flags stale data when the connection drops', () => {
    render(<App wsUrl="ws://test/ws" />);
    openSocket();
    emitFrame({
      bids: [level(64000)],
      asks: [level(64001)],
      stats: {spread: 1, midPrice: 64000.5},
    });
    act(() => MockWebSocket.instances[0].dropConnection());
    expect(
      screen.getByText('Disconnected — data may be stale, reconnecting…'),
    ).toBeTruthy();
    expect(document.querySelector('.book.stale')).toBeTruthy();
    // The last book stays visible (dimmed), not blanked.
    expect(screen.getAllByRole('table')).toHaveLength(2);
  });

  it('renders dashes while stats are unavailable', () => {
    render(<App wsUrl="ws://test/ws" />);
    emitFrame({bids: [level(100)], asks: [], stats: null});
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.getAllByRole('table')).toHaveLength(2);
  });

  it('shows at most 10 levels per side', () => {
    render(<App wsUrl="ws://test/ws" />);
    const levels = Array.from({length: 12}, (_, i) => level(100 - i));
    emitFrame({
      bids: levels,
      asks: levels.map(l => level(l.price + 50)),
      stats: {spread: 1, midPrice: 100},
    });
    const [bids] = screen.getAllByRole('table');
    // 1 header row + 10 level rows
    expect(bids.querySelectorAll('tr')).toHaveLength(11);
  });
});
