// Interstitial cadence and the soft remove-ads upsell (docs/ARCHITECTURE.md §4.11).
// Interstitials are gated by active play time, not by run count: none during roughly the whole
// first session, then at most one per INTERSTITIAL_MIN_PLAY_SEC_SINCE_AD seconds of play and
// INTERSTITIAL_MIN_INTERVAL_SEC of wall clock since any full-screen ad, never after the first run
// of a session. Pure logic on SaveData (`save.ads`, `save.stats.playSec`, `save.iap.adsRemoved`).

import { CONFIG } from '../config.js';
import { dayKey } from './progression.js';

export class AdPolicy {
  /**
   * @param {import('./storage.js').SaveData} save
   * @param {{ config?: typeof CONFIG.ADS, nowMs?: () => number, onChange?: (save: object) => void }} [options]
   *   onChange (extra) runs after every mutation, like Progression's
   */
  constructor(save, { config = CONFIG.ADS, nowMs = () => Date.now(), onChange } = {}) {
    this.save = save;
    this.config = config;
    this._nowMs = nowMs;
    this._onChange = typeof onChange === 'function' ? onChange : null;
  }

  /** A new session began (cold start, or resume after >= SESSION_GAP_MIN away). */
  onSessionStart() {
    this.save.ads.sessionRuns = 0;
    this.save.lastSessionStart = this._nowMs();
    this._changed();
  }

  /**
   * Once per finished or abandoned run (never the tutorial). Runs with fewer than RUN_MIN_PIECES
   * pieces are ignored entirely.
   * @param {{ playSec: number, pieces: number }} run playSec = active in-run seconds
   * @returns {boolean} whether the run counted
   */
  onRunFinished({ playSec, pieces } = {}) {
    if (!(pieces >= this.config.RUN_MIN_PIECES)) return false;
    const ads = this.save.ads;
    ads.runsFinished += 1;
    ads.sessionRuns += 1;
    ads.playSecSinceAd += Number.isFinite(playSec) && playSec > 0 ? playSec : 0;
    this._changed();
    return true;
  }

  /**
   * Ask right before an interstitial would be shown (leaving a run-result screen).
   * @returns {boolean}
   */
  shouldShowInterstitial() {
    const c = this.config;
    const ads = this.save.ads;
    if (this.save.iap.adsRemoved) return false;
    if (this.save.stats.playSec < c.INTERSTITIAL_MIN_TOTAL_PLAY_SEC) return false;
    if (ads.playSecSinceAd < c.INTERSTITIAL_MIN_PLAY_SEC_SINCE_AD) return false;
    const elapsedMs = this._nowMs() - Math.max(ads.lastInterstitialAt, ads.lastRewardedAt);
    // A negative elapsed time means the clock moved back: count the interval as elapsed.
    if (elapsedMs >= 0 && elapsedMs < c.INTERSTITIAL_MIN_INTERVAL_SEC * 1000) return false;
    if (c.SKIP_FIRST_RUN_OF_SESSION && ads.sessionRuns <= 1) return false;
    return true;
  }

  /** After an interstitial was actually shown. */
  markInterstitialShown() {
    const ads = this.save.ads;
    ads.playSecSinceAd = 0;
    ads.lastInterstitialAt = this._nowMs();
    ads.interstitialsShown += 1;
    this._changed();
  }

  /** After every rewarded ad that resolved true (a full-screen ad resets the cadence too). */
  markRewardedShown() {
    const ads = this.save.ads;
    ads.playSecSinceAd = 0;
    ads.lastRewardedAt = this._nowMs();
    this._changed();
  }

  /**
   * Soft "ad-free" chip on the game-over screen: after UPSELL_AFTER_INTERSTITIALS interstitials,
   * at most once per day.
   * @returns {boolean}
   */
  shouldShowUpsell() {
    const ads = this.save.ads;
    return !this.save.iap.adsRemoved
      && ads.interstitialsShown >= this.config.UPSELL_AFTER_INTERSTITIALS
      && ads.upsellDay !== this._today();
  }

  /** The upsell chip was shown (blocks it for the rest of the day). */
  markUpsellShown() {
    this.save.ads.upsellDay = this._today();
    this._changed();
  }

  _today() {
    return dayKey(new Date(this._nowMs()));
  }

  _changed() {
    if (this._onChange) this._onChange(this.save);
  }
}
