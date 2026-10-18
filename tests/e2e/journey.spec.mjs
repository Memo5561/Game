// E2E journey (§4.15): start level 1 from the home card, a gem-seeking bot wins it → gem counters
// complete, levelResult with animated stars matching the saved stars, next level unlocked → Next;
// hammer (target mode + a real tap on the board) and shuffle consume boosters; a booster at 0
// opens the offer (buy with coins); the "stuck" panel offers boosters / give up.
// Run: node tests/e2e/run.mjs journey
import { CONFIG } from '../../game/js/config.js';
import { openGame, veteranSave, assert, ev, state, idle, waitModal, waitState, tap, assertNoErrors } from './ui.helpers.mjs';

/** Greedy bot that prefers clearing lines with gems. @returns {Promise<string>} final status */
function levelBot(page, max = 300) {
  return page.evaluate(async (limit) => {
    const B = window.__blocko;
    for (let k = 0; k < limit; k++) {
      const s = B.app.game.session;
      if (s.status !== 'playing' || B.app.game.busy) break;
      const moves = B.validMoves();
      if (!moves.length) break;
      let best = null;
      let bestScore = -1;
      for (const m of moves) {
        const pv = s.preview(m.trayIndex, m.r, m.c);
        let gems = 0;
        for (const r of pv.rows) for (let c = 0; c < 8; c++) if (s.board.gems[r * 8 + c]) gems++;
        for (const c of pv.cols) for (let r = 0; r < 8; r++) if (s.board.gems[r * 8 + c]) gems++;
        const score = gems * 1000 + m.lines * 100 + m.cells;
        if (score > bestScore) {
          bestScore = score;
          best = m;
        }
      }
      await B.place(best.trayIndex, best.r, best.c);
    }
    return B.state().session.status;
  }, max);
}

/** Index of a filled board cell. */
function filledCell(s) {
  const i = s.session.board.findIndex((v) => v > 0);
  return { r: Math.floor(i / 8), c: i % 8 };
}

export default async function journeySpec() {
  const g = await openGame({ save: veteranSave({ journey: { unlocked: 1 } }) });
  const { page } = g;
  try {
    // --- level 1 from the home card -----------------------------------------------------------
    await tap(page, 'home.journeyPlay');
    let s = await waitState(page, '(st) => st.screen === "game" && st.session && st.session.mode === "journey"');
    const title = await ev(page, () => document.querySelector('.hud__title').textContent.trim());
    assert(title.startsWith('Level 1'), `HUD title (${title})`);
    const goalTypes = Object.keys(s.session.goals.gems);
    assert((await page.$$('.hud .goal')).length === goalTypes.length, 'one gem counter per goal type');

    let status = 'over';
    for (let attempt = 0; attempt < 4 && status !== 'won'; attempt++) {
      status = await levelBot(page);
      if (status !== 'won') {
        await waitModal(page, 'revive');
        await tap(page, 'revive.giveUp');
        await waitModal(page, 'levelResult');
        await tap(page, 'levelResult.retry');
        await waitState(page, '(st) => st.modals.length === 0 && st.session.status === "playing"');
      }
    }
    assert(status === 'won', 'bot won journey level 1');
    await waitModal(page, 'levelResult');
    const done = await ev(page, () => document.querySelectorAll('.hud .goal.is-done').length);
    assert(done === goalTypes.length, `gem counters completed (${done}/${goalTypes.length})`);
    await page.waitForTimeout(1500); // star animation
    const sv = await ev(page, () => window.__blocko.save());
    const lit = await ev(page, () => document.querySelectorAll('[data-modal="levelResult"] .result__stars .star.is-on').length);
    assert(sv.journey.stars['1'] >= 1 && lit === sv.journey.stars['1'], `stars shown ${lit} = saved ${sv.journey.stars['1']}`);
    assert(sv.journey.unlocked === 2 && sv.run === null, 'level 2 unlocked, run finalized');
    await tap(page, 'levelResult.next');
    s = await waitState(page, '(st) => st.modals.length === 0 && st.session.mode === "journey" && st.session.status === "playing"');
    assert((await ev(page, () => document.querySelector('.hud__title').textContent)).startsWith('Level 2'), 'Next starts level 2');

    // --- hammer: target mode + real tap on the board -------------------------------------------
    s = await ev(page, () => window.__blocko.startGame('journey', { level: 3, seed: 4 }).then(() => window.__blocko.state()));
    let boosters = (await ev(page, () => window.__blocko.save())).boosters;
    await tap(page, 'game.booster.hammer');
    s = await state(page);
    assert(s.targetMode === 'hammer', 'hammer target mode');
    const cell = filledCell(s);
    const pt = await ev(page, (c) => window.__blocko.cellPoint(c.r, c.c), cell);
    await page.mouse.click(pt.x, pt.y);
    s = await waitState(page, '(st) => st.targetMode === null');
    await idle(page);
    assert(s.session.board[cell.r * 8 + cell.c] === 0, 'hammer cleared the tapped cell');
    let after = (await ev(page, () => window.__blocko.save())).boosters;
    assert(after.hammer === boosters.hammer - 1, `hammer consumed (${after.hammer})`);
    assert((await ev(page, () => window.__blocko.save().run)).session.board.cells[cell.r * 8 + cell.c] === 0, 'booster result persisted');

    // --- shuffle -------------------------------------------------------------------------------
    await tap(page, 'game.booster.shuffle');
    await idle(page);
    after = (await ev(page, () => window.__blocko.save())).boosters;
    assert(after.shuffle === boosters.shuffle - 1, `shuffle consumed (${after.shuffle})`);

    // --- booster at 0 → offer → buy with coins → target mode ---------------------------------
    await ev(page, () => window.__blocko.save({ boosters: { hammer: 0 }, coins: 1000 }));
    await ev(page, () => window.__blocko.startGame('journey', { level: 3, seed: 4 }));
    await tap(page, 'game.booster.hammer');
    await waitModal(page, 'booster');
    await tap(page, 'booster.buy');
    s = await waitState(page, '(st) => st.modals.length === 0 && st.targetMode === "hammer"');
    assert(s.coins === 1000 - CONFIG.ECONOMY.BOOSTER_PRICES.hammer, `booster bought (${s.coins})`);
    const p2 = await ev(page, (c) => window.__blocko.cellPoint(c.r, c.c), filledCell(s));
    await page.mouse.click(p2.x, p2.y);
    await waitState(page, '(st) => st.targetMode === null');
    boosters = (await ev(page, () => window.__blocko.save())).boosters;
    assert(boosters.hammer === 0, 'bought hammer used');

    // --- stuck panel: boosters / give up -------------------------------------------------------
    await ev(page, () => window.__blocko.forceGameOver());
    await waitModal(page, 'revive');
    assert(await page.$('[data-modal="revive"] [data-action="revive.booster.shuffle"]'), 'stuck panel offers boosters');
    assert(!(await page.$('[data-modal="revive"] .ring')), 'no countdown on the stuck panel');
    await tap(page, 'revive.booster.shuffle');
    s = await waitState(page, '(st) => st.modals.length === 0 && st.session.status === "playing" && !st.busy');
    assert(!s.stuck, 'shuffle rescued the run');
    await ev(page, () => window.__blocko.forceGameOver());
    await waitModal(page, 'revive');
    await tap(page, 'revive.giveUp');
    await waitModal(page, 'levelResult');
    assert(await page.$('[data-modal="levelResult"] .result--level.is-failed'), 'failure variant');
    assertNoErrors(g, 'journey');
  } finally {
    await g.close();
  }
}
