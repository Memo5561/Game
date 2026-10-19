// Interstitial cadence and the soft remove-ads upsell (docs/ARCHITECTURE.md §4.11).
// Interstitials are gated by active play time, not by run count: none during roughly the whole
// first session, then at most one per INTERSTITIAL_MIN_PLAY_SEC_SINCE_AD seconds of play and
// INTERSTITIAL_MIN_INTERVAL_SEC of wall clock since any full-screen ad, never after the first run
// of a session. Pure logic on SaveData (`save.ads`, `save.stats.playSec`, `save.iap.adsRemoved`).

import { CONFIG } from '../config.js';
import { dayKey } from './progression.js';

/** @param {unknown} v @returns {number} finite seconds >= 0 (anything else → 0) */
function seconds(v) {
  return Number.isFinite(v) && v > 0 ? v : 0;
}

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
   * pieces are ignored entirely. Play time from before a rewarded ad watched in this run
   * (`markRewardedShown(runPlaySecSoFar)`) was already "spent" by that ad and does not count.
   * @param {{ playSec: number, pieces: number }} run playSec = active in-run seconds of the whole run
   * @returns {boolean} whether the run counted
   */
  onRunFinished({ playSec, pieces } = {}) {
    const ads = this.save.ads;
    const adAt = seconds(ads.runSecAtAd);
    const sinceAd = Math.max(0, seconds(playSec) - adAt);
    if (adAt > 0) ads.runSecAtAd = 0; // the run is over, whether it counted or not
    if (!(pieces >= this.config.RUN_MIN_PIECES)) {
      if (adAt > 0) this._changed();
      return false;
    }
    ads.runsFinished += 1;
    ads.sessionRuns += 1;
    ads.playSecSinceAd += sinceAd;
    this._changed();
    return true;
  }

  /**
   * Ask right before an interstitial would be shown (leaving a run-result screen).
   * @param {{ newBest?: boolean, nearRecord?: boolean, celebration?: boolean }} [context] emotional
   *   moments (new best, close call, 3-star win): with SKIP_AFTER_HIGH_MOMENTS none of them is
   *   interrupted by an ad. Nothing is consumed: the ad is simply postponed to the next result screen.
   * @returns {boolean}
   */
  shouldShowInterstitial(context = {}) {
    const c = this.config;
    const ads = this.save.ads;
    if (this.save.iap.adsRemoved) return false;
    if (c.SKIP_AFTER_HIGH_MOMENTS && context && (context.newBest || context.nearRecord || context.celebration)) return false;
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

  /**
   * After every rewarded ad that was shown (a full-screen ad resets the cadence too).
   * @param {number} [runPlaySecSoFar=0] active play seconds of the running run at this moment (a
   *   mid-run ad: revive, booster), 0/omitted for an ad outside a run. `onRunFinished` then credits
   *   only the play time after the ad. Persisted in `save.ads.runSecAtAd`, so a resumed run keeps it.
   */
  markRewardedShown(runPlaySecSoFar = 0) {
    const ads = this.save.ads;
    ads.playSecSinceAd = 0;
    ads.runSecAtAd = seconds(runPlaySecSoFar);
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
