// E2E journey map (§1 Journey): opens from the home card centred on the current level;
// completed levels show their stars, locked ones a lock, hard/super-hard ones a flame/skull badge;
// only the nodes around the viewport exist (virtualized, up to unlocked + AHEAD levels); real
// touch scrolling moves the map while the page stays fixed; "jump to level" returns to the
// current node; a node opens the level start sheet (goal + par rows); a saved journey run shows
// Continue; locked nodes only toast; replaying a completed level pays per Progression rules
// (+10 per newly earned star, no unlock); Map from the result returns to the map.
// Run: node tests/e2e/run.mjs meta-journey
import { CONFIG } from '../../game/js/config.js';
import { openGame, veteranSave, assert, ev, state, idle, waitModal, waitState, tap, assertNoErrors } from './ui.helpers.mjs';
import { text, back, shotB } from './meta.helpers.mjs';

const UNLOCKED = 60;
const AHEAD = 20;

const rendered = (page) => ev(page, () => [...document.querySelectorAll('.screen.is-active .map [data-n]')].map((e) => Number(e.dataset.n)).sort((a, b) => a - b));

/** Scrolls the map until node n is rendered and centred (never scrolls anything but the map). */
async function reveal(page, n) {
  const ok = await page.evaluate(async (target) => {
    const sc = document.querySelector('.screen.is-active .map');
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    for (let i = 0; i < 300; i++) {
      const el = sc.querySelector(`[data-n="${target}"]`);
      if (el) {
        sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - sc.clientHeight / 2;
        await frame();
        await frame();
        return true;
      }
      const nodes = [...sc.querySelectorAll('[data-n]')].map((e) => Number(e.dataset.n));
      sc.scrollTop += target > Math.max(...nodes) ? -500 : 500;
      await frame();
      await frame();
    }
    return false;
  }, n);
  assert(ok, `node ${n} reachable`);
}

/** Is node n fully inside the map viewport? */
const inView = (page, n) => ev(page, (x) => {
  const sc = document.querySelector('.screen.is-active .map').getBoundingClientRect();
  const el = document.querySelector(`.screen.is-active .map [data-n="${x}"]`);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.top >= sc.top && r.bottom <= sc.bottom;
}, n);

/** Greedy bot that prefers clearing lines with gems (as in journey.spec). */
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

export default async function metaJourneySpec() {
  const stars = {};
  for (let n = 1; n < UNLOCKED; n++) stars[n] = (n % 3) + 1;
  stars[1] = 1;
  const g = await openGame({ save: veteranSave({ journey: { unlocked: UNLOCKED, stars }, stats: { gamesPlayed: 40 } }) });
  const { page } = g;
  try {
    // --- open from the home card, centred on the current level --------------------------------
    await tap(page, 'home.journeyCard');
    await waitState(page, '(st) => st.screen === "journey"');
    await idle(page);
    let nodes = await rendered(page);
    assert(nodes.includes(UNLOCKED) && await inView(page, UNLOCKED), `current level ${UNLOCKED} in view (${nodes})`);
    assert(nodes.length > 4 && nodes.length <= 30, `virtualized: ${nodes.length} nodes in the DOM`);
    assert(!nodes.includes(1) && !nodes.includes(UNLOCKED + AHEAD), 'far levels not rendered');
    assert(await page.$(`.screen.is-active [data-n="${UNLOCKED}"].node--current .node__pin`), 'current node marked');
    assert(await page.$(`.screen.is-active [data-n="${UNLOCKED + 1}"].node--locked .node__lock`), 'next level locked');
    const lit = await ev(page, (n) => document.querySelectorAll(`.screen.is-active [data-n="${n}"] .node__stars .star.is-on`).length, UNLOCKED - 1);
    assert(lit === stars[UNLOCKED - 1], `completed node shows its stars (${lit})`);
    assert(await ev(page, () => document.querySelector('.screen.is-active .map__jump').hidden), 'no jump button while the current level is visible');
    await shotB(page, 'journey-map-phone');

    // --- real touch scrolling: the map moves, the page does not ---------------------------------
    const box = await ev(page, () => { const r = document.querySelector('.screen.is-active .map').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: document.querySelector('.screen.is-active .map').scrollTop }; });
    // a real finger swipe (touchstart → touchmove… → touchend), downwards = towards higher levels
    const cdp = await g.context.newCDPSession(page);
    const x = Math.round(box.x);
    const y0 = Math.round(box.y - 160);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
    for (let i = 1; i <= 12; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + i * 25 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(700); // momentum
    await idle(page);
    const after = await ev(page, () => ({
      top: document.querySelector('.screen.is-active .map').scrollTop,
      page: window.scrollY + document.scrollingElement.scrollTop + document.getElementById('app').scrollTop + document.querySelector('.screen.is-active').scrollTop,
    }));
    assert(after.top < box.top - 300, `touch swipe scrolled the map (${box.top} → ${after.top})`);
    assert(after.page === 0, 'body / screen stay fixed');
    nodes = await rendered(page);
    assert(Math.max(...nodes) > UNLOCKED + 5 && nodes.length <= 30, `higher levels rendered while scrolling (${nodes})`);
    assert(!(await inView(page, UNLOCKED)), 'current level scrolled out of view');
    assert(!(await ev(page, () => document.querySelector('.screen.is-active .map__jump').hidden)), 'jump button appears');
    await tap(page, 'journey.jump');
    await page.waitForFunction((n) => {
      const sc = document.querySelector('.screen.is-active .map').getBoundingClientRect();
      const el = document.querySelector(`.screen.is-active .map [data-n="${n}"]`);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.top >= sc.top && r.bottom <= sc.bottom;
    }, UNLOCKED, { timeout: 5000 });

    // --- top of the map: unlocked + AHEAD, tags -------------------------------------------------------
    await reveal(page, UNLOCKED + AHEAD);
    nodes = await rendered(page);
    assert(Math.max(...nodes) === UNLOCKED + AHEAD && nodes.length <= 30, `map ends at ${UNLOCKED + AHEAD} (${nodes})`);
    await ev(page, () => { document.querySelector('.screen.is-active .map').scrollTop = 0; });
    await idle(page);
    assert(/More levels unlock/.test(await text(page, '.screen.is-active .map__end')), '"more levels" note at the top');
    assert(await page.$('.screen.is-active [data-n="80"].node--superhard .node__tag .ico--skull'), 'super hard: skull badge');
    assert(await page.$('.screen.is-active [data-n="75"].node--hard .node__tag .ico--flame'), 'hard: flame badge');
    // locked node → toast only
    await reveal(page, UNLOCKED + 2);
    await tap(page, `journey.node.${UNLOCKED + 2}`);
    let s = await state(page);
    assert(s.modals.length === 0 && s.toasts.some((x) => x === `Complete level ${UNLOCKED} first`), `locked node toast (${s.toasts})`);

    // --- bottom: level 1 -------------------------------------------------------------------------------
    await reveal(page, 1);
    nodes = await rendered(page);
    assert(nodes[0] === 1 && nodes.length <= 30, `level 1 at the bottom (${nodes})`);

    // --- current level: sheet → Play; saved run → Continue -----------------------------------------
    await reveal(page, UNLOCKED);
    await tap(page, `journey.node.${UNLOCKED}`);
    await waitModal(page, 'levelStart');
    const sheet = await text(page, '[data-modal="levelStart"]');
    assert(/Level 60/.test(sheet) && /Super hard/i.test(sheet) && /Collect/i.test(sheet), `sheet: title, tag, goal (${sheet})`);
    const pars = await ev(page, () => [...document.querySelectorAll('[data-modal="levelStart"] .ls__row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
    const L = CONFIG.ECONOMY;
    assert(pars.length === 3 && pars[0].includes(`+${L.LEVEL_COMPLETE_COINS + 3 * L.LEVEL_STAR_COINS}`) && /Complete the level/.test(pars[2]), `par rows (${pars})`);
    const gems = await ev(page, () => document.querySelectorAll('[data-modal="levelStart"] .ls__gem').length);
    assert(gems >= 1, 'gem goals shown');
    await shotB(page, 'journey-levelStart-phone');
    await tap(page, 'levelStart.play');
    s = await waitState(page, '(st) => st.screen === "game" && st.session && st.session.mode === "journey"');
    assert(await ev(page, () => window.__blocko.app.game.session.level.number) === UNLOCKED, 'level 60 started');
    for (let i = 0; i < 2; i++) {
      const m = (await ev(page, () => window.__blocko.validMoves())).find((x) => x.lines === 0);
      await ev(page, (x) => window.__blocko.place(x.trayIndex, x.r, x.c), m);
    }
    await tap(page, 'game.pause');
    await waitModal(page, 'pause');
    await tap(page, 'pause.home');
    await waitState(page, '(st) => st.screen === "home"');
    await tap(page, 'home.journeyCard');
    await waitState(page, '(st) => st.screen === "journey"');
    await idle(page);
    await tap(page, `journey.node.${UNLOCKED}`);
    await waitModal(page, 'levelStart');
    assert(/Continue/.test(await text(page, '[data-modal="levelStart"] [data-action="levelStart.play"]')), 'saved run → Continue');
    await back(page);
    assert((await state(page)).modals.length === 0, 'back closes the sheet');

    // another level while a journey run is saved → abandon confirmation
    await reveal(page, 1);
    await tap(page, 'journey.node.1');
    await waitModal(page, 'levelStart');
    const best = await ev(page, () => document.querySelectorAll('[data-modal="levelStart"] .ls__best .star.is-on').length);
    assert(best === 1, `best stars of level 1 (${best})`);
    const replayRows = await ev(page, () => [...document.querySelectorAll('[data-modal="levelStart"] .ls__row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
    assert(replayRows[0].includes(`+${2 * L.LEVEL_STAR_COINS}`) && replayRows[1].includes(`+${L.LEVEL_STAR_COINS}`), `replay pays only new stars (${replayRows})`);
    await tap(page, 'levelStart.play');
    await waitModal(page, 'confirm');
    await tap(page, 'confirm.ok');

    // --- replay level 1 to a win: rewards per Progression rules, nothing unlocked --------------------
    let status = 'over';
    for (let attempt = 0; attempt < 5 && status !== 'won'; attempt++) {
      await waitState(page, '(st) => st.screen === "game" && st.session.mode === "journey" && st.session.status === "playing" && st.modals.length === 0');
      status = await levelBot(page);
      if (status !== 'won') {
        await waitModal(page, 'revive');
        await tap(page, 'revive.giveUp');
        await waitModal(page, 'levelResult');
        await tap(page, 'levelResult.retry');
      }
    }
    assert(status === 'won', 'bot won the replay of level 1');
    await waitModal(page, 'levelResult');
    const sum = await ev(page, () => window.__blocko.app.game.summary);
    const sv = await ev(page, () => window.__blocko.save());
    assert(sum.firstTime === false && sum.levelCoins === L.LEVEL_STAR_COINS * Math.max(0, sum.stars - 1), `replay coins ${sum.levelCoins} for ${sum.stars}★`);
    assert(sv.journey.unlocked === UNLOCKED && sv.journey.stars['1'] === Math.max(1, sum.stars), 'no unlock, best stars kept');
    await tap(page, 'levelResult.map');
    await waitState(page, '(st) => st.screen === "journey" && st.modals.length === 0');
    await idle(page);
    assert(await inView(page, UNLOCKED), 'Map returns to the map at the current level');
    assertNoErrors(g, 'meta-journey');
  } finally {
    await g.close();
  }
}
