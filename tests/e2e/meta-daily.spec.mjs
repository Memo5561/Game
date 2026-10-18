// E2E 7-day login calendar (§1, §4.9, popup 'dailyReward'): auto popup on arrival at home (never
// during a run), day-by-day progression with setNow (days 1–7, chest with boosters on day 7, the
// cycle restarts with the streak counting on), the grace day ("Streak saved!"), a reset after a gap
// of ≥ 3 days, "Watch ad: ×2" (placement daily_double), dismissing (no second auto popup that day;
// the home gift button reopens it) and the read-only calendar once claimed.
// Run: node tests/e2e/run.mjs meta-daily
import { CONFIG } from '../../game/js/config.js';
import { openGame, assert, ev, state, idle, waitModal, waitState, tap, recordAds, adLog, assertNoErrors } from './ui.helpers.mjs';
import { unclaimedSave, goToDay, dayOffset, text, back, shotB } from './meta.helpers.mjs';

const REWARDS = CONFIG.ECONOMY.DAILY_REWARDS;

async function todayCell(page) {
  return ev(page, () => {
    const el = document.querySelector('[data-modal="dailyReward"] .dday.is-today');
    return el ? Number(el.getAttribute('data-day')) : 0;
  });
}

async function claimedCells(page) {
  return ev(page, () => document.querySelectorAll('[data-modal="dailyReward"] .dday.is-claimed').length);
}

/** Taps Claim and waits until the sheet is gone; returns the save afterwards. */
async function claim(page, action = 'dailyReward.claim') {
  await tap(page, action);
  await waitState(page, '(st) => st.modals.length === 0');
  await idle(page);
  return ev(page, () => window.__blocko.save());
}

export default async function metaDailySpec() {
  // notifDeclines 2: the reminder soft ask never follows a claim here (see meta-notif)
  const g = await openGame({ save: unclaimedSave({ coins: 0, flags: { notifDeclines: 2 } }) });
  const { page } = g;
  try {
    await recordAds(page);
    // --- day 1: auto popup at boot ---------------------------------------------------------------
    await waitModal(page, 'dailyReward');
    let s = await state(page);
    assert(s.screen === 'home' && s.modals.join() === 'dailyReward', `popup on arrival at home (${s.modals})`);
    assert(await todayCell(page) === 1 && await claimedCells(page) === 0, 'day 1 highlighted, nothing claimed');
    assert(/Come back every day/.test(await text(page, '[data-modal="dailyReward"] .daily__sub')), 'first-day text');
    assert(await page.$('.screen.is-active .gift-btn.is-ready'), 'home gift shows the ready dot');
    await shotB(page, 'daily-day1');
    let sv = await claim(page);
    let coins = REWARDS[0];
    assert(sv.coins === coins && sv.daily.day === 1 && sv.daily.streak === 1 && sv.daily.lastClaimDay === dayOffset(0), `day 1 claimed (${JSON.stringify(sv.daily)}, ${sv.coins})`);
    assert(!(await page.$('.screen.is-active .gift-btn.is-ready')), 'gift dot gone after the claim');

    // --- read-only calendar from the gift button -------------------------------------------------
    await tap(page, 'home.dailyReward');
    await waitModal(page, 'dailyReward');
    assert(/Next reward in/.test(await text(page, '[data-modal="dailyReward"] .daily__sub')), 'read-only: time to the next reward');
    assert(!(await page.$('[data-modal="dailyReward"] [data-action="dailyReward.claim"]')), 'read-only: no Claim');
    assert(await claimedCells(page) === 1, 'read-only: day 1 checked');
    await tap(page, 'dailyReward.close');
    await waitState(page, '(st) => st.modals.length === 0');

    // --- never during a run: the next day arrives while playing ----------------------------------
    await tap(page, 'home.play');
    await waitState(page, '(st) => st.screen === "game" && st.session && st.session.status === "playing"');
    await goToDay(page, 1);
    s = await state(page);
    assert(s.modals.length === 0, `no popup during a run (${s.modals})`);
    await tap(page, 'game.pause');
    await waitModal(page, 'pause');
    await tap(page, 'pause.home');
    await waitModal(page, 'dailyReward');

    // --- days 2..7 -------------------------------------------------------------------------------
    for (let day = 2; day <= 7; day++) {
      if (day > 2) {
        await goToDay(page, day - 1);
        await waitModal(page, 'dailyReward');
      }
      assert(await todayCell(page) === day, `day ${day} highlighted (${await todayCell(page)})`);
      assert(await claimedCells(page) === day - 1, `days 1..${day - 1} checked`);
      if (day === 7) await shotB(page, 'daily-day7');
      const boosters = sv.boosters;
      sv = await claim(page);
      coins += REWARDS[day - 1];
      assert(sv.coins === coins && sv.daily.day === day && sv.daily.streak === day, `day ${day}: coins ${sv.coins} / ${coins}, streak ${sv.daily.streak}`);
      if (day === 7) {
        const gift = CONFIG.ECONOMY.DAILY_REWARD_DAY7_BOOSTERS;
        assert(sv.boosters.hammer === boosters.hammer + gift.hammer && sv.boosters.shuffle === boosters.shuffle + gift.shuffle, 'day 7 chest boosters');
        s = await state(page);
        assert(s.toasts.some((x) => /Hammer/.test(x) && /Shuffle/.test(x)), 'booster toast');
      }
    }

    // --- after day 7 → day 1 again, the streak keeps counting ------------------------------------
    await goToDay(page, 7);
    await waitModal(page, 'dailyReward');
    assert(await todayCell(page) === 1 && await claimedCells(page) === 0, 'new cycle starts at day 1');
    assert(/7 days in a row/.test(await text(page, '[data-modal="dailyReward"] .daily__sub')), 'streak text');
    sv = await claim(page);
    coins += REWARDS[0];
    assert(sv.daily.day === 1 && sv.daily.streak === 8 && sv.coins === coins, `cycle restart keeps the streak (${JSON.stringify(sv.daily)})`);

    // --- grace day: one day skipped → next day, "Streak saved!" ----------------------------------
    await goToDay(page, 9);
    await waitModal(page, 'dailyReward');
    assert(await todayCell(page) === 2, 'grace: continues with day 2');
    assert(/streak is safe/.test(await text(page, '[data-modal="dailyReward"] .daily__sub')), 'grace text');
    sv = await claim(page);
    coins += REWARDS[1];
    s = await state(page);
    assert(s.toasts.includes('Streak saved!'), `"Streak saved!" toast (${s.toasts})`);
    assert(sv.daily.day === 2 && sv.daily.streak === 9 && sv.coins === coins, `grace keeps the streak (${JSON.stringify(sv.daily)})`);

    // --- gap of 3 days → back to day 1, streak reset; "Watch ad: ×2" -----------------------------
    await goToDay(page, 12);
    await waitModal(page, 'dailyReward');
    assert(await todayCell(page) === 1 && await claimedCells(page) === 0, 'gap ≥ 3: day 1');
    assert(/Come back every day/.test(await text(page, '[data-modal="dailyReward"] .daily__sub')), 'reset text');
    const armed = await ev(page, () => document.querySelector('[data-action="dailyReward.double"]').getAttribute('aria-disabled'));
    assert(armed === 'true', 'auto-opened: ad button arming');
    await page.waitForTimeout(CONFIG.ADS.AD_BUTTON_ARM_MS + 100);
    sv = await claim(page, 'dailyReward.double');
    coins += REWARDS[0] * 2;
    assert(sv.coins === coins && sv.daily.streak === 1, `×2 claim (${sv.coins} / ${coins})`);
    assert((await adLog(page)).join() === 'Rewarded (daily_double)', `one rewarded video (${await adLog(page)})`);
    assert(sv.ads.lastRewardedAt > 0, 'markRewardedShown');

    // --- dismiss: Back closes, no second auto popup that day, the gift reopens it ----------------
    await goToDay(page, 13);
    await waitModal(page, 'dailyReward');
    await back(page);
    s = await state(page);
    assert(s.modals.length === 0, 'back closes the calendar');
    assert((await ev(page, () => window.__blocko.save().daily.lastClaimDay)) === dayOffset(12), 'dismiss claims nothing');
    await ev(page, () => window.__blocko.goto('settings'));
    await idle(page);
    await tap(page, 'nav.back');
    await waitState(page, '(st) => st.screen === "home"');
    await page.waitForTimeout(150);
    s = await state(page);
    assert(s.modals.length === 0, `no second auto popup the same day (${s.modals})`);
    assert(await page.$('.screen.is-active .gift-btn.is-ready'), 'gift dot still on');
    await tap(page, 'home.dailyReward');
    await waitModal(page, 'dailyReward');
    assert(await todayCell(page) === 2, 'reopened from the gift: day 2');
    assert((await ev(page, () => document.querySelector('[data-action="dailyReward.double"]')?.getAttribute('aria-disabled') ?? null)) === null, 'user-opened: ad button armed at once');
    sv = await claim(page);
    coins += REWARDS[1];
    assert(sv.coins === coins && sv.daily.day === 2, 'claimed from the gift button');
    assertNoErrors(g, 'meta-daily');
  } finally {
    await g.close();
  }
}
