// E2E daily missions (§4.10): locked teaser before the 'missions' unlock; progress from a real
// bot-played run ("Mission complete" toasts, home badge with the claimable count); claiming each
// mission (coins fly, claimed state); the bonus chest opens once all three are claimed; the reset
// countdown; a new day brings new missions.
// Run: node tests/e2e/run.mjs meta-missions
import { CONFIG } from '../../game/js/config.js';
import { openGame, veteranSave, assert, ev, state, idle, waitModal, waitState, tap, assertNoErrors } from './ui.helpers.mjs';
import { botPlay } from './harness.mjs';
import { freshSave, goToDay, todayKey, text, shotB } from './meta.helpers.mjs';

const R = CONFIG.ECONOMY.MISSION_REWARDS;

function missionList(day) {
  const m = (slot, type, target) => ({ id: `${day}-${slot}`, type, target, progress: 0, reward: R[slot], claimed: false, textKey: `mission.${type}` });
  return [m(0, 'place_pieces', 5), m(1, 'clear_lines', 2), m(2, 'play_games', 1)];
}

export default async function metaMissionsSpec() {
  // --- locked before the first game ---------------------------------------------------------------
  let g = await openGame({ save: freshSave() });
  try {
    const { page } = g;
    await tap(page, 'home.missions');
    let s = await state(page);
    assert(s.screen === 'home' && s.toasts.some((x) => /Unlocks after 1 more game/.test(x)), `dock: locked toast (${s.toasts})`);
    await ev(page, () => window.__blocko.goto('missions'));
    await idle(page);
    assert(/Unlocks after 1 more game/.test(await text(page, '.screen.is-active .locked-card')), 'missions screen: locked teaser');
    assert(await ev(page, () => document.querySelector('.screen.is-active .missions-timer').hidden), 'no countdown while locked');
    await shotB(page, 'missions-locked-phone');
    await tap(page, 'missions.play');
    await waitState(page, '(st) => st.screen === "home"');
    assertNoErrors(g, 'missions locked');
  } finally {
    await g.close();
  }

  // --- progress from real play, claim, bonus chest -----------------------------------------------
  const today = todayKey();
  g = await openGame({ save: veteranSave({ missions: { day: today, list: missionList(today), bonusClaimed: false }, flags: { notifDeclines: 2 } }) });
  try {
    const { page } = g;
    assert(!(await ev(page, () => document.querySelector('[data-ref="missionsBadge"]').classList.contains('is-on'))), 'no badge before playing');
    await tap(page, 'home.play');
    await waitState(page, '(st) => st.screen === "game" && st.session.status === "playing"');
    const r = await botPlay(page, { maxMoves: 600 });
    assert(r.status === 'over' && r.moves >= 5, `bot played a full run (${r.moves} moves)`);
    await waitModal(page, 'revive');
    await tap(page, 'revive.skip');
    await waitModal(page, 'gameover');
    let s = await state(page);
    const doneToasts = s.toasts.filter((x) => x.startsWith('Mission complete'));
    assert(doneToasts.length === 3, `three "Mission complete" toasts (${doneToasts})`);
    let sv = await ev(page, () => window.__blocko.save());
    assert(sv.missions.list.every((m) => m.progress >= m.target && !m.claimed), 'all three completed by the run');
    await tap(page, 'gameover.home');
    await waitState(page, '(st) => st.screen === "home" && st.modals.length === 0');
    await idle(page);
    assert(await text(page, '[data-ref="missionsBadge"]') === '3', 'home badge: 3 claimable');

    await tap(page, 'home.missions');
    await waitState(page, '(st) => st.screen === "missions"');
    await idle(page);
    assert(/New missions in (\d+ h )?\d+ min/.test(await text(page, '.screen.is-active .missions-timer')), 'reset countdown');
    assert((await page.$$('.screen.is-active .mission.is-done')).length === 3, 'three missions ready to claim');
    await shotB(page, 'missions-claim-phone');
    let coins = sv.coins;
    for (let slot = 0; slot < 3; slot++) {
      await tap(page, `missions.claim.${today}-${slot}`);
      coins += R[slot];
      await page.waitForFunction((n) => window.__blocko.save().coins === n, coins);
      await page.waitForFunction((id) => document.querySelector(`.screen.is-active [data-mission="${id}"]`)?.classList.contains('is-claimed'), `${today}-${slot}`);
      // the list re-renders once the coins landed
      await page.waitForFunction(() => !document.querySelector('#fx .fx-coin'));
      await page.waitForTimeout(60);
    }
    await page.waitForSelector('.screen.is-active .chest-card.is-ready [data-action="missions.bonus"]');
    await tap(page, 'missions.bonus');
    coins += CONFIG.ECONOMY.MISSION_BONUS_COINS;
    await page.waitForFunction((n) => window.__blocko.save().coins === n, coins);
    await page.waitForFunction(() => /Opened/.test(document.querySelector('.screen.is-active .chest-card.is-open')?.textContent || ''));
    sv = await ev(page, () => window.__blocko.save());
    assert(sv.missions.bonusClaimed && sv.missions.list.every((m) => m.claimed), 'missions + bonus claimed');
    assert(/Opened/.test(await text(page, '.screen.is-active .chest-card')), 'chest opened');
    await shotB(page, 'missions-done-phone');
    // claiming twice is impossible
    assert(!(await page.$('.screen.is-active [data-action^="missions.claim."]')), 'no claim buttons left');
    await ev(page, () => window.__blocko.goto('home'));
    await idle(page);
    assert(!(await ev(page, () => document.querySelector('[data-ref="missionsBadge"]').classList.contains('is-on'))), 'badge cleared');

    // --- next day: new missions, chest closed again ------------------------------------------------
    await ev(page, () => window.__blocko.goto('missions'));
    await goToDay(page, 1);
    sv = await ev(page, () => window.__blocko.save());
    assert(sv.missions.day !== today && !sv.missions.bonusClaimed && sv.missions.list.length === 3 && sv.missions.list.every((m) => !m.claimed), 'new day → new missions');
    assert((await page.$$('.screen.is-active .mission')).length === 3 && !(await page.$('.screen.is-active .chest-card.is-open')), 'screen re-rendered for the new day');
    assertNoErrors(g, 'missions');
  } finally {
    await g.close();
  }
}
