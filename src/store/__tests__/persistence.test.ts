import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BoardStore } from '../boardStore';
import { BoardPersistence } from '../persistence';

/**
 * Exercises the real y-indexeddb persistence layer against fake-indexeddb
 * (an in-memory IndexedDB implementation, wired up in src/test/setup.ts).
 * This proves the "offline queue" story end-to-end at the storage layer:
 * edits made with zero network survive a full doc/process teardown and
 * are recovered by a brand new Y.Doc instance, the same way a page reload
 * while offline would work in a real browser.
 */
describe('BoardPersistence (IndexedDB durability)', () => {
  it('recovers board state in a fresh Y.Doc after the original is destroyed', async () => {
    const roomName = `syncboard-test-${Math.random().toString(36).slice(2)}`;

    const docA = new Y.Doc();
    const storeA = BoardStore.bootstrap(docA);
    const persistenceA = new BoardPersistence(roomName, docA);
    await persistenceA.whenSynced();

    const [backlogId] = storeA.getSnapshot().columns.map((c) => c.id);
    const cardId = storeA.addCard(backlogId, 'Survives a reload')!;

    // Give IndexedDB a moment to flush the update (y-indexeddb persists on
    // the 'update' event, which fires synchronously, but the underlying
    // idb transaction still resolves asynchronously).
    await new Promise((resolve) => setTimeout(resolve, 20));

    await persistenceA.destroy();
    docA.destroy();

    // Simulate reopening the app: a brand new Y.Doc, no relay, loading
    // straight from IndexedDB.
    const docB = new Y.Doc();
    const storeB = new BoardStore(docB);
    const persistenceB = new BoardPersistence(roomName, docB);
    await persistenceB.whenSynced();

    const recovered = storeB.getSnapshot();
    expect(recovered.cards[cardId]).toBeDefined();
    expect(recovered.cards[cardId].title).toBe('Survives a reload');
    expect(recovered.columns.find((c) => c.id === backlogId)?.cardIds).toContain(cardId);

    await persistenceB.destroy();
  });

  it('two independently-persisted, never-networked docs still merge cleanly through their update logs', async () => {
    const roomName = `syncboard-test-${Math.random().toString(36).slice(2)}`;

    const seed = BoardStore.bootstrap();
    const [backlogId] = seed.getSnapshot().columns.map((c) => c.id);

    const docA = new Y.Doc();
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(seed.doc));
    const storeA = new BoardStore(docA);
    const persistenceA = new BoardPersistence(`${roomName}-a`, docA);
    await persistenceA.whenSynced();
    const cardIdA = storeA.addCard(backlogId, 'Offline card A')!;
    await new Promise((resolve) => setTimeout(resolve, 10));

    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(seed.doc));
    const storeB = new BoardStore(docB);
    const persistenceB = new BoardPersistence(`${roomName}-b`, docB);
    await persistenceB.whenSynced();
    const cardIdB = storeB.addCard(backlogId, 'Offline card B')!;
    await new Promise((resolve) => setTimeout(resolve, 10));

    // "Reconnect": exchange updates directly (no relay needed for this
    // assertion — the relay is just a message pipe for these same bytes).
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    expect(storeA.getSnapshot()).toEqual(storeB.getSnapshot());
    expect(storeA.getSnapshot().cards[cardIdA]).toBeDefined();
    expect(storeA.getSnapshot().cards[cardIdB]).toBeDefined();

    await persistenceA.destroy();
    await persistenceB.destroy();
  });
});
