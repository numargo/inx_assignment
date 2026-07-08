import {memo} from 'react';

import {formatAmount, formatPrice, formatTotal} from './format.js';
import {Level} from './types.js';

export type Side = 'bids' | 'asks';

interface RowProps {
  price: number;
  amount: number;
  side: Side;
  /** Largest total in the visible side, for the depth bar width. */
  maxTotal: number;
}

/**
 * One price level. Memoized on primitive props (not a level object, whose
 * identity changes every frame) and keyed by price in the parent, so an
 * unchanged level skips re-rendering and the DOM stays stable across updates.
 */
const Row = memo(({price, amount, side, maxTotal}: RowProps) => {
  const total = price * amount;
  const width = maxTotal > 0 ? Math.min(100, (total / maxTotal) * 100) : 0;
  return (
    <tr className="level-row">
      <td className="depth-cell">
        <span
          className={`depth-bar depth-${side}`}
          style={{width: `${width}%`}}
        />
        <span className={`price price-${side}`}>{formatPrice(price)}</span>
      </td>
      <td>{formatAmount(amount)}</td>
      <td>{formatTotal(price, amount)}</td>
    </tr>
  );
});

interface SideTableProps {
  side: Side;
  levels: Level[];
}

/** One side of the book: Price · Amount · Total, best price first. */
export const SideTable = ({side, levels}: SideTableProps) => {
  const label = side === 'bids' ? 'Bids' : 'Asks';
  const maxTotal = levels.reduce(
    (max, level) => Math.max(max, level.price * level.amount),
    0,
  );
  return (
    <table className="side-table" aria-label={label}>
      {/* Visible caption: sides must not be distinguished by color alone. */}
      <caption className={`side-caption caption-${side}`}>{label}</caption>
      <thead>
        <tr>
          <th>Price (USD)</th>
          <th>Amount (BTC)</th>
          <th>Total (USD)</th>
        </tr>
      </thead>
      <tbody>
        {levels.map(level => (
          <Row
            key={level.price}
            price={level.price}
            amount={level.amount}
            side={side}
            maxTotal={maxTotal}
          />
        ))}
      </tbody>
    </table>
  );
};
