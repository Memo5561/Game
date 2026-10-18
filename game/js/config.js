// Central configuration for Blocko.
// Everything a publisher typically wants to tweak lives here (economy, ad cadence, product ids).
// Native ad unit ids / AdMob app id live in android/gradle.properties, NOT here.

export const CONFIG = Object.freeze({
  APP_NAME: 'Blocko',
  VERSION: '1.0.0',

  // Change the package id together with android/app/build.gradle.kts (applicationId).
  PACKAGE_ID: 'io.github.memo5561.blocko',
  PLAY_STORE_URL: 'https://play.google.com/store/apps/details?id=io.github.memo5561.blocko',
  // Host docs/privacy-policy.html somewhere public (e.g. GitHub Pages) and put the URL here.
  PRIVACY_POLICY_URL: 'https://memo5561.github.io/game/privacy-policy.html',
  SUPPORT_EMAIL: 'support@example.com',

  BOARD_SIZE: 8,
  TRAY_SIZE: 3,

  SCORING: Object.freeze({
    // points for clearing n lines at once (index = n); beyond the table: last + 140 per extra line
    LINE_POINTS: Object.freeze([0, 20, 60, 120, 200, 300, 420]),
    // a combo survives this many consecutive placements without a clear
    COMBO_KEEP_MOVES: 3,
    ALL_CLEAR_BONUS: 500,
  }),

  ECONOMY: Object.freeze({
    COINS_PER_SCORE: 1 / 40,            // classic: coins = floor(score * this)
    COINS_MIN_PER_GAME: 5,
    LEVEL_COMPLETE_COINS: 40,           // journey base reward (+10 per star)
    DAILY_CHALLENGE_COINS: 150,
    DAILY_REWARDS: Object.freeze([50, 75, 100, 150, 200, 300, 500]), // 7-day login calendar
    DAILY_REWARD_DAY7_BOOSTERS: Object.freeze({ hammer: 1, shuffle: 1 }),
    MISSION_BONUS_COINS: 150,           // claim all 3 daily missions
    STARTING_COINS: 100,
    STARTING_BOOSTERS: Object.freeze({ hammer: 2, shuffle: 2 }),
    BOOSTER_PRICES: Object.freeze({ hammer: 150, shuffle: 120 }),
    LEVEL_UP_COINS: 100,
    FREE_COINS_AD_AMOUNT: 60,
  }),

  ADS: Object.freeze({
    INTERSTITIAL_MIN_GAMES: 3,          // never before the player finished this many runs
    INTERSTITIAL_EVERY_N_GAMES: 2,      // then at most every N finished runs
    INTERSTITIAL_MIN_INTERVAL_SEC: 120, // and never more often than this (also counts rewarded ads)
    FREE_COINS_ADS_PER_DAY: 5,
    BANNER_ENABLED: true,
  }),

  // Product ids must be created 1:1 in Google Play Console (Monetize > Products > In-app products).
  PRODUCTS: Object.freeze({
    remove_ads: Object.freeze({ type: 'nonconsumable' }),
    coins_small: Object.freeze({ type: 'consumable', coins: 1500 }),
    coins_large: Object.freeze({ type: 'consumable', coins: 6000 }),
  }),

  RETENTION: Object.freeze({
    REMINDER_DELAY_MINUTES: 22 * 60,    // local notification ~22h after the last session
    ASK_NOTIFICATIONS_AFTER_GAMES: 2,
    ASK_REVIEW_AFTER_GAMES: 5,          // ask for a Play review after a new best, from this many games on
  }),
});
