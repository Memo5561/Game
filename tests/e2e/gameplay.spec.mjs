// E2E gameplay + interstitial rules (§4.15): a bot plays a full classic run to game over →
// revive offer → decline → the game-over screen shows values consistent with the save (score,
// best, coins) → Play again. Interstitials: none in the first session; afterwards (play time and
// time manipulated via save patches / setNow) one appears ONLY inside the tap handler of a result
// button, only after the screen was visible ≥ RESULT_SCREEN_MIN_MS, and never again within
// INTERSTITIAL_MIN_INTERVAL_SEC.
// Run: node tests/e2e/run.mjs gameplay
import { CONFIG } from '../../game/js/config.js';
import { openGame, veteranSave, assert, ev, state, idle, waitModal, waitState, tap, playMoves, recordAds, adLog, assertNoErrors } from './ui.helpers.mjs';
import { botPlay } from './harness.mjs';

const MIN_MS = CONFIG.ADS.RESULT_SCREEN_MIN_MS;

/** Plays ≥ RUN_MIN_PIECES pieces, forces the game over, declines the revive. */
async function shortRunToGameOver(page) {
  const placed = await playMoves(page, CONFIG.ADS.RUN_MIN_PIECES + 1);
  assert(placed === CONFIG.ADS.RUN_MIN_PIECES + 1, `placed ${placed} pieces`);
  assert(await ev(page, () => window.__blocko.forceGameOver()), 'forceGameOver');
  await waitModal(page, 'revive');
  await tap(page, 'revive.skip');
  await waitModal(page, 'gameover');
}

/** Enough play time since the last ad for AdPolicy (the bot plays far faster than a human). */
function grantPlayTime(page) {
  return ev(page, () => window.__blocko.save({ stats: { playSec: 2000 }, ads: { playSecSinceAd: 600 } }));
}

export default async function gameplaySpec() {
  const g = await openGame({ save: veteranSave({ stats: { gamesPlayed: 3, playSec: 0, bestScore: 900 }, coins: 300 }) });
  const { page } = g;
  try {
    await recordAds(page);

    // --- run 1: full bot game -----------------------------------------------------------------
    await tap(page, 'home.play');
    let s = await waitState(page, '(st) => st.screen === "game" && st.session && st.session.status === "playing"');
    const r = await botPlay(page, { maxMoves: 600 });
    assert(r.status === 'over', `bot reached game over (${r.status}, ${r.moves} moves)`);
    await waitModal(page, 'revive');
    s = await state(page);
    assert(s.modals.join() === 'revive' && s.session.status === 'over', 'revive offered after game over');
    const runScore = s.session.score;
    const before = await ev(page, () => window.__blocko.save());
    assert(before.run && before.run.session.status === 'over', 'the over state was persisted while the revive is offered');
    await tap(page, 'revive.skip');
    await waitModal(page, 'gameover');
    await page.waitForTimeout(2200); // count-ups + coin flight
    const sv = await ev(page, () => window.__blocko.save());
    const ui = await ev(page, () => {
      const m = document.querySelector('[data-modal="gameover"]');
      const txt = (sel) => (m.querySelector(sel) ? m.querySelector(sel).textContent.trim() : null);
      return {
        score: txt('[data-ref="score"]'),
        coins: txt('[data-ref="coins"]'),
        pill: txt('[data-coins]'),
        best: txt('.best-bar__value'),
        record: !!m.querySelector('.result__record'),
      };
    });
    const fmt = (n) => n.toLocaleString('en-US');
    assert(sv.run === null && sv.stats.gamesPlayed === 4, 'run finalized exactly once');
    assert(ui.score === fmt(runScore), `score shown ${ui.score} = ${fmt(runScore)}`);
    assert(sv.stats.bestScore === Math.max(900, runScore), `best saved ${sv.stats.bestScore}`);
    if (runScore > 900) assert(ui.record, 'new best shows the record banner');
    else assert(ui.best === fmt(900), `best bar shows ${ui.best}`);
    const sum = await ev(page, () => window.__blocko.app.game.summary);
    const earned = sum.coinsEarned;
    assert(earned > 0 && ui.coins === fmt(earned), `coins earned shown ${ui.coins} = ${earned}`);
    assert(sv.coins === before.coins + earned + sum.levelUpCoins, `balance ${sv.coins} = ${before.coins} + ${earned} + level-up ${sum.levelUpCoins}`);
    assert(ui.pill === fmt(sv.coins), `coin pill ${ui.pill} = balance ${sv.coins}`);
    assert((await adLog(page)).length === 0, 'no ad so far');

    await page.waitForTimeout(MIN_MS);
    await tap(page, 'gameover.again');
    s = await waitState(page, '(st) => st.modals.length === 0 && st.session.status === "playing" && st.session.score === 0');
    assert((await adLog(page)).length === 0, 'first session: no interstitial (total play time / first run of the session)');

    // --- run 2: conditions met, but the tap comes before RESULT_SCREEN_MIN_MS -----------------
    await grantPlayTime(page);
    await shortRunToGameOver(page);
    await tap(page, 'gameover.again');
    await waitState(page, '(st) => st.modals.length === 0 && st.session.score === 0');
    assert((await adLog(page)).length === 0, 'no interstitial when the result screen was visible < RESULT_SCREEN_MIN_MS');

    // --- run 3: interstitial on the Play again tap ---------------------------------------------
    await grantPlayTime(page);
    await shortRunToGameOver(page);
    await page.waitForTimeout(MIN_MS + 200);
    assert((await adLog(page)).length === 0, 'no interstitial while the result screen is just shown');
    await tap(page, 'gameover.again');
    await page.waitForFunction(() => window.__adLog.includes('Interstitial'), null, { timeout: 5000 });
    s = await waitState(page, '(st) => st.modals.length === 0 && st.session.status === "playing" && st.session.score === 0');
    let ads = await ev(page, () => window.__blocko.save().ads);
    assert(ads.interstitialsShown === 1 && ads.playSecSinceAd === 0, 'interstitial recorded by AdPolicy');

    // --- run 4: within the minimum interval → none ---------------------------------------------
    await grantPlayTime(page);
    await shortRunToGameOver(page);
    await page.waitForTimeout(MIN_MS + 200);
    await tap(page, 'gameover.home');
    await waitState(page, '(st) => st.screen === "home" && st.modals.length === 0');
    assert((await adLog(page)).filter((x) => x === 'Interstitial').length === 1, 'no interstitial within INTERSTITIAL_MIN_INTERVAL_SEC');

    // --- run 5: clock moved past the interval → interstitial on Home -------------------------
    await ev(page, (ms) => window.__blocko.setNow(Date.now() + ms), (CONFIG.ADS.INTERSTITIAL_MIN_INTERVAL_SEC + 60) * 1000);
    await grantPlayTime(page);
    await tap(page, 'home.play');
    await waitState(page, '(st) => st.screen === "game" && st.session.status === "playing"');
    await shortRunToGameOver(page);
    await page.waitForTimeout(MIN_MS + 200);
    await tap(page, 'gameover.home');
    await page.waitForFunction(() => window.__adLog.filter((x) => x === 'Interstitial').length === 2, null, { timeout: 5000 });
    await waitState(page, '(st) => st.screen === "home" && st.modals.length === 0');
    ads = await ev(page, () => window.__blocko.save().ads);
    assert(ads.interstitialsShown === 2, 'second interstitial after the interval');
    assert((await adLog(page)).every((x) => x === 'Interstitial'), 'only interstitials were shown, only from result buttons');

    // --- emotional moments: no interstitial after a new best or a close call, but after an ordinary game over ---
    const dueAgain = async () => {
      await ev(page, (ms) => window.__blocko.setNow(Date.now() + ms), (CONFIG.ADS.INTERSTITIAL_MIN_INTERVAL_SEC + 60) * 1000 + 600 * 1000);
      await grantPlayTime(page);
    };
    const interstitials = async () => (await adLog(page)).filter((x) => x === 'Interstitial').length;
    const stagedRun = async (score, best) => {
      await ev(page, (b) => window.__blocko.save({ stats: { bestScore: b } }), best);
      await ev(page, (sc) => window.__blocko.startGame('classic', { score: sc }), score);
      await waitState(page, '(st) => st.screen === "game" && st.session.status === "playing"');
    };
    const assist = CONFIG.GENERATOR.ASSIST;

    // state flags: assist active only inside [FROM*best, best), gone after the record
    await stagedRun(Math.ceil(4000), 5000);
    let st = await state(page);
    assert(st.session.nearRecord === true && st.session.best === 5000, 'near-record assist active at 80% of the best');
    await ev(page, () => window.__blocko.startGame('classic', { score: 5001, best: 5000 }));
    st = await state(page);
    assert(st.session.nearRecord === false, 'assist ends once the record is broken');
    await ev(page, (n) => window.__blocko.startGame('classic', { score: 100, best: 5000, shortRunStreak: n }), assist.SHORT_RUNS_FOR_EASY_START);
    st = await state(page);
    assert(st.session.nearRecord === false && st.session.assistedStart === true, 'gentle start after several short runs');
    await ev(page, () => window.__blocko.startGame('journey', { level: 3, best: 5000 }));
    st = await state(page);
    assert(st.session.nearRecord === false && st.session.assistedStart === false, 'journey never gets the classic assist');

    // (1) close call at game over → postponed
    await dueAgain();
    const base = await interstitials();
    await stagedRun(Math.ceil(5000 * 0.9), 5000);
    await shortRunToGameOver(page);
    await page.waitForTimeout(MIN_MS + 200);
    await tap(page, 'gameover.again');
    await waitState(page, '(st) => st.modals.length === 0 && st.session.score === 0');
    assert((await interstitials()) === base, 'no interstitial after a close call');
    ads = await ev(page, () => window.__blocko.save().ads);
    assert(ads.playSecSinceAd >= CONFIG.ADS.INTERSTITIAL_MIN_PLAY_SEC_SINCE_AD, 'the postponed ad did not consume the play-time counter');

    // (2) new best → postponed
    await stagedRun(9000, 5000);
    await shortRunToGameOver(page);
    await page.waitForTimeout(MIN_MS + 200);
    await tap(page, 'gameover.again');
    await waitState(page, '(st) => st.modals.length === 0 && st.session.score === 0');
    assert((await interstitials()) === base, 'no interstitial after a new best');

    // (3) ordinary game over, ad is due → shown (the postponed one)
    await shortRunToGameOver(page);
    await page.waitForTimeout(MIN_MS + 200);
    await tap(page, 'gameover.home');
    await page.waitForFunction((n) => window.__adLog.filter((x) => x === 'Interstitial').length === n + 1, base, { timeout: 5000 });
    await waitState(page, '(st) => st.screen === "home" && st.modals.length === 0');

    // Home → Play never shows one
    await grantPlayTime(page);
    await ev(page, (ms) => window.__blocko.setNow(Date.now() + ms), 3600 * 1000);
    await tap(page, 'home.play');
    await idle(page);
    assert((await interstitials()) === base + 1 && (await adLog(page)).length === base + 1, 'no interstitial from Home → Play');
    assertNoErrors(g, 'gameplay');
  } finally {
    await g.close();
  }
}
