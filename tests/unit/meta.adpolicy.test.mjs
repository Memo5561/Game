import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../game/js/config.js';
import { defaultSave } from '../../game/js/meta/storage.js';
import { AdPolicy } from '../../game/js/meta/adpolicy.js';

const ADS = CONFIG.ADS;
const MIN = 60 * 1000;
const START = new Date(2026, 9, 18, 12, 0).getTime();

function setup(config = ADS) {
  const save = defaultSave();
  const clock = { t: START };
  const changes = { count: 0 };
  const policy = new AdPolicy(save, { config, nowMs: () => clock.t, onChange: () => { changes.count++; } });
  return { save, policy, clock, changes };
}

/** A run as the controller reports it: recordGame adds stats.playSec, then onRunFinished. */
function finishRun({ save, policy, clock }, playSec, pieces = 30) {
  save.stats.playSec += playSec;
  clock.t += playSec * 1000;
  return policy.onRunFinished({ playSec, pieces });
}

/** Satisfies every requirement except the one a test is about. */
function eligible(ctx) {
  ctx.save.stats.playSec = ADS.INTERSTITIAL_MIN_TOTAL_PLAY_SEC;
  ctx.save.ads.playSecSinceAd = ADS.INTERSTITIAL_MIN_PLAY_SEC_SINCE_AD;
  ctx.save.ads.sessionRuns = 2;
  return ctx;
}

test('defaults come from CONFIG.ADS', () => {
  const save = defaultSave();
  const policy = new AdPolicy(save);
  assert.equal(policy.config, ADS);
  assert.equal(policy.shouldShowInterstitial(), false);
  policy.onSessionStart();
  assert.ok(Math.abs(save.lastSessionStart - Date.now()) < 1000);
});

test('an eligible state allows an interstitial', () => {
  const ctx = eligible(setup());
  assert.equal(ctx.policy.shouldShowInterstitial(), true);
});

test('no interstitial during the first ~session: total play time gate', () => {
  const ctx = eligible(setup());
  ctx.save.stats.playSec = ADS.INTERSTITIAL_MIN_TOTAL_PLAY_SEC - 1;
  assert.equal(ctx.policy.shouldShowInterstitial(), false);

  // realistic first session: 90 s runs, first possible interstitial only after the total gate
  const fresh = setup();
  fresh.policy.onSessionStart();
  let firstAdAfter = null;
  for (let run = 1; run <= 20 && firstAdAfter === null; run++) {
    finishRun(fresh, 90);
    if (fresh.policy.shouldShowInterstitial()) firstAdAfter = run;
  }
  assert.ok(firstAdAfter !== null);
  assert.ok(firstAdAfter * 90 >= ADS.INTERSTITIAL_MIN_TOTAL_PLAY_SEC, `first ad after ${firstAdAfter} runs`);
});

test('play time since the last full-screen ad must reach the threshold', () => {
  const ctx = eligible(setup());
  ctx.save.ads.playSecSinceAd = ADS.INTERSTITIAL_MIN_PLAY_SEC_SINCE_AD - 1;
  assert.equal(ctx.policy.shouldShowInterstitial(), false);
  finishRun(ctx, 1);
  assert.equal(ctx.policy.shouldShowInterstitial(), true);
});

test('the first run of a session never gets an interstitial', () => {
  const ctx = eligible(setup());
  ctx.policy.onSessionStart();
  assert.equal(ctx.save.ads.sessionRuns, 0);
  assert.equal(ctx.save.lastSessionStart, ctx.clock.t);
  assert.equal(ctx.policy.shouldShowInterstitial(), false);
  finishRun(ctx, 60);
  assert.equal(ctx.save.ads.sessionRuns, 1);
  assert.equal(ctx.policy.shouldShowInterstitial(), false, 'skip the first run of the session');
  finishRun(ctx, 60);
  assert.equal(ctx.policy.shouldShowInterstitial(), true);

  const noSkip = eligible(setup({ ...ADS, SKIP_FIRST_RUN_OF_SESSION: false }));
  noSkip.policy.onSessionStart();
  finishRun(noSkip, 60);
  assert.equal(noSkip.policy.shouldShowInterstitial(), true);
});

test('runs shorter than RUN_MIN_PIECES are ignored', () => {
  const ctx = setup();
  const before = JSON.stringify(ctx.save.ads);
  assert.equal(ctx.policy.onRunFinished({ playSec: 300, pieces: ADS.RUN_MIN_PIECES - 1 }), false);
  assert.equal(ctx.policy.onRunFinished({ playSec: 300 }), false);
  assert.equal(JSON.stringify(ctx.save.ads), before);
  assert.equal(ctx.changes.count, 0);
  assert.equal(ctx.policy.onRunFinished({ playSec: 300, pieces: ADS.RUN_MIN_PIECES }), true);
  assert.equal(ctx.save.ads.runsFinished, 1);
  assert.equal(ctx.save.ads.sessionRuns, 1);
  assert.equal(ctx.save.ads.playSecSinceAd, 300);
  assert.equal(ctx.changes.count, 1);
  ctx.policy.onRunFinished({ playSec: -5, pieces: 10 });
  ctx.policy.onRunFinished({ playSec: NaN, pieces: 10 });
  assert.equal(ctx.save.ads.playSecSinceAd, 300, 'invalid play time adds nothing');
});

test('markInterstitialShown resets the cadence and enforces the wall-clock interval', () => {
  const ctx = eligible(setup());
  ctx.policy.markInterstitialShown();
  assert.equal(ctx.save.ads.playSecSinceAd, 0);
  assert.equal(ctx.save.ads.lastInterstitialAt, START);
  assert.equal(ctx.save.ads.interstitialsShown, 1);
  assert.equal(ctx.policy.shouldShowInterstitial(), false);

  ctx.save.ads.playSecSinceAd = ADS.INTERSTITIAL_MIN_PLAY_SEC_SINCE_AD; // play time alone is not enough
  ctx.clock.t = START + ADS.INTERSTITIAL_MIN_INTERVAL_SEC * 1000 - 1;
  assert.equal(ctx.policy.shouldShowInterstitial(), false);
  ctx.clock.t = START + ADS.INTERSTITIAL_MIN_INTERVAL_SEC * 1000;
  assert.equal(ctx.policy.shouldShowInterstitial(), true);
});

test('a rewarded ad resets play time and the interval like an interstitial', () => {
  const ctx = eligible(setup());
  ctx.policy.markRewardedShown();
  assert.equal(ctx.save.ads.playSecSinceAd, 0);
  assert.equal(ctx.save.ads.lastRewardedAt, START);
  assert.equal(ctx.save.ads.interstitialsShown, 0);
  assert.equal(ctx.policy.shouldShowInterstitial(), false);
  ctx.save.ads.playSecSinceAd = ADS.INTERSTITIAL_MIN_PLAY_SEC_SINCE_AD;
  ctx.clock.t += MIN;
  assert.equal(ctx.policy.shouldShowInterstitial(), false, 'interval counts from the rewarded ad');
  ctx.clock.t = START + ADS.INTERSTITIAL_MIN_INTERVAL_SEC * 1000;
  assert.equal(ctx.policy.shouldShowInterstitial(), true);
});

test('a clock moved back does not block interstitials forever', () => {
  const ctx = eligible(setup());
  ctx.save.ads.lastInterstitialAt = START + 24 * 60 * MIN; // "tomorrow"
  assert.equal(ctx.policy.shouldShowInterstitial(), true);
});

test('adsRemoved disables interstitials and the upsell', () => {
  const ctx = eligible(setup());
  ctx.save.ads.interstitialsShown = 99;
  ctx.save.iap.adsRemoved = true;
  assert.equal(ctx.policy.shouldShowInterstitial(), false);
  assert.equal(ctx.policy.shouldShowUpsell(), false);
});

test('the upsell appears after enough interstitials, at most once per day', () => {
  const ctx = setup();
  for (let i = 0; i < ADS.UPSELL_AFTER_INTERSTITIALS; i++) {
    assert.equal(ctx.policy.shouldShowUpsell(), false);
    ctx.policy.markInterstitialShown();
  }
  assert.equal(ctx.policy.shouldShowUpsell(), true);
  ctx.policy.markUpsellShown();
  assert.equal(ctx.save.ads.upsellDay, '2026-10-18');
  assert.equal(ctx.policy.shouldShowUpsell(), false);
  ctx.clock.t = new Date(2026, 9, 18, 23, 59).getTime();
  assert.equal(ctx.policy.shouldShowUpsell(), false);
  ctx.clock.t = new Date(2026, 9, 19, 0, 1).getTime();
  assert.equal(ctx.policy.shouldShowUpsell(), true);
});

test('every mutation notifies onChange', () => {
  const ctx = setup();
  ctx.policy.onSessionStart();
  ctx.policy.markInterstitialShown();
  ctx.policy.markRewardedShown();
  ctx.policy.markUpsellShown();
  assert.equal(ctx.changes.count, 4);
  ctx.policy.shouldShowInterstitial();
  ctx.policy.shouldShowUpsell();
  assert.equal(ctx.changes.count, 4);
});
