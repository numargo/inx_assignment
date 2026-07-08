/**
 * Scripted stand-in for the INX UAT gateway used by the e2e suite (and local
 * dev without credentials). Serves the REST token endpoint and a WebSocket
 * feed that sends a deterministic snapshot followed by scripted deltas.
 */
import {createServer} from 'node:http';

import {WebSocketServer} from 'ws';

const REST_PORT = Number(process.env.MOCK_INX_REST_PORT ?? 9101);
const WS_PORT = Number(process.env.MOCK_INX_WS_PORT ?? 9102);
const MARKET = process.env.INX_MARKET_NAME ?? 'BTC-USD';

const level = (price: number, amount: number) => ({price, amount});

// 12 levels per side so the UI's top-10 cut is observable.
const SNAPSHOT_BUY = [
  level(64000, 0.75),
  level(63999, 2),
  level(63998, 1.2),
  level(63997, 0.8),
  level(63996, 3),
  level(63995, 1.5),
  level(63994, 2.2),
  level(63993, 0.6),
  level(63992, 4),
  level(63991, 1.1),
  level(63990.5, 9),
  level(63990, 9),
];
const SNAPSHOT_SELL = [
  level(64001, 0.5),
  level(64002, 1.4),
  level(64003, 2.1),
  level(64004, 0.9),
  level(64005, 2.8),
  level(64006, 1.7),
  level(64007, 0.4),
  level(64008, 3.3),
  level(64009, 1),
  level(64010, 2.5),
  level(64011, 9),
  level(64012, 9),
];

// First scripted delta: override, remove, and insert — all three semantics.
const DELTA_1 = {
  buy: [level(63999, 5), level(63995, 0), level(63994.5, 1.9)],
  sell: [level(64002, 7)],
};

const rest = createServer((request, response) => {
  const authed =
    typeof request.headers.apikeyid === 'string' &&
    typeof request.headers.signedcontext === 'string' &&
    request.headers.signedcontext.length > 0;
  if (request.method !== 'POST' || !authed) {
    response.writeHead(401).end(JSON.stringify({error: 'unauthorized'}));
    return;
  }
  if (request.url === '/api/createToken') {
    response
      .writeHead(200, {'content-type': 'application/json'})
      .end(JSON.stringify({websocketToken: `mock-token-${Date.now()}`}));
    return;
  }
  if (request.url === '/api/revokeToken') {
    response
      .writeHead(200, {'content-type': 'application/json'})
      .end(JSON.stringify({}));
    return;
  }
  response.writeHead(404).end();
});

const wss = new WebSocketServer({port: WS_PORT});
wss.on('connection', (socket, request) => {
  if (
    typeof request.headers.authorization !== 'string' ||
    typeof request.headers.apikey !== 'string'
  ) {
    socket.close(4401, 'unauthorized');
    return;
  }
  const timers: NodeJS.Timeout[] = [];
  socket.on('message', raw => {
    const message = JSON.parse(String(raw)) as {
      event: string;
      data?: {marketName?: string};
    };
    if (
      message.event !== 'orderBook/subscribeOrderBook' ||
      message.data?.marketName !== MARKET
    ) {
      return;
    }
    const send = (buy: unknown[], sell: unknown[]) =>
      socket.send(
        JSON.stringify({
          event: 'ORDER_BOOK',
          sentTime: Date.now(),
          marketName: MARKET,
          buy,
          sell,
        }),
      );
    send(SNAPSHOT_BUY, SNAPSHOT_SELL);
    timers.push(setTimeout(() => send(DELTA_1.buy, DELTA_1.sell), 400));
    // Keep the book visibly alive: toggle one bid amount forever.
    let tick = 0;
    timers.push(
      setInterval(() => {
        tick += 1;
        send([level(63998, tick % 2 === 0 ? 1.2 : 6.5)], []);
      }, 500),
    );
  });
  socket.on('close', () => timers.forEach(clearTimeout));
});

rest.listen(REST_PORT, () => {
  console.info(
    `mock INX ready: rest :${REST_PORT}, ws :${WS_PORT}, market ${MARKET}`,
  );
});

const shutdown = () => {
  for (const client of wss.clients) {
    client.terminate();
  }
  wss.close();
  rest.close();
  process.exitCode = 0;
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
