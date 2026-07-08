import {describe, expect, it} from 'vitest';

import {OrderBook} from '../src/order-book.js';

const SNAPSHOT_BUY = [
  {price: 100, amount: 1},
  {price: 99, amount: 2},
  {price: 98, amount: 3},
];
const SNAPSHOT_SELL = [
  {price: 101, amount: 1.5},
  {price: 102, amount: 2.5},
  {price: 103, amount: 3.5},
];

const makeBook = () => {
  const book = new OrderBook();
  book.applySnapshot(SNAPSHOT_BUY, SNAPSHOT_SELL);
  return book;
};

describe('OrderBook', () => {
  it('is not ready and has no stats before the first snapshot', () => {
    const book = new OrderBook();
    expect(book.isReady()).toBe(false);
    expect(book.getStats()).toBeNull();
    expect(book.topN(10)).toEqual({bids: [], asks: []});
  });

  it('applies a snapshot and orders bids descending, asks ascending', () => {
    const book = new OrderBook();
    // Deliberately unordered input: ordering must come from the book.
    book.applySnapshot(
      [
        {price: 98, amount: 3},
        {price: 100, amount: 1},
        {price: 99, amount: 2},
      ],
      [
        {price: 103, amount: 3.5},
        {price: 101, amount: 1.5},
        {price: 102, amount: 2.5},
      ],
    );
    expect(book.isReady()).toBe(true);
    expect(book.topN(10)).toEqual({bids: SNAPSHOT_BUY, asks: SNAPSHOT_SELL});
  });

  it('computes spread and mid price from best bid/ask', () => {
    const book = makeBook();
    expect(book.getStats()).toEqual({spread: 1, midPrice: 100.5});
  });

  it('overrides the amount of an existing level on delta', () => {
    const book = makeBook();
    book.applyDelta([{price: 100, amount: 9}], [{price: 101, amount: 8}]);
    expect(book.topN(1)).toEqual({
      bids: [{price: 100, amount: 9}],
      asks: [{price: 101, amount: 8}],
    });
  });

  it('inserts a new level on delta and keeps ordering', () => {
    const book = makeBook();
    book.applyDelta([{price: 99.5, amount: 4}], [{price: 100.5, amount: 5}]);
    expect(book.topN(2)).toEqual({
      bids: [
        {price: 100, amount: 1},
        {price: 99.5, amount: 4},
      ],
      asks: [
        {price: 100.5, amount: 5},
        {price: 101, amount: 1.5},
      ],
    });
  });

  it('removes a level when the delta amount is 0', () => {
    const book = makeBook();
    book.applyDelta([{price: 100, amount: 0}], [{price: 101, amount: 0}]);
    expect(book.topN(1)).toEqual({
      bids: [{price: 99, amount: 2}],
      asks: [{price: 102, amount: 2.5}],
    });
  });

  it('treats negative amounts as removals (UAT feed quirk)', () => {
    const book = makeBook();
    book.applyDelta([{price: 100, amount: -0.5}], [{price: 101, amount: -1}]);
    expect(book.topN(1)).toEqual({
      bids: [{price: 99, amount: 2}],
      asks: [{price: 102, amount: 2.5}],
    });
  });

  it('drops non-positive levels arriving inside a snapshot', () => {
    const book = new OrderBook();
    book.applySnapshot(
      [
        {price: 100, amount: 1},
        {price: 99.5, amount: -0.02},
      ],
      [{price: 101, amount: 1}],
    );
    expect(book.topN(10).bids).toEqual([{price: 100, amount: 1}]);
  });

  it('ignores removal of a price that is not in the book', () => {
    const book = makeBook();
    book.applyDelta([{price: 55, amount: 0}], [{price: 555, amount: 0}]);
    expect(book.topN(10)).toEqual({bids: SNAPSHOT_BUY, asks: SNAPSHOT_SELL});
  });

  it('re-adds a previously removed level', () => {
    const book = makeBook();
    book.applyDelta([{price: 100, amount: 0}], []);
    book.applyDelta([{price: 100, amount: 7}], []);
    expect(book.topN(1).bids).toEqual([{price: 100, amount: 7}]);
  });

  it('updates stats on every mutation', () => {
    const book = makeBook();
    book.applyDelta([{price: 100.5, amount: 1}], []);
    expect(book.getStats()).toEqual({spread: 0.5, midPrice: 100.75});
    book.applyDelta([{price: 100.5, amount: 0}], [{price: 101, amount: 0}]);
    expect(book.getStats()).toEqual({spread: 2, midPrice: 101});
  });

  it('reports null stats when a side becomes empty', () => {
    const book = new OrderBook();
    book.applySnapshot([{price: 100, amount: 1}], [{price: 101, amount: 1}]);
    book.applyDelta([], [{price: 101, amount: 0}]);
    expect(book.getStats()).toBeNull();
    book.applyDelta([{price: 100, amount: 0}], []);
    expect(book.getStats()).toBeNull();
  });

  it('limits topN to the requested depth', () => {
    const book = makeBook();
    const view = book.topN(2);
    expect(view.bids).toHaveLength(2);
    expect(view.asks).toHaveLength(2);
  });

  it('replaces the whole book on a new snapshot', () => {
    const book = makeBook();
    book.applySnapshot([{price: 50, amount: 1}], [{price: 51, amount: 1}]);
    expect(book.topN(10)).toEqual({
      bids: [{price: 50, amount: 1}],
      asks: [{price: 51, amount: 1}],
    });
    expect(book.getStats()).toEqual({spread: 1, midPrice: 50.5});
  });

  it('reset() forgets state and readiness', () => {
    const book = makeBook();
    book.reset();
    expect(book.isReady()).toBe(false);
    expect(book.getStats()).toBeNull();
    expect(book.topN(10)).toEqual({bids: [], asks: []});
  });
});
