# INX BTC/USD Real-Time Order Book

A real-time order book for BTC/USD on the INX (UAT) exchange: a Node.js/TypeScript
backend that maintains the live book from the INX WebSocket feed, and a React UI that
renders it — bids on the left, asks on the right, top 10 levels with Price, Amount and
Total — plus a REST endpoint with book statistics.

```
INX UAT ──wss──▶ feed client ──▶ in-memory book ──▶ throttled fan-out ──ws──▶ React UI
                 (snapshot +      (2 red-black       (~10 frames/s)
                  deltas, zod-     trees, cached            │
                  validated)       spread/mid)              └─▶ GET /api/orderbook/stats
```

## How to run

Prerequisites: Node.js ≥ 20, pnpm (`corepack enable`).

```bash
pnpm install
```

### With real INX UAT credentials

Create `.env` in the repo root (see `.env.example`):

```
INX_API_KEY_ID=<your apiKeyId (UUID) from one.uat.inx.co → Settings → API>
INX_PRIVATE_KEY=<the RSA private key PEM generated with that API key; \n-escaped or multiline>
```

Then:

```bash
pnpm dev          # backend on :3000 + Vite dev server on http://127.0.0.1:5173
```

Open http://127.0.0.1:5173. Stats: `curl http://127.0.0.1:3000/api/orderbook/stats`
→ `{"spread": …, "midPrice": …}` (503 until the first snapshot arrives).

### Without credentials (scripted mock feed)

```bash
pnpm --filter @inx-orderbook/e2e run mock-inx   # mock INX gateway on :9101/:9102
# in a second terminal:
INX_REST_URL=http://127.0.0.1:9101 INX_WS_URL=ws://127.0.0.1:9102 \
INX_API_KEY_ID=dev INX_PRIVATE_KEY="$(node -e 'const{generateKeyPairSync}=require("crypto");console.log(generateKeyPairSync("rsa",{modulusLength:2048}).privateKey.export({type:"pkcs8",format:"pem"}))')" \
pnpm --filter @inx-orderbook/server run dev
# in a third terminal:
pnpm --filter @inx-orderbook/web run dev
```

### Quality gates

```bash
pnpm lint         # eslint (gts / Google TS style) + prettier
pnpm typecheck    # tsc --noEmit in every workspace
pnpm coverage     # vitest, 100% coverage thresholds enforced
pnpm e2e          # Playwright end-to-end against the scripted mock feed
pnpm build        # production builds (server → dist/, web → web/dist/)
```

## How WebSocket delta updates are handled

INX sends `ORDER_BOOK` events on one stream: the **first message after subscribing is
the full snapshot**, every following message is a **delta** with the changed tiers only.
Per the INX contract, for each tier in a delta: if the price exists in the local book its
amount is **overridden**; if the amount is **0** the tier is **removed**; unknown prices
are inserted.

- `server/src/order-book.ts` keeps each side in a **red-black tree**
  (`@js-sdsl/ordered-map`) keyed by price — bids descending, asks ascending — so insert,
  override and delete are all **O(log n)**; top-10 reads iterate the (depth-bounded) side.
  **Spread and mid price are recomputed on every mutation** from the tree fronts and
  cached, so `GET /api/orderbook/stats` is an O(1) memory read.
- `server/src/inx-feed.ts` validates **every** message against a zod schema before it
  touches the book, and treats any anomaly — disconnect, unparseable/invalid message, or
  feed silence (watchdog) — as fatal for the current session: it tears the connection
  down, resets the book, reconnects with exponential backoff (capped at 30 s), fetches a
  fresh WebSocket token (`/api/createToken`, RSA-SHA256-signed context), resubscribes,
  and treats the next message as a fresh snapshot. Deltas are therefore never applied to
  a stale or partially-synced book.

## How UI performance is optimized (no flickering)

Two coalescing layers between the raw feed and the DOM:

1. **Server-side throttling** (`server/src/broadcast.ts`): the first book change after a
   quiet period is broadcast immediately, then at most one frame per 100 ms with the
   latest top-10 + stats — bursts of INX deltas never flood clients.
2. **One render per animation frame** (`web/src/use-order-book.ts`): incoming frames are
   stashed in a ref; a `requestAnimationFrame` callback flushes the newest frame into
   React state at most once per display frame.

In the components (`web/src/side-table.tsx`): rows are **memoized on primitive props and
keyed by price**, so an unchanged level never re-renders and React reuses the same DOM
nodes (asserted by an e2e test that tags nodes and verifies identity across live
updates); number formatters are cached `Intl.NumberFormat` instances (constructing one
per call is the classic render-path hidden cost); `font-variant-numeric: tabular-nums`
keeps digits fixed-width so updating numbers don't shift layout; depth bars animate via
CSS `width` transitions only.

**Staleness is visible**: if the backend loses INX, it immediately broadcasts the
not-ready state (stats show `—`); if the browser loses the backend, the UI shows a
"Disconnected — data may be stale, reconnecting…" banner and dims the book until the
socket recovers. Sides carry visible "Bids"/"Asks" captions (not color-only), and status
messages are announced via `aria-live`.

## UAT feed quirks (observed live, handled defensively)

- **Negative amounts** appear in snapshots/deltas although the docs don't mention them;
  any tier with `amount <= 0` is treated as a removal (non-positive size is not
  displayable liquidity).
- **The UAT book can be crossed** (best bid above best ask — no live matching in the
  test environment), so the spread can legitimately display negative. The assignment
  formulas (`spread = best ask − best bid`, `mid = (best bid + best ask) / 2`) are
  applied faithfully to the feed's actual state.
- The `subscribeOrderBook` **ack can arrive after** the first `ORDER_BOOK` message; the
  client keys the snapshot off the first `ORDER_BOOK` event, not the ack.

## Security notes

- Credentials live only in `.env` (gitignored); the INX API key **never reaches the
  browser** — the UI talks exclusively to this backend.
- All external input is schema-validated (zod) before use; HTTP error responses never
  echo internals; CORS is restricted to localhost dev origins.
