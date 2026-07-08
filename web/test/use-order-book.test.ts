import {act, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {defaultWsUrl, useOrderBook} from '../src/use-order-book.js';
import {BroadcastFrame} from '../src/types.js';

import {MockWebSocket} from './mock-web-socket.js';

let rafQueue: FrameRequestCallback[] = [];
const flushRaf = () => {
  const queue = [...rafQueue];
  rafQueue = [];
  act(() => queue.forEach(callback => callback(0)));
};

const FRAME: BroadcastFrame = {
  bids: [{price: 100, amount: 1}],
  asks: [{price: 101, amount: 2}],
  stats: {spread: 1, midPrice: 100.5},
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
  vi.useRealTimers();
});

describe('useOrderBook', () => {
  it('starts with no frame and disconnected', () => {
    const {result} = renderHook(() => useOrderBook('ws://test/ws'));
    expect(result.current).toEqual({frame: null, connected: false});
    expect(MockWebSocket.instances[0].url).toBe('ws://test/ws');
  });

  it('reports connected once the socket opens', () => {
    const {result} = renderHook(() => useOrderBook('ws://test/ws'));
    act(() => MockWebSocket.instances[0].open());
    expect(result.current.connected).toBe(true);
  });

  it('publishes a frame once per animation frame', () => {
    const {result} = renderHook(() => useOrderBook('ws://test/ws'));
    act(() => MockWebSocket.instances[0].emit(FRAME));
    expect(result.current.frame).toBeNull(); // not before the rAF flush
    flushRaf();
    expect(result.current.frame).toEqual(FRAME);
  });

  it('coalesces bursts, rendering only the latest frame', () => {
    const {result} = renderHook(() => useOrderBook('ws://test/ws'));
    const second = {...FRAME, stats: {spread: 2, midPrice: 200}};
    act(() => {
      MockWebSocket.instances[0].emit(FRAME);
      MockWebSocket.instances[0].emit(second);
    });
    expect(rafQueue).toHaveLength(1); // one scheduled flush for the burst
    flushRaf();
    expect(result.current.frame).toEqual(second);
  });

  it('ignores malformed frames', () => {
    const {result} = renderHook(() => useOrderBook('ws://test/ws'));
    act(() => MockWebSocket.instances[0].emitRaw('garbage'));
    expect(rafQueue).toHaveLength(0);
    expect(result.current.frame).toBeNull();
  });

  it('flags disconnection and reconnects after the server drops', () => {
    vi.useFakeTimers();
    const {result} = renderHook(() => useOrderBook('ws://test/ws', 500));
    act(() => MockWebSocket.instances[0].open());
    expect(result.current.connected).toBe(true);
    act(() => MockWebSocket.instances[0].dropConnection());
    expect(result.current.connected).toBe(false);
    expect(MockWebSocket.instances).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(MockWebSocket.instances).toHaveLength(2);
    act(() => MockWebSocket.instances[1].open());
    expect(result.current.connected).toBe(true);
  });

  it('closes the socket and stops reconnecting on unmount', () => {
    vi.useFakeTimers();
    const {unmount} = renderHook(() => useOrderBook('ws://test/ws', 500));
    unmount();
    expect(MockWebSocket.instances[0].closeCalls).toBe(1);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('derives the default URL from the page origin', () => {
    expect(defaultWsUrl()).toBe(`ws://${window.location.host}/ws`);
    renderHook(() => useOrderBook());
    expect(MockWebSocket.instances[0].url).toBe(defaultWsUrl());
  });

  it('uses wss on https pages', () => {
    expect(defaultWsUrl({protocol: 'https:', host: 'app.example'})).toBe(
      'wss://app.example/ws',
    );
  });
});
