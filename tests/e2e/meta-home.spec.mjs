// E2E home cards and progressive unlocks (§1, CONFIG.UNLOCKS): a fresh player sees locked
// teasers (journey: "Unlocks after 2 more games", daily: "Unlocks at journey level 4", missions
// locked, no gift); after game 1 the daily reward + missions open (the calendar pops up on the
// way home), after game 2 the journey; a journey save patch (level 4) opens the daily challenge;
// the journey card shows the hard / super-hard tag and the stars collected; a completed daily
// shows its stars + streak flame; the missions badge counts claimable missions + the chest; a day
// rollover re-renders home and opens the new day's calendar.
// Run: node tests/e2e/run.mjs meta-home
import { openGame, assert, ev, state, idle, waitModal, waitState, tap, playMoves, assertNoErrors } from './ui.helpers.mjs';
import { freshSave, goToDay, todayKey, text, shotB } from './meta.helpers.mjs';

const locked = (page, ref) => ev(page, (r) => document.querySelector(`.screen.is-active [data-ref="${r}"]`).classList.contains('is-locked'), ref);
const hidden = (page, ref) => ev(page, (r) => document.querySelector(`.screen.is-active [data-ref="${r}"]`).hidden, ref);

/** A counted classic run (≥ RUN_MIN_PIECES pieces) from home to the result and back home. */
async function playCountedRun(page) {
  await tap(page, 'home.play');
  await waitState(page, '(st) => st.screen === "game" && st.session && st.session.status === "playing"');
  const placed = await playMoves(page, 6);
  assert(placed === 6, `placed ${placed}`);
  await ev(page, () => window.__blocko.forceGameOver());
  await waitModal(page, 'revive');
  await tap(page, 'revive.skip');
  await waitModal(page, 'gameover');
  await tap(page, 'gameover.home');
  await waitState(page, '(st) => st.screen === "home"');
  await idle(page);
  await page.waitForTimeout(100);
}

export default async function metaHomeSpec() {
  const g = await openGame({ save: freshSave({ flags: { notifDeclines: 2 } }) });
  const { page } = g;
  try {
    // --- fresh: everything locked ------------------------------------------------------------------
    let s = await state(page);
    assert(s.screen === 'home' && s.modals.length === 0, 'fresh: home without popups');
    assert(await locked(page, 'journey') && await text(page, '[data-ref="journeySub"]') === 'Unlocks after 2 more games', 'journey teaser');
    assert(await locked(page, 'daily') && await text(page, '[data-ref="dailySub"]') === 'Unlocks at journey level 4', 'daily teaser');
    assert(await locked(page, 'missions'), 'missions locked');
    assert(await hidden(page, 'gift'), 'no daily reward gift yet');
    await shotB(page, 'home-fresh-phone');
    await tap(page, 'home.journeyCard');
    await tap(page, 'home.daily');
    s = await state(page);
    assert(s.screen === 'home' && s.toasts.includes('Unlocks after 2 more games') && s.toasts.includes('Unlocks at journey level 4'), `locked toasts (${s.toasts})`);

    // --- game 1 → daily reward + missions ----------------------------------------------------------
    await playCountedRun(page);
    s = await state(page);
    assert(s.modals.join() === 'dailyReward', `calendar pops up after game 1 (${s.modals})`);
    await tap(page, 'dailyReward.claim');
    await waitState(page, '(st) => st.modals.length === 0');
    await idle(page);
    assert(!(await locked(page, 'missions')) && !(await hidden(page, 'gift')), 'missions + gift unlocked');
    assert(await locked(page, 'journey') && await text(page, '[data-ref="journeySub"]') === 'Unlocks after 1 more game', 'journey: 1 more game');

    // --- game 2 → journey -------------------------------------------------------------------------
    await playCountedRun(page);
    s = await state(page);
    assert(s.modals.length === 0, `no popup (reward already claimed) (${s.modals})`);
    assert(!(await locked(page, 'journey')) && await text(page, '[data-ref="journeySub"]') === 'Level 1', 'journey unlocked at level 1');
    assert(await hidden(page, 'journeyStars'), 'no stars yet');
    assert(await locked(page, 'daily'), 'daily still locked');
    await shotB(page, 'home-unlocked-phone');

    // --- journey level 3 done (save patch) → daily challenge ------------------------------------
    await ev(page, () => window.__blocko.save({ journey: { unlocked: 4, stars: { 1: 3, 2: 2, 3: 1 } } }));
    await idle(page);
    assert(!(await locked(page, 'daily')), 'daily unlocked at journey level 4');
    assert(/^Goal: [\d,]+ points$/.test(await text(page, '[data-ref="dailySub"]')), `daily goal (${await text(page, '[data-ref="dailySub"]')})`);
    assert(await text(page, '[data-ref="calDay"]') === String(Number(todayKey().slice(8))), 'today on the calendar icon');
    assert(await text(page, '[data-ref="journeyStars"]') === '6/9', `stars collected (${await text(page, '[data-ref="journeyStars"]')})`);
    assert(await hidden(page, 'journeyTag'), 'normal level: no tag');

    // --- tags ---------------------------------------------------------------------------------------
    await ev(page, () => window.__blocko.save({ journey: { unlocked: 10 } }));
    assert(!(await hidden(page, 'journeyTag')) && /Super hard/i.test(await text(page, '[data-ref="journeyTag"]')), 'super hard tag');
    assert(await page.$('.screen.is-active [data-ref="journeyTag"] .ico--skull'), 'skull icon');
    await ev(page, () => window.__blocko.save({ journey: { unlocked: 15 } }));
    assert(/Hard/i.test(await text(page, '[data-ref="journeyTag"]')) && await page.$('.screen.is-active [data-ref="journeyTag"] .ico--flame'), 'hard tag');
    await shotB(page, 'home-hard-phone');

    // --- completed daily challenge: stars + streak flame ---------------------------------------
    const today = todayKey();
    await ev(page, (d) => window.__blocko.save({ challenge: { completed: { [d]: 2 }, streak: 3, lastDay: d } }), today);
    assert(await ev(page, () => document.querySelector('.screen.is-active [data-ref="daily"]').classList.contains('is-done')), 'daily done state');
    assert(await ev(page, () => document.querySelectorAll('.screen.is-active [data-ref="dailyStars"] .star.is-on').length) === 2, '2 stars shown');
    assert(!(await hidden(page, 'dailyStreak')) && await text(page, '[data-ref="dailyStreak"]') === '3', 'streak flame 3');
    await shotB(page, 'home-daily-done-phone');

    // --- missions badge: claimable missions + chest ------------------------------------------------
    const list = (await ev(page, () => window.__blocko.save().missions.list)).map((m, i) => ({ ...m, progress: i < 2 ? m.target : 0 }));
    await ev(page, (l) => window.__blocko.save({ missions: { list: l } }), list);
    assert(await text(page, '[data-ref="missionsBadge"]') === '2', 'badge counts 2 claimable missions');
    const all = list.map((m) => ({ ...m, progress: m.target, claimed: true }));
    await ev(page, (l) => window.__blocko.save({ missions: { list: l, bonusClaimed: false } }), all);
    assert(await text(page, '[data-ref="missionsBadge"]') === '1', 'badge counts the chest');

    // --- day rollover while on home: re-render + calendar --------------------------------------------
    const day1 = await text(page, '[data-ref="calDay"]');
    await goToDay(page, 1);
    await waitModal(page, 'dailyReward');
    assert(await text(page, '[data-ref="calDay"]') !== day1, 'calendar icon shows the new day');
    assert(!(await ev(page, () => document.querySelector('.screen.is-active [data-ref="daily"]').classList.contains('is-done'))), 'new day: challenge open again');
    assertNoErrors(g, 'meta-home');
  } finally {
    await g.close();
  }
}
