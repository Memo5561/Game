// E2E auto popups (§4.15): a level-up during a run shows on the result screen and is celebrated
// (modal 'levelUp': level, coins, unlocked theme with "Use now") only on the next arrival at home –
// never at the start of the next run, never stacked; priority dailyReward > levelUp with at most
// one popup per arrival; queued level-ups merge; nothing pops up in the first session.
// Run: node tests/e2e/run.mjs meta-popups
import { CONFIG } from '../../game/js/config.js';
import { openGame, veteranSave, assert, ev, state, idle, waitModal, waitState, tap, playMoves, assertNoErrors } from './ui.helpers.mjs';
import { goToDay, text, shotB } from './meta.helpers.mjs';

/** Total XP needed to reach `level` (Progression.xpToReach). */
function xpToReach(level) {
  const n = level - 1;
  const P = CONFIG.PROGRESSION;
  return n * P.XP_LEVEL_BASE + (P.XP_LEVEL_STEP * n * (n + 1)) / 2;
}

/** A counted classic run that ends on the game-over screen. */
async function runToGameOver(page, start = 'home.play') {
  if (start) await tap(page, start);
  await waitState(page, '(st) => st.screen === "game" && st.session && st.session.status === "playing" && st.modals.length === 0');
  await playMoves(page, CONFIG.ADS.RUN_MIN_PIECES + 1);
  await ev(page, () => window.__blocko.forceGameOver());
  await waitModal(page, 'revive');
  await tap(page, 'revive.skip');
  await waitModal(page, 'gameover');
}

async function pauseHome(page) {
  await tap(page, 'game.pause');
  await waitModal(page, 'pause');
  await tap(page, 'pause.home');
  await waitState(page, '(st) => st.screen === "home"');
  await idle(page);
  await page.waitForTimeout(120);
}

export default async function metaPopupsSpec() {
  const g = await openGame({ save: veteranSave({ xp: xpToReach(3) - 5, coins: 600, flags: { notifDeclines: 2 } }) });
  const { page } = g;
  try {
    // --- level 3 reached in a run → result line, no modal until home ---------------------------------
    await runToGameOver(page);
    assert(/Level 3 reached!/.test(await text(page, '[data-modal="gameover"] [data-ref="levelUp"]')), 'result screen: level-up line');
    assert(/Neon/.test(await text(page, '[data-modal="gameover"] .result__theme')), 'result screen: theme line');
    await tap(page, 'gameover.again');
    await waitState(page, '(st) => st.screen === "game" && st.session.status === "playing"');
    await page.waitForTimeout(150);
    let s = await state(page);
    assert(s.modals.length === 0, `no level-up modal at the start of the next run (${s.modals})`);
    await pauseHome(page);
    await waitModal(page, 'levelUp');
    s = await state(page);
    assert(s.modals.join() === 'levelUp', `level-up celebrated on arrival at home (${s.modals})`);
    const body = await text(page, '[data-modal="levelUp"]');
    assert(/Level up!/.test(body) && /level 3/.test(body) && /\+100/.test(body) && /Neon/.test(body), `level-up content (${body})`);
    assert(await ev(page, () => document.querySelector('[data-modal="levelUp"] canvas').width > 0), 'theme preview painted');
    await page.waitForTimeout(400);
    await shotB(page, 'levelUp-phone');
    await tap(page, 'levelUp.use');
    s = await waitState(page, '(st) => st.modals.length === 0 && st.theme === "neon"');
    assert((await ev(page, () => window.__blocko.save().themes.selected)) === 'neon', '"Use now" selects the theme');
    await ev(page, () => window.__blocko.setTheme('jewel'));
    await ev(page, () => window.__blocko.save({ themes: { selected: 'jewel' } }));

    // --- priority: new day + level-up queued → calendar first, level-up on the next arrival -----------
    await ev(page, (xp) => window.__blocko.save({ xp }), xpToReach(4) - 5);
    await runToGameOver(page);
    await tap(page, 'gameover.again');
    await waitState(page, '(st) => st.screen === "game" && st.session.status === "playing"');
    await goToDay(page, 1);
    s = await state(page);
    assert(s.modals.length === 0, 'no popup during the run');
    await pauseHome(page);
    s = await state(page);
    assert(s.modals.join() === 'dailyReward', `daily reward has priority (${s.modals})`);
    await tap(page, 'dailyReward.claim');
    await waitState(page, '(st) => st.modals.length === 0');
    await page.waitForTimeout(150);
    s = await state(page);
    assert(s.modals.length === 0, 'at most one popup per arrival');
    await ev(page, () => window.__blocko.goto('settings'));
    await tap(page, 'nav.back');
    await waitModal(page, 'levelUp');
    assert(/level 4/.test(await text(page, '[data-modal="levelUp"] .modal__text')), 'level 4 on the next arrival');
    await tap(page, 'levelUp.close');
    await waitState(page, '(st) => st.modals.length === 0');

    // --- queued level-ups merge into one ---------------------------------------------------------------
    await ev(page, () => {
      window.__blocko.app.retention.queueLevelUp({ levels: [5], coins: 100, themes: [] });
      window.__blocko.app.retention.queueLevelUp({ levels: [6], coins: 100, themes: [] });
      window.__blocko.goto('settings');
    });
    await tap(page, 'nav.back');
    await waitModal(page, 'levelUp');
    const merged = await text(page, '[data-modal="levelUp"]');
    assert(/level 6/.test(merged) && /\+200/.test(merged), `merged (${merged})`);
    await tap(page, 'levelUp.close');
    await ev(page, () => window.__blocko.goto('settings'));
    await tap(page, 'nav.back');
    await page.waitForTimeout(150);
    assert((await state(page)).modals.length === 0, 'shown once');
    assertNoErrors(g, 'popups');
  } finally {
    await g.close();
  }

  // --- first session (tutorial): nothing pops up, even with a reward available -------------------
  const f = await openGame({});
  try {
    const { page: p } = f;
    await ev(p, () => window.__blocko.skipTutorial());
    await runToGameOver(p, null);
    await tap(p, 'gameover.home');
    await waitState(p, '(st) => st.screen === "home"');
    await idle(p);
    await p.waitForTimeout(200);
    const s = await state(p);
    assert(s.modals.length === 0, `no popup in the first session (${s.modals})`);
    assert(await ev(p, () => document.querySelector('[data-ref="gift"]').classList.contains('is-ready')), 'the gift shows the reward instead');
    assertNoErrors(f, 'first session');
  } finally {
    await f.close();
  }
}
