import {config as loadEnv} from 'dotenv';

// The .env lives at the repo root, two levels up from src/ (and from dist/).
// Existing environment variables always win over .env values.
loadEnv({path: new URL('../../.env', import.meta.url).pathname});

import {buildApp} from './app.js';
import {Broadcaster} from './broadcast.js';
import {loadConfig} from './config.js';
import {InxAuth} from './inx-auth.js';
import {InxFeed} from './inx-feed.js';
import {OrderBook} from './order-book.js';

const config = loadConfig(process.env);

const book = new OrderBook();
const broadcaster = new Broadcaster(book);
const auth = new InxAuth(
  config.apiKeyId,
  config.privateKeyPem,
  config.inxRestUrl,
);
const feed = new InxFeed({
  wsUrl: config.inxWsUrl,
  marketName: config.marketName,
  depth: config.depth,
  apiKeyId: config.apiKeyId,
  auth,
  book,
  onUpdate: () => broadcaster.notify(),
});

const app = await buildApp({book, broadcaster});
await app.listen({port: config.port, host: '0.0.0.0'});
console.info(`server listening on :${config.port}`);
await feed.start();

const shutdown = async () => {
  broadcaster.stop();
  await feed.stop();
  await app.close();
  // All handles are closed; the event loop drains and the process exits.
  process.exitCode = 0;
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
