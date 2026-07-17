import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BoardStore } from '../boardStore';

/**
 * Simulates a network partition between two replicas of the same board
 * without ever opening a socket: each replica is a fully independent
 * Y.Doc that only exchanges binary CRDT updates when we explicitly call
 * `sync()`, exactly like two browser tabs that were offline and just
 * reconnected to the relay. This is the offline-verifiable equivalent of
 * a split-brain integration test — no network, no Docker, fully
 * deterministic.
 */
function sync(a: Y.Doc, b: Y.Doc): void {
  const updateForB = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const updateForA = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, updateForB, 'partition-merge');
  Y.applyUpdate(a, updateForA, 'partition-merge');
}

function replicate(source: BoardStore): { doc: Y.Doc; store: BoardStore } {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(source.doc));
  return { doc, store: new BoardStore(doc) };
}

describe('conflict resolution under a simulated network partition', () => {
  it('preserves cards concurrently added on both sides of a split-brain', () => {
    const origin = BoardStore.bootstrap();
    const [backlogId] = origin.getSnapshot().columns.map((c) => c.id);

    // Two replicas start identical, then the network partitions.
    const replicaA = replicate(origin);
    const replicaB = replicate(origin);

    // Offline edits on each side concurrently, unaware of each other.
    const cardFromA = replicaA.store.addCard(backlogId, 'Fix login bug (found by Alice)')!;
    const cardFromB = replicaB.store.addCard(backlogId, 'Fix login bug (found by Bob)')!;

    // Network heals.
    sync(replicaA.doc, replicaB.doc);

    const snapshotA = replicaA.store.getSnapshot();
    const snapshotB = replicaB.store.getSnapshot();

    // Strong eventual consistency: identical state on both replicas.
    expect(snapshotA).toEqual(snapshotB);

    // No data loss: naive last-write-wins over the whole column would have
    // silently discarded whichever card synced second. Yjs's array CRDT
    // keeps both.
    expect(snapshotA.cards[cardFromA]).toBeDefined();
    expect(snapshotA.cards[cardFromB]).toBeDefined();
    const backlogAfter = snapshotA.columns.find((c) => c.id === backlogId)!;
    expect(backlogAfter.cardIds).toContain(cardFromA);
    expect(backlogAfter.cardIds).toContain(cardFromB);
    expect(backlogAfter.cardIds).toHaveLength(2);
  });

  it('merges concurrent edits to different fields of the same card without loss', () => {
    const origin = BoardStore.bootstrap();
    const [backlogId] = origin.getSnapshot().columns.map((c) => c.id);
    const cardId = origin.addCard(backlogId, 'Ship v2 API', 'initial notes')!;

    const replicaA = replicate(origin);
    const replicaB = replicate(origin);

    replicaA.store.setCardTitle(cardId, 'Ship v2 API (blocked on infra)');
    replicaB.store.setCardDescription(cardId, 'initial notes + needs QA sign-off');

    sync(replicaA.doc, replicaB.doc);

    const cardA = replicaA.store.getSnapshot().cards[cardId];
    const cardB = replicaB.store.getSnapshot().cards[cardId];

    expect(cardA).toEqual(cardB);
    expect(cardA.title).toBe('Ship v2 API (blocked on infra)');
    expect(cardA.description).toBe('initial notes + needs QA sign-off');
  });

  it('merges concurrent, non-overlapping edits to the same text field character-by-character', () => {
    // This is the strongest "no silent overwrite" demonstration: both
    // replicas edit the *same* title field concurrently, in different
    // places, and both edits survive the merge because Y.Text tracks
    // character identity rather than diffing whole strings.
    const origin = BoardStore.bootstrap();
    const [backlogId] = origin.getSnapshot().columns.map((c) => c.id);
    const cardId = origin.addCard(backlogId, 'Refactor auth module')!;

    const replicaA = replicate(origin);
    const replicaB = replicate(origin);

    replicaA.store.setCardTitle(cardId, '[URGENT] Refactor auth module');
    replicaB.store.setCardTitle(cardId, 'Refactor auth module (owner: Priya)');

    sync(replicaA.doc, replicaB.doc);

    const titleA = replicaA.store.getSnapshot().cards[cardId].title;
    const titleB = replicaB.store.getSnapshot().cards[cardId].title;

    expect(titleA).toBe(titleB); // both replicas converge to one identical string
    expect(titleA).toContain('[URGENT]');
    expect(titleA).toContain('(owner: Priya)');
  });

  it('resolves a concurrent move-to-two-different-columns split-brain deterministically, without duplicating or losing the card', () => {
    const origin = BoardStore.bootstrap();
    const [backlogId, inProgressId, doneId] = origin.getSnapshot().columns.map((c) => c.id);
    const cardId = origin.addCard(backlogId, 'Contested card')!;

    const replicaA = replicate(origin);
    const replicaB = replicate(origin);

    // Split brain: A thinks the card moved to "In Progress", B thinks it
    // moved to "Done", each unaware of the other's action.
    replicaA.store.moveCard(cardId, inProgressId, 0);
    replicaB.store.moveCard(cardId, doneId, 0);

    sync(replicaA.doc, replicaB.doc);

    const snapshotA = replicaA.store.getSnapshot();
    const snapshotB = replicaB.store.getSnapshot();

    // Both replicas must agree with each other (no split-brain survives
    // the merge) even though we don't hard-code which write "won".
    expect(snapshotA).toEqual(snapshotB);

    // The card exists in exactly one column's cardIds array, never zero,
    // never two.
    const columnsContainingCard = snapshotA.columns.filter((c) => c.cardIds.includes(cardId));
    expect(columnsContainingCard).toHaveLength(1);
    expect(snapshotA.cards[cardId]).toBeDefined();
    expect(snapshotA.cards[cardId].columnId).toBe(columnsContainingCard[0].id);
  });

  it('handles delete-column vs add-card-to-that-column without crashing or corrupting the doc', () => {
    const origin = BoardStore.bootstrap();
    const [backlogId] = origin.getSnapshot().columns.map((c) => c.id);

    const replicaA = replicate(origin);
    const replicaB = replicate(origin);

    replicaA.store.deleteColumn(backlogId);
    const orphanCardId = replicaB.store.addCard(backlogId, 'Added right before the column vanished')!;

    expect(() => sync(replicaA.doc, replicaB.doc)).not.toThrow();

    const snapshotA = replicaA.store.getSnapshot();
    const snapshotB = replicaB.store.getSnapshot();
    expect(snapshotA).toEqual(snapshotB);

    // The column is gone on both replicas (delete propagated)...
    expect(snapshotA.columns.some((c) => c.id === backlogId)).toBe(false);
    // ...and the card that was concurrently added is not silently
    // deleted — it survives as an orphan record rather than vanishing,
    // which is the honest, documented behavior of this schema: deletes
    // are structural (tombstone the column), inserts elsewhere in the
    // map are independent CRDT ops, so both operations apply cleanly.
    expect(snapshotA.cards[orphanCardId]).toBeDefined();
  });

  it('three-way partition (A, B, and C all diverge) still converges once fully connected', () => {
    const origin = BoardStore.bootstrap();
    const [backlogId] = origin.getSnapshot().columns.map((c) => c.id);

    const replicaA = replicate(origin);
    const replicaB = replicate(origin);
    const replicaC = replicate(origin);

    const cardA = replicaA.store.addCard(backlogId, 'From A')!;
    const cardB = replicaB.store.addCard(backlogId, 'From B')!;
    const cardC = replicaC.store.addCard(backlogId, 'From C')!;

    // Partial healing: A<->B first, then the merged pair catches up with C.
    sync(replicaA.doc, replicaB.doc);
    sync(replicaA.doc, replicaC.doc);
    sync(replicaB.doc, replicaC.doc);

    const snapshots = [replicaA, replicaB, replicaC].map((r) => r.store.getSnapshot());
    expect(snapshots[0]).toEqual(snapshots[1]);
    expect(snapshots[1]).toEqual(snapshots[2]);

    for (const cardId of [cardA, cardB, cardC]) {
      expect(snapshots[0].cards[cardId]).toBeDefined();
    }
    const backlogAfter = snapshots[0].columns.find((c) => c.id === backlogId)!;
    expect(backlogAfter.cardIds).toHaveLength(3);
  });
});
