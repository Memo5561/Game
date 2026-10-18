// E2E reminder soft ask + reminders (§4.15 Popups / Settings): the ask appears only right after a
// daily-reward claim, with gamesPlayed ≥ NOTIF_ASK_MIN_GAMES, never more often than every
// NOTIF_ASK_RETRY_DAYS and at most twice ("Not now" or a denied system dialog); the system
// dialog only after "Yes"; opted-in players get scheduleReminder(REMINDER_DELAY_MINUTES, neutral
// texts) on pause and cancelReminder on resume; Settings: switch off/on, 'denied' → "Open
// settings" → granted on return turns the reminder on.
// Run: node tests/e2e/run.mjs meta-notif
import { CONFIG } from '../../game/js/config.js';
import { openGame, assert, ev, state, idle, waitModal, waitState, tap, assertNoErrors } from './ui.helpers.mjs';
import { unclaimedSave, goToDay, dayOffset, text, recordPlatform, calls, shotB } from './meta.helpers.mjs';

const R = CONFIG.RETENTION;

/** Claims the open calendar; resolves with the modal shown afterwards (or null). */
async function claimAndSettle(page) {
  await waitModal(page, 'dailyReward');
  await tap(page, 'dailyReward.claim');
  await waitState(page, '(st) => !st.modals.includes("dailyReward")');
  await idle(page);
  await page.waitForTimeout(100);
  const s = await state(page);
  return s.modals.length ? s.modals[s.modals.length - 1] : null;
}

const flags = (page) => ev(page, () => window.__blocko.save().flags);
const setPerm = (page, p) => ev(page, (x) => { window.__blocko.platform.info.notificationPermission = x; }, p);

export default async function metaNotifSpec() {
  // --- asking rules ----------------------------------------------------------------------------
  let g = await openGame({ save: unclaimedSave({ stats: { gamesPlayed: R.NOTIF_ASK_MIN_GAMES - 1 } }) });
  try {
    const { page } = g;
    assert(await claimAndSettle(page) === null, 'no ask below NOTIF_ASK_MIN_GAMES');

    await ev(page, (n) => window.__blocko.save({ stats: { gamesPlayed: n } }), R.NOTIF_ASK_MIN_GAMES);
    await goToDay(page, 1);
    assert(await claimAndSettle(page) === 'notifAsk', 'soft ask right after the claim');
    await waitModal(page, 'notifAsk');
    const tomorrow = CONFIG.ECONOMY.DAILY_REWARDS[2];
    const body = await text(page, '[data-modal="notifAsk"] .notif__text');
    assert(body === `Tomorrow: +${tomorrow} coins. Remind me?`, `ask text (${body})`);
    await shotB(page, 'notifAsk-phone');
    await tap(page, 'notifAsk.no');
    await waitState(page, '(st) => st.modals.length === 0');
    let f = await flags(page);
    assert(f.notifDeclines === 1 && f.notifAsked === dayOffset(1) && !f.notifOptIn, `"Not now" recorded (${JSON.stringify(f)})`);

    await goToDay(page, 2);
    assert(await claimAndSettle(page) === null, 'no ask within NOTIF_ASK_RETRY_DAYS');

    // second ask after the retry days: "Yes", but the system dialog is denied
    await goToDay(page, 1 + R.NOTIF_ASK_RETRY_DAYS);
    assert(await claimAndSettle(page) === 'notifAsk', 'asked once more after the retry days');
    await recordPlatform(page, ['requestNotificationPermission'], { requestNotificationPermission: { resolve: false } });
    await tap(page, 'notifAsk.yes');
    await waitState(page, '(st) => st.modals.length === 0');
    await idle(page);
    assert((await ev(page, () => window.__calls.requestNotificationPermission.length)) === 1, 'system dialog only after "Yes"');
    f = await flags(page);
    assert(f.notifDeclines === 2 && !f.notifOptIn, `denied dialog counts as a decline (${JSON.stringify(f)})`);

    await goToDay(page, 2 + 2 * R.NOTIF_ASK_RETRY_DAYS);
    assert(await claimAndSettle(page) === null, 'never more than 2 asks');
    assertNoErrors(g, 'notif rules');
  } finally {
    await g.close();
  }

  // --- "Yes" → permission → reminders on pause; Settings switch; denied → open settings --------
  g = await openGame({ save: unclaimedSave({ stats: { gamesPlayed: R.NOTIF_ASK_MIN_GAMES } }) });
  try {
    const { page } = g;
    assert(await claimAndSettle(page) === 'notifAsk', 'ask after the first claim');
    await recordPlatform(page, ['requestNotificationPermission', 'scheduleReminder', 'cancelReminder', 'openNotificationSettings']);
    await waitModal(page, 'notifAsk');
    await tap(page, 'notifAsk.yes');
    await waitState(page, '(st) => st.modals.length === 0 && st.toasts.some((x) => /Reminder on/.test(x))');
    let f = await flags(page);
    assert(f.notifOptIn === true, 'opted in');
    assert((await ev(page, () => window.__blocko.platform.getNotificationPermission())) === 'granted', 'permission granted (mock)');

    await ev(page, () => window.__blocko.simulate({ type: 'pause' }));
    const sched = await calls(page, 'scheduleReminder');
    assert(sched.length === 1 && sched[0][0] === R.REMINDER_DELAY_MINUTES && sched[0][1] === 'Blocko' && sched[0][2] === 'Your daily puzzles are ready.',
      `reminder scheduled on pause (${JSON.stringify(sched)})`);
    await ev(page, () => window.__blocko.simulate({ type: 'resume' }));
    assert((await calls(page, 'cancelReminder')).length === 1, 'reminder cancelled on resume');

    await goToDay(page, 1);
    assert(await claimAndSettle(page) === null, 'no ask once opted in');

    // Settings: switch shows on → off (no reminder, no further asks) → on again
    await ev(page, () => window.__blocko.goto('settings'));
    await idle(page);
    const sw = () => ev(page, () => document.querySelector('[data-action="settings.notif"]').getAttribute('aria-checked'));
    assert(await sw() === 'true', 'settings: reminder on');
    await tap(page, 'settings.notif');
    await idle(page);
    f = await flags(page);
    assert(await sw() === 'false' && !f.notifOptIn && f.notifDeclines >= 2, `switched off (${JSON.stringify(f)})`);
    assert((await calls(page, 'cancelReminder')).length === 2, 'switching off cancels the reminder');
    await ev(page, () => window.__blocko.simulate({ type: 'pause' }));
    assert((await calls(page, 'scheduleReminder')).length === 1, 'no reminder after opting out');
    await ev(page, () => window.__blocko.simulate({ type: 'resume' }));
    await tap(page, 'settings.notif');
    await idle(page);
    assert(await sw() === 'true' && (await flags(page)).notifOptIn, 'switched on again (already granted: no dialog)');
    assert((await calls(page, 'requestNotificationPermission')).length === 1, 'no further system dialog when already granted (only the one after "Yes")');

    // denied → "Open settings"; granted on return → on
    await ev(page, () => window.__blocko.save({ flags: { notifOptIn: false } }));
    await setPerm(page, 'denied');
    await ev(page, () => window.__blocko.goto('home'));
    await ev(page, () => window.__blocko.goto('settings'));
    await idle(page);
    assert(await ev(page, () => document.querySelector('[data-action="settings.notif"]').hidden), 'denied: switch hidden');
    assert(/system settings/.test(await text(page, '[data-action="settings.notifOpen"]')), 'denied: hint + open settings');
    await shotB(page, 'settings-notif-denied');
    await tap(page, 'settings.notifOpen');
    assert((await calls(page, 'openNotificationSettings')).length === 1, 'openNotificationSettings()');
    await setPerm(page, 'granted');
    await ev(page, () => window.__blocko.simulate({ type: 'pause' }));
    await ev(page, () => window.__blocko.simulate({ type: 'resume' }));
    await idle(page);
    assert(await sw() === 'true' && (await flags(page)).notifOptIn, 'granted in the system settings → reminder on');

    // a denied permission never shows the soft ask
    await ev(page, () => window.__blocko.goto('home'));
    await ev(page, () => window.__blocko.save({ flags: { notifOptIn: false, notifDeclines: 0, notifAsked: null } }));
    await setPerm(page, 'denied');
    await goToDay(page, 2);
    assert(await claimAndSettle(page) === null, 'no ask while denied');
    assertNoErrors(g, 'notif yes');
  } finally {
    await g.close();
  }
}
