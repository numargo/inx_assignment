import {OrderedMap} from '@js-sdsl/ordered-map';

/** A single price level of the book. */
export interface Level {
  price: number;
  amount: number;
}

/** Statistics derived from the best bid/ask, cached on every mutation. */
export interface BookStats {
  spread: number;
  midPrice: number;
}

/** Top-N view of both sides, best prices first. */
export interface BookView {
  bids: Level[];
  asks: Level[];
}

/**
 * In-memory BTC/USD order book.
 *
 * Each side is a red-black tree (`OrderedMap`) keyed by price — bids
 * descending, asks ascending — so insert, override and delete are all
 * O(log n) and the best price is always at the front. Stats (spread and
 * mid-price) are recomputed on every mutation and served from memory in O(1).
 */
export class OrderBook {
  private readonly bids = new OrderedMap<number, number>([], (a, b) => b - a);
  private readonly asks = new OrderedMap<number, number>([], (a, b) => a - b);
  private stats: BookStats | null = null;
  private ready = false;

  /** Replaces the whole book with a fresh snapshot. */
  applySnapshot(buy: readonly Level[], sell: readonly Level[]): void {
    this.bids.clear();
    this.asks.clear();
    this.ready = true;
    this.applyDelta(buy, sell);
  }

  /**
   * Applies a delta update: per tier, a positive amount overrides the level
   * (inserting it if absent) and an amount of 0 removes it — the INX
   * contract. Negative amounts (seen on the UAT feed, undocumented) are
   * treated as removals too: non-positive size is not displayable liquidity.
   */
  applyDelta(buy: readonly Level[], sell: readonly Level[]): void {
    for (const level of buy) {
      this.applyLevel(this.bids, level);
    }
    for (const level of sell) {
      this.applyLevel(this.asks, level);
    }
    this.refreshStats();
  }

  /** Forgets all state (used when resyncing after a feed anomaly). */
  reset(): void {
    this.bids.clear();
    this.asks.clear();
    this.stats = null;
    this.ready = false;
  }

  /** True once the first snapshot has been applied. */
  isReady(): boolean {
    return this.ready;
  }

  /** Cached spread/mid-price; null until both sides have at least one level. */
  getStats(): BookStats | null {
    return this.stats;
  }

  /**
   * Best `n` levels per side, best prices first. Note: the OrderedMap
   * iterator materializes the side eagerly, so this is O(side size) — fine
   * at the configured depth (≤100 levels), stated here for honesty.
   */
  topN(n: number): BookView {
    return {bids: this.take(this.bids, n), asks: this.take(this.asks, n)};
  }

  private applyLevel(side: OrderedMap<number, number>, level: Level): void {
    if (level.amount <= 0) {
      side.eraseElementByKey(level.price);
    } else {
      side.setElement(level.price, level.amount);
    }
  }

  private refreshStats(): void {
    const bestBid = this.bids.front();
    const bestAsk = this.asks.front();
    if (bestBid === undefined || bestAsk === undefined) {
      this.stats = null;
      return;
    }
    this.stats = {
      spread: bestAsk[0] - bestBid[0],
      midPrice: (bestAsk[0] + bestBid[0]) / 2,
    };
  }

  private take(side: OrderedMap<number, number>, n: number): Level[] {
    const levels: Level[] = [];
    for (const [price, amount] of side) {
      if (levels.length >= n) {
        break;
      }
      levels.push({price, amount});
    }
    return levels;
  }
}
