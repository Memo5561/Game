// Modal stack (docs/ARCHITECTURE.md §4.15 "Popups": one modal visible at a time).
//
// Modals are opened by id with props; a newer modal covers the previous one (which stays in the
// stack, hidden) and the previous one reappears when the top closes. Only the top modal receives
// actions and Back.
//
// Modal definition (see js/ui/modals/*.js):
//   {
//     id: 'pause',
//     variant: 'sheet' | 'full',            // centred card or full-screen result layout
//     build(props, m, app) → string|Element // dialog content
//     onOpen(m, app)                        // after insertion (start timers, count-ups …)
//     onClose(m, app)                       // cleanup (timers)
//     actions: { name(m, el, app) }         // handles data-action="<id>.<name>" while on top
//     back(m, app)                          // Back key while on top (default: close)
//     pauseTimers(m) / resumeTimers(m)      // optional: app went to background / came back
//   }
// Handle `m`: { id, el, props, data (free scratch object), shownAt (ms, once visible),
//   visible: Promise, closed: Promise, close(result), $(sel) }.

import { animate } from './anim.js';
import { translateDom } from './i18n.js';

export class ModalStack {
  /**
   * @param {HTMLElement} root #modals
   * @param {Object} app
   */
  constructor(root, app) {
    this.root = root;
    this.app = app;
    /** @type {Map<string, Object>} */
    this.defs = new Map();
    /** @type {Object[]} open handles, bottom → top */
    this.stack = [];
    this.animating = 0;
    this._listeners = new Set();
  }

  /** Registers (or replaces) a modal definition. */
  register(def) {
    if (!def || !def.id) throw new Error('ModalStack.register: modal needs an id');
    this.defs.set(def.id, def);
  }

  /** @returns {boolean} any modal open */
  get isOpen() {
    return this.stack.length > 0;
  }

  /** @returns {string[]} open modal ids, bottom → top */
  get ids() {
    return this.stack.map((m) => m.id);
  }

  /** @returns {Object|null} top handle */
  top() {
    return this.stack.length ? this.stack[this.stack.length - 1] : null;
  }

  /** @returns {Object|null} the open handle with this id (topmost) */
  find(id) {
    for (let i = this.stack.length - 1; i >= 0; i--) if (this.stack[i].id === id) return this.stack[i];
    return null;
  }

  /**
   * Opens modal `id` on top of the stack.
   * @param {string} id
   * @param {Object} [props]
   * @returns {Object} handle
   */
  open(id, props = {}) {
    const def = this.defs.get(id);
    if (!def) throw new Error(`ModalStack: unknown modal ${id}`);
    const below = this.top();
    const el = document.createElement('div');
    el.className = `modal modal--${def.variant || 'sheet'}`;
    el.setAttribute('data-modal', id);
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = '<div class="modal__backdrop"></div><div class="modal__dialog" tabindex="-1"></div>';
    const dialog = el.lastElementChild;
    let resolveClosed;
    let resolveVisible;
    const m = {
      id,
      el,
      dialog,
      props,
      data: {},
      shownAt: 0,
      isClosed: false,
      closed: new Promise((r) => { resolveClosed = r; }),
      visible: null,
      close: (result) => this.close(m, result),
      $: (sel) => el.querySelector(sel),
      _resolveClosed: (v) => resolveClosed(v),
      _restoreFocus: document.activeElement,
    };
    m.visible = new Promise((r) => { resolveVisible = r; });
    const content = def.build(props, m, this.app);
    if (typeof content === 'string') dialog.innerHTML = content;
    else if (content) dialog.appendChild(content);
    translateDom(dialog);
    this.stack.push(m);
    this.root.appendChild(el);
    if (below) below.el.classList.add('is-covered');
    this._emit('open', m);
    if (def.onOpen) def.onOpen(m, this.app);
    this.animating++;
    const full = def.variant === 'full';
    Promise.all([
      animate(el.firstElementChild, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 }),
      animate(dialog, full
        ? [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }]
        : [{ opacity: 0, transform: 'scale(0.86)' }, { opacity: 1, transform: 'scale(1)' }],
      { duration: full ? 260 : 300, easing: full ? 'cubic-bezier(.2,.8,.2,1)' : 'cubic-bezier(.3,1.45,.5,1)' }),
    ]).then(() => {
      this.animating--;
      m.shownAt = performance.now();
      resolveVisible();
    });
    // focus the dialog itself (keyboard users tab on from there; no ring on a button)
    try { dialog.focus({ preventScroll: true }); } catch { /* not focusable */ }
    return m;
  }

  /**
   * Closes a modal (handle or id). Resolves when the exit animation finished.
   * @param {Object|string} handleOrId
   * @param {any} [result] resolves `m.closed`
   * @returns {Promise<void>}
   */
  close(handleOrId, result) {
    const m = typeof handleOrId === 'string' ? this.find(handleOrId) : handleOrId;
    if (!m || m.isClosed) return Promise.resolve();
    m.isClosed = true;
    const def = this.defs.get(m.id);
    const idx = this.stack.indexOf(m);
    if (idx >= 0) this.stack.splice(idx, 1);
    if (def && def.onClose) def.onClose(m, this.app);
    const top = this.top();
    if (top) top.el.classList.remove('is-covered');
    m.el.classList.add('is-closing');
    this._emit('close', m);
    m._resolveClosed(result);
    if (m._restoreFocus && document.contains(m._restoreFocus) && !top) {
      try { m._restoreFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
    this.animating++;
    return Promise.all([
      animate(m.el.firstElementChild, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }),
      animate(m.dialog, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.94)' }], { duration: 150, fill: 'forwards' }),
    ]).then(() => {
      this.animating--;
      m.el.remove();
    });
  }

  /** Closes every modal (instantly visible change, exit animations run). */
  closeAll() {
    return Promise.all(this.stack.slice().reverse().map((m) => this.close(m)));
  }

  /**
   * Routes `<id>.<name>` actions to the top modal.
   * @returns {boolean} handled
   */
  dispatch(action, el) {
    const m = this.top();
    if (!m || !action.startsWith(`${m.id}.`)) return false;
    const def = this.defs.get(m.id);
    const name = action.slice(m.id.length + 1);
    const fn = def.actions && (def.actions[name] || def.actions[name.split('.')[0]]);
    if (!fn) return false;
    fn(m, el, this.app, name);
    return true;
  }

  /** Back key for the top modal. @returns {boolean} handled (true whenever a modal is open) */
  back() {
    const m = this.top();
    if (!m) return false;
    const def = this.defs.get(m.id);
    if (def.back) def.back(m, this.app);
    else this.close(m);
    return true;
  }

  /** App went to the background / came back (revive countdown etc.). */
  pauseTimers() {
    for (const m of this.stack) {
      const def = this.defs.get(m.id);
      if (def.pauseTimers) def.pauseTimers(m, this.app);
    }
  }

  resumeTimers() {
    for (const m of this.stack) {
      const def = this.defs.get(m.id);
      if (def.resumeTimers) def.resumeTimers(m, this.app);
    }
  }

  /** Re-translates and lets open modals refresh (language/theme change). */
  refresh(reason) {
    for (const m of this.stack) {
      translateDom(m.dialog);
      const def = this.defs.get(m.id);
      if (def.refresh) def.refresh(m, this.app, reason);
    }
  }

  /** @param {(type: 'open'|'close', m: Object) => void} fn */
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit(type, m) {
    for (const fn of [...this._listeners]) fn(type, m);
  }
}
