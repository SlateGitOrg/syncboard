import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyTextDelta } from '../textDelta';

function makeText(initial: string): Y.Text {
  const doc = new Y.Doc();
  const text = doc.getText('t');
  text.insert(0, initial);
  return text;
}

describe('applyTextDelta', () => {
  it('is a no-op when the value is unchanged', () => {
    const text = makeText('hello');
    applyTextDelta(text, 'hello');
    expect(text.toString()).toBe('hello');
  });

  it('appends to the end', () => {
    const text = makeText('hello');
    applyTextDelta(text, 'hello world');
    expect(text.toString()).toBe('hello world');
  });

  it('prepends to the start', () => {
    const text = makeText('world');
    applyTextDelta(text, 'hello world');
    expect(text.toString()).toBe('hello world');
  });

  it('replaces a middle segment only', () => {
    const text = makeText('the quick brown fox');
    applyTextDelta(text, 'the slow brown fox');
    expect(text.toString()).toBe('the slow brown fox');
  });

  it('handles full replacement when there is no shared prefix/suffix', () => {
    const text = makeText('abc');
    applyTextDelta(text, 'xyz');
    expect(text.toString()).toBe('xyz');
  });

  it('handles clearing the text entirely', () => {
    const text = makeText('abc');
    applyTextDelta(text, '');
    expect(text.toString()).toBe('');
  });

  it('only touches the changed range, leaving concurrently-inserted characters elsewhere untouched', () => {
    // Two replicas of the same Y.Doc/Y.Text: one applies our delta-based
    // edit, the other independently inserts a character in an untouched
    // region. Applying both updates to a fresh doc must preserve both.
    const docA = new Y.Doc();
    const textA = docA.getText('t');
    textA.insert(0, 'the quick brown fox');

    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const textB = docB.getText('t');

    // Replica A edits the word "quick" -> "slow" via the diff helper.
    applyTextDelta(textA, 'the slow brown fox');
    // Replica B, concurrently and independently, appends to the end.
    textB.insert(textB.length, '!');

    const merged = new Y.Doc();
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(docB));

    expect(merged.getText('t').toString()).toBe('the slow brown fox!');
  });
});
