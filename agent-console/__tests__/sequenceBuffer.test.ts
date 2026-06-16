import { SeqBuffer } from '@/lib/sequenceBuffer';
import type { ServerMessage, TokenMessage } from '@/lib/types';

/** Helper: create a minimal TOKEN ServerMessage with a given seq */
function makeToken(seq: number): TokenMessage {
  return { type: 'TOKEN', seq, text: `t${seq}`, stream_id: 'stream-1' };
}

describe('SeqBuffer', () => {
  let buf: SeqBuffer;

  beforeEach(() => {
    buf = new SeqBuffer();
  });

  // 1. Empty buffer — drain() returns []
  it('returns empty array when buffer is empty', () => {
    expect(buf.drain()).toEqual([]);
    expect(buf.getLastProcessed()).toBe(-1);
  });

  // 2. Single in-order message — drain() returns it, updates lastProcessed
  it('returns a single in-order message and updates lastProcessed', () => {
    buf.insert(makeToken(0));
    const drained = buf.drain();
    expect(drained).toHaveLength(1);
    expect((drained[0] as TokenMessage).seq).toBe(0);
    expect(buf.getLastProcessed()).toBe(0);
  });

  // 3. Out-of-order: insert 3, 1, 2 — drain() returns [1,2,3]
  it('reorders out-of-order messages and drains in seq order', () => {
    buf.insert(makeToken(3));
    buf.insert(makeToken(1));
    buf.insert(makeToken(2));
    // After inserting 3 and 1: drain returns only seq=0 chain starting from -1+1=0 — but 0 is missing
    // Wait — default lastProcessed is -1, so next expected is 0. seq 1 is not 0 → nothing drains yet.
    expect(buf.drain()).toEqual([]);

    // Insert seq=0 to fill the gap from initial state
    buf.insert(makeToken(0));
    const drained = buf.drain();
    expect(drained.map((m: ServerMessage) => m.seq)).toEqual([0, 1, 2, 3]);
    expect(buf.getLastProcessed()).toBe(3);
  });

  // 4. Duplicate seq — inserting the same seq twice, drain() returns it once
  it('ignores duplicate seqs and drains each seq only once', () => {
    buf.insert(makeToken(0));
    buf.insert(makeToken(0));  // duplicate
    const drained = buf.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]?.seq).toBe(0);
  });

  // 5. Gap: insert 1, 2, 4 — drain returns [1,2], holds 4. Insert 3, drain returns [3,4]
  it('stops draining at a gap and resumes when gap is filled', () => {
    // Start from seq 0
    buf.insert(makeToken(0));
    buf.insert(makeToken(1));
    buf.insert(makeToken(2));
    buf.insert(makeToken(4)); // gap: 3 missing

    const first = buf.drain();
    expect(first.map((m: ServerMessage) => m.seq)).toEqual([0, 1, 2]);
    expect(buf.getLastProcessed()).toBe(2);

    buf.insert(makeToken(3));
    const second = buf.drain();
    expect(second.map((m: ServerMessage) => m.seq)).toEqual([3, 4]);
    expect(buf.getLastProcessed()).toBe(4);
  });

  // 6. reset(5) then insert 3, 5, 6 — drain() returns [6] only
  it('after reset(5), ignores seqs <= 5 and drains from 6 onward', () => {
    buf.reset(5);
    buf.insert(makeToken(3)); // already processed
    buf.insert(makeToken(5)); // already processed
    buf.insert(makeToken(6)); // next expected
    const drained = buf.drain();
    expect(drained.map((m: ServerMessage) => m.seq)).toEqual([6]);
    expect(buf.getLastProcessed()).toBe(6);
  });

  // 7. Fully reversed sequence [5,4,3,2,1] — drain() returns [1,2,3,4,5]
  it('handles a fully reversed insertion order correctly', () => {
    buf.insert(makeToken(5));
    buf.insert(makeToken(4));
    buf.insert(makeToken(3));
    buf.insert(makeToken(2));
    buf.insert(makeToken(1));
    // seq 0 still missing — drain returns nothing
    expect(buf.drain()).toEqual([]);

    buf.insert(makeToken(0));
    const drained = buf.drain();
    expect(drained.map((m: ServerMessage) => m.seq)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(buf.getLastProcessed()).toBe(5);
  });
});
