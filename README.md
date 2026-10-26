# SyncBoard

**An offline-first, real-time kanban board where concurrent edits converge instead of being overwritten.**

[![CI](https://github.com/SlateGitOrg/syncboard/actions/workflows/ci.yml/badge.svg)](https://github.com/SlateGitOrg/syncboard/actions/workflows/ci.yml)

## Why

Most collaborative boards handle a dropped connection badly: they either lose the edits
made while offline, or resolve conflicts last-write-wins, which silently discards a
teammate's change when two people touch the same card while partitioned. SyncBoard uses
**Yjs CRDTs** so concurrent edits merge deterministically on every replica and nothing is
silently dropped, including when two users edit the same card offline and reconnect at
the same time.

Merging is done by [Yjs](https://docs.yjs.dev/); SyncBoard does not implement its own
CRDT. What it adds on top is the document schema, an IndexedDB-backed offline queue, a
reconnect state machine that follows the browser's online status, awareness-based live
cursors, and a conflict-resolution test suite that checks convergence under a simulated
split-brain.

## Features

- Drag-and-drop kanban board (columns and cards) where every drag is a CRDT mutation.
- Full offline support: edits are applied locally and persisted to IndexedDB immediately.
- Real-time multi-user sync through a small stateless `y-websocket` relay.
- Live multi-user cursors via Yjs awareness (ephemeral, never persisted).
- Reconnect state machine that distinguishes `offline` from `disconnected` and reconnects as soon as the browser is back online.
- In-app "Simulate network partition" / "Simulate reconnect" controls for demos.
- Dockerized relay, unit/conflict-resolution tests, and a Playwright offline/online E2E test.

## Architecture

```mermaid
flowchart LR
    subgraph ClientA["Browser Tab A"]
        UIA["React kanban UI"] <--> DocA["Yjs CRDT doc<br/>(BoardStore)"]
        DocA <--> IDBA["IndexedDB<br/>local persistence"]
    end

    subgraph ClientB["Browser Tab B (peer)"]
        UIB["React kanban UI"] <--> DocB["Yjs CRDT doc<br/>(BoardStore)"]
        DocB <--> IDBB["IndexedDB<br/>local persistence"]
    end

    DocA <-->|"WebSocket<br/>(CRDT updates +<br/>awareness/cursors)"| Relay["y-websocket relay<br/>(Dockerized, stateless)"]
    Relay <-->|"WebSocket"| DocB

    subgraph Partition["Offline edit and reconnect path"]
        Offline["Edits queue in IndexedDB<br/>while relay is unreachable"] --> Reconnect["Reconnect: exchange<br/>Yjs state vectors"]
        Reconnect --> Merge["Deterministic Yjs merge<br/>(no data loss)"]
    end

    DocA -.->|"offline"| Offline
```

The offline → reconnect → merge path, concretely:

1. **Offline queue.** Every local edit (add card, move card, edit title) is applied to
   the in-memory `Y.Doc` immediately and persisted to IndexedDB on the same tick via
   `y-indexeddb`. There is no separate "outbox" table — the persisted CRDT document
   *is* the queue. This works with zero network reachability at all.
2. **Reconnect.** When the `y-websocket` `WebsocketProvider` (re)connects to the relay,
   the Yjs sync protocol exchanges compact state vectors with peers and each side sends
   only the updates the other is missing — not the whole document.
3. **Deterministic merge.** Yjs applies the incoming updates to the local document.
   Map writes resolve by `(logical clock, client ID)`, not wall-clock time; array
   inserts/deletes are position-aware; `Y.Text` edits merge character-by-character. The
   `src/store/__tests__/partition.test.ts` suite proves this directly by running two
   `Y.Doc` replicas with zero network between them, mutating both concurrently, then
   merging and asserting both converge to one identical, complete state.

## Quick start

Prerequisites: Node 22+ and npm.

```bash
npm install

# terminal 1: the relay
npm run dev:relay          # ws://localhost:1234

# terminal 2: the app
npm run dev                # http://localhost:5173

# open two browser tabs to see live cursors + real-time sync:
#   http://localhost:5173/?board=demo
#   http://localhost:5173/?board=demo   (in a second tab/incognito window)
```

Click **"Simulate network partition"** in the header of either tab to disconnect just
that tab (via the app's own connection manager, independent of your real network) —
edit the board while it's "offline", then click **"Simulate reconnect"** and watch the
edits merge into the other tab with zero data loss.

## Testing

```bash
npm test          # Vitest unit + conflict-resolution suite (32 tests; no network, no Docker)
npm run build     # tsc --noEmit + production build
npm run e2e       # Playwright E2E (a required CI job) — needs `npx playwright install chromium`
                  # and spins up a real relay + real dev server (see playwright.config.ts)
```

### Running the relay in Docker

```bash
docker compose up --build
# or directly:
docker build -t syncboard-relay .
docker run -p 1234:1234 syncboard-relay
```

## How it works

### Document schema (`src/store/boardStore.ts`)

```
Y.Doc
├── getMap('columns')  columnId -> Y.Map { id, title, order, cardIds: Y.Array<string> }
└── getMap('cards')    cardId   -> Y.Map { id, columnId, title: Y.Text, description: Y.Text, createdAt, updatedAt }
```

`cardIds` arrays are treated as an **ordering hint**, not the source of truth for
column membership — `card.columnId` is. This is the one non-obvious design decision in
the project, and it exists to fix a real bug found during development: if two
replicas concurrently move the *same* card into two *different* columns while
partitioned, each removes the card from the shared source array (fine, that converges)
but inserts it into its *own* destination array — two different `Y.Array` instances, so
both inserts survive independently. Without a fix, the card would render inside two
columns at once after the merge, even though `columnId` itself already resolved to one
deterministic winner. `BoardStore.getSnapshot()` reconciles this at read time: each
column's rendered card list is filtered to cards whose `columnId` actually points at
it, with strays re-attached to whichever column they legitimately belong to. See the
`"resolves a concurrent move-to-two-different-columns split-brain"` test for the
regression case.

### Offline-first persistence (`src/store/persistence.ts`)

Wraps `y-indexeddb`. Unit-tested against `fake-indexeddb` (a full in-memory IndexedDB
implementation) so the real persistence code path — not a mock of it — runs in CI with
no browser and no network.

### Connection state machine (`src/lib/connectionManager.ts`)

`y-websocket`'s `WebsocketProvider` only knows about the socket; it will happily keep
retrying with exponential backoff even after the OS has told the browser there's no
network at all. `ConnectionManager` layers `navigator.onLine`/`online`/`offline` events
on top: the instant the browser reports no network it force-disconnects the provider
and reports a distinct `offline` status (vs. `disconnected`, a live retry-in-progress
state); the instant the network returns it reconnects immediately rather than waiting
out a backoff timer. It's built against a small `SyncProvider` interface so the whole
state machine is unit-tested with a fake transport — no real socket required.

### Live cursors (`src/hooks/useCursorBroadcast.ts`, `src/components/Cursors.tsx`)

Cursor positions are coalesced to at most one awareness update per animation frame
(`requestAnimationFrame`), so mouse movement doesn't flood the relay. Built on Yjs **awareness** (`y-protocols/awareness`, wired in via `y-websocket`), which
is deliberately a separate channel from the CRDT document: awareness state (cursor
position, presence) is ephemeral and re-broadcast on connect, never persisted and never
merged into document history — which matches the semantics wanted for "is this person still
here" instead of "what did they type."

### Drag-and-drop kanban UI (`src/components/`)

Native HTML5 drag-and-drop (no DnD dependency) driving `BoardStore.moveCard`, so every
drag operation is a real CRDT mutation, replicated and persisted the same way a typed
edit is.

## Project layout

```
src/
  types.ts                    shared TS types (snapshots, awareness state)
  store/
    boardStore.ts              Yjs document schema + mutation API
    persistence.ts              IndexedDB (y-indexeddb) wrapper
    connection.ts                relay wiring (WebsocketProvider + awareness)
    __tests__/
      boardStore.test.ts        CRUD behavior of the schema
      partition.test.ts          conflict-resolution / split-brain suite
      persistence.test.ts        IndexedDB durability, using fake-indexeddb
  lib/
    textDelta.ts                 minimal-diff binder for plain strings <-> Y.Text
    connectionManager.ts         online/offline/reconnect state machine
    __tests__/                   unit tests for both, no network/browser required
  hooks/
    useBoard.ts                  assembles doc + persistence + relay + awareness
    useCursorBroadcast.ts        mouse -> awareness broadcaster (one update per animation frame)
  components/                    Board, Column, CardItem, Cursors, ConnectionBanner
  server/
    relay.ts                     the y-websocket relay (Dockerized)
e2e/
  offline-online.spec.ts         two-browser-context partition/reconnect test (Playwright)
```

## Limitations

- **Field-level edits are last-writer-wins**, deterministically ordered by Yjs, not
  merged semantically. Concurrent edits to the *same* character range of a title (rather
  than different ranges) resolve to one winner — Yjs guarantees both replicas agree on
  which one, but it doesn't invent a merge of "delete this word" vs. "change this word"
  the way a human would.
- **Deleting a column that another replica is concurrently adding a card into** leaves
  that card as an orphan (present in the `cards` map, not attached to any surviving
  column) rather than silently deleting it or resurrecting the column. This is a
  deliberate, tested trade-off — see `partition.test.ts` — favoring "never silently
  lose a user's card" over automatic column resurrection.
- The relay holds no board data at rest; it is a pure message relay. Long-term storage
  of a board that no client has open would need a persistence-enabled relay (Yjs
  supports this via `y-leveldb`/`y-redis` persistence adapters) — out of scope here by
  design, since every client already persists its own full copy.

## License

MIT — see [LICENSE](LICENSE).
