import type { ServerMessage } from '@/lib/types';

/**
 * SeqBuffer — sequence-order deduplication buffer.
 *
 * Guarantees that messages are emitted in strict ascending seq order with no
 * gaps. Out-of-order or duplicate messages are held until their predecessors
 * arrive.
 */
export class SeqBuffer {
  private buffer: Map<number, ServerMessage> = new Map();
  private lastProcessed: number = -1;

  /**
   * Insert a message. Silently ignores duplicates (same seq already seen or
   * already processed).
   */
  insert(msg: ServerMessage): void {
    const { seq } = msg;
    // Drop already-processed and duplicates
    if (seq <= this.lastProcessed) return;
    if (this.buffer.has(seq)) return;
    this.buffer.set(seq, msg);
  }

  /**
   * Drain consecutive ready messages starting from lastProcessed + 1.
   * Stops at the first gap. Updates lastProcessed internally.
   */
  drain(): ServerMessage[] {
    const result: ServerMessage[] = [];
    let next = this.lastProcessed + 1;

    while (this.buffer.has(next)) {
      const msg = this.buffer.get(next) as ServerMessage;
      this.buffer.delete(next);
      result.push(msg);
      this.lastProcessed = next;
      next++;
    }

    return result;
  }

  /** Returns the highest seq that has been fully processed. */
  getLastProcessed(): number {
    return this.lastProcessed;
  }

  /**
   * Reset the buffer to a new starting point (RESUME scenario).
   * All seqs <= lastProcessedSeq are considered already processed.
   */
  reset(lastProcessedSeq: number): void {
    this.buffer.clear();
    this.lastProcessed = lastProcessedSeq;
  }
}
