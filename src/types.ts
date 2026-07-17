export interface ColumnSnapshot {
  id: string;
  title: string;
  order: number;
  cardIds: string[];
}

export interface CardSnapshot {
  id: string;
  columnId: string;
  title: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export interface BoardSnapshot {
  columns: ColumnSnapshot[];
  cards: Record<string, CardSnapshot>;
}

export type ConnectionStatus = 'offline' | 'connecting' | 'connected' | 'disconnected';

export interface PeerAwarenessState {
  user: {
    id: string;
    name: string;
    color: string;
  };
  cursor: { x: number; y: number } | null;
  focusCardId: string | null;
}
