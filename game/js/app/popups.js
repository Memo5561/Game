// Automatic popups (docs/ARCHITECTURE.md §4.15 "Popups").
//
// Rules enforced here:
// - auto popups drain ONLY on arrival at the home screen, at most ONE per arrival;
// - never on the first launch (the session that started with the tutorial), never during a run,
//   never while another modal is open;
// - order by priority: dailyReward (30) > levelUp / themeUnlock (20) > notifAsk (10).
//
// A popup kind is registered by the screen/modal that owns it (part B):
//   app.popups.register('dailyReward', {
//     priority: 30,
//     check: (app) => props | null,   // null = nothing to show right now
//     modal: 'dailyReward',           // modal id opened with the props
//     onShown: (props) => {},         // optional: after it was opened (e.g. forget a persisted queue entry)
//   });
// One-off popups produced elsewhere (e.g. a level-up that could not be shown on the run-end
// screen) are queued with app.popups.enqueue(kind, props) and shown on a later home arrival.

export const POPUP_PRIORITY = Object.freeze({ dailyReward: 30, levelUp: 20, themeUnlock: 20, notifAsk: 10 });

export class PopupQueue {
  /** @param {Object} app */
  constructor(app) {
    this.app = app;
    /** @type {Map<string, { priority: number, check?: Function, modal: string }>} */
    this.kinds = new Map();
    /** @type {Array<{ kind: string, props: Object }>} */
    this.queue = [];
    this.enabled = true;
  }

  /**
   * @param {string} kind
   * @param {{ priority?: number, check?: (app: Object) => (Object|null), modal?: string }} def
   */
  register(kind, def) {
    this.kinds.set(kind, {
      priority: def.priority ?? POPUP_PRIORITY[kind] ?? 0,
      check: def.check,
      modal: def.modal || kind,
      onShown: def.onShown,
    });
  }

  /** Queues a one-off popup of a registered kind. */
  enqueue(kind, props = {}) {
    this.queue.push({ kind, props });
  }

  /**
   * Called on every arrival at the home screen. Opens at most one popup.
   * @returns {string|null} kind shown
   */
  drainOnHome() {
    const app = this.app;
    if (!this.enabled || app.firstLaunch || app.modals.isOpen || app.router.current !== 'home') return null;
    const candidates = [];
    for (const [kind, def] of this.kinds) {
      if (!app.modals.defs.has(def.modal)) continue;
      const queued = this.queue.find((q) => q.kind === kind);
      let props = queued ? queued.props : null;
      if (!props && def.check) {
        try {
          props = def.check(app);
        } catch (e) {
          console.error('[popups] check failed', kind, e);
          props = null;
        }
      }
      if (props) candidates.push({ kind, def, props, queued });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.def.priority - a.def.priority);
    const pick = candidates[0];
    if (pick.queued) this.queue.splice(this.queue.indexOf(pick.queued), 1);
    app.modals.open(pick.def.modal, pick.props);
    if (pick.def.onShown) pick.def.onShown(pick.props);
    return pick.kind;
  }
}
