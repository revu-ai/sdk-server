/**
 * @file Bounded in-memory FIFO queue. The hard cap is what keeps memory flat
 * when REVU is unreachable for a long time: once full, the oldest entry is
 * dropped to make room, so the most recent traffic is what gets reported.
 */

/**
 * @template T
 */
export class BoundedQueue {
  /**
   * @param {number} max Maximum entries held (at least 1).
   */
  constructor(max) {
    /** @type {number} */
    this.max = Math.max(1, Math.floor(max));
    /** @type {T[]} */
    this.items = [];
  }

  /** @returns {number} Entries currently queued. */
  get size() {
    return this.items.length;
  }

  /**
   * Append one entry, dropping the oldest when the queue is full.
   * @param {T} item
   * @returns {number} How many entries were dropped (0 or 1).
   */
  push(item) {
    this.items.push(item);
    if (this.items.length <= this.max) return 0;
    this.items.shift();
    return 1;
  }

  /**
   * Put entries back at the front (after a throttled send), keeping the cap.
   * When the combined length exceeds the cap, the oldest entries are dropped.
   * @param {T[]} items
   * @returns {number} How many entries were dropped.
   */
  unshift(items) {
    this.items = items.concat(this.items);
    const overflow = this.items.length - this.max;
    if (overflow <= 0) return 0;
    this.items.splice(0, overflow);
    return overflow;
  }

  /**
   * Remove and return up to `n` entries from the front.
   * @param {number} n
   * @returns {T[]}
   */
  take(n) {
    return this.items.splice(0, n);
  }

  /** Drop everything. */
  clear() {
    this.items = [];
  }
}
