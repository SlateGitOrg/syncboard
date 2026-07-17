import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { ConnectionManager, browserNetworkSource } from '../lib/connectionManager';
import type { PeerAwarenessState } from '../types';

const CURSOR_COLORS = ['#f97316', '#22d3ee', '#a78bfa', '#34d399', '#f472b6', '#fbbf24'];

export function pickColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}

export interface RelayConnection {
  provider: WebsocketProvider;
  manager: ConnectionManager;
  destroy(): void;
}

/**
 * Wires the shared Y.Doc up to the y-websocket relay and returns a
 * ConnectionManager that layers browser online/offline awareness on top
 * (see lib/connectionManager.ts for why that layer exists).
 *
 * This is the only place in the app that touches a real WebSocket. It is
 * intentionally excluded from the unit test suite — it is exercised by
 * the Playwright E2E offline/online spec against the Dockerized relay,
 * and by the awareness/cursor demo when you run `npm run dev` +
 * `npm run dev:relay` locally.
 */
export function createRelayConnection(
  relayUrl: string,
  roomName: string,
  doc: Y.Doc,
  user: PeerAwarenessState['user'],
): RelayConnection {
  const provider = new WebsocketProvider(relayUrl, roomName, doc);

  provider.awareness.setLocalState({
    user,
    cursor: null,
    focusCardId: null,
  } satisfies PeerAwarenessState);

  const manager = new ConnectionManager(provider, browserNetworkSource);

  return {
    provider,
    manager,
    destroy() {
      manager.destroy();
      provider.destroy();
    },
  };
}
