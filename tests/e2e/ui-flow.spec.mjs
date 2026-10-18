// E2E app flows fixed after the QA review (browser mock platform):
// - Play review (once ever): a quick "Play again" keeps the ask, a calm result screen spends it,
//   and it never shares a result screen with an interstitial.
// - "Watch ad: ×2" appears when the rewarded video finishes loading after the result screen opened.
// - Journey card ▶ continues the saved (older) level; a daily run of a past day ends at the day
//   rollover and Restart / the Daily card start today's challenge.
// - A level-up celebration queued in the first session survives a restart.
// - Tutorial step 3 explains the real combo rule; a new player sees no "BEST 0"; the HUD nudge is
//   gone behind the revive offer; the booster badge follows a bought booster; free booster videos
//   are capped per day (persisted, shared by the shop and the in-run sheet).
// Run: node tests/e2e/run.mjs ui-flow
import { CONFIG } from '../../game/js/config.js';
import en from '../../game/js/ui/strings/en.js';
import de from '../../game/js/ui/strings/de.js';
import { openGame, veteranSave, makeSave, assert, ev, state, idle, waitModal, waitState, tap, playMoves, assertNoErrors, recordAds, adLog } from './ui.helpers.mjs';
import { recordPlatform, calls, goToDay, dayOffset, text } from './meta.helpers.mjs';
import { waitForDebug } from './harness.mjs';

const REVIEW_MS = 1600;

async function reload(page) {
  await page.reload({ waitUntil: 'load' });
  await waitForDebug(page);
  await page.waitForFunction(() => window.__blockoBooted === true);
  await ev(page, () => window.__blocko.setTimeScale(20));
}

/** A counted classic run ending in a NEW BEST on the game-over screen. */
async function newBestGameOver(page) {
  await ev(page, () => window.__blocko.startGame('classic', { seed: 5, score: 500 }));
  await idle(page);
  await playMoves(page, CONFIG.ADS.RUN_MIN_PIECES + 1);
  await ev(page, () => window.__blocko.forceGameOver());
  await waitModal(page, 'revive');
  await tap(page, 'revive.skip');
  await waitModal(page, 'gameover');
}

async function reviewRules() {
  const g = await openGame({
    save: veteranSave({ stats: { gamesPlayed: CONFIG.RETENTION.ASK_REVIEW_AFTER_GAMES + 1, classicGames: 8, bestScore: 10, playSec: 2000 }, flags: { reviewAsked: false } }),
  });
  const { page } = g;
  try {
    await recordPlatform(page, ['requestReview']);
    await recordAds(page);
    const asked = async () => (await ev(page, () => window.__blocko.save().flags.reviewAsked));

    // leaving before the card was requested keeps the once-ever ask
    await newBestGameOver(page);
    assert(await ev(page, () => window.__blocko.app.game.summary.newBest), 'the run set a new best');
    await page.waitForTimeout(CONFIG.ADS.RESULT_SCREEN_MIN_MS + 100);
    await tap(page, 'gameover.again');
    await waitState(page, '(st) => st.modals.length === 0 && st.session.score === 0');
    await page.waitForTimeout(REVIEW_MS + 300);
    assert((await calls(page, 'requestReview')).length === 0 && !(await asked()), 'a quick Play again does not spend the review ask');

    // an interstitial is due: leaving cancels the review, no card over the ad
    await ev(page, () => window.__blocko.save({ stats: { bestScore: 10 }, ads: { sessionRuns: 3, playSecSinceAd: 900, lastInterstitialAt: 0, lastRewardedAt: 0 } }));
    await newBestGameOver(page);
    await page.waitForTimeout(CONFIG.ADS.RESULT_SCREEN_MIN_MS + 100);
    await tap(page, 'gameover.again');
    await page.waitForFunction(() => window.__adLog.includes('Interstitial'), null, { timeout: 5000 });
    await page.waitForTimeout(REVIEW_MS + 300);
    assert((await calls(page, 'requestReview')).length === 0 && !(await asked()), 'no review card over / after an interstitial');

    // a calm result screen: the card is requested once, and then there is no interstitial
    await ev(page, () => window.__blocko.save({ stats: { bestScore: 10 }, ads: { sessionRuns: 3, playSecSinceAd: 900, lastInterstitialAt: 0, lastRewardedAt: 0 } }));
    const adsBefore = (await adLog(page)).length;
    await newBestGameOver(page);
    await page.waitForFunction(() => window.__blocko.save().flags.reviewAsked === true, null, { timeout: REVIEW_MS + 2000 });
    assert((await calls(page, 'requestReview')).length === 1, 'the review card is requested once');
    await tap(page, 'gameover.again');
    await waitState(page, '(st) => st.modals.length === 0 && st.session.score === 0');
    assert((await adLog(page)).length === adsBefore, 'the screen that asked for a review shows no interstitial');
    assertNoErrors(g, 'review');
  } finally {
    await g.close();
  }
}

async function lateDoubleOffer() {
  const g = await openGame({ save: veteranSave(), query: 'debug=1&mock=nofill' });
  const { page } = g;
  try {
    await recordPlatform(page, ['showRewardedResult'], { showRewardedResult: { resolve: { rewarded: true, shown: true } } });
    await ev(page, () => window.__blocko.startGame('classic', { seed: 4 }));
    await idle(page);
    await playMoves(page, CONFIG.ADS.RUN_MIN_PIECES + 1);
    await ev(page, () => window.__blocko.forceGameOver());
    await waitModal(page, 'revive');
    await tap(page, 'revive.skip');
    await waitModal(page, 'gameover');
    const has = () => ev(page, () => !!document.querySelector('[data-modal="gameover"] [data-action="gameover.double"]'));
    assert(!(await has()), 'no ×2 offer without a video');
    await ev(page, () => window.__blocko.simulate({ type: 'adState', canRequestAds: true, rewardedReady: true }));
    await page.waitForSelector('[data-modal="gameover"] [data-action="gameover.double"]');
    assert(await ev(page, () => document.querySelector('[data-action="gameover.double"]').getAttribute('aria-disabled') === 'true'), 'a late offer starts unarmed');
    await page.waitForFunction(() => !document.querySelector('[data-action="gameover.double"]').hasAttribute('aria-disabled'), null, { timeout: 3000 });
    const coins = await ev(page, () => window.__blocko.save().coins);
    await tap(page, 'gameover.double');
    await page.waitForSelector('[data-modal="gameover"] .result__doubled');
    const earned = await ev(page, () => window.__blocko.app.game.summary.coinsEarned);
    assert(await ev(page, () => window.__blocko.save().coins) === coins + earned, 'the late ×2 button doubles the run coins');
    assertNoErrors(g, 'late double');
  } finally {
    await g.close();
  }
}

async function journeyCard() {
  const g = await openGame({ save: veteranSave({ journey: { unlocked: 6, stars: { 1: 3, 2: 3, 3: 3, 4: 1, 5: 1 } } }) });
  const { page } = g;
  try {
    await ev(page, () => window.__blocko.startGame('journey', { level: 4 }));
    await idle(page);
    await playMoves(page, 2);
    await idle(page); // pause taps are ignored while the controller is busy
    await tap(page, 'game.pause');
    await waitModal(page, 'pause');
    await tap(page, 'pause.home');
    await waitState(page, '(st) => st.screen === "home"');
    assert(/Continue level 4/.test(await text(page, '[data-ref="journeySub"]')), 'the card offers "Continue level 4"');
    await tap(page, 'home.journeyPlay');
    const s = await waitState(page, '(st) => st.screen === "game"');
    assert(s.modals.length === 0, `no abandon confirmation (${s.modals})`);
    assert(await ev(page, () => window.__blocko.app.game.session.level.number) === 4 && s.session.piecesPlaced === 2, 'the saved level-4 run continues');
    assertNoErrors(g, 'journey card');
  } finally {
    await g.close();
  }
}

async function staleDaily() {
  const g = await openGame({ save: veteranSave({ journey: { unlocked: 6 } }) });
  const { page } = g;
  try {
    const dayId = () => ev(page, () => window.__blocko.app.game.session.level.id);
    await tap(page, 'home.daily');
    await waitState(page, '(st) => st.screen === "game" && st.session.mode === "daily"');
    const first = await dayId();
    assert(first === `D${dayOffset(0)}`, `today's challenge (${first})`);
    await playMoves(page, 3);
    await idle(page); // pause taps are ignored while the controller is busy
    await tap(page, 'game.pause');
    await waitModal(page, 'pause');
    await tap(page, 'pause.home');
    await waitState(page, '(st) => st.screen === "home"');
    assert(/Continue/.test(await text(page, '[data-ref="dailySub"]')), 'same day: the card continues');

    await goToDay(page, 1);
    await idle(page);
    const sv = await ev(page, () => window.__blocko.save());
    assert(sv.run === null, 'the daily run of yesterday ended at the rollover');
    assert(/Goal/.test(await text(page, '[data-ref="dailySub"]')) && sv.challenge.completed[dayOffset(0)] === undefined, 'no reward, the card offers a new goal');
    await ev(page, () => window.__blocko.app.modals.closeAll());
    await tap(page, 'home.daily');
    await waitState(page, '(st) => st.screen === "game" && st.session.mode === "daily"');
    assert(await dayId() === `D${dayOffset(1)}`, 'the Daily card starts the new day\'s level');

    // a run that is still open on the game screen at midnight restarts as the new day's level
    await playMoves(page, 2);
    await goToDay(page, 2);
    assert(await dayId() === `D${dayOffset(1)}`, 'the open run keeps playing (no jump under the player)');
    await idle(page); // pause taps are ignored while the controller is busy
    await tap(page, 'game.pause');
    await waitModal(page, 'pause');
    await tap(page, 'pause.restart');
    await waitModal(page, 'confirm');
    await tap(page, 'confirm.ok');
    await waitState(page, '(st) => st.modals.length === 0 && st.session && st.session.piecesPlaced === 0');
    assert(await dayId() === `D${dayOffset(2)}`, 'Restart starts today\'s challenge, not yesterday\'s');
    assertNoErrors(g, 'stale daily');
  } finally {
    await g.close();
  }
}

async function pendingLevelUp() {
  // first session: nothing opens on home, but the celebration is kept for the next launch
  const g = await openGame({ save: makeSave({}), timeScale: 20 });
  const { page } = g;
  try {
    await ev(page, () => window.__blocko.skipTutorial());
    await idle(page);
    await ev(page, () => window.__blocko.app.retention.queueLevelUp({ levels: [2], coins: 100, themes: [] }));
    await ev(page, () => window.__blocko.app.retention.queueLevelUp({ levels: [3], coins: 100, themes: ['neon'] }));
    const flag = await ev(page, () => window.__blocko.save().flags.pendingLevelUp);
    assert(flag && flag.levels.join() === '2,3' && flag.coins === 200 && flag.themes.join() === 'neon', `persisted: ${JSON.stringify(flag)}`);
    await ev(page, () => window.__blocko.goto('home'));
    await idle(page);
    await page.waitForTimeout(150);
    assert((await state(page)).modals.length === 0, 'no popup in the first session');
    await ev(page, () => window.__blocko.save({ settings: { haptics: false } })); // no vibrate() without a tap in this headless page
    await reload(page);
    await waitModal(page, 'levelUp');
    assert(/level 3/i.test(await text(page, '[data-modal="levelUp"] .modal__text')), 'the celebration appears on the next launch');
    assert(await ev(page, () => window.__blocko.save().flags.pendingLevelUp) === null, 'forgotten once shown');
    await tap(page, 'levelUp.close');
    await reload(page);
    await page.waitForTimeout(200);
    assert(!(await state(page)).modals.includes('levelUp'), 'shown only once');
    assertNoErrors(g, 'pending level-up');
  } finally {
    await g.close();
  }
}

async function smallThings() {
  // tutorial step 3 teaches the real rule, in English and German
  assert(/Combo/.test(en['tutorial.step3']) && !/row and a column/i.test(en['tutorial.step3']), `en step 3: ${en['tutorial.step3']}`);
  assert(/Combo/.test(de['tutorial.step3']) && !/Reihe und Spalte/i.test(de['tutorial.step3']), `de step 3: ${de['tutorial.step3']}`);

  // a new player: no "BEST 0" on home, no empty crown in the HUD
  const g = await openGame({ save: makeSave({ flags: { tutorialDone: true, notifDeclines: 2 } }) });
  const { page } = g;
  try {
    const hidden = (sel) => ev(page, (q) => getComputedStyle(document.querySelector(q)).visibility === 'hidden', sel);
    assert(await hidden('.screen.is-active .home__best'), 'home: no BEST 0 for a new player');
    await ev(page, () => window.__blocko.startGame('classic', { seed: 2 }));
    await idle(page);
    assert(await hidden('.hud__best'), 'HUD: no crown 0');
    await ev(page, () => window.__blocko.save({ stats: { bestScore: 1500 } }));
    await ev(page, () => window.__blocko.startGame('classic', { seed: 2, best: 1500 }));
    await idle(page);
    assert(!(await hidden('.hud__best')), 'HUD: crown once a best exists');

    // the "only n to beat your best" nudge is gone behind the revive offer (it carries its own number)
    await ev(page, () => window.__blocko.startGame('classic', { seed: 2, best: 1500, score: 1320 }));
    await idle(page);
    assert(await ev(page, () => document.querySelector('.hud__nudge').classList.contains('is-on')), 'nudge while playing');
    await ev(page, () => window.__blocko.forceGameOver());
    await waitModal(page, 'revive');
    assert(!(await ev(page, () => document.querySelector('.hud__nudge').classList.contains('is-on'))), 'no HUD nudge behind the revive offer');
    await tap(page, 'revive.skip');
    await waitModal(page, 'gameover');
  } finally {
    await g.close();
  }
}

async function boosters() {
  const g = await openGame({ save: veteranSave({ coins: 1000, boosters: { hammer: 0, shuffle: 0 }, journey: { unlocked: 6 } }) });
  const { page } = g;
  try {
    await ev(page, () => window.__blocko.startGame('journey', { level: 3, seed: 1 }));
    await idle(page);
    const badge = () => text(page, '[data-booster="hammer"] .booster__count');
    assert(await badge() === '+', 'no hammer: buy badge');
    await tap(page, 'game.booster.hammer');
    await waitModal(page, 'booster');
    await tap(page, 'booster.buy');
    await waitState(page, '(st) => st.targetMode === "hammer"');
    assert(await badge() === '1', `the badge shows the hammer just bought (${await badge()})`);

    // free booster videos: capped per day, persisted, and shared by the shop and the in-run sheet
    const cap = CONFIG.ADS.FREE_BOOSTER_ADS_PER_DAY;
    await ev(page, () => window.__blocko.app.game.back());
    await ev(page, () => window.__blocko.save({ boosters: { hammer: 0 } }));
    assert(await ev(page, () => window.__blocko.app.freeBoostersLeft()) === cap, 'the cap starts full');
    await ev(page, () => window.__blocko.app.modals.open('booster', { type: 'hammer' }));
    await waitModal(page, 'booster');
    assert(!!(await page.$('[data-modal="booster"] [data-action="booster.watch"]')), 'in-run sheet offers a free booster video');
    await ev(page, (n) => { for (let i = 0; i < n; i++) window.__blocko.app.grantFreeBooster('hammer'); }, cap);
    assert(await ev(page, () => window.__blocko.app.freeBoostersLeft()) === 0, 'cap used up');
    await ev(page, () => { window.__blocko.app.modals.closeAll(); window.__blocko.app.modals.open('booster', { type: 'hammer' }); });
    await waitModal(page, 'booster');
    assert(!(await page.$('[data-modal="booster"] [data-action="booster.watch"]')), 'no free video once the day\'s cap is used');
    await reload(page);
    assert(await ev(page, () => window.__blocko.app.freeBoostersLeft()) === 0, 'the cap survives a restart');
    await ev(page, () => window.__blocko.goto('shop'));
    await tap(page, 'shop.tab.boosters');
    await idle(page);
    assert(!(await page.$('.screen.is-active [data-action^="shop.booster.watch."]')), 'the shop shows no free video either');
    assertNoErrors(g, 'boosters');
  } finally {
    await g.close();
  }
}

/** Impressum: the contact form link (§ 5 DDG: a second contact channel besides e-mail) is rendered when configured. */
async function legalContactForm() {
  const url = 'https://example.org/contact-form';
  const g = await openGame({ save: veteranSave(), query: 'debug=1&mock=fast' });
  try {
    const { page } = g;
    // CONFIG is frozen: serve a copy with the form URL set and reload
    await g.context.route('**/js/config.js', async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, body: (await res.text()).replace("CONTACT_FORM_URL: ''", `CONTACT_FORM_URL: '${url}'`) });
    });
    await reload(page);
    await recordPlatform(page, ['openUrl']);
    await ev(page, () => window.__blocko.goto('legal'));
    await page.waitForSelector('.screen.is-active [data-action="legal.form"]');
    assert(/Contact form/.test(await text(page, '.screen.is-active [data-action="legal.form"]')), 'contact form link on the legal screen');
    await tap(page, 'legal.form');
    assert((await calls(page, 'openUrl')).some((a) => a[0] === url), 'the link opens the configured form');
    await ev(page, () => window.__blocko.setLang('de'));
    assert(/Kontaktformular/.test(await text(page, '.screen.is-active [data-action="legal.form"]')), 'translated (de)');
    assertNoErrors(g, 'legal form');
  } finally {
    await g.close();
  }
}

export default async function uiFlowSpec() {
  await legalContactForm();
  await reviewRules();
  await lateDoubleOffer();
  await journeyCard();
  await staleDaily();
  await pendingLevelUp();
  await smallThings();
  await boosters();
}
