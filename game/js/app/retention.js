// Retention flows of the meta layer (docs/ARCHITECTURE.md §4.15 "Popups"):
//
// - dailyReward (priority 30): the 7-day login calendar opens on arrival at home while today's
//   reward is claimable (only once 'daily_reward' is unlocked). Dismissing it without claiming
//   keeps it out of the auto queue for the rest of the session (the home gift button reopens it).
// - levelUp (priority 20): player level-ups are queued by GameController.finalizeRun (the run-end
//   screen already shows a level-up line) and celebrated on the next arrival at home – never during
//   a run and never stacked on another modal. Several queued level-ups merge into one popup.
// - notifAsk (soft ask): right after a daily-reward claim (never stacked: the calendar closes
//   first) when gamesPlayed >= NOTIF_ASK_MIN_GAMES, the reminder is not on yet, the system
//   permission can still be granted ('prompt', or already 'granted' on Android < 13 where only the
//   in-app opt-in is missing) and at most 2 asks in total, NOTIF_ASK_RETRY_DAYS apart.
//   The system dialog only follows a "Yes".

import { CONFIG } from '../config.js';
import { Platform } from '../platform/bridge.js';
import { requestSave, flushSave } from '../meta/storage.js';
import { daysBetween } from '../meta/progression.js';
import { t } from '../ui/i18n.js';

/** "Not now" answers (incl. a denied system dialog) after which the soft ask never returns. */
export const NOTIF_MAX_ASKS = 2;

/** @param {Object} app */
export function installRetention(app) {
  /** day key whose auto daily-reward popup the player dismissed (session only) */
  let dismissedDay = null;

  app.popups.register('dailyReward', {
    priority: 30,
    modal: 'dailyReward',
    check: (a) => {
      const P = a.progression;
      if (!P.isFeatureUnlocked('daily_reward')) return null;
      if (dismissedDay === a.clock.today()) return null;
      return P.dailyRewardStatus().available ? { auto: true } : null;
    },
  });
  app.popups.register('levelUp', { priority: 20, modal: 'levelUp' });

  app.retention = {
    /** The auto-opened calendar was closed without claiming (stays out of the queue today). */
    dismissDailyReward() {
      dismissedDay = app.clock.today();
    },

    /**
     * Queues (or merges into the queued) level-up celebration.
     * @param {{ levels: number[], coins: number, themes: string[] }} info
     */
    queueLevelUp(info) {
      if (!info || !info.levels || !info.levels.length) return;
      const q = app.popups.queue.find((x) => x.kind === 'levelUp');
      if (q) {
        q.props.levels = q.props.levels.concat(info.levels);
        q.props.coins += info.coins || 0;
        q.props.themes = q.props.themes.concat(info.themes || []);
      } else {
        app.popups.enqueue('levelUp', { levels: info.levels.slice(), coins: info.coins || 0, themes: (info.themes || []).slice() });
      }
    },

    shouldAskNotif: () => shouldAskNotif(app),

    /**
     * Soft ask answered.
     * @param {boolean} yes
     * @returns {Promise<boolean>} reminders are on now
     */
    async answerNotif(yes) {
      const flags = app.save.flags;
      flags.notifAsked = app.clock.today();
      let on = false;
      if (yes) on = await enableReminders(app);
      if (!on) flags.notifDeclines = (Number(flags.notifDeclines) || 0) + 1;
      flushSave(app.save);
      return on;
    },

    enableReminders: () => enableReminders(app),

    /** Settings switch off: no reminders and no further soft asks. */
    disableReminders() {
      const flags = app.save.flags;
      flags.notifOptIn = false;
      flags.notifDeclines = Math.max(Number(flags.notifDeclines) || 0, NOTIF_MAX_ASKS);
      requestSave(app.save);
      Platform.cancelReminder();
    },
  };
}

/** Conditions of the notification soft ask (see the header). */
export function shouldAskNotif(app) {
  const save = app.save;
  const flags = save.flags;
  if (flags.notifOptIn) return false;
  if (save.stats.gamesPlayed < CONFIG.RETENTION.NOTIF_ASK_MIN_GAMES) return false;
  if ((Number(flags.notifDeclines) || 0) >= NOTIF_MAX_ASKS) return false;
  const perm = Platform.getNotificationPermission();
  if (perm !== 'prompt' && perm !== 'granted') return false;
  if (flags.notifAsked) {
    const gap = daysBetween(flags.notifAsked, app.clock.today());
    if (!(gap >= CONFIG.RETENTION.NOTIF_ASK_RETRY_DAYS)) return false;
  }
  return true;
}

/**
 * Turns the daily reminder on: asks the system permission if needed (only ever after the player
 * chose it), then sets flags.notifOptIn.
 * @returns {Promise<boolean>} on
 */
async function enableReminders(app) {
  let perm = Platform.getNotificationPermission();
  if (perm === 'prompt') {
    let granted = false;
    try {
      granted = await Platform.requestNotificationPermission();
    } catch (e) {
      console.error('[retention] notification permission failed', e);
    }
    perm = granted ? 'granted' : Platform.getNotificationPermission();
  }
  app.notifPermission = perm;
  const on = perm === 'granted';
  if (on) {
    app.save.flags.notifOptIn = true;
    requestSave(app.save);
    app.toast(t('toast.reminderOn'), { icon: 'bell', tone: 'good' });
  }
  return on;
}
