import {formatPrice} from './format.js';
import {SideTable} from './side-table.js';
import {useOrderBook} from './use-order-book.js';

const DEPTH = 10;

/** BTC/USD order book: stats header, bids left, asks right. */
export const App = ({wsUrl}: {wsUrl?: string}) => {
  const {frame, connected} = useOrderBook(wsUrl);

  return (
    <main className="app">
      <header className="header">
        <h1>BTC/USD Order Book</h1>
        <div className="stats" aria-label="Order book statistics">
          <span>
            Spread:{' '}
            <strong>
              {frame?.stats ? formatPrice(frame.stats.spread) : '—'}
            </strong>
          </span>
          <span>
            Mid Price:{' '}
            <strong>
              {frame?.stats ? formatPrice(frame.stats.midPrice) : '—'}
            </strong>
          </span>
        </div>
      </header>
      {frame === null ? (
        <p className="status" role="status" aria-live="polite">
          Connecting to order book…
        </p>
      ) : (
        <>
          {!connected && (
            <p className="status banner" role="status" aria-live="polite">
              Disconnected — data may be stale, reconnecting…
            </p>
          )}
          <section className={connected ? 'book' : 'book stale'}>
            <SideTable side="bids" levels={frame.bids.slice(0, DEPTH)} />
            <SideTable side="asks" levels={frame.asks.slice(0, DEPTH)} />
          </section>
        </>
      )}
    </main>
  );
};
