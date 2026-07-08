import {useEffect, useState} from 'react';

import {BroadcastFrame} from './types.js';

/** ws(s):// URL of the backend fan-out, derived from the page origin. */
export const defaultWsUrl = (
  location: {protocol: string; host: string} = window.location,
): string => {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${location.host}/ws`;
};

export interface OrderBookConnection {
  /** Latest frame, or null before the first one arrives. */
  frame: BroadcastFrame | null;
  /** False while the socket is down — the frame on screen may be stale. */
  connected: boolean;
}

/**
 * Subscribes to the backend's order-book fan-out.
 *
 * Incoming frames are stashed and flushed to React state at most once per
 * animation frame, so a burst of WebSocket messages costs a single render —
 * the core of the "smooth UI under frequent updates" requirement. The socket
 * reconnects automatically when closed, and `connected` lets the UI flag
 * stale data in the meantime.
 */
export const useOrderBook = (
  url?: string,
  reconnectDelayMs = 1_000,
): OrderBookConnection => {
  const [frame, setFrame] = useState<BroadcastFrame | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const target = url ?? defaultWsUrl();
    let disposed = false;
    let socket: WebSocket;
    let reconnectTimer: number | undefined;
    let rafHandle = 0;
    let latest: BroadcastFrame | null = null;
    let flushScheduled = false;

    const connect = () => {
      socket = new WebSocket(target);
      socket.onopen = () => setConnected(true);
      socket.onmessage = event => {
        try {
          latest = JSON.parse(String(event.data)) as BroadcastFrame;
        } catch {
          return; // Ignore malformed frames rather than crash the UI.
        }
        if (!flushScheduled) {
          flushScheduled = true;
          rafHandle = requestAnimationFrame(() => {
            flushScheduled = false;
            setFrame(latest);
          });
        }
      };
      socket.onclose = () => {
        if (!disposed) {
          setConnected(false);
          reconnectTimer = window.setTimeout(connect, reconnectDelayMs);
        }
      };
    };
    connect();

    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      cancelAnimationFrame(rafHandle);
      socket.close();
    };
  }, [url, reconnectDelayMs]);

  return {frame, connected};
};
