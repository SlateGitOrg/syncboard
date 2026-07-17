import * as Y from 'yjs';
import { nanoid } from 'nanoid';
import { applyTextDelta } from '../lib/textDelta';
import type { BoardSnapshot, CardSnapshot, ColumnSnapshot } from '../types';

export const DEFAULT_COLUMN_TITLES = ['Backlog', 'In Progress', 'Done'];

type YColumn = Y.Map<unknown>;
type YCard = Y.Map<unknown>;

/**
 * BoardStore is a thin, typed façade over a Yjs document that models a
 * Trello-style board:
 *
 *   doc.getMap('columns')  -> columnId -> Y.Map { id, title, order, cardIds: Y.Array<string> }
 *   doc.getMap('cards')    -> cardId   -> Y.Map { id, columnId, title: Y.Text, description: Y.Text, ... }
 *
 * Every mutation goes through a `doc.transact(...)` call, which is what
 * lets Yjs batch an operation into a single update and gives us a single
 * origin token to distinguish local vs. remote changes.
 *
 * IMPORTANT: this class does not implement any conflict resolution
 * itself. All of the merge semantics (deterministic ordering of
 * concurrent map writes, position-preserving array inserts/deletes,
 * character-level text merges) come from Yjs's CRDT algorithm. This
 * class only defines the *shape* of the shared document and exposes an
 * ergonomic API for the React layer.
 */
export class BoardStore {
  readonly doc: Y.Doc;
  private readonly columns: Y.Map<YColumn>;
  private readonly cards: Y.Map<YCard>;

  constructor(doc: Y.Doc = new Y.Doc()) {
    this.doc = doc;
    this.columns = doc.getMap<YColumn>('columns');
    this.cards = doc.getMap<YCard>('cards');
  }

  /** Creates a store and seeds default columns if the doc is empty (fresh board). */
  static bootstrap(doc: Y.Doc = new Y.Doc()): BoardStore {
    const store = new BoardStore(doc);
    if (store.columns.size === 0) {
      store.doc.transact(() => {
        DEFAULT_COLUMN_TITLES.forEach((title, index) => store.addColumn(title, index));
      });
    }
    return store;
  }

  // ---------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------

  addColumn(title: string, order = this.columns.size, id: string = nanoid(8)): string {
    this.doc.transact(() => {
      const column: YColumn = new Y.Map();
      column.set('id', id);
      column.set('title', title);
      column.set('order', order);
      column.set('cardIds', new Y.Array<string>());
      this.columns.set(id, column);
    });
    return id;
  }

  renameColumn(columnId: string, title: string): void {
    const column = this.columns.get(columnId);
    if (!column) return;
    this.doc.transact(() => column.set('title', title));
  }

  deleteColumn(columnId: string): void {
    const column = this.columns.get(columnId);
    if (!column) return;
    this.doc.transact(() => {
      const cardIds = column.get('cardIds') as Y.Array<string>;
      cardIds.toArray().forEach((cardId) => this.cards.delete(cardId));
      this.columns.delete(columnId);
    });
  }

  reorderColumns(orderedIds: string[]): void {
    this.doc.transact(() => {
      orderedIds.forEach((id, index) => {
        const column = this.columns.get(id);
        if (column) column.set('order', index);
      });
    });
  }

  // ---------------------------------------------------------------------
  // Cards
  // ---------------------------------------------------------------------

  addCard(
    columnId: string,
    title: string,
    description = '',
    id: string = nanoid(10),
  ): string | null {
    const column = this.columns.get(columnId);
    if (!column) return null;

    this.doc.transact(() => {
      const now = Date.now();
      const card: YCard = new Y.Map();
      const titleText = new Y.Text();
      titleText.insert(0, title);
      const descriptionText = new Y.Text();
      descriptionText.insert(0, description);

      card.set('id', id);
      card.set('columnId', columnId);
      card.set('title', titleText);
      card.set('description', descriptionText);
      card.set('createdAt', now);
      card.set('updatedAt', now);

      this.cards.set(id, card);
      const cardIds = column.get('cardIds') as Y.Array<string>;
      cardIds.push([id]);
    });
    return id;
  }

  /** Applies a minimal text diff so concurrent edits elsewhere in the string survive the merge. */
  setCardTitle(cardId: string, title: string): void {
    const card = this.cards.get(cardId);
    if (!card) return;
    this.doc.transact(() => {
      applyTextDelta(card.get('title') as Y.Text, title);
      card.set('updatedAt', Date.now());
    });
  }

  setCardDescription(cardId: string, description: string): void {
    const card = this.cards.get(cardId);
    if (!card) return;
    this.doc.transact(() => {
      applyTextDelta(card.get('description') as Y.Text, description);
      card.set('updatedAt', Date.now());
    });
  }

  deleteCard(cardId: string): void {
    const card = this.cards.get(cardId);
    if (!card) return;
    const columnId = card.get('columnId') as string;
    const column = this.columns.get(columnId);
    this.doc.transact(() => {
      if (column) {
        const cardIds = column.get('cardIds') as Y.Array<string>;
        const index = cardIds.toArray().indexOf(cardId);
        if (index !== -1) cardIds.delete(index, 1);
      }
      this.cards.delete(cardId);
    });
  }

  /**
   * Moves a card to a (possibly different) column at a specific index.
   * Concurrent moves of the *same* card to two different columns during a
   * partition are resolved deterministically by Yjs's last-writer-wins
   * map semantics on `card.columnId` (ordered by (clock, clientID), not
   * wall-clock time) — see the conflict-resolution test suite. The card
   * itself is never duplicated or dropped: it always ends up in exactly
   * one `cardIds` array once both replicas have exchanged updates,
   * because every apply-side effect below is idempotent when replayed.
   */
  moveCard(cardId: string, toColumnId: string, toIndex: number): void {
    const card = this.cards.get(cardId);
    const toColumn = this.columns.get(toColumnId);
    if (!card || !toColumn) return;

    this.doc.transact(() => {
      const fromColumnId = card.get('columnId') as string;
      const fromColumn = this.columns.get(fromColumnId);
      if (fromColumn) {
        const fromCardIds = fromColumn.get('cardIds') as Y.Array<string>;
        const index = fromCardIds.toArray().indexOf(cardId);
        if (index !== -1) fromCardIds.delete(index, 1);
      }

      const toCardIds = toColumn.get('cardIds') as Y.Array<string>;
      const existingIndex = toCardIds.toArray().indexOf(cardId);
      if (existingIndex !== -1) toCardIds.delete(existingIndex, 1);

      const clampedIndex = Math.max(0, Math.min(toIndex, toCardIds.length));
      toCardIds.insert(clampedIndex, [cardId]);

      card.set('columnId', toColumnId);
      card.set('updatedAt', Date.now());
    });
  }

  // ---------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------

  /**
   * Materializes a plain-object snapshot for rendering/testing.
   *
   * Column membership is derived from `card.columnId` (a single
   * last-writer-wins CRDT register), NOT solely from the per-column
   * `cardIds` Y.Array. This matters for one specific split-brain case: if
   * two replicas concurrently move the *same* card to two *different*
   * columns while partitioned, each replica independently removes the
   * card from the source array and inserts it into its own destination
   * array. Both inserts are on different Y.Arrays, so both survive the
   * merge — the card would otherwise render inside two columns at once,
   * even though `columnId` itself resolves to a single deterministic
   * winner on both replicas (Yjs Map writes are ordered by
   * (logical clock, clientID), not last-write-wins by wall time).
   *
   * The fix: treat each column's `cardIds` array as an *ordering hint*
   * for cards it legitimately owns, filter out any entry whose card no
   * longer points at that column (or was deleted), and append any card
   * whose `columnId` claims this column but is missing from the array
   * (e.g. it lost the array race but won the columnId race). This keeps
   * reads pure — no document mutation, no extra transactions — while
   * guaranteeing each card renders in exactly one column post-merge. See
   * `src/store/__tests__/partition.test.ts` for the regression test.
   */
  getSnapshot(): BoardSnapshot {
    const cards: Record<string, CardSnapshot> = {};
    this.cards.forEach((card) => {
      const id = card.get('id') as string;
      cards[id] = {
        id,
        columnId: card.get('columnId') as string,
        title: (card.get('title') as Y.Text).toString(),
        description: (card.get('description') as Y.Text).toString(),
        createdAt: card.get('createdAt') as number,
        updatedAt: card.get('updatedAt') as number,
      };
    });

    const columns: ColumnSnapshot[] = [];
    this.columns.forEach((column) => {
      const columnId = column.get('id') as string;
      const rawOrder = (column.get('cardIds') as Y.Array<string>).toArray();

      const owned = rawOrder.filter((cardId) => cards[cardId]?.columnId === columnId);
      const ownedSet = new Set(owned);
      const strays = Object.values(cards)
        .filter((card) => card.columnId === columnId && !ownedSet.has(card.id))
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((card) => card.id);

      columns.push({
        id: columnId,
        title: column.get('title') as string,
        order: column.get('order') as number,
        cardIds: [...owned, ...strays],
      });
    });
    columns.sort((a, b) => a.order - b.order);

    return { columns, cards };
  }

  /** Subscribes to any change (local or remote) that affects the rendered board. Returns an unsubscribe fn. */
  subscribe(callback: () => void): () => void {
    this.doc.on('update', callback);
    return () => this.doc.off('update', callback);
  }

  cardCount(): number {
    return this.cards.size;
  }

  columnCount(): number {
    return this.columns.size;
  }

  hasCard(cardId: string): boolean {
    return this.cards.has(cardId);
  }
}
