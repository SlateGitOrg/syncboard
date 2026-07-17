import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

/**
 * Wraps y-indexeddb so every local edit is durably queued to IndexedDB the
 * instant it happens — independent of whether a websocket connection
 * exists. This is what makes the app "offline-first": a user can create
 * cards, edit titles, and drag things between columns with the relay
 * completely unreachable, close the tab, reopen it, and find their board
 * exactly as they left it. When a WebsocketProvider later attaches to the
 * same Y.Doc, Yjs's sync protocol reconciles the queued local updates with
 * whatever the relay/peers have — no separate "outbox" data structure is
 * needed because the persisted document *is* the outbox.
 */
export class BoardPersistence {
  readonly provider: IndexeddbPersistence;
  private readonly readyPromise: Promise<void>;

  constructor(roomName: string, doc: Y.Doc) {
    this.provider = new IndexeddbPersistence(roomName, doc);
    this.readyPromise = new Promise((resolve) => {
      this.provider.once('synced', () => resolve());
    });
  }

  whenSynced(): Promise<void> {
    return this.readyPromise;
  }

  destroy(): Promise<void> {
    return this.provider.destroy();
  }

  static async clear(roomName: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(roomName);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
  }
}
