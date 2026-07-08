import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, {FastifyInstance} from 'fastify';

import {Broadcaster} from './broadcast.js';
import {OrderBook} from './order-book.js';

export interface AppDeps {
  book: OrderBook;
  broadcaster: Broadcaster;
}

/**
 * HTTP surface: `GET /api/orderbook/stats` (the assignment's single REST
 * endpoint) plus the `/ws` fan-out used by the UI.
 */
export const buildApp = async ({
  book,
  broadcaster,
}: AppDeps): Promise<FastifyInstance> => {
  const app = Fastify({logger: false});

  await app.register(fastifyCors, {
    // The UI is served same-origin (Vite proxy); allow localhost for dev.
    origin: [/^https?:\/\/localhost(:\d+)?$/],
  });
  await app.register(fastifyWebsocket);

  // Never leak internals: log server-side, answer with a generic message.
  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    void reply.status(500).send({error: 'internal server error'});
  });

  app.get('/api/orderbook/stats', (_request, reply) => {
    const stats = book.getStats();
    if (!book.isReady() || stats === null) {
      void reply.status(503).send({error: 'order book not ready'});
      return;
    }
    void reply.send(stats);
  });

  app.get('/ws', {websocket: true}, socket => {
    broadcaster.addClient(socket);
  });

  return app;
};
