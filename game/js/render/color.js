// Small color helpers for sprite generation (render-time only, never per frame).
// Colors are '#RRGGBB' strings or [r, g, b] arrays (0..255).

/**
 * @param {string|number[]} c '#RGB', '#RRGGBB' or [r, g, b]
 * @returns {number[]} [r, g, b]
 */
export function rgb(c) {
  if (Array.isArray(c)) return c;
  let h = String(c).trim().replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** @returns {string} '#rrggbb' */
export function hex(c) {
  const [r, g, b] = rgb(c);
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** @returns {string} 'rgba(r,g,b,a)' */
export function rgba(c, a = 1) {
  const [r, g, b] = rgb(c);
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${+a.toFixed(3)})`;
}

/** Linear mix of two colors (t = 0 → a, t = 1 → b). @returns {string} hex */
export function mix(a, b, t) {
  const A = rgb(a);
  const B = rgb(b);
  return hex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}

/** @returns {string} the color mixed toward white by t */
export function lighten(c, t) {
  return mix(c, '#ffffff', t);
}

/** @returns {string} the color mixed toward black by t */
export function darken(c, t) {
  return mix(c, '#000000', t);
}

/** Relative luminance-ish brightness 0..1 (Rec. 601 weights, fast). */
export function brightness(c) {
  const [r, g, b] = rgb(c);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Grey with the same perceived brightness, optionally tinted (for game-over / dimmed pieces).
 * @param {string} c
 * @param {string} [tint] color the grey leans toward
 * @param {number} [tintAmount]
 * @param {[number, number]} [range] output brightness range (compresses contrast)
 */
export function greyOf(c, tint = '#8890b0', tintAmount = 0.18, range = [0.42, 0.72]) {
  const l = brightness(c);
  const v = (range[0] + (range[1] - range[0]) * l) * 255;
  return mix([v, v, v], tint, tintAmount);
}

/**
 * Adjusts saturation in HSL space (amount > 0 more saturated, < 0 less).
 * @returns {string} hex
 */
export function saturate(c, amount) {
  const [r, g, b] = rgb(c).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  s = Math.max(0, Math.min(1, s * (1 + amount)));
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) return hex([l * 255, l * 255, l * 255]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return hex([hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255]);
}
