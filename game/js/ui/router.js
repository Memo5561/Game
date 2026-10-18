// Screen router: one full-viewport screen (`<section class="screen" data-screen="id">`) is active
// at a time; switching cross-fades the two screens (transform/opacity only).
//
// Screen definition (see js/ui/screens/*.js):
//   {
//     id: 'shop',
//     build(app) → HTMLElement            // called once, lazily, on the first visit
//     enter(params, app)                  // every time the screen becomes active (refresh data here)
//     leave(app)                          // when another screen becomes active
//     refresh(reason, app)                // reason: 'lang' | 'theme' | 'day' | 'coins' | 'data'
//     back(app) → boolean                 // optional; true = handled (default: go home)
//   }

import { animate } from './anim.js';
import { translateDom } from './i18n.js';

export class Router {
  /**
   * @param {HTMLElement} root container of all screens (#app)
   * @param {Object} app passed to the screen hooks
   */
  constructor(root, app) {
    this.root = root;
    this.app = app;
    /** @type {Map<string, Object>} */
    this.defs = new Map();
    /** @type {Map<string, HTMLElement>} */
    this.els = new Map();
    /** @type {string|null} */
    this.current = null;
    this.transitioning = false;
    this._listeners = new Set();
  }

  /** Registers (or replaces) a screen definition. */
  register(def) {
    if (!def || !def.id) throw new Error('Router.register: screen needs an id');
    const old = this.els.get(def.id);
    if (old && this.current !== def.id) {
      old.remove();
      this.els.delete(def.id);
    }
    this.defs.set(def.id, def);
  }

  /** @returns {HTMLElement} the screen element (built on demand) */
  el(id) {
    let el = this.els.get(id);
    if (el) return el;
    const def = this.defs.get(id);
    if (!def) throw new Error(`Router: unknown screen ${id}`);
    el = def.build(this.app);
    translateDom(el);
    el.classList.add('screen');
    el.setAttribute('data-screen', id);
    this.root.appendChild(el);
    this.els.set(id, el);
    return el;
  }

  /**
   * Activates screen `id`.
   * @param {string} id
   * @param {Object} [params] forwarded to enter()
   * @param {{ instant?: boolean }} [opts]
   */
  go(id, params, { instant = false } = {}) {
    const def = this.defs.get(id);
    if (!def) throw new Error(`Router: unknown screen ${id}`);
    const prevId = this.current;
    const next = this.el(id);
    if (prevId === id) {
      if (def.enter) def.enter(params || {}, this.app);
      return;
    }
    const prev = prevId ? this.els.get(prevId) : null;
    if (prev && this.defs.get(prevId).leave) this.defs.get(prevId).leave(this.app);
    this.current = id;
    next.classList.add('is-active');
    next.removeAttribute('aria-hidden');
    if (def.enter) def.enter(params || {}, this.app);
    for (const fn of [...this._listeners]) fn(id, prevId);
    if (!prev) return;
    prev.setAttribute('aria-hidden', 'true');
    if (instant) {
      prev.classList.remove('is-active');
      return;
    }
    this.transitioning = true;
    prev.classList.add('is-leaving');
    const back = id === 'home';
    animate(next, [
      { opacity: 0, transform: `translateX(${back ? -24 : 24}px)` },
      { opacity: 1, transform: 'none' },
    ], { duration: 220 });
    animate(prev, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).then(() => {
      prev.classList.remove('is-leaving');
      if (this.current !== prevId) prev.classList.remove('is-active');
      prev.getAnimations().forEach((a) => a.cancel());
      this.transitioning = false;
    });
  }

  /** Calls refresh(reason) on the active screen (and drops cached hidden screens' state). */
  refresh(reason) {
    for (const [id, def] of this.defs) {
      if (!this.els.has(id) || !def.refresh) continue;
      if (id === this.current || reason === 'lang' || reason === 'theme') def.refresh(reason, this.app);
    }
  }

  /** Back for the active screen: the screen's back() or → home. @returns {boolean} handled */
  back() {
    const def = this.defs.get(this.current);
    if (def && def.back && def.back(this.app)) return true;
    if (this.current !== 'home') {
      this.go('home');
      return true;
    }
    return false;
  }

  /** @param {(id: string, prev: string|null) => void} fn @returns {() => void} */
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
}
