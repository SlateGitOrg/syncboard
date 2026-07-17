import http from 'node:http';
import { WebSocketServer } from 'ws';
// @ts-expect-error -- y-websocket ships its server helper as a CommonJS
// script under bin/, with no published type declarations for it.
import { setupWSConnection } from 'y-websocket/bin/utils';

/**
 * The relay. Deliberately dumb: it is a plain y-websocket room server that
 * relays CRDT updates and awareness messages between connected clients. It
 * has zero board-specific logic and stores nothing durably itself — every
 * client persists its own copy of the document to IndexedDB (see
 * store/persistence.ts), so the relay can restart, or be unreachable for
 * an arbitrary amount of time, without losing a single edit. Clients that
 * reconnect exchange Yjs state vectors and receive only the updates they
 * were missing.
 */
const port = Number(process.env.PORT) || 1234;
const host = process.env.HOST || '0.0.0.0';

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('syncboard relay ok\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (conn, req) => {
  setupWSConnection(conn, req);
});

server.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`syncboard relay listening on ws://${host}:${port}`);
});

const shutdown = () => {
  wss.close(() => server.close(() => process.exit(0)));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
