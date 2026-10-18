// Central configuration for Blocko.
// Everything a publisher typically wants to tweak lives here (economy, ad cadence, product ids, legal info).
// Native ad unit ids / AdMob app id live in android/gradle.properties, NOT here.

export const CONFIG = Object.freeze({
  APP_NAME: 'Blocko',
  VERSION: '1.0.0',

  // Change the package id together with android/app/build.gradle.kts (applicationId) BEFORE the first upload.
  PACKAGE_ID: 'io.github.memo5561.blocko',
  PLAY_STORE_URL: 'https://play.google.com/store/apps/details?id=io.github.memo5561.blocko',
  PLAY_STORE_MARKET_URL: 'market://details?id=io.github.memo5561.blocko',
  // Host docs/site/* on a GitHub Pages *user site* (repo "memo5561.github.io") – see docs/VEROEFFENTLICHUNG.md.
  PRIVACY_POLICY_URL: 'https://memo5561.github.io/blocko/privacy-policy.html',
  IMPRINT_URL: 'https://memo5561.github.io/blocko/impressum.html',

  // Legal notice (Impressum, § 5 DDG) – REQUIRED for a commercial app from Germany.
  // tools/check-release.mjs refuses a release while placeholders are left here.
  LEGAL: Object.freeze({
    OWNER_NAME: 'Vorname Nachname',
    ADDRESS_LINES: Object.freeze(['Musterstraße 1', '12345 Musterstadt', 'Deutschland']),
    EMAIL: 'support@example.com',
    // § 5 DDG needs a second fast, direct contact channel besides e-mail: a phone number OR a contact form.
    PHONE: '',
    CONTACT_FORM_URL: '',
    VAT_ID: '',
  }),

  BOARD_SIZE: 8,
  TRAY_SIZE: 3,

  SCORING: Object.freeze({
    // points for clearing n lines at once (index = n); beyond the table: last + 140 per extra line
    LINE_POINTS: Object.freeze([0, 20, 60, 120, 200, 300, 420]),
    // The combo breaks when this many consecutive placements clear nothing
    // (= the player must clear at least once every 3 placements to keep it).
    COMBO_KEEP_MOVES: 3,
    ALL_CLEAR_BONUS: 500,
    // praise text: the higher of the line praise and the combo-milestone praise reached exactly on this placement
    PRAISE: Object.freeze({
      LINES: Object.freeze({ 2: 'good', 3: 'great', 4: 'excellent', 5: 'amazing', 6: 'unbelievable' }),
      COMBO_MILESTONES: Object.freeze({ 3: 'good', 5: 'great', 8: 'excellent', 12: 'amazing', 20: 'unbelievable' }),
    }),
  }),

  GENERATOR: Object.freeze({
    CANDIDATES: 8,            // candidate trays sampled per refill
    NODE_LIMIT: 1500,         // DFS node budget in analyzeTray (never a time budget → deterministic)
    EARLY_TRAYS: 8,           // generous phase of every classic run
    NEWBIE_GAMES: 3,          // players with fewer finished games …
    NEWBIE_EARLY_TRAYS: 15,   // … get a longer generous phase
    MERCY_FILL: 0.55,         // board fill ratio that triggers mercy
    MERCY_TRAYS_NO_CLEAR: 2,  // trays without a clear that trigger mercy
    MERCY_AFTER_REVIVE: 2,    // trays of mercy after a revive
    RAMP_TRAYS: 60,           // classic: d = clamp(D_MIN + trayIndex / RAMP_TRAYS, D_MIN, D_MAX)
    D_MIN: 0.1,
    D_MAX: 1.0,
    RAW_P_MAX: 0.3,           // classic, at difficulty 1: chance to take an unfiltered random candidate
    RAW_P_MAX_LEVELS: 0.12,   // same for journey/daily levels (their bands are tuned with this)
    EARLY_MULTI_P: 0.6,       // early phase: chance to prefer a tray with a single placement clearing >= 2 lines
    // [weight at difficulty 0, weight at difficulty 1] per shape family.
    // Effective weight of one orientation = lerp(w0, w1, d) / orientations in the family.
    FAMILY_WEIGHTS: Object.freeze({
      '1x1': Object.freeze([3, 1]),
      I2: Object.freeze([6, 3]),
      I3: Object.freeze([8, 5]),
      L3: Object.freeze([8, 5]),
      O2: Object.freeze([9, 7]),
      I4: Object.freeze([7, 6]),
      T: Object.freeze([5, 6]),
      L4: Object.freeze([7, 7]),
      SZ: Object.freeze([4, 6]),
      R23: Object.freeze([5, 6]),
      I5: Object.freeze([4, 6]),
      L5: Object.freeze([3, 6]),
      O3: Object.freeze([3, 6]),
    }),
  }),

  PROGRESSION: Object.freeze({
    // xpForLevel(L) = XP_LEVEL_BASE + XP_LEVEL_STEP * L  (XP to go from L to L+1)
    XP_LEVEL_BASE: 60,
    XP_LEVEL_STEP: 40,
    XP_RUN_BASE: 10,          // every finished run (pieces >= 5)
    XP_PER_LINE: 1,
    XP_RUN_CAP: 150,
    XP_LEVEL_WIN: 20,
    XP_PER_STAR: 5,
    XP_DAILY_WIN: 40,
  }),

  ECONOMY: Object.freeze({
    // classic only: coins = floor(RUN_COINS_FACTOR * sqrt(score)) – concave, so long combo-driven
    // runs don't explode the economy (score 2,500 → 25, 10,000 → 50, 40,000 → 100)
    RUN_COINS_FACTOR: 0.5,
    LEVEL_COMPLETE_COINS: 40,           // journey: first completion = base + 10 per star; replays: +10 per newly earned star
    LEVEL_STAR_COINS: 10,
    DAILY_CHALLENGE_COINS: 150,         // first completion of that day only
    DAILY_REWARDS: Object.freeze([50, 75, 100, 150, 200, 300, 500]), // 7-day login calendar
    DAILY_REWARD_DAY7_BOOSTERS: Object.freeze({ hammer: 1, shuffle: 1 }),
    MISSION_REWARDS: Object.freeze([30, 50, 70]),  // easy / medium / hard slot
    MISSION_BONUS_COINS: 100,           // all 3 daily missions claimed
    STARTING_COINS: 100,
    STARTING_BOOSTERS: Object.freeze({ hammer: 2, shuffle: 2 }),
    BOOSTER_PRICES: Object.freeze({ hammer: 150, shuffle: 120 }),
    REVIVE_COINS: 400,                  // alternative to the revive ad (still once per run)
    LEVEL_UP_COINS: 100,
    FREE_COINS_AD_AMOUNT: 40,
    REMOVE_ADS_GIFT: Object.freeze({ coins: 500, hammer: 1, shuffle: 1 }), // once, when remove_ads is first owned
    // Each theme is either bought with coins (price) or unlocked by player level (unlockLevel).
    THEMES: Object.freeze({
      jewel: Object.freeze({ price: 0, unlockLevel: 0 }),
      neon: Object.freeze({ price: 0, unlockLevel: 3 }),
      candy: Object.freeze({ price: 1500, unlockLevel: 0 }),
      wood: Object.freeze({ price: 3000, unlockLevel: 0 }),
      pixel: Object.freeze({ price: 5000, unlockLevel: 0 }),
      gold: Object.freeze({ price: 10000, unlockLevel: 0 }),
    }),
  }),

  ADS: Object.freeze({
    // Interstitials are attempted ONLY when the player taps a button that leaves a run-result screen.
    INTERSTITIAL_MIN_TOTAL_PLAY_SEC: 480,     // none during roughly the whole first session
    INTERSTITIAL_MIN_PLAY_SEC_SINCE_AD: 180,  // active in-run seconds since any full-screen ad (rewarded included)
    INTERSTITIAL_MIN_INTERVAL_SEC: 120,       // wall clock since any full-screen ad
    SKIP_FIRST_RUN_OF_SESSION: true,          // session = cold start or resume after >= SESSION_GAP_MIN
    SESSION_GAP_MIN: 30,
    RUN_MIN_PIECES: 8,                        // shorter runs don't count (games played, XP, ad cadence)
    RESULT_SCREEN_MIN_MS: 1000,               // result screen visible at least this long before an interstitial
    AD_BUTTON_ARM_MS: 500,                    // ad buttons in auto-opened modals ignore taps this long
    REVIVE_COUNTDOWN_SEC: 5,
    FREE_COINS_ADS_PER_DAY: 3,
    FREE_BOOSTER_ADS_PER_DAY: 3,              // "Watch ad: free booster" (shop + in-run booster sheet), persisted
    UPSELL_AFTER_INTERSTITIALS: 3,            // soft "Ad-free" chip on the game-over screen (max once a day)
    BANNER_ENABLED: true,
  }),

  // Product ids must be created 1:1 in Google Play Console (Monetize > Products > In-app products).
  PRODUCTS: Object.freeze({
    remove_ads: Object.freeze({ type: 'nonconsumable' }),
    coins_small: Object.freeze({ type: 'consumable', coins: 1500 }),
    coins_large: Object.freeze({ type: 'consumable', coins: 6000 }),
  }),

  RETENTION: Object.freeze({
    REMINDER_DELAY_MINUTES: 22 * 60,    // local notification ~22h after the last session (opt-in only)
    NOTIF_ASK_MIN_GAMES: 2,             // soft ask after the first daily-reward claim with >= this many games
    NOTIF_ASK_RETRY_DAYS: 7,            // "Not now" → offered once more after this many days, then never
    ASK_REVIEW_AFTER_GAMES: 5,          // automatic Play review card after a new best, from this many games on
  }),

  // Progressive feature unlock (derived from stats, see Progression.isFeatureUnlocked)
  UNLOCKS: Object.freeze({
    missions: Object.freeze({ games: 1 }),
    daily_reward: Object.freeze({ games: 1 }),
    journey: Object.freeze({ games: 2 }),
    daily: Object.freeze({ journeyLevel: 4 }),
  }),
});
