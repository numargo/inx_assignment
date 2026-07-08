import {BookStats, Level, OrderBook} from './order-book.js';

/** Frame pushed to every connected UI client. */
export interface BroadcastFrame {
  bids: Level[];
  asks: Level[];
  stats: BookStats | null;
}

/** Structural socket contract — satisfied by `ws` sockets and test fakes. */
export interface ClientSocket {
  readyState: number;
  send(data: string): void;
  on(event: 'close', listener: () => void): unknown;
}

const OPEN = 1; // WebSocket.OPEN

/**
 * Fans the order book out to UI clients over WebSocket, coalescing bursts:
 * the first update after a quiet period is sent immediately, then at most
 * one frame per `intervalMs` — frequent INX deltas never flood the UI.
 */
export class Broadcaster {
  private readonly clients = new Set<ClientSocket>();
  private cooldown: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(
    private readonly book: OrderBook,
    private readonly depth = 10,
    private readonly intervalMs = 100,
  ) {}

  /** Registers a UI client and primes it with the current book, if any. */
  addClient(socket: ClientSocket): void {
    this.clients.add(socket);
    socket.on('close', () => this.clients.delete(socket));
    if (this.book.isReady()) {
      socket.send(this.frame());
    }
  }

  /** Signals that the book changed; sends now or after the cooldown. */
  notify(): void {
    if (this.cooldown !== null) {
      this.dirty = true;
      return;
    }
    this.flush();
    this.cooldown = setTimeout(() => {
      this.cooldown = null;
      if (this.dirty) {
        this.dirty = false;
        this.notify();
      }
    }, this.intervalMs);
  }

  /** Cancels the pending cooldown (for shutdown). */
  stop(): void {
    if (this.cooldown !== null) {
      clearTimeout(this.cooldown);
      this.cooldown = null;
    }
  }

  /** Number of connected clients (diagnostics/tests). */
  clientCount(): number {
    return this.clients.size;
  }

  private frame(): string {
    const view = this.book.topN(this.depth);
    const frame: BroadcastFrame = {...view, stats: this.book.getStats()};
    return JSON.stringify(frame);
  }

  private flush(): void {
    const frame = this.frame();
    for (const client of this.clients) {
      if (client.readyState === OPEN) {
        client.send(frame);
      }
    }
  }
}
