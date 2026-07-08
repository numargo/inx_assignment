import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

const proxy = {
  '/api': 'http://127.0.0.1:3000',
  '/ws': {
    target: 'ws://127.0.0.1:3000',
    ws: true,
    // http-proxy throws (and kills Vite) on ws upgrade errors unless an
    // error listener is attached — e.g. when the backend restarts.
    configure(proxyServer: {on(event: 'error', cb: () => void): unknown}) {
      proxyServer.on('error', () => {});
    },
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy,
    // Coverage runs rewrite these files; watching them causes reload storms.
    watch: {ignored: ['**/coverage/**']},
  },
  preview: {host: '127.0.0.1', port: 5173, proxy},
});
