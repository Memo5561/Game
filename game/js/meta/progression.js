// Player progression (docs/ARCHITECTURE.md §4.9): coins, XP/levels, stats, feature unlocks,
// 7-day login calendar, daily missions, themes, boosters, journey/daily-challenge rewards, free
// coins and IAP grants. Pure logic on the SaveData object – no DOM, no storage access; every
// mutation is reported through `onChange` (the App wires it to `requestSave`).

import { CONFIG } from '../config.js';
import { generateMissions, progressMissions } from './missions.js';
import { DEFAULT_THEME } from './storage.js';

const { ECONOMY, PROGRESSION, ADS, UNLOCKS, PRODUCTS } = CONFIG;

/** Feature ids known to `isFeatureUnlocked` (passed to mission generation). */
const FEATURES = Object.freeze(['missions', 'daily_reward', 'journey', 'daily']);
/** `save.iap.grantedTokens` keeps this many most recent purchase tokens. */
const MAX_GRANT_TOKENS = 100;
const MAX_STARS = 3;
const MS_PER_DAY = 864e5;

/**
 * Local calendar date as 'YYYY-MM-DD'.
 * @param {Date|number} [date] Date or ms timestamp (default: now)
 * @returns {string}
 */
export function dayKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${d.getFullYear()}-${m < 10 ? '0' : ''}${m}-${day < 10 ? '0' : ''}${day}`;
}

/**
 * Whole calendar days from keyA to keyB (negative if B is earlier). Computed from the keys via
 * Date.UTC, so DST changes never produce 23/25-hour "days". NaN for an invalid key.
 * @param {string} keyA
 * @param {string} keyB
 * @returns {number}
 */
export function daysBetween(keyA, keyB) {
  return Math.round((utcFromKey(keyB) - utcFromKey(keyA)) / MS_PER_DAY);
}

/**
 * XP needed to advance from `level` to `level + 1`.
 * @param {number} level 1-based player level
 * @returns {number}
 */
export function xpForLevel(level) {
  return PROGRESSION.XP_LEVEL_BASE + PROGRESSION.XP_LEVEL_STEP * level;
}

/**
 * @typedef {object} XPResult
 * @property {boolean} leveledUp
 * @property {number[]} levels every level reached by this gain, ascending
 * @property {number} coins LEVEL_UP_COINS per level reached (already added)
 * @property {string[]} unlockedThemes level themes that became owned
 */

/**
 * Progression over one SaveData object (mutated in place).
 * Methods that depend on the calendar (missions, login reward, free coins, challenge streak)
 * first roll day-scoped state over to `dayKey(now())`.
 */
export class Progression {
  /**
   * @param {import('./storage.js').SaveData} save
   * @param {{ now?: () => Date, onChange?: (save: object) => void }} [options]
   *   onChange runs once after every public call that changed the save
   */
  constructor(save, { now = () => new Date(), onChange } = {}) {
    /** @type {import('./storage.js').SaveData} */
    this.save = save;
    this._now = now;
    this._onChange = typeof onChange === 'function' ? onChange : null;
    this._dirty = false;
  }

  // --- feature unlocks ------------------------------------------------------------------------

  /**
   * Progressive unlock from CONFIG.UNLOCKS (`games` = finished games, `journeyLevel` = highest
   * unlocked journey level). Features without requirements are always unlocked.
   * @param {'missions'|'daily_reward'|'journey'|'daily'|string} feature
   * @returns {boolean}
   */
  isFeatureUnlocked(feature) {
    const req = Object.prototype.hasOwnProperty.call(UNLOCKS, feature) ? UNLOCKS[feature] : null;
    if (!req) return true;
    if (req.games !== undefined && this.save.stats.gamesPlayed < req.games) return false;
    if (req.journeyLevel !== undefined && this.save.journey.unlocked < req.journeyLevel) return false;
    return true;
  }

  // --- coins ----------------------------------------------------------------------------------

  /** @returns {number} */
  get coins() {
    return this.save.coins;
  }

  /**
   * @param {number} n coins to add (floored; ≤ 0 adds nothing)
   * @param {string} [source] informational tag of the caller ('ad', 'shop', …)
   * @returns {number} coins actually added
   */
  addCoins(n, source) {
    const added = this._addCoins(n);
    this._commit();
    return added;
  }

  /**
   * @param {number} n non-negative integer price
   * @returns {boolean} false (and nothing spent) if the balance is too low
   */
  spendCoins(n) {
    const ok = this._spend(n);
    this._commit();
    return ok;
  }

  // --- XP / level -----------------------------------------------------------------------------

  /** @returns {{ level: number, xp: number, xpIntoLevel: number, xpForNext: number, progress: number }} */
  levelInfo() {
    const xp = this.save.xp;
    const level = levelFromXP(xp);
    const xpIntoLevel = xp - xpToReach(level);
    const xpForNext = xpForLevel(level);
    return { level, xp, xpIntoLevel, xpForNext, progress: Math.min(1, xpIntoLevel / xpForNext) };
  }

  /**
   * Adds XP; each level reached pays LEVEL_UP_COINS and makes its level themes owned.
   * @param {number} n
   * @returns {XPResult}
   */
  addXP(n) {
    const result = this._addXP(n);
    this._commit();
    return result;
  }

  // --- runs -----------------------------------------------------------------------------------

  /**
   * Records a finished or abandoned run (call once per run, never for the tutorial).
   * - stats for every mode; bestScore, run coins and `newBest` only in classic
   * - classic coins = max(COINS_MIN_PER_GAME, floor(score × COINS_PER_SCORE)); the minimum only
   *   applies to counted runs, so instantly abandoned runs can't farm it
   * - XP = min(XP_RUN_CAP, XP_RUN_BASE + lines × XP_PER_LINE), only for counted runs
   * @param {{ mode: string, score?: number, lines?: number, maxCombo?: number, pieces?: number,
   *   allClears?: number, playSec?: number }} run
   * @returns {{ newBest: boolean, firstRecord: boolean, coinsEarned: number, xp: XPResult,
   *   counted: boolean }} newBest = classic score above the previous best (also on the first
   *   record); firstRecord = the first classic run that scored at all; counted = pieces >= RUN_MIN_PIECES
   */
  recordGame({ mode, score, lines, maxCombo, pieces, allClears, playSec } = {}) {
    const st = this.save.stats;
    const runScore = toCount(score);
    const runLines = toCount(lines);
    const runPieces = toCount(pieces);
    const counted = runPieces >= ADS.RUN_MIN_PIECES;
    const classic = mode === 'classic';

    st.gamesPlayed += 1;
    if (classic) st.classicGames += 1;
    st.totalScore += runScore;
    st.totalLines += runLines;
    st.bestCombo = Math.max(st.bestCombo, toCount(maxCombo));
    st.piecesPlaced += runPieces;
    st.allClears += toCount(allClears);
    st.playSec += Number.isFinite(playSec) && playSec > 0 ? playSec : 0;

    let newBest = false;
    let firstRecord = false;
    let coinsEarned = 0;
    if (classic) {
      if (runScore > st.bestScore) {
        firstRecord = st.bestScore === 0;
        newBest = true;
        st.bestScore = runScore;
      }
      const coins = Math.floor(runScore * ECONOMY.COINS_PER_SCORE);
      coinsEarned = this._addCoins(counted ? Math.max(ECONOMY.COINS_MIN_PER_GAME, coins) : coins);
    }
    const xp = this._addXP(counted
      ? Math.min(PROGRESSION.XP_RUN_CAP, PROGRESSION.XP_RUN_BASE + runLines * PROGRESSION.XP_PER_LINE)
      : 0);
    this.save.lastPlayedAt = this._now().getTime();
    this._dirty = true;
    this._commit();
    return { newBest, firstRecord, coinsEarned, xp, counted };
  }

  /**
   * Grants the run coins once more (×2 rewarded ad). The caller ensures once per run.
   * @param {number} amount
   * @returns {number} coins added
   */
  doubleRunCoins(amount) {
    const added = this._addCoins(amount);
    this._commit();
    return added;
  }

  /** Classic best score. @returns {number} */
  get bestScore() {
    return this.save.stats.bestScore;
  }

  // --- login calendar -------------------------------------------------------------------------

  /**
   * State of the 7-day login calendar. `available` also requires the 'daily_reward' unlock.
   * day = the day that can be claimed now (or, when not available, the day claimed last);
   * streak = consecutive claim days so far (0 if broken); graceUsed = claiming now uses the grace
   * day ("streak saved").
   * @returns {{ available: boolean, day: number, streak: number, graceUsed: boolean,
   *   rewards: Array<{ day: number, coins: number, boosters?: Record<string, number> }> }}
   */
  dailyRewardStatus() {
    const state = this._dailyState(this._rollover());
    this._commit();
    const last = ECONOMY.DAILY_REWARDS.length;
    const rewards = ECONOMY.DAILY_REWARDS.map((coins, i) => (i + 1 === last
      ? { day: i + 1, coins, boosters: { ...ECONOMY.DAILY_REWARD_DAY7_BOOSTERS } }
      : { day: i + 1, coins }));
    return { ...state, rewards };
  }

  /**
   * Claims today's login reward. Gap since the last claim: 1 day → next day; 2 days → next day
   * with `graceUsed`; ≥ 3 days → day 1 and a new streak; after day 7 → day 1 (streak keeps
   * counting); ≤ 0 (already claimed today / clock moved back) → nothing.
   * @param {number} [multiplier] coin multiplier (2 after a rewarded ad); boosters aren't multiplied
   * @returns {{ coins: number, boosters: Record<string, number>, day: number, graceUsed: boolean }}
   *   coins 0 and no boosters when nothing was available
   */
  claimDailyReward(multiplier = 1) {
    const today = this._rollover();
    const state = this._dailyState(today);
    if (!state.available) {
      this._commit();
      return { coins: 0, boosters: {}, day: state.day, graceUsed: false };
    }
    const factor = Math.max(1, Math.floor(Number(multiplier)) || 1);
    const coins = this._addCoins(ECONOMY.DAILY_REWARDS[state.day - 1] * factor);
    const boosters = state.day === ECONOMY.DAILY_REWARDS.length ? { ...ECONOMY.DAILY_REWARD_DAY7_BOOSTERS } : {};
    for (const type of Object.keys(boosters)) this._addBooster(type, boosters[type]);
    const d = this.save.daily;
    d.lastClaimDay = today;
    d.day = state.day;
    d.streak = state.streak + 1;
    this._dirty = true;
    this._commit();
    return { coins, boosters, day: state.day, graceUsed: state.graceUsed };
  }

  // --- missions -------------------------------------------------------------------------------

  /**
   * Today's missions (generated on the first call of a day once 'missions' is unlocked; empty
   * before that).
   * @returns {import('./missions.js').Mission[]} copies
   */
  missions() {
    this._rollover();
    this._commit();
    return this.save.missions.list.filter(isObject).map((m) => ({ ...m }));
  }

  /**
   * Advances mission progress by one meta event (see §4.15 for who sends what).
   * @param {{ type: 'place'|'clear'|'all_clear'|'game_end'|'level_complete'|'daily_complete'|'booster_used',
   *   cells?: number, lines?: number, combo?: number, mode?: string, score?: number, stars?: number,
   *   pieces?: number }} evt game_end may carry `pieces` (see missions.progressMissions)
   * @returns {import('./missions.js').Mission[]} copies of the missions this event completed
   */
  trackEvent(evt) {
    this._rollover();
    const { changed, completed } = progressMissions(this.save.missions.list, evt);
    if (changed) this._dirty = true;
    this._commit();
    return completed;
  }

  /**
   * @param {string} id mission id
   * @returns {number} coins granted (0 if unknown, not completed or already claimed)
   */
  claimMission(id) {
    this._rollover();
    const m = this.save.missions.list.find((x) => isObject(x) && x.id === id);
    let coins = 0;
    if (m && !m.claimed && m.progress >= m.target) {
      m.claimed = true;
      coins = this._addCoins(m.reward);
      this._dirty = true;
    }
    this._commit();
    return coins;
  }

  /** @returns {{ available: boolean, claimed: boolean }} available once all missions are claimed */
  missionBonusStatus() {
    this._rollover();
    this._commit();
    return this._bonusStatus();
  }

  /** @returns {number} MISSION_BONUS_COINS, or 0 if not available */
  claimMissionBonus() {
    this._rollover();
    let coins = 0;
    if (this._bonusStatus().available) {
      this.save.missions.bonusClaimed = true;
      coins = this._addCoins(ECONOMY.MISSION_BONUS_COINS);
      this._dirty = true;
    }
    this._commit();
    return coins;
  }

  // --- themes ---------------------------------------------------------------------------------

  /**
   * Themes are free (price 0, unlockLevel 0), level themes (price 0, owned from unlockLevel) or
   * coin themes (price > 0, buyable from unlockLevel). Unknown ids are never owned.
   * @param {string} id
   * @returns {boolean}
   */
  ownsTheme(id) {
    const def = themeDef(id);
    if (!def) return false;
    return this.save.themes.owned.includes(id) || (def.price === 0 && def.unlockLevel <= this.levelInfo().level);
  }

  /**
   * @param {string} id
   * @returns {{ owned: boolean, price: number, unlockLevel: number, canBuy: boolean }}
   *   canBuy = coin theme, not owned, level reached and enough coins
   */
  themeUnlockInfo(id) {
    const def = themeDef(id);
    const owned = this.ownsTheme(id);
    const price = def ? def.price : 0;
    const unlockLevel = def ? def.unlockLevel : 0;
    const canBuy = !owned && price > 0 && this.levelInfo().level >= unlockLevel && this.save.coins >= price;
    return { owned, price, unlockLevel, canBuy };
  }

  /**
   * Buys a coin theme for its CONFIG price (does not select it).
   * @param {string} id
   * @returns {boolean} false if not buyable or too few coins
   */
  buyTheme(id) {
    if (!this.themeUnlockInfo(id).canBuy) return false;
    this._spend(themeDef(id).price);
    this.save.themes.owned.push(id);
    this._commit();
    return true;
  }

  /**
   * @param {string} id
   * @returns {boolean} false if the theme isn't owned
   */
  selectTheme(id) {
    if (!this.ownsTheme(id)) return false;
    if (this.save.themes.selected !== id) {
      this.save.themes.selected = id;
      this._dirty = true;
    }
    this._commit();
    return true;
  }

  /** Selected theme id (DEFAULT_THEME if the stored selection isn't owned). @returns {string} */
  get selectedTheme() {
    const id = this.save.themes.selected;
    return this.ownsTheme(id) ? id : DEFAULT_THEME;
  }

  // --- boosters -------------------------------------------------------------------------------

  /**
   * @param {'hammer'|'shuffle'} type
   * @returns {number} boosters owned (0 for unknown types)
   */
  boosterCount(type) {
    if (!isBoosterType(type)) return 0;
    return toCount(this.save.boosters[type]);
  }

  /**
   * @param {'hammer'|'shuffle'} type
   * @param {number} n
   * @returns {number} new count
   */
  addBooster(type, n) {
    this._addBooster(type, n);
    this._commit();
    return this.boosterCount(type);
  }

  /**
   * Consumes one booster (call only after the session applied it).
   * @param {'hammer'|'shuffle'} type
   * @returns {boolean} false if none left
   */
  useBooster(type) {
    const left = this.boosterCount(type);
    if (left < 1) return false;
    this.save.boosters[type] = left - 1;
    this._dirty = true;
    this._commit();
    return true;
  }

  /**
   * Buys one booster for CONFIG.ECONOMY.BOOSTER_PRICES[type].
   * @param {'hammer'|'shuffle'} type
   * @returns {boolean} false for an unknown type or too few coins
   */
  buyBooster(type) {
    if (!isBoosterType(type) || !this._spend(ECONOMY.BOOSTER_PRICES[type])) return false;
    this._addBooster(type, 1);
    this._commit();
    return true;
  }

  // --- journey --------------------------------------------------------------------------------

  /** Highest playable journey level. @returns {number} */
  get journeyUnlocked() {
    return this.save.journey.unlocked;
  }

  /**
   * Records a won journey level and unlocks the next one. First win: LEVEL_COMPLETE_COINS +
   * LEVEL_STAR_COINS per star and XP_LEVEL_WIN + XP_PER_STAR per star; replays: LEVEL_STAR_COINS
   * per newly earned star, no XP.
   * @param {number} n 1-based level number
   * @param {number} stars 1..3
   * @returns {{ coins: number, firstTime: boolean, newStars: number, xp: XPResult }}
   */
  completeLevel(n, stars) {
    const level = toCount(n);
    if (level < 1) return { coins: 0, firstTime: false, newStars: 0, xp: this._addXP(0) };
    const j = this.save.journey;
    const key = String(level);
    const earned = clampStars(stars);
    const before = toCount(j.stars[key]);
    const firstTime = before === 0;
    const newStars = Math.max(0, earned - before);
    const coins = this._addCoins(firstTime
      ? ECONOMY.LEVEL_COMPLETE_COINS + ECONOMY.LEVEL_STAR_COINS * earned
      : ECONOMY.LEVEL_STAR_COINS * newStars);
    if (earned > before) j.stars[key] = earned;
    if (j.unlocked < level + 1) j.unlocked = level + 1;
    const xp = this._addXP(firstTime ? PROGRESSION.XP_LEVEL_WIN + PROGRESSION.XP_PER_STAR * earned : 0);
    this._dirty = true;
    this._commit();
    return { coins, firstTime, newStars, xp };
  }

  // --- daily challenge ------------------------------------------------------------------------

  /**
   * @param {string} key day key of the challenge ('YYYY-MM-DD'; a level id 'DYYYY-MM-DD' works too)
   * @returns {{ completed: boolean, stars: number, streak: number }} streak = current challenge streak
   */
  challengeStatus(key) {
    const today = this._rollover();
    const stars = toCount(this.save.challenge.completed[challengeKey(key)]);
    this._commit();
    return { completed: stars > 0, stars, streak: this._challengeStreak(today) };
  }

  /**
   * Records a won daily challenge, credited to its own day (never to today's date). Only the first
   * completion of a day pays DAILY_CHALLENGE_COINS + XP_DAILY_WIN and advances the streak
   * (consecutive challenge days; a gap restarts it at 1). Replays only keep the best stars.
   * @param {string} key day key of the challenge ('YYYY-MM-DD' or level id 'DYYYY-MM-DD');
   *   an invalid key changes nothing
   * @param {number} stars 1..3
   * @returns {{ coins: number, streak: number, firstTime: boolean, xp: XPResult }}
   */
  completeChallenge(key, stars) {
    const today = this._rollover();
    const c = this.save.challenge;
    const day = challengeKey(key);
    let coins = 0;
    let xp = this._addXP(0);
    if (Number.isNaN(utcFromKey(day))) {
      this._commit();
      return { coins, streak: this._challengeStreak(today), firstTime: false, xp };
    }
    const earned = clampStars(stars);
    const before = toCount(c.completed[day]);
    const firstTime = before === 0;
    if (earned > before) {
      c.completed[day] = earned;
      this._dirty = true;
    }
    if (firstTime) {
      coins = this._addCoins(ECONOMY.DAILY_CHALLENGE_COINS);
      const gap = c.lastDay ? daysBetween(c.lastDay, day) : NaN;
      if (gap === 1) {
        c.streak += 1;
        c.lastDay = day;
      } else if (!(gap <= 0)) {
        // first challenge ever or a gap: new streak (gap <= 0 = an older day finished late)
        c.streak = 1;
        c.lastDay = day;
      }
      xp = this._addXP(PROGRESSION.XP_DAILY_WIN);
    }
    this._commit();
    return { coins, streak: this._challengeStreak(today), firstTime, xp };
  }

  // --- free coins (rewarded ad) ---------------------------------------------------------------

  /** @returns {number} rewarded "free coins" grants left today */
  freeCoinsLeft() {
    this._rollover();
    this._commit();
    return this._freeCoinsLeft();
  }

  /**
   * Grants FREE_COINS_AD_AMOUNT after a rewarded ad (FREE_COINS_ADS_PER_DAY per day).
   * @returns {number} coins added (0 when today's limit is reached)
   */
  grantFreeCoins() {
    this._rollover();
    let coins = 0;
    if (this._freeCoinsLeft() > 0) {
      this.save.ads.freeCoins.count += 1;
      coins = this._addCoins(ECONOMY.FREE_COINS_AD_AMOUNT);
      this._dirty = true;
    }
    this._commit();
    return coins;
  }

  // --- purchases ------------------------------------------------------------------------------

  /**
   * One-time gift for owning remove_ads (CONFIG.ECONOMY.REMOVE_ADS_GIFT).
   * @returns {{ coins: number, hammer: number, shuffle: number } | null} null if already granted
   */
  grantRemoveAdsGift() {
    const iap = this.save.iap;
    if (iap.adsGiftGranted) return null;
    iap.adsGiftGranted = true;
    const gift = ECONOMY.REMOVE_ADS_GIFT;
    const result = {
      coins: this._addCoins(gift.coins),
      hammer: this._addBooster('hammer', gift.hammer),
      shuffle: this._addBooster('shuffle', gift.shuffle),
    };
    this._dirty = true;
    this._commit();
    return result;
  }

  /**
   * Applies a native coin grant, idempotent by purchase token (the last MAX_GRANT_TOKENS tokens
   * are remembered in save.iap.grantedTokens). After a non-unknown result the App flushes the
   * save and acks the token; an unknown product (or a missing token) records nothing and must
   * not be acked.
   * @param {string} token
   * @param {string} productId
   * @returns {{ coins: number, duplicate: boolean, unknown: boolean }}
   */
  applyGrant(token, productId) {
    const product = Object.prototype.hasOwnProperty.call(PRODUCTS, productId) ? PRODUCTS[productId] : null;
    const amount = product ? toCount(product.coins) : 0;
    if (!amount || typeof token !== 'string' || token === '') return { coins: 0, duplicate: false, unknown: true };
    const tokens = this.save.iap.grantedTokens;
    if (tokens.includes(token)) return { coins: 0, duplicate: true, unknown: false };
    tokens.push(token);
    if (tokens.length > MAX_GRANT_TOKENS) tokens.splice(0, tokens.length - MAX_GRANT_TOKENS);
    const coins = this._addCoins(amount);
    this._dirty = true;
    this._commit();
    return { coins, duplicate: false, unknown: false };
  }

  // --- internals ------------------------------------------------------------------------------

  /** Calls onChange once if the save changed since the last commit. */
  _commit() {
    if (!this._dirty) return;
    this._dirty = false;
    if (this._onChange) this._onChange(this.save);
  }

  /**
   * Rolls day-scoped state (missions, free-coin counter) over to today. State stamped with a
   * later day (clock moved back) is kept rather than reset.
   * @returns {string} today's day key
   */
  _rollover() {
    const today = dayKey(this._now());
    const m = this.save.missions;
    if (this.isFeatureUnlocked('missions') && isNewDay(m.day, today)) {
      m.day = today;
      m.list = generateMissions(today, this.levelInfo().level, FEATURES.filter((f) => this.isFeatureUnlocked(f)));
      m.bonusClaimed = false;
      this._dirty = true;
    }
    const free = this.save.ads.freeCoins;
    if (isNewDay(free.day, today)) {
      free.day = today;
      free.count = 0;
      this._dirty = true;
    }
    return today;
  }

  _dailyState(today) {
    const d = this.save.daily;
    const unlocked = this.isFeatureUnlocked('daily_reward');
    const cycle = ECONOMY.DAILY_REWARDS.length;
    const last = Number.isInteger(d.day) && d.day >= 1 && d.day <= cycle ? d.day : 0;
    const gap = d.lastClaimDay ? daysBetween(d.lastClaimDay, today) : NaN;
    if (gap <= 0) return { available: false, day: Math.max(1, last), streak: d.streak, graceUsed: false };
    if (gap === 1 || gap === 2) {
      return { available: unlocked, day: (last % cycle) + 1, streak: d.streak, graceUsed: gap === 2 };
    }
    return { available: unlocked, day: 1, streak: 0, graceUsed: false };
  }

  _bonusStatus() {
    const m = this.save.missions;
    const allClaimed = m.list.length > 0 && m.list.every((x) => isObject(x) && x.claimed);
    return { available: allClaimed && !m.bonusClaimed, claimed: m.bonusClaimed };
  }

  _challengeStreak(today) {
    const c = this.save.challenge;
    return c.lastDay && daysBetween(c.lastDay, today) <= 1 ? c.streak : 0;
  }

  _freeCoinsLeft() {
    return Math.max(0, ADS.FREE_COINS_ADS_PER_DAY - this.save.ads.freeCoins.count);
  }

  _addCoins(n) {
    const v = toCount(n);
    if (v > 0) {
      this.save.coins += v;
      this._dirty = true;
    }
    return v;
  }

  _spend(n) {
    if (!Number.isSafeInteger(n) || n < 0 || this.save.coins < n) return false;
    if (n > 0) {
      this.save.coins -= n;
      this._dirty = true;
    }
    return true;
  }

  _addBooster(type, n) {
    const v = toCount(n);
    if (!isBoosterType(type) || v === 0) return 0;
    this.save.boosters[type] = this.boosterCount(type) + v;
    this._dirty = true;
    return v;
  }

  /** @returns {XPResult} */
  _addXP(n) {
    const v = toCount(n);
    const before = levelFromXP(this.save.xp);
    if (v > 0) {
      this.save.xp += v;
      this._dirty = true;
    }
    const after = levelFromXP(this.save.xp);
    const levels = [];
    for (let l = before + 1; l <= after; l++) levels.push(l);
    const unlockedThemes = [];
    for (const id of Object.keys(ECONOMY.THEMES)) {
      const def = ECONOMY.THEMES[id];
      if (def.price === 0 && def.unlockLevel > before && def.unlockLevel <= after) {
        if (!this.save.themes.owned.includes(id)) this.save.themes.owned.push(id);
        unlockedThemes.push(id);
      }
    }
    const coins = this._addCoins(levels.length * ECONOMY.LEVEL_UP_COINS);
    return { leveledUp: levels.length > 0, levels, coins, unlockedThemes };
  }
}

// ---------------------------------------------------------------------------------------------

/** Total XP needed to go from level 1 to `level`. */
function xpToReach(level) {
  const n = level - 1;
  return n * PROGRESSION.XP_LEVEL_BASE + (PROGRESSION.XP_LEVEL_STEP * n * (n + 1)) / 2;
}

/** Player level (1-based) for a total XP amount – closed form, then exact integer correction. */
function levelFromXP(xp) {
  const total = Math.min(Number.isFinite(xp) && xp > 0 ? xp : 0, Number.MAX_SAFE_INTEGER);
  const b = PROGRESSION.XP_LEVEL_BASE;
  const s = PROGRESSION.XP_LEVEL_STEP;
  // levels gained n solves s/2·n² + (b + s/2)·n = total
  const k = b + s / 2;
  let n = s > 0 ? Math.floor((Math.sqrt(k * k + 2 * s * total) - k) / s) : Math.floor(total / b);
  n = Math.max(0, n);
  while (n > 0 && xpToReach(n + 1) > total) n--;
  while (xpToReach(n + 2) <= total) n++;
  return n + 1;
}

function utcFromKey(key) {
  const m = typeof key === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(key) : null;
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
}

/** true if `stored` is missing/invalid or earlier than `today` (a later stamp means the clock moved back). */
function isNewDay(stored, today) {
  return !stored || !(daysBetween(stored, today) <= 0);
}

/** Accepts a day key or a daily level id ('D2026-10-18'). */
function challengeKey(key) {
  return typeof key === 'string' && key[0] === 'D' ? key.slice(1) : String(key);
}

function themeDef(id) {
  return Object.prototype.hasOwnProperty.call(ECONOMY.THEMES, id) ? ECONOMY.THEMES[id] : null;
}

function isBoosterType(type) {
  return Object.prototype.hasOwnProperty.call(ECONOMY.BOOSTER_PRICES, type);
}

function clampStars(stars) {
  return Math.min(MAX_STARS, Math.max(1, toCount(stars)));
}

/** Non-negative integer (floored); anything else → 0. */
function toCount(v) {
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function isObject(v) {
  return v !== null && typeof v === 'object';
}
