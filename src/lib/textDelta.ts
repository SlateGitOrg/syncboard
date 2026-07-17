import * as Y from 'yjs';

/**
 * Applies a plain-string value to a Y.Text instance using a minimal
 * prefix/suffix diff instead of a blind "delete everything, insert
 * everything" replace.
 *
 * Why this matters for the CRDT story: Yjs deletes are tombstones on
 * specific character ids, not on a byte range. If we only touch the
 * middle segment that actually changed, characters a concurrent
 * (offline) editor inserted elsewhere in the string are never targeted
 * by our delete op, so they survive the merge instead of being wiped
 * out by an over-eager full-text replace. This is the concrete
 * mechanism behind "no silent last-write-wins data loss" for text
 * fields.
 */
export function applyTextDelta(ytext: Y.Text, next: string): void {
  const current = ytext.toString();
  if (current === next) return;

  let prefix = 0;
  const maxPrefix = Math.min(current.length, next.length);
  while (prefix < maxPrefix && current[prefix] === next[prefix]) {
    prefix++;
  }

  let suffix = 0;
  const maxSuffix = Math.min(current.length, next.length) - prefix;
  while (
    suffix < maxSuffix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }

  const deleteLength = current.length - prefix - suffix;
  const insertText = next.slice(prefix, next.length - suffix);

  if (deleteLength > 0) {
    ytext.delete(prefix, deleteLength);
  }
  if (insertText.length > 0) {
    ytext.insert(prefix, insertText);
  }
}
