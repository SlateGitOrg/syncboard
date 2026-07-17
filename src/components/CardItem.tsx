import { useState } from 'react';
import type { CardSnapshot } from '../types';

interface CardItemProps {
  card: CardSnapshot;
  onDragStart: (event: React.DragEvent, cardId: string) => void;
  onTitleChange: (cardId: string, title: string) => void;
  onDelete: (cardId: string) => void;
}

export function CardItem({ card, onDragStart, onTitleChange, onDelete }: CardItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.title);

  const commit = () => {
    setEditing(false);
    if (draft.trim().length === 0) {
      onTitleChange(card.id, card.title);
      return;
    }
    onTitleChange(card.id, draft);
  };

  return (
    <div
      className="card"
      draggable
      data-testid={`card-${card.id}`}
      onDragStart={(event) => onDragStart(event, card.id)}
    >
      {editing ? (
        <input
          autoFocus
          className="card-title-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') {
              setDraft(card.title);
              setEditing(false);
            }
          }}
        />
      ) : (
        <p className="card-title" onClick={() => setEditing(true)}>
          {card.title}
        </p>
      )}
      <button
        type="button"
        className="card-delete"
        aria-label="Delete card"
        onClick={() => onDelete(card.id)}
      >
        ×
      </button>
    </div>
  );
}
