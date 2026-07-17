import { describe, expect, it, vi } from 'vitest';
import { ConnectionManager, type BrowserNetworkSource, type SyncProvider } from '../connectionManager';

type StatusPayload = { status: 'connecting' | 'connected' | 'disconnected' };

function makeFakeProvider() {
  const listeners = new Set<(payload: StatusPayload) => void>();
  const provider: SyncProvider & { emit(payload: StatusPayload): void } = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: (_event, cb) => listeners.add(cb),
    off: (_event, cb) => listeners.delete(cb),
    emit: (payload) => listeners.forEach((cb) => cb(payload)),
  };
  return provider;
}

function makeFakeNetwork(initiallyOnline = true) {
  let online = initiallyOnline;
  const onlineCbs = new Set<() => void>();
  const offlineCbs = new Set<() => void>();
  const network: BrowserNetworkSource & { goOffline(): void; goOnline(): void } = {
    isOnline: () => online,
    onOnline: (cb) => onlineCbs.add(cb),
    onOffline: (cb) => offlineCbs.add(cb),
    offOnline: (cb) => onlineCbs.delete(cb),
    offOffline: (cb) => offlineCbs.delete(cb),
    goOffline: () => {
      online = false;
      offlineCbs.forEach((cb) => cb());
    },
    goOnline: () => {
      online = true;
      onlineCbs.forEach((cb) => cb());
    },
  };
  return network;
}

describe('ConnectionManager', () => {
  it('starts in "connecting" when the browser reports online', () => {
    const provider = makeFakeProvider();
    const network = makeFakeNetwork(true);
    const manager = new ConnectionManager(provider, network);

    expect(manager.getStatus()).toBe('connecting');
    manager.destroy();
  });

  it('starts "offline" and disconnects the provider immediately when the browser reports no network', () => {
    const provider = makeFakeProvider();
    const network = makeFakeNetwork(false);
    const manager = new ConnectionManager(provider, network);

    expect(manager.getStatus()).toBe('offline');
    expect(provider.disconnect).toHaveBeenCalled();
    manager.destroy();
  });

  it('forwards provider status transitions while online', () => {
    const provider = makeFakeProvider();
    const network = makeFakeNetwork(true);
    const manager = new ConnectionManager(provider, network);

    const seen: string[] = [];
    manager.onStatusChange((status) => seen.push(status));

    provider.emit({ status: 'connected' });
    expect(manager.getStatus()).toBe('connected');

    provider.emit({ status: 'disconnected' });
    expect(manager.getStatus()).toBe('disconnected');

    expect(seen).toEqual(['connected', 'disconnected']);
    manager.destroy();
  });

  it('forces the provider offline and reports "offline" when the browser loses the network mid-session', () => {
    const provider = makeFakeProvider();
    const network = makeFakeNetwork(true);
    const manager = new ConnectionManager(provider, network);
    provider.emit({ status: 'connected' });

    network.goOffline();

    expect(manager.getStatus()).toBe('offline');
    expect(provider.disconnect).toHaveBeenCalledTimes(1);
    manager.destroy();
  });

  it('reconnects immediately when the browser regains the network', () => {
    const provider = makeFakeProvider();
    const network = makeFakeNetwork(true);
    const manager = new ConnectionManager(provider, network);
    network.goOffline();

    network.goOnline();

    expect(manager.getStatus()).toBe('connecting');
    expect(provider.connect).toHaveBeenCalled();
    manager.destroy();
  });

  it('ignores stray "connected" events from the provider while the browser is offline', () => {
    const provider = makeFakeProvider();
    const network = makeFakeNetwork(true);
    const manager = new ConnectionManager(provider, network);
    network.goOffline();

    // A pending reconnect attempt from before the offline event resolves
    // late and reports "connected" — the manager should not believe it.
    provider.emit({ status: 'connected' });

    expect(manager.getStatus()).toBe('offline');
    manager.destroy();
  });

  it('supports a manual force-offline/force-online toggle for demos and tests', () => {
    const provider = makeFakeProvider();
    const network = makeFakeNetwork(true);
    const manager = new ConnectionManager(provider, network);
    provider.emit({ status: 'connected' });

    manager.forceOffline();
    expect(manager.getStatus()).toBe('offline');

    manager.forceOnline();
    expect(manager.getStatus()).toBe('connecting');
    manager.destroy();
  });

  it('stops emitting once destroyed', () => {
    const provider = makeFakeProvider();
    const network = makeFakeNetwork(true);
    const manager = new ConnectionManager(provider, network);
    const listener = vi.fn();
    manager.onStatusChange(listener);

    manager.destroy();
    provider.emit({ status: 'connected' });

    expect(listener).not.toHaveBeenCalled();
  });
});
