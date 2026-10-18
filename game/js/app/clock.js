// The app's single wall clock. Progression, AdPolicy, the daily challenge and all day-scoped UI
// read time only through here, so the debug API can move the whole game in time (setNow) while
// time keeps running from the chosen instant.

import { dayKey } from '../meta/progression.js';

let offsetMs = 0;

export const clock = {
  /** @returns {number} ms timestamp */
  nowMs() {
    return Date.now() + offsetMs;
  },

  /** @returns {Date} */
  now() {
    return new Date(Date.now() + offsetMs);
  },

  /** @returns {string} local day key 'YYYY-MM-DD' */
  today() {
    return dayKey(this.now());
  },

  /**
   * Moves the clock so that "now" is `iso` (time keeps running); null restores real time.
   * @param {string|number|null} iso ISO string or ms timestamp
   */
  setNow(iso) {
    if (iso === null || iso === undefined) {
      offsetMs = 0;
      return;
    }
    const ms = typeof iso === 'number' ? iso : Date.parse(iso);
    if (!Number.isFinite(ms)) throw new Error(`clock.setNow: invalid time ${iso}`);
    offsetMs = ms - Date.now();
  },

  /** @returns {number} current offset to real time in ms (0 = real time) */
  get offsetMs() {
    return offsetMs;
  },
};
