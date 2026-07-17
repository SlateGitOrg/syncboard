import type { ConnectionStatus } from '../types';

/**
 * The minimal surface ConnectionManager needs from a sync transport. The
 * real implementation is `y-websocket`'s WebsocketProvider (see
 * `store/connection.ts`); tests inject a lightweight fake so the state
 * machine below can be exercised with zero real sockets and zero network
 * access.
 */
export interface SyncProvider {
  connect(): void;
  disconnect(): void;
  on(event: 'status', cb: (payload: { status: 'connecting' | 'connected' | 'disconnected' }) => void): void;
  off(event: 'status', cb: (payload: { status: 'connecting' | 'connected' | 'disconnected' }) => void): void;
}

export type StatusListener = (status: ConnectionStatus) => void;

export interface BrowserNetworkSource {
  isOnline(): boolean;
  onOnline(cb: () => void): void;
  onOffline(cb: () => void): void;
  offOnline(cb: () => void): void;
  offOffline(cb: () => void): void;
}

/** Default network source backed by `navigator.onLine` + window events, for browser use. */
export const browserNetworkSource: BrowserNetworkSource = {
  isOnline: () => typeof navigator === 'undefined' || navigator.onLine,
  onOnline: (cb) => window.addEventListener('online', cb),
  onOffline: (cb) => window.addEventListener('offline', cb),
  offOnline: (cb) => window.removeEventListener('online', cb),
  offOffline: (cb) => window.removeEventListener('offline', cb),
};

/**
 * Owns the online/offline/connecting/connected state machine on top of a
 * sync provider.
 *
 * Why this exists instead of relying on WebsocketProvider's own status
 * alone: y-websocket only knows about the *socket*. It happily keeps
 * retrying a dead socket with exponential backoff even when the OS has
 * already told the browser there is no network at all, which produces a
 * confusing "connecting… connecting… connecting…" UI forever and wastes
 * battery. ConnectionManager layers browser-level connectivity awareness
 * on top: the moment the network goes away it forces the provider to
 * disconnect and reports a distinct `offline` status; the moment the
 * network returns it reconnects immediately instead of waiting out a
 * backoff timer.
 */
export class ConnectionManager {
  private status: ConnectionStatus;
  private readonly listeners = new Set<StatusListener>();
  private readonly handleProviderStatus = (payload: {
    status: 'connecting' | 'connected' | 'disconnected';
  }) => {
    if (!this.network.isOnline()) {
      // Browser already told us we're offline; don't let a stray socket
      // event flip the UI back to "connecting".
      this.setStatus('offline');
      return;
    }
    this.setStatus(payload.status);
  };
  private readonly handleNetworkOnline = () => {
    this.setStatus('connecting');
    this.provider.connect();
  };
  private readonly handleNetworkOffline = () => {
    this.provider.disconnect();
    this.setStatus('offline');
  };

  constructor(
    private readonly provider: SyncProvider,
    private readonly network: BrowserNetworkSource = browserNetworkSource,
  ) {
    this.status = this.network.isOnline() ? 'connecting' : 'offline';
    this.provider.on('status', this.handleProviderStatus);
    this.network.onOnline(this.handleNetworkOnline);
    this.network.onOffline(this.handleNetworkOffline);

    if (!this.network.isOnline()) {
      this.provider.disconnect();
    }
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  onStatusChange(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Simulates a manual "go offline" toggle (used by the UI demo control and by tests). */
  forceOffline(): void {
    this.handleNetworkOffline();
  }

  /** Simulates reconnecting after a manual offline toggle. */
  forceOnline(): void {
    if (this.network.isOnline()) {
      this.handleNetworkOnline();
    }
  }

  destroy(): void {
    this.provider.off('status', this.handleProviderStatus);
    this.network.offOnline(this.handleNetworkOnline);
    this.network.offOffline(this.handleNetworkOffline);
    this.listeners.clear();
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.listeners.forEach((listener) => listener(status));
  }
}
