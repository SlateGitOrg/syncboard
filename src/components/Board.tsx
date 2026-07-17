import { useRef } from 'react';
import type { BoardStore } from '../store/boardStore';
import type { BoardSnapshot, PeerAwarenessState } from '../types';
import { Column } from './Column';
import { Cursors } from './Cursors';
import { useCursorBroadcast } from '../hooks/useCursorBroadcast';
import type { WebsocketProvider } from 'y-websocket';

interface BoardProps {
  store: BoardStore;
  snapshot: BoardSnapshot;
  peers: PeerAwarenessState[];
  provider: WebsocketProvider | undefined;
}

export function Board({ store, snapshot, peers, provider }: BoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useCursorBroadcast(provider, containerRef);

  return (
    <div className="board" ref={containerRef} data-testid="board">
      <Cursors peers={peers} />
      {snapshot.columns.map((column) => (
        <Column
          key={column.id}
          column={column}
          cards={column.cardIds.map((id) => snapshot.cards[id]).filter(Boolean)}
          onAddCard={(columnId, title) => store.addCard(columnId, title)}
          onDeleteCard={(cardId) => store.deleteCard(cardId)}
          onTitleChange={(cardId, title) => store.setCardTitle(cardId, title)}
          onDropCard={(cardId, toColumnId, toIndex) => store.moveCard(cardId, toColumnId, toIndex)}
        />
      ))}
    </div>
  );
}
