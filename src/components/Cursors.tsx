import type { PeerAwarenessState } from '../types';

export function Cursors({ peers }: { peers: PeerAwarenessState[] }) {
  return (
    <div className="cursor-layer">
      {peers
        .filter((peer) => peer.cursor)
        .map((peer) => (
          <div
            key={peer.user.id}
            className="peer-cursor"
            style={{
              transform: `translate(${peer.cursor!.x}px, ${peer.cursor!.y}px)`,
              // color comes from awareness, not hard-coded — each peer gets a
              // deterministic color derived from their client id.
              // eslint-disable-next-line
              ['--cursor-color' as any]: peer.user.color,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill={peer.user.color}>
              <path d="M2 1l14 6-6 2-2 6-6-14z" />
            </svg>
            <span className="peer-label" style={{ background: peer.user.color }}>
              {peer.user.name}
            </span>
          </div>
        ))}
    </div>
  );
}
