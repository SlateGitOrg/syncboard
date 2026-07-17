import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { BoardStore } from '../store/boardStore';
import { BoardPersistence } from '../store/persistence';
import { createRelayConnection, pickColor, type RelayConnection } from '../store/connection';
import type { BoardSnapshot, ConnectionStatus, PeerAwarenessState } from '../types';
import type { WebsocketProvider } from 'y-websocket';

export interface UseBoardOptions {
  boardId: string;
  relayUrl: string;
  userName: string;
}

export interface UseBoardResult {
  store: BoardStore;
  snapshot: BoardSnapshot;
  status: ConnectionStatus;
  peers: PeerAwarenessState[];
  localUserId: string;
  provider: WebsocketProvider | undefined;
  setForcedOffline: (offline: boolean) => void;
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Top-level hook that assembles the full sync stack for one board:
 * Y.Doc -> BoardStore (schema) -> IndexedDB persistence -> websocket relay
 * + awareness. Everything downstream (the kanban UI, cursors) just reads
 * `snapshot`/`peers`/`status` and calls methods on `store`.
 */
export function useBoard({ boardId, relayUrl, userName }: UseBoardOptions): UseBoardResult {
  const localUserId = useMemo(() => randomId(), []);
  const doc = useMemo(() => new Y.Doc(), [boardId]);
  const store = useMemo(() => BoardStore.bootstrap(doc), [doc]);

  const [snapshot, setSnapshot] = useState<BoardSnapshot>(() => store.getSnapshot());
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [peers, setPeers] = useState<PeerAwarenessState[]>([]);
  const connectionRef = useRef<RelayConnection | null>(null);

  useEffect(() => {
    const persistence = new BoardPersistence(`syncboard-${boardId}`, doc);
    const unsubscribe = store.subscribe(() => setSnapshot(store.getSnapshot()));

    const connection = createRelayConnection(relayUrl, boardId, doc, {
      id: localUserId,
      name: userName,
      color: pickColor(localUserId),
    });
    connectionRef.current = connection;

    const unsubscribeStatus = connection.manager.onStatusChange(setStatus);
    setStatus(connection.manager.getStatus());

    const updatePeers = () => {
      const states = Array.from(connection.provider.awareness.getStates().entries())
        .filter(([clientId]) => clientId !== doc.clientID)
        .map(([, state]) => state as PeerAwarenessState)
        .filter((state) => state?.user);
      setPeers(states);
    };
    connection.provider.awareness.on('change', updatePeers);
    updatePeers();

    return () => {
      unsubscribe();
      unsubscribeStatus();
      connection.provider.awareness.off('change', updatePeers);
      connection.destroy();
      void persistence.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, store, boardId, relayUrl, localUserId, userName]);

  const setForcedOffline = (offline: boolean) => {
    if (!connectionRef.current) return;
    if (offline) connectionRef.current.manager.forceOffline();
    else connectionRef.current.manager.forceOnline();
  };

  return {
    store,
    snapshot,
    status,
    peers,
    localUserId,
    provider: connectionRef.current?.provider,
    setForcedOffline,
  };
}
