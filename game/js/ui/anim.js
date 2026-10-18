// UI animation helpers shared by screens, modals and the HUD.
//
// All UI motion goes through these helpers so the debug API can speed everything up together
// with the canvas renderer (`setAnimScale` mirrors Renderer.timeScale: 1 normal, 20 fast, 0 instant).
// Motion uses the Web Animations API (transform/opacity only → no layout work) and RAF; nothing
// here reads layout.

let scale = 1;

/** @param {number} x 1 = normal speed, >1 faster, 0 = instant */
export function setAnimScale(x) {
  scale = Number.isFinite(x) && x >= 0 ? x : 1;
}

/** Scaled duration in ms (0 when instant). */
export function dur(ms) {
  return scale <= 0 ? 0 : ms / scale;
}

/**
 * Promise that resolves after `ms` (scaled).
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function wait(ms) {
  const d = dur(ms);
  return new Promise((resolve) => (d <= 0 ? resolve() : setTimeout(resolve, d)));
}

/**
 * Element.animate with a scaled duration/delay. Resolves when finished (or immediately if the
 * element can't animate). Never rejects.
 * @param {Element} el
 * @param {Keyframe[]} keyframes
 * @param {KeyframeAnimationOptions} [opts]
 * @returns {Promise<void>}
 */
export function animate(el, keyframes, opts = {}) {
  if (!el || typeof el.animate !== 'function') return Promise.resolve();
  const o = { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'none', ...opts };
  o.duration = dur(o.duration);
  if (o.delay) o.delay = dur(o.delay);
  try {
    const a = el.animate(keyframes, o);
    return a.finished.then(() => {}, () => {});
  } catch {
    return Promise.resolve();
  }
}

/** Short "pop" bump (e.g. a counter that changed). */
export function pop(el, amount = 1.25) {
  return animate(el, [{ transform: 'scale(1)' }, { transform: `scale(${amount})` }, { transform: 'scale(1)' }], {
    duration: 320, easing: 'cubic-bezier(.3,1.6,.5,1)',
  });
}

/** Horizontal shake (e.g. "not enough coins"). */
export function shake(el) {
  return animate(el, [
    { transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' },
    { transform: 'translateX(-4px)' }, { transform: 'translateX(0)' },
  ], { duration: 300, easing: 'linear' });
}

const counters = new WeakMap();

/**
 * Counts a number up (or down) in `el.textContent` with an ease-out curve. Starting a new count on
 * the same element continues from the value currently shown.
 * @param {Element} el
 * @param {number} to
 * @param {{ from?: number, ms?: number, format?: (n: number) => string }} [opts]
 * @returns {Promise<void>}
 */
export function countUp(el, to, { from, ms = 500, format = String } = {}) {
  const prev = counters.get(el);
  if (prev) prev.cancel();
  const start = from ?? (prev ? prev.value : Number(el.dataset.value ?? to));
  const d = dur(ms);
  el.dataset.value = String(to);
  if (d <= 0 || start === to) {
    el.textContent = format(to);
    counters.delete(el);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const state = { value: start, raf: 0, cancel: () => { cancelAnimationFrame(state.raf); resolve(); } };
    counters.set(el, state);
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / d);
      const e = 1 - (1 - k) * (1 - k) * (1 - k);
      state.value = Math.round(start + (to - start) * e);
      el.textContent = format(state.value);
      if (k < 1) state.raf = requestAnimationFrame(step);
      else {
        counters.delete(el);
        resolve();
      }
    };
    state.raf = requestAnimationFrame(step);
  });
}
