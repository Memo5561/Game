// E2E persistence (§4.15): save.run is rewritten after every placement; a reload shows Continue
// and restores the identical board / tray / score (and the future trays); a run killed during the
// game-over offer is finalized at boot; an incompatible saved run is dropped silently.
// Run: node tests/e2e/run.mjs persistence
import { openGame, veteranSave, assert, ev, state, waitModal, waitState, tap, playMoves, assertNoErrors } from './ui.helpers.mjs';
import { waitForDebug } from './harness.mjs';

async function reload(page) {
  await page.reload({ waitUntil: 'load' });
  await waitForDebug(page);
  await page.waitForFunction(() => window.__blockoBooted === true);
  await ev(page, () => window.__blocko.setTimeScale(20));
}

const snap = (s) => JSON.stringify({ board: s.session.board, gems: s.session.gems, tray: s.session.tray, score: s.session.score, combo: s.session.combo, pieces: s.session.piecesPlaced });

export default async function persistenceSpec() {
  const g = await openGame({ save: veteranSave() });
  const { page } = g;
  try {
    // --- Continue restores the run exactly ----------------------------------------------------
    await tap(page, 'home.play');
    await waitState(page, '(st) => st.screen === "game" && st.session.status === "playing"');
    await playMoves(page, 4);
    const before = await state(page);
    const run = await ev(page, () => window.__blocko.save().run);
    assert(run && run.v === 1 && run.session.piecesPlaced === 4, 'save.run written after the placements');
    await page.waitForTimeout(50); // coalesced requestSave
    await reload(page);
    let s = await state(page);
    assert(s.screen === 'home', 'boot lands on home');
    assert(await page.$('.screen.is-active [data-action="home.continue"]'), 'home shows Continue');
    await tap(page, 'home.continue');
    s = await waitState(page, '(st) => st.screen === "game"');
    assert(snap(s) === snap(before), 'identical board / tray / score after Continue');
    // the same moves produce the same future on both sides of the reload
    await playMoves(page, 3);
    const a = await state(page);
    await reload(page);
    await tap(page, 'home.continue');
    s = await waitState(page, '(st) => st.screen === "game"');
    assert(snap(s) === snap(a), 'still identical after more moves + reload');

    // --- killed while the revive is offered → finalized at boot -------------------------------
    const gamesBefore = (await ev(page, () => window.__blocko.save())).stats.gamesPlayed;
    await ev(page, () => window.__blocko.forceGameOver());
    await waitModal(page, 'revive');
    const overRun = await ev(page, () => window.__blocko.save().run);
    assert(overRun && overRun.session.status === 'over', 'over state persisted');
    await reload(page);
    let sv = await ev(page, () => window.__blocko.save());
    assert(sv.run === null, 'run finalized at boot');
    assert(sv.stats.gamesPlayed === gamesBefore + 1, `game recorded once (${sv.stats.gamesPlayed})`);
    s = await state(page);
    assert(s.screen === 'home' && s.modals.length === 0, 'home without result screen');
    assert(await page.$('.screen.is-active [data-action="home.play"]'), 'home shows Play (no Continue)');

    // --- incompatible saved run is dropped -----------------------------------------------------
    await ev(page, () => window.__blocko.save({ run: { v: 999, mode: 'classic', level: null, session: { v: 999 } } }));
    await reload(page);
    sv = await ev(page, () => window.__blocko.save());
    assert(sv.run === null, 'incompatible run dropped');
    assert(sv.stats.gamesPlayed === gamesBefore + 1, 'dropping does not record a game');

    // --- journey run continues from its card ---------------------------------------------------
    await ev(page, () => window.__blocko.save({ stats: { gamesPlayed: 6 }, journey: { unlocked: 3 } }));
    await reload(page);
    await tap(page, 'home.journeyPlay');
    s = await waitState(page, '(st) => st.screen === "game" && st.session.mode === "journey"');
    await playMoves(page, 2);
    const j = await state(page);
    await reload(page);
    const sub = await ev(page, () => document.querySelector('[data-ref="journeySub"]').textContent);
    assert(/Continue level 3/.test(sub), `journey card offers Continue (${sub})`);
    await tap(page, 'home.journeyPlay');
    s = await waitState(page, '(st) => st.screen === "game" && st.session.mode === "journey"');
    assert(snap(s) === snap(j), 'journey run restored');
    assertNoErrors(g, 'persistence');
  } finally {
    await g.close();
  }
}
