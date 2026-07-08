/** Wire types of the backend's /ws frames (kept in sync with server). */

export interface Level {
  price: number;
  amount: number;
}

export interface BookStats {
  spread: number;
  midPrice: number;
}

export interface BroadcastFrame {
  bids: Level[];
  asks: Level[];
  stats: BookStats | null;
}
