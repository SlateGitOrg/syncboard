import { useEffect } from 'react';
import type { WebsocketProvider } from 'y-websocket';

/**
 * Throttled mouse-position broadcaster over Yjs awareness. Awareness state
 * is ephemeral (never persisted, never merged into the CRDT document) —
 * exactly what you want for live cursors, which should vanish the instant
 * a peer disconnects rather than being replayed from history.
 */
export function useCursorBroadcast(
  provider: WebsocketProvider | undefined,
  containerRef: React.RefObject<HTMLElement>,
): void {
  useEffect(() => {
    if (!provider) return;
    const container = containerRef.current;
    if (!container) return;

    let frame: number | null = null;
    let pending: { x: number; y: number } | null = null;

    const flush = () => {
      frame = null;
      if (!pending) return;
      const current = provider.awareness.getLocalState() ?? {};
      provider.awareness.setLocalState({ ...current, cursor: pending });
      pending = null;
    };

    const handleMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      pending = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (frame === null) frame = requestAnimationFrame(flush);
    };

    const handleLeave = () => {
      const current = provider.awareness.getLocalState() ?? {};
      provider.awareness.setLocalState({ ...current, cursor: null });
    };

    container.addEventListener('mousemove', handleMove);
    container.addEventListener('mouseleave', handleLeave);
    return () => {
      container.removeEventListener('mousemove', handleMove);
      container.removeEventListener('mouseleave', handleLeave);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [provider, containerRef]);
}
