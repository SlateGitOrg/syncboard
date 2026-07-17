import { useMemo, useState } from 'react';
import { useBoard } from './hooks/useBoard';
import { Board } from './components/Board';
import { ConnectionBanner } from './components/ConnectionBanner';

const ADJECTIVES = ['Swift', 'Calm', 'Bright', 'Bold', 'Quiet', 'Clever'];
const ANIMALS = ['Falcon', 'Otter', 'Lynx', 'Heron', 'Fox', 'Wren'];

function randomName(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${adjective} ${animal}`;
}

function getBoardIdFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('board') || 'demo';
}

export default function App() {
  const [boardId] = useState(getBoardIdFromUrl);
  const userName = useMemo(randomName, []);
  const relayUrl = import.meta.env.VITE_RELAY_URL ?? 'ws://localhost:1234';

  const { store, snapshot, status, peers, provider, setForcedOffline } = useBoard({
    boardId,
    relayUrl,
    userName,
  });

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>SyncBoard</h1>
          <p className="subtitle">
            Board <strong>{boardId}</strong> · you are <strong>{userName}</strong>
          </p>
        </div>
        <ConnectionBanner status={status} onToggleOffline={setForcedOffline} />
      </header>

      <main>
        <Board store={store} snapshot={snapshot} peers={peers} provider={provider} />
      </main>
    </div>
  );
}
