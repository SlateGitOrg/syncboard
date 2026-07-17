import { useState } from 'react';
import type { CardSnapshot, ColumnSnapshot } from '../types';
import { CardItem } from './CardItem';

interface ColumnProps {
  column: ColumnSnapshot;
  cards: CardSnapshot[];
  onAddCard: (columnId: string, title: string) => void;
  onDeleteCard: (cardId: string) => void;
  onTitleChange: (cardId: string, title: string) => void;
  onDropCard: (cardId: string, toColumnId: string, toIndex: number) => void;
}

export function Column({
  column,
  cards,
  onAddCard,
  onDeleteCard,
  onTitleChange,
  onDropCard,
}: ColumnProps) {
  const [draft, setDraft] = useState('');
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const submit = () => {
    const title = draft.trim();
    if (!title) return;
    onAddCard(column.id, title);
    setDraft('');
  };

  const handleDragStart = (event: React.DragEvent, cardId: string) => {
    event.dataTransfer.setData('text/plain', cardId);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (event: React.DragEvent, index: number) => {
    event.preventDefault();
    const cardId = event.dataTransfer.getData('text/plain');
    if (cardId) onDropCard(cardId, column.id, index);
    setDragOverIndex(null);
  };

  return (
    <div className="column" data-testid={`column-${column.id}`}>
      <div className="column-header">
        <h3>{column.title}</h3>
        <span className="column-count">{cards.length}</span>
      </div>

      <div
        className="column-body"
        onDragOver={(event) => {
          event.preventDefault();
          setDragOverIndex(cards.length);
        }}
        onDrop={(event) => handleDrop(event, cards.length)}
      >
        {cards.map((card, index) => (
          <div
            key={card.id}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragOverIndex(index);
            }}
            onDrop={(event) => {
              event.stopPropagation();
              handleDrop(event, index);
            }}
            className={dragOverIndex === index ? 'drop-target' : undefined}
          >
            <CardItem
              card={card}
              onDragStart={handleDragStart}
              onTitleChange={onTitleChange}
              onDelete={onDeleteCard}
            />
          </div>
        ))}

        <div className="add-card">
          <input
            placeholder="Add a card…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
          />
          <button type="button" onClick={submit}>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
