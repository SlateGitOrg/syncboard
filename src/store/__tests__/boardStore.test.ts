import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BoardStore, DEFAULT_COLUMN_TITLES } from '../boardStore';

describe('BoardStore', () => {
  it('bootstraps default columns exactly once', () => {
    const doc = new Y.Doc();
    const store = BoardStore.bootstrap(doc);
    const snapshot = store.getSnapshot();

    expect(snapshot.columns.map((c) => c.title)).toEqual(DEFAULT_COLUMN_TITLES);
    expect(snapshot.columns.map((c) => c.order)).toEqual([0, 1, 2]);

    // Re-bootstrapping the same doc must not duplicate columns.
    const again = BoardStore.bootstrap(doc);
    expect(again.getSnapshot().columns).toHaveLength(3);
  });

  it('adds a card to a column and reflects it in the snapshot', () => {
    const store = BoardStore.bootstrap();
    const [backlog] = store.getSnapshot().columns;

    const cardId = store.addCard(backlog.id, 'Write onboarding doc');
    expect(cardId).not.toBeNull();

    const snapshot = store.getSnapshot();
    expect(snapshot.columns[0].cardIds).toEqual([cardId]);
    expect(snapshot.cards[cardId!].title).toBe('Write onboarding doc');
    expect(snapshot.cards[cardId!].columnId).toBe(backlog.id);
  });

  it('returns null when adding a card to a non-existent column', () => {
    const store = BoardStore.bootstrap();
    expect(store.addCard('does-not-exist', 'orphan')).toBeNull();
  });

  it('edits a card title in place', () => {
    const store = BoardStore.bootstrap();
    const [backlog] = store.getSnapshot().columns;
    const cardId = store.addCard(backlog.id, 'Draft')!;

    store.setCardTitle(cardId, 'Draft the README');
    expect(store.getSnapshot().cards[cardId].title).toBe('Draft the README');
  });

  it('moves a card between columns and preserves ordering', () => {
    const store = BoardStore.bootstrap();
    const [backlog, inProgress] = store.getSnapshot().columns;
    const cardA = store.addCard(backlog.id, 'A')!;
    const cardB = store.addCard(backlog.id, 'B')!;

    store.moveCard(cardA, inProgress.id, 0);

    const snapshot = store.getSnapshot();
    const backlogAfter = snapshot.columns.find((c) => c.id === backlog.id)!;
    const inProgressAfter = snapshot.columns.find((c) => c.id === inProgress.id)!;

    expect(backlogAfter.cardIds).toEqual([cardB]);
    expect(inProgressAfter.cardIds).toEqual([cardA]);
    expect(snapshot.cards[cardA].columnId).toBe(inProgress.id);
  });

  it('deletes a card and removes it from its column order', () => {
    const store = BoardStore.bootstrap();
    const [backlog] = store.getSnapshot().columns;
    const cardId = store.addCard(backlog.id, 'Temp')!;

    store.deleteCard(cardId);

    const snapshot = store.getSnapshot();
    expect(snapshot.cards[cardId]).toBeUndefined();
    expect(snapshot.columns[0].cardIds).toEqual([]);
  });

  it('deleting a column cascades to its cards', () => {
    const store = BoardStore.bootstrap();
    const [backlog] = store.getSnapshot().columns;
    const cardId = store.addCard(backlog.id, 'Doomed')!;

    store.deleteColumn(backlog.id);

    const snapshot = store.getSnapshot();
    expect(snapshot.columns.some((c) => c.id === backlog.id)).toBe(false);
    expect(snapshot.cards[cardId]).toBeUndefined();
  });

  it('reorders columns', () => {
    const store = BoardStore.bootstrap();
    const ids = store.getSnapshot().columns.map((c) => c.id);
    const reversed = [...ids].reverse();

    store.reorderColumns(reversed);

    expect(store.getSnapshot().columns.map((c) => c.id)).toEqual(reversed);
  });

  it('notifies subscribers on every mutation', () => {
    const store = BoardStore.bootstrap();
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);

    store.addColumn('Extra');
    expect(calls).toBeGreaterThan(0);

    unsubscribe();
    const callsAfterUnsubscribe = calls;
    store.addColumn('Another');
    expect(calls).toBe(callsAfterUnsubscribe);
  });
});
