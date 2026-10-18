// Non-blocking toasts at the top of the screen (rewards, mission completed, info). They never take
// input, so they are allowed during a run.

import { icon } from './icons.js';
import { esc } from './dom.js';
import { animate, dur } from './anim.js';

const MAX = 3;

export class Toasts {
  /** @param {HTMLElement} root #toasts */
  constructor(root) {
    this.root = root;
  }

  /**
   * @param {string} text already translated
   * @param {{ icon?: string, tone?: 'info'|'good'|'warn', ms?: number }} [opts]
   */
  show(text, { icon: ic = '', tone = 'info', ms = 2400 } = {}) {
    while (this.root.children.length >= MAX) this.root.firstElementChild.remove();
    const el = document.createElement('div');
    el.className = `toast toast--${tone}`;
    el.setAttribute('role', 'status');
    el.innerHTML = `${ic ? icon(ic, 'toast__icon') : ''}<span class="toast__text">${esc(text)}</span>`;
    this.root.appendChild(el);
    animate(el, [{ opacity: 0, transform: 'translateY(-12px) scale(.96)' }, { opacity: 1, transform: 'none' }], {
      duration: 260, easing: 'cubic-bezier(.3,1.4,.5,1)',
    });
    setTimeout(() => {
      animate(el, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(-8px)' }], { duration: 220, fill: 'forwards' })
        .then(() => el.remove());
    }, Math.max(300, dur(ms) || 300));
    return el;
  }
}
