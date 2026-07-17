import type { ConnectionStatus } from '../types';

const COPY: Record<ConnectionStatus, string> = {
  connected: 'Live — synced with the relay',
  connecting: 'Connecting to relay…',
  disconnected: 'Relay unreachable — editing offline, will sync on reconnect',
  offline: 'Offline — edits are queued locally and will sync when you reconnect',
};

export function ConnectionBanner({
  status,
  onToggleOffline,
}: {
  status: ConnectionStatus;
  onToggleOffline: (offline: boolean) => void;
}) {
  const isOffline = status === 'offline';
  return (
    <div className={`connection-banner status-${status}`} data-testid="connection-banner">
      <span className={`status-dot status-dot-${status}`} />
      <span>{COPY[status]}</span>
      <button
        type="button"
        className="offline-toggle"
        data-testid="offline-toggle"
        onClick={() => onToggleOffline(!isOffline)}
      >
        {isOffline ? 'Simulate reconnect' : 'Simulate network partition'}
      </button>
    </div>
  );
}
