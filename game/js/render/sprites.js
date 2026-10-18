// Sprite painting and caching for the canvas renderer.
//
// Everything that looks expensive (gradients, shadows, blur, text) is painted ONCE into offscreen
// <canvas> sprites when the theme, the layout or the device pixel ratio changes. The per-frame
// renderer only calls drawImage() with these sprites (docs/ARCHITECTURE.md §4.12 "Performance").
//
// Sizes: painters work in device pixels; `SpriteSet` records the CSS size each sprite represents.

import { rgb, rgba, mix, lighten, darken, greyOf, saturate } from './color.js';
import { BOARD_PAD } from './layout.js';

export { BOARD_PAD };

/** Gem type → gradient stops (fixed across themes: diamond blue, star gold, heart red). */
const GEM_COLORS = Object.freeze({
  1: ['#C4F1FF', '#4FB3FF', '#1A5FE0'],
  2: ['#FFF6B8', '#FFC81F', '#F08A00'],
  3: ['#FFB0C4', '#F5386A', '#B80F3C'],
});

/** Praise level → text gradient stops + glow (index = PRAISE_LEVELS index). */
export const PRAISE_STYLES = Object.freeze({
  good: { stops: ['#E9FFB0', '#7BEA5A', '#25B84F'], glow: '#5BFF8A' },
  great: { stops: ['#E3FBFF', '#62D8FF', '#1E8FF0'], glow: '#4FD2FF' },
  excellent: { stops: ['#FFE3FB', '#FF8AE6', '#B44BFF'], glow: '#E26BFF' },
  amazing: { stops: ['#FFF8C2', '#FFC93C', '#FF7A1A'], glow: '#FFB12E' },
  unbelievable: { stops: ['#FF6B8B', '#FFC93C', '#5BEA7A', '#4FD2FF', '#B86BFF'], glow: '#FFFFFF', rainbow: true },
});

const FONT_FAMILY = "Nunito, 'Trebuchet MS', system-ui, sans-serif";

// ---------------------------------------------------------------------------------------------
// Basic helpers
// ---------------------------------------------------------------------------------------------

/** @returns {HTMLCanvasElement} */
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** Rounded-rectangle path (works on WebView 90, which lacks ctx.roundRect). */
export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Deterministic small PRNG for decorative randomness (mulberry32). */
export function makeRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 4-point sparkle star path centred at (cx, cy). */
function sparklePath(ctx, cx, cy, r, waist = 0.22) {
  const w = r * waist;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx + w, cy - w, cx + r, cy);
  ctx.quadraticCurveTo(cx + w, cy + w, cx, cy + r);
  ctx.quadraticCurveTo(cx - w, cy + w, cx - r, cy);
  ctx.quadraticCurveTo(cx - w, cy - w, cx, cy - r);
  ctx.closePath();
}

/** Shade set of a palette color: explicit theme gradient pair or derived. */
export function blockShades(theme, color) {
  const base = theme.palette[color] || theme.palette[0];
  const pair = theme.shades && theme.shades[color];
  return {
    base,
    top: pair ? pair[0] : lighten(base, 0.38),
    bottom: pair ? pair[1] : darken(base, 0.14),
  };
}

// ---------------------------------------------------------------------------------------------
// Block painters (one per theme style). All draw a block into the cell box (x, y, s, s).
// ---------------------------------------------------------------------------------------------

function paintJewel(ctx, x, y, s, top, bottom) {
  const g = s * 0.045;
  const w = s - 2 * g;
  const r = s * 0.19;
  const bx = x + g;
  const by = y + g;
  const lip = Math.max(1, s * 0.095);
  ctx.save();
  roundRect(ctx, bx, by, w, w, r);
  ctx.clip();
  // darker bottom lip (block thickness)
  ctx.fillStyle = darken(bottom, 0.32);
  ctx.fillRect(bx, by, w, w);
  // light top rim
  roundRect(ctx, bx, by, w, w - lip, r);
  ctx.fillStyle = lighten(top, 0.55);
  ctx.fill();
  // face gradient
  const face = ctx.createLinearGradient(0, by, 0, by + w - lip);
  face.addColorStop(0, top);
  face.addColorStop(1, bottom);
  roundRect(ctx, bx, by + Math.max(1, s * 0.03), w, w - lip - Math.max(1, s * 0.03), r * 0.95);
  ctx.fillStyle = face;
  ctx.fill();
  // glossy shine band (as on the app icon)
  const sh = ctx.createLinearGradient(0, by + w * 0.07, 0, by + w * 0.45);
  sh.addColorStop(0, 'rgba(255,255,255,0.72)');
  sh.addColorStop(1, 'rgba(255,255,255,0)');
  roundRect(ctx, bx + w * 0.11, by + w * 0.07, w * 0.78, w * 0.36, s * 0.13);
  ctx.fillStyle = sh;
  ctx.fill();
  ctx.restore();
  // specular glint
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  sparklePath(ctx, bx + w * 0.24, by + w * 0.22, s * 0.075, 0.3);
  ctx.fill();
}

function paintCandy(ctx, x, y, s, base) {
  const g = s * 0.05;
  const w = s - 2 * g;
  const r = s * 0.32;
  const bx = x + g;
  const by = y + g;
  const lip = Math.max(1, s * 0.08);
  ctx.save();
  roundRect(ctx, bx, by, w, w, r);
  ctx.clip();
  ctx.fillStyle = darken(base, 0.18);
  ctx.fillRect(bx, by, w, w);
  const face = ctx.createLinearGradient(0, by, 0, by + w);
  face.addColorStop(0, lighten(base, 0.42));
  face.addColorStop(0.55, lighten(base, 0.08));
  face.addColorStop(1, base);
  roundRect(ctx, bx, by, w, w - lip, r);
  ctx.fillStyle = face;
  ctx.fill();
  // jelly gloss
  const gl = ctx.createLinearGradient(0, by + w * 0.08, 0, by + w * 0.5);
  gl.addColorStop(0, 'rgba(255,255,255,0.85)');
  gl.addColorStop(1, 'rgba(255,255,255,0.05)');
  ctx.beginPath();
  ctx.ellipse(bx + w * 0.5, by + w * 0.3, w * 0.36, w * 0.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = gl;
  ctx.fill();
  // soft inner glow at the bottom (translucent candy)
  const bl = ctx.createRadialGradient(bx + w * 0.5, by + w * 0.95, 0, bx + w * 0.5, by + w * 0.95, w * 0.55);
  bl.addColorStop(0, rgba(lighten(base, 0.5), 0.55));
  bl.addColorStop(1, rgba(lighten(base, 0.5), 0));
  ctx.fillStyle = bl;
  ctx.fillRect(bx, by, w, w);
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.arc(bx + w * 0.24, by + w * 0.26, s * 0.055, 0, Math.PI * 2);
  ctx.fill();
}

function paintNeon(ctx, x, y, s, base) {
  const g = s * 0.1;
  const w = s - 2 * g;
  const r = s * 0.16;
  const bx = x + g;
  const by = y + g;
  const lw = Math.max(1.5, s * 0.07);
  // dark tinted body
  roundRect(ctx, bx, by, w, w, r);
  ctx.fillStyle = mix(base, '#000000', 0.78);
  ctx.fill();
  // inner color wash
  const wash = ctx.createLinearGradient(0, by, 0, by + w);
  wash.addColorStop(0, rgba(base, 0.42));
  wash.addColorStop(1, rgba(base, 0.1));
  ctx.fillStyle = wash;
  ctx.fill();
  // glow + tube (shadowBlur only while painting the cache)
  ctx.save();
  ctx.shadowColor = base;
  ctx.shadowBlur = s * 0.22;
  ctx.strokeStyle = base;
  ctx.lineWidth = lw;
  roundRect(ctx, bx, by, w, w, r);
  ctx.stroke();
  ctx.stroke();
  ctx.restore();
  // hot white core of the tube
  ctx.strokeStyle = rgba(lighten(base, 0.7), 0.95);
  ctx.lineWidth = Math.max(1, s * 0.022);
  roundRect(ctx, bx, by, w, w, r);
  ctx.stroke();
  // reflection dash
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.beginPath();
  ctx.moveTo(bx + w * 0.22, by + w * 0.2);
  ctx.lineTo(bx + w * 0.42, by + w * 0.2);
  ctx.stroke();
}

function paintWood(ctx, x, y, s, base, seed) {
  const g = s * 0.04;
  const w = s - 2 * g;
  const r = s * 0.11;
  const bx = x + g;
  const by = y + g;
  const wood = mix(base, '#9A6332', 0.16);
  const rnd = makeRandom(1000 + seed * 7919);
  ctx.save();
  roundRect(ctx, bx, by, w, w, r);
  ctx.clip();
  const face = ctx.createLinearGradient(bx, by, bx + w, by + w);
  face.addColorStop(0, lighten(wood, 0.14));
  face.addColorStop(1, darken(wood, 0.14));
  ctx.fillStyle = face;
  ctx.fillRect(bx, by, w, w);
  // grain
  const lines = 7;
  for (let k = 0; k < lines; k++) {
    const y0 = by + ((k + 0.3 + rnd() * 0.4) / lines) * w;
    const amp = w * (0.02 + rnd() * 0.04);
    const freq = 1.2 + rnd() * 2.2;
    const ph = rnd() * 6.28;
    ctx.beginPath();
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const yy = y0 + Math.sin(t * freq * Math.PI + ph) * amp;
      if (i === 0) ctx.moveTo(bx, yy);
      else ctx.lineTo(bx + t * w, yy);
    }
    ctx.strokeStyle = rgba(darken(wood, 0.45), 0.2 + rnd() * 0.15);
    ctx.lineWidth = Math.max(0.6, s * (0.012 + rnd() * 0.016));
    ctx.stroke();
  }
  if (rnd() < 0.5) {
    const kx = bx + w * (0.25 + rnd() * 0.5);
    const ky = by + w * (0.3 + rnd() * 0.4);
    for (let k = 3; k >= 1; k--) {
      ctx.beginPath();
      ctx.ellipse(kx, ky, w * 0.035 * k, w * 0.02 * k, 0, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(darken(wood, 0.5), 0.22);
      ctx.lineWidth = Math.max(0.6, s * 0.012);
      ctx.stroke();
    }
  }
  // bevel
  const b = s * 0.085;
  const bevel = (pts, color) => {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };
  const x2 = bx + w;
  const y2 = by + w;
  bevel([bx, by, x2, by, x2 - b, by + b, bx + b, by + b], rgba(lighten(wood, 0.5), 0.55));
  bevel([bx, by, bx + b, by + b, bx + b, y2 - b, bx, y2], rgba(lighten(wood, 0.3), 0.4));
  bevel([x2, by, x2, y2, x2 - b, y2 - b, x2 - b, by + b], rgba(darken(wood, 0.35), 0.45));
  bevel([bx, y2, bx + b, y2 - b, x2 - b, y2 - b, x2, y2], rgba(darken(wood, 0.45), 0.6));
  // varnish
  const vg = ctx.createLinearGradient(0, by, 0, by + w * 0.5);
  vg.addColorStop(0, 'rgba(255,255,255,0.22)');
  vg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = vg;
  ctx.fillRect(bx + b, by + b, w - 2 * b, w * 0.4);
  ctx.restore();
  roundRect(ctx, bx, by, w, w, r);
  ctx.strokeStyle = rgba(darken(wood, 0.55), 0.7);
  ctx.lineWidth = Math.max(1, s * 0.025);
  ctx.stroke();
}

/** Pixel-art grid size for a cell of s device px (prefers an integer scale). */
function pixelGrid(s) {
  let best = 10;
  let bestErr = 1e9;
  for (let n = 8; n <= 12; n++) {
    const err = (s % n) / n + Math.abs(n - 10) * 0.01;
    if (err < bestErr) { bestErr = err; best = n; }
  }
  return best;
}

function paintPixel(ctx, x, y, s, base) {
  const n = pixelGrid(Math.round(s));
  const tmp = makeCanvas(n, n);
  const p = tmp.getContext('2d');
  const outline = darken(base, 0.62);
  const light = lighten(base, 0.5);
  const light2 = lighten(base, 0.22);
  const dark = darken(base, 0.32);
  p.fillStyle = outline;
  p.fillRect(0, 0, n, n);
  p.fillStyle = base;
  p.fillRect(1, 1, n - 2, n - 2);
  p.fillStyle = light;
  p.fillRect(1, 1, n - 2, 1);
  p.fillRect(1, 1, 1, n - 2);
  p.fillStyle = light2;
  p.fillRect(2, 2, n - 4, 1);
  p.fillStyle = dark;
  p.fillRect(1, n - 2, n - 2, 1);
  p.fillRect(n - 2, 1, 1, n - 2);
  p.fillStyle = darken(base, 0.15);
  p.fillRect(2, n - 3, n - 4, 1);
  p.fillStyle = '#FFFFFF';
  p.fillRect(2, 2, 2, 1);
  p.fillRect(2, 3, 1, 1);
  // corners transparent → chunky rounded look
  p.clearRect(0, 0, 1, 1);
  p.clearRect(n - 1, 0, 1, 1);
  p.clearRect(0, n - 1, 1, 1);
  p.clearRect(n - 1, n - 1, 1, 1);
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  const g = Math.round(s * 0.03);
  ctx.drawImage(tmp, x + g, y + g, s - 2 * g, s - 2 * g);
  ctx.imageSmoothingEnabled = prev;
}

const GOLD_STOPS = ['#FFF4C8', '#E9C46A', '#A87A1E', '#F7DC8A', '#8C6215'];

function goldGradient(ctx, x, y, w, h) {
  const gr = ctx.createLinearGradient(x, y, x + w, y + h);
  gr.addColorStop(0, GOLD_STOPS[0]);
  gr.addColorStop(0.28, GOLD_STOPS[1]);
  gr.addColorStop(0.55, GOLD_STOPS[2]);
  gr.addColorStop(0.78, GOLD_STOPS[3]);
  gr.addColorStop(1, GOLD_STOPS[4]);
  return gr;
}

function paintGold(ctx, x, y, s, base) {
  const g = s * 0.04;
  const w = s - 2 * g;
  const bx = x + g;
  const by = y + g;
  // gold bezel
  roundRect(ctx, bx, by, w, w, s * 0.12);
  ctx.fillStyle = goldGradient(ctx, bx, by, w, w);
  ctx.fill();
  roundRect(ctx, bx + s * 0.07, by + s * 0.07, w - s * 0.14, w - s * 0.14, s * 0.06);
  ctx.fillStyle = 'rgba(70,45,0,0.75)';
  ctx.fill();
  // cut stone with facets
  const b = s * 0.095;
  const gx = bx + b;
  const gy = by + b;
  const gw = w - 2 * b;
  const t = gw * 0.25;
  const tx = gx + t;
  const ty = gy + t;
  const tw = gw - 2 * t;
  const gem = saturate(base, 0.1);
  const facet = (pts, color) => {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };
  const gx2 = gx + gw;
  const gy2 = gy + gw;
  facet([gx, gy, gx2, gy, tx + tw, ty, tx, ty], lighten(gem, 0.4));
  facet([gx, gy, tx, ty, tx, ty + tw, gx, gy2], lighten(gem, 0.14));
  facet([gx2, gy, gx2, gy2, tx + tw, ty + tw, tx + tw, ty], darken(gem, 0.22));
  facet([gx, gy2, tx, ty + tw, tx + tw, ty + tw, gx2, gy2], darken(gem, 0.45));
  const tg = ctx.createLinearGradient(tx, ty, tx + tw, ty + tw);
  tg.addColorStop(0, lighten(gem, 0.28));
  tg.addColorStop(1, darken(gem, 0.05));
  ctx.fillStyle = tg;
  ctx.fillRect(tx, ty, tw, tw);
  // facet edges
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = Math.max(0.6, s * 0.012);
  ctx.beginPath();
  ctx.moveTo(gx, gy); ctx.lineTo(tx, ty);
  ctx.moveTo(gx2, gy); ctx.lineTo(tx + tw, ty);
  ctx.moveTo(gx, gy2); ctx.lineTo(tx, ty + tw);
  ctx.moveTo(gx2, gy2); ctx.lineTo(tx + tw, ty + tw);
  ctx.rect(tx, ty, tw, tw);
  ctx.stroke();
  // table sheen + glint
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.moveTo(tx, ty); ctx.lineTo(tx + tw * 0.75, ty); ctx.lineTo(tx, ty + tw * 0.75);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  sparklePath(ctx, gx + gw * 0.3, gy + gw * 0.28, s * 0.085, 0.28);
  ctx.fill();
}

/**
 * Paints one block (palette color index or explicit color) into the cell box.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} theme
 * @param {number|string} color palette index, or a color string (used for grey variants)
 * @param {number} x
 * @param {number} y
 * @param {number} s cell size in px
 * @param {{ grey?: boolean }} [opts]
 */
export function paintBlock(ctx, theme, color, x, y, s, opts = {}) {
  const idx = typeof color === 'number' ? color : 0;
  let { base, top, bottom } = typeof color === 'number'
    ? blockShades(theme, color)
    : { base: color, top: lighten(color, 0.38), bottom: darken(color, 0.14) };
  if (opts.grey) {
    base = greyOf(base, theme.greyTint);
    top = greyOf(top, theme.greyTint);
    bottom = greyOf(bottom, theme.greyTint);
  }
  ctx.save();
  switch (theme.style) {
    case 'neon': paintNeon(ctx, x, y, s, base); break;
    case 'candy': paintCandy(ctx, x, y, s, base); break;
    case 'wood': paintWood(ctx, x, y, s, base, idx); break;
    case 'pixel': paintPixel(ctx, x, y, s, base); break;
    case 'gold': paintGold(ctx, x, y, s, base); break;
    default: paintJewel(ctx, x, y, s, top, bottom);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Gems (collectibles drawn on top of blocks)
// ---------------------------------------------------------------------------------------------

function gemFill(ctx, type, cx, cy, d) {
  const st = GEM_COLORS[type];
  const gr = ctx.createLinearGradient(cx - d * 0.3, cy - d * 0.5, cx + d * 0.3, cy + d * 0.5);
  gr.addColorStop(0, st[0]);
  gr.addColorStop(0.45, st[1]);
  gr.addColorStop(1, st[2]);
  return gr;
}

function diamondPath(ctx, cx, cy, d) {
  ctx.beginPath();
  ctx.moveTo(cx - d * 0.5, cy - d * 0.12);
  ctx.lineTo(cx - d * 0.27, cy - d * 0.4);
  ctx.lineTo(cx + d * 0.27, cy - d * 0.4);
  ctx.lineTo(cx + d * 0.5, cy - d * 0.12);
  ctx.lineTo(cx, cy + d * 0.46);
  ctx.closePath();
}

function starPath(ctx, cx, cy, d) {
  const R = d * 0.52;
  const r = R * 0.5;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? R : r;
    const px = cx + Math.cos(a) * rad;
    const py = cy + 0.04 * d + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function heartPath(ctx, cx, cy, d) {
  const w = d * 0.5;
  const top = cy - d * 0.26;
  ctx.beginPath();
  ctx.moveTo(cx, cy + d * 0.42);
  ctx.bezierCurveTo(cx - w * 0.3, cy + d * 0.22, cx - w * 1.08, cy + d * 0.04, cx - w * 1.0, top + d * 0.08);
  ctx.bezierCurveTo(cx - w * 0.95, top - d * 0.18, cx - w * 0.1, top - d * 0.2, cx, top + d * 0.06);
  ctx.bezierCurveTo(cx + w * 0.1, top - d * 0.2, cx + w * 0.95, top - d * 0.18, cx + w * 1.0, top + d * 0.08);
  ctx.bezierCurveTo(cx + w * 1.08, cy + d * 0.04, cx + w * 0.3, cy + d * 0.22, cx, cy + d * 0.42);
  ctx.closePath();
}

/**
 * Paints a gem icon centred in the cell box (x, y, s).
 * @param {CanvasRenderingContext2D} ctx
 * @param {1|2|3} type 1 diamond, 2 star, 3 heart
 */
export function paintGem(ctx, type, x, y, s, scale = 0.64) {
  const d = s * scale;
  const cx = x + s / 2;
  const cy = y + s / 2;
  const path = type === 1 ? diamondPath : type === 2 ? starPath : heartPath;
  ctx.save();
  ctx.lineJoin = 'round';
  // white outline with soft drop shadow
  ctx.shadowColor = 'rgba(10,5,40,0.55)';
  ctx.shadowBlur = s * 0.08;
  ctx.shadowOffsetY = s * 0.03;
  path(ctx, cx, cy, d);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = Math.max(1.5, d * 0.16);
  ctx.stroke();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  path(ctx, cx, cy, d);
  ctx.fillStyle = gemFill(ctx, type, cx, cy, d);
  ctx.fill();
  ctx.clip();
  // facets / highlights
  if (type === 1) {
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = Math.max(0.8, d * 0.035);
    ctx.beginPath();
    ctx.moveTo(cx - d * 0.5, cy - d * 0.12); ctx.lineTo(cx + d * 0.5, cy - d * 0.12);
    ctx.moveTo(cx - d * 0.12, cy - d * 0.4); ctx.lineTo(cx - d * 0.22, cy - d * 0.12); ctx.lineTo(cx, cy + d * 0.46);
    ctx.moveTo(cx + d * 0.12, cy - d * 0.4); ctx.lineTo(cx + d * 0.22, cy - d * 0.12); ctx.lineTo(cx, cy + d * 0.46);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.moveTo(cx - d * 0.27, cy - d * 0.4); ctx.lineTo(cx - d * 0.12, cy - d * 0.4);
    ctx.lineTo(cx - d * 0.22, cy - d * 0.12); ctx.lineTo(cx - d * 0.5, cy - d * 0.12);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(cx - d * 0.16, cy - d * 0.14, d * 0.16, d * 0.09, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Board, empty cells, background
// ---------------------------------------------------------------------------------------------

/** Paints one empty (inset) cell. */
export function paintEmptyCell(ctx, theme, x, y, s) {
  const style = theme.style;
  const g = s * 0.045;
  const w = s - 2 * g;
  const bx = x + g;
  const by = y + g;
  ctx.save();
  if (style === 'pixel') {
    const p = Math.max(1, Math.round(s / 12));
    ctx.fillStyle = darken(theme.cellEmpty, 0.4);
    ctx.fillRect(Math.round(bx), Math.round(by), Math.round(w), Math.round(w));
    ctx.fillStyle = theme.cellEmpty;
    ctx.fillRect(Math.round(bx + p), Math.round(by + p), Math.round(w - p), Math.round(w - p));
    ctx.fillStyle = theme.cellEmptyEdge;
    ctx.fillRect(Math.round(bx + p), Math.round(by + w - p), Math.round(w - p), p);
    ctx.restore();
    return;
  }
  const r = s * (style === 'candy' ? 0.3 : style === 'wood' ? 0.1 : style === 'gold' ? 0.1 : 0.19);
  const d = Math.max(1, s * 0.055);
  roundRect(ctx, bx, by, w, w, r);
  ctx.clip();
  // inset: dark top shadow, light bottom edge
  ctx.fillStyle = darken(theme.cellEmpty, theme.dark ? 0.45 : 0.12);
  ctx.fillRect(bx, by, w, w);
  roundRect(ctx, bx, by + d, w, w, r);
  ctx.fillStyle = theme.cellEmptyEdge;
  ctx.fill();
  roundRect(ctx, bx, by + d, w, w - d - Math.max(1, s * 0.03), r);
  ctx.fillStyle = theme.cellEmpty;
  ctx.fill();
  if (style === 'wood') {
    const rnd = makeRandom(Math.round(x * 13 + y * 7));
    for (let k = 0; k < 4; k++) {
      const yy = by + w * (0.2 + k * 0.2 + rnd() * 0.08);
      ctx.beginPath();
      ctx.moveTo(bx, yy);
      ctx.bezierCurveTo(bx + w * 0.3, yy + w * (rnd() - 0.5) * 0.12, bx + w * 0.7, yy + w * (rnd() - 0.5) * 0.12, bx + w, yy);
      ctx.strokeStyle = rgba(darken(theme.cellEmpty, 0.35), 0.2);
      ctx.lineWidth = Math.max(0.6, s * 0.015);
      ctx.stroke();
    }
  }
  if (style === 'neon') {
    roundRect(ctx, bx + 0.5, by + 0.5, w - 1, w - 1, r);
    ctx.strokeStyle = rgba(theme.accent, 0.1);
    ctx.lineWidth = Math.max(1, s * 0.02);
    ctx.stroke();
  }
  if (style === 'gold') {
    roundRect(ctx, bx + 0.5, by + 0.5, w - 1, w - 1, r);
    ctx.strokeStyle = rgba(theme.boardEdge, 0.14);
    ctx.lineWidth = Math.max(1, s * 0.018);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Paints the board panel (frame + empty cells) with its top-left cell at (ox, oy).
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} theme
 * @param {number} ox x of the first cell (px)
 * @param {number} oy y of the first cell (px)
 * @param {number} cell cell size (px)
 * @param {number} n cells per side
 */
export function paintBoardPanel(ctx, theme, ox, oy, cell, n = 8) {
  const pad = cell * BOARD_PAD;
  const x = ox - pad;
  const y = oy - pad;
  const w = n * cell + 2 * pad;
  const style = theme.style;
  const r = style === 'pixel' ? cell * 0.08 : cell * (style === 'candy' ? 0.5 : 0.36);
  ctx.save();
  // drop shadow
  ctx.shadowColor = theme.dark ? 'rgba(0,0,0,0.5)' : 'rgba(120,60,150,0.28)';
  ctx.shadowBlur = cell * 0.6;
  ctx.shadowOffsetY = cell * 0.16;
  roundRect(ctx, x, y, w, w, r);
  ctx.fillStyle = theme.board;
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, x, y, w, w, r);
  ctx.clip();
  if (style === 'wood') {
    // walnut frame with grain
    const fg = ctx.createLinearGradient(x, y, x + w, y + w);
    fg.addColorStop(0, '#5C3519');
    fg.addColorStop(1, '#2E180A');
    ctx.fillStyle = fg;
    ctx.fillRect(x, y, w, w);
    const rnd = makeRandom(77);
    for (let k = 0; k < 40; k++) {
      const yy = y + rnd() * w;
      ctx.beginPath();
      ctx.moveTo(x, yy);
      ctx.bezierCurveTo(x + w * 0.3, yy + (rnd() - 0.5) * cell * 0.4, x + w * 0.7, yy + (rnd() - 0.5) * cell * 0.4, x + w, yy);
      ctx.strokeStyle = rgba('#1A0C04', 0.18);
      ctx.lineWidth = Math.max(0.6, cell * 0.02);
      ctx.stroke();
    }
    // recessed bed under the cells
    roundRect(ctx, ox - cell * 0.06, oy - cell * 0.06, n * cell + cell * 0.12, n * cell + cell * 0.12, cell * 0.12);
    ctx.fillStyle = darken(theme.cellEmpty, 0.35);
    ctx.fill();
  } else {
    // subtle top sheen on the panel
    const sh = ctx.createLinearGradient(0, y, 0, y + w * 0.5);
    sh.addColorStop(0, theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.5)');
    sh.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(x, y, w, w * 0.5);
  }
  ctx.restore();

  // rim
  ctx.save();
  const lw = Math.max(1.5, cell * (style === 'gold' ? 0.075 : 0.05));
  roundRect(ctx, x + lw / 2, y + lw / 2, w - lw, w - lw, r - lw / 2);
  if (style === 'gold') {
    ctx.strokeStyle = goldGradient(ctx, x, y, w, w);
  } else if (style === 'neon') {
    ctx.shadowColor = theme.boardEdge;
    ctx.shadowBlur = cell * 0.35;
    ctx.strokeStyle = rgba(theme.boardEdge, 0.85);
  } else {
    ctx.strokeStyle = theme.boardEdge;
  }
  ctx.lineWidth = lw;
  ctx.stroke();
  if (style === 'neon') ctx.stroke();
  if (style === 'gold') {
    roundRect(ctx, x + lw * 1.6, y + lw * 1.6, w - lw * 3.2, w - lw * 3.2, r - lw * 1.6);
    ctx.strokeStyle = 'rgba(233,196,106,0.35)';
    ctx.lineWidth = Math.max(1, cell * 0.015);
    ctx.stroke();
  }
  ctx.restore();

  for (let r2 = 0; r2 < n; r2++) {
    for (let c = 0; c < n; c++) paintEmptyCell(ctx, theme, ox + c * cell, oy + r2 * cell, cell);
  }
}

/**
 * Paints the full-canvas background (gradient, glow behind the board, decorative pattern, vignette).
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} theme
 * @param {number} w device px
 * @param {number} h device px
 * @param {{x:number, y:number, size:number, cell:number}} focus board centre and size (device px)
 */
export function paintBackground(ctx, theme, w, h, focus, edge = null) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, theme.bg[0]);
  g.addColorStop(1, theme.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rnd = makeRandom(4242);
  const cell = focus.cell;
  const R = Math.max(w, h) * 0.75;
  const glow = ctx.createRadialGradient(focus.x, focus.y, 0, focus.x, focus.y, R);
  glow.addColorStop(0, rgba(theme.bgGlow, theme.bgGlowAlpha));
  glow.addColorStop(1, rgba(theme.bgGlow, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  switch (theme.bgPattern) {
    case 'sparkle': {
      for (let i = 0; i < 26; i++) {
        const px = rnd() * w;
        const py = rnd() * h;
        const big = rnd() < 0.3;
        ctx.fillStyle = `rgba(255,255,255,${(big ? 0.22 : 0.12) + rnd() * 0.12})`;
        if (big) {
          sparklePath(ctx, px, py, cell * (0.12 + rnd() * 0.14), 0.22);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(px, py, Math.max(1, cell * 0.035), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'grid': {
      // synthwave floor: perspective grid in the lower part
      const hy = h * 0.58;
      ctx.strokeStyle = rgba(theme.accent2, 0.16);
      ctx.lineWidth = Math.max(1, cell * 0.03);
      for (let i = 0; i < 14; i++) {
        const t = i / 13;
        const yy = hy + (h - hy) * t * t;
        ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w, yy); ctx.stroke();
      }
      for (let i = -12; i <= 12; i++) {
        ctx.beginPath();
        ctx.moveTo(w / 2 + i * cell * 0.4, hy);
        ctx.lineTo(w / 2 + i * cell * 2.6, h);
        ctx.stroke();
      }
      const fade = ctx.createLinearGradient(0, hy - cell, 0, hy + cell * 2);
      fade.addColorStop(0, rgba(theme.bg[1], 1));
      fade.addColorStop(1, rgba(theme.bg[1], 0));
      ctx.fillStyle = fade;
      ctx.fillRect(0, hy - cell, w, cell * 3);
      ctx.strokeStyle = rgba(theme.accent, 0.08);
      for (let yy = 0; yy < hy; yy += cell * 0.9) {
        ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w, yy); ctx.stroke();
      }
      break;
    }
    case 'dots': {
      const step = cell * 1.1;
      for (let yy = 0, row = 0; yy < h + step; yy += step, row++) {
        for (let xx = row % 2 ? step / 2 : 0; xx < w + step; xx += step) {
          ctx.fillStyle = 'rgba(255,255,255,0.28)';
          ctx.beginPath();
          ctx.arc(xx, yy, cell * 0.12, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'planks': {
      const pw = cell * 1.9;
      for (let xx = 0, k = 0; xx < w; xx += pw, k++) {
        ctx.fillStyle = k % 2 ? 'rgba(0,0,0,0.08)' : 'rgba(255,220,170,0.04)';
        ctx.fillRect(xx, 0, pw, h);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(xx, 0, Math.max(1, cell * 0.04), h);
        for (let j = 0; j < 7; j++) {
          const x0 = xx + pw * (0.1 + rnd() * 0.8);
          ctx.beginPath();
          ctx.moveTo(x0, 0);
          ctx.bezierCurveTo(x0 + (rnd() - 0.5) * cell, h * 0.33, x0 + (rnd() - 0.5) * cell, h * 0.66, x0, h);
          ctx.strokeStyle = 'rgba(30,12,0,0.12)';
          ctx.lineWidth = Math.max(1, cell * 0.02);
          ctx.stroke();
        }
      }
      break;
    }
    case 'stars': {
      const px = Math.max(2, Math.round(cell / 14));
      for (let i = 0; i < 70; i++) {
        const sx = Math.round((rnd() * w) / px) * px;
        const sy = Math.round((rnd() * h) / px) * px;
        const a = 0.2 + rnd() * 0.5;
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.fillRect(sx, sy, px, px);
        if (rnd() < 0.12) {
          ctx.fillRect(sx - px, sy, px, px);
          ctx.fillRect(sx + px, sy, px, px);
          ctx.fillRect(sx, sy - px, px, px);
          ctx.fillRect(sx, sy + px, px, px);
        }
      }
      break;
    }
    case 'deco': {
      // art-deco sunburst from the top centre
      ctx.strokeStyle = rgba(theme.accent, 0.07);
      ctx.lineWidth = Math.max(1, cell * 0.03);
      const cx = w / 2;
      const cy = -cell;
      for (let i = 0; i <= 28; i++) {
        const a = Math.PI * (0.05 + (0.9 * i) / 28);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * R * 2, cy + Math.sin(a) * R * 2);
        ctx.stroke();
      }
      for (let k = 1; k < 6; k++) {
        ctx.beginPath();
        ctx.arc(cx, cy, k * cell * 3.2, 0, Math.PI);
        ctx.stroke();
      }
      break;
    }
    default:
      break;
  }
  ctx.restore();

  // vignette
  const v = ctx.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.35, w / 2, h * 0.45, Math.max(w, h) * 0.85);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, theme.dark ? 'rgba(0,0,0,0.38)' : 'rgba(110,60,160,0.16)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);

  // Seamless joint with the DOM HUD: the edge next to the HUD fades back to the plain
  // bg gradient (portrait: top edge = exactly --bg-top; landscape: left edge = the same
  // vertical --bg-top → --bg-bottom gradient a full-height HUD column uses).
  if (edge) {
    const f = Math.round(focus.cell * 1.4);
    const strip = edge === 'left' ? makeCanvas(f, h) : makeCanvas(w, f);
    const s = strip.getContext('2d');
    s.fillStyle = g;
    s.fillRect(0, 0, strip.width, strip.height);
    s.globalCompositeOperation = 'destination-in';
    const m = edge === 'left' ? s.createLinearGradient(0, 0, f, 0) : s.createLinearGradient(0, 0, 0, f);
    m.addColorStop(0, 'rgba(0,0,0,1)');
    m.addColorStop(1, 'rgba(0,0,0,0)');
    s.fillStyle = m;
    s.fillRect(0, 0, strip.width, strip.height);
    ctx.drawImage(strip, 0, 0);
  }
}

/** Pulsing frame around the board (booster target mode). */
function paintFrame(ctx, theme, ox, oy, cell) {
  const pad = cell * BOARD_PAD;
  const x = ox - pad;
  const y = oy - pad;
  const w = 8 * cell + 2 * pad;
  const r = theme.style === 'pixel' ? cell * 0.08 : cell * (theme.style === 'candy' ? 0.5 : 0.36);
  ctx.save();
  ctx.shadowColor = theme.accent;
  ctx.shadowBlur = cell * 0.45;
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = Math.max(2, cell * 0.09);
  roundRect(ctx, x, y, w, w, r);
  ctx.stroke();
  ctx.stroke();
  ctx.restore();
}

/** 3x3 hammer target (cells with a warm tint and a bright outline); m = margin around it. */
function paintTarget(ctx, theme, cell, m) {
  const w = cell * 3;
  ctx.save();
  ctx.translate(m, m);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      roundRect(ctx, c * cell + cell * 0.06, r * cell + cell * 0.06, cell * 0.88, cell * 0.88, cell * 0.18);
      ctx.fillStyle = r === 1 && c === 1 ? 'rgba(255,90,60,0.5)' : 'rgba(255,120,70,0.32)';
      ctx.fill();
    }
  }
  ctx.shadowColor = 'rgba(255,90,40,0.9)';
  ctx.shadowBlur = cell * 0.35;
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = Math.max(2, cell * 0.07);
  roundRect(ctx, 0, 0, w, w, cell * 0.28);
  ctx.stroke();
  ctx.restore();
}

/**
 * Shop preview: background + a 4x4 board sample with a few blocks and a gem.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w device px
 * @param {number} h device px
 * @param {Object} theme
 */
export function paintBoardPreview(ctx, w, h, theme) {
  const n = 4;
  const cell = Math.floor(Math.min(w, h) / (n + 2 * BOARD_PAD + 0.6));
  const ox = Math.round((w - n * cell) / 2);
  const oy = Math.round((h - n * cell) / 2);
  paintBackground(ctx, theme, w, h, { x: w / 2, y: h / 2, size: n * cell, cell });
  paintBoardPanel(ctx, theme, ox, oy, cell, n);
  const layout = [
    [0, 0, -1, 4],
    [0, 2, 2, 4],
    [-1, 6, 3, 3],
    [5, 6, 7, -1],
  ];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const col = layout[r][c];
      if (col >= 0) paintBlock(ctx, theme, col, ox + c * cell, oy + r * cell, cell);
    }
  }
  paintGem(ctx, 2, ox + 2 * cell, oy + cell, cell);
}

// ---------------------------------------------------------------------------------------------
// Effect sprites
// ---------------------------------------------------------------------------------------------

/** White rounded block silhouette (flash / pop highlight), same shape as the theme's blocks. */
function paintFlash(ctx, theme, s) {
  const g = s * 0.045;
  const r = theme.style === 'pixel' ? s * 0.04 : theme.style === 'candy' ? s * 0.32 : s * 0.19;
  roundRect(ctx, g, g, s - 2 * g, s - 2 * g, r);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
}

/** Soft drop shadow of a block (floating piece). */
function paintShadow(ctx, s, pad) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = s * 0.22;
  ctx.shadowOffsetX = 10000;
  roundRect(ctx, pad + s * 0.06 - 10000, pad + s * 0.06, s * 0.88, s * 0.88, s * 0.2);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();
}

function paintShard(ctx, theme, color, s) {
  const { top, bottom, base } = blockShades(theme, color);
  const c = theme.style === 'neon' ? base : null;
  if (c) {
    ctx.shadowColor = c;
    ctx.shadowBlur = s * 0.3;
  }
  const inset = s * 0.2;
  const w = s - 2 * inset;
  const gr = ctx.createLinearGradient(0, inset, 0, inset + w);
  gr.addColorStop(0, lighten(top, 0.2));
  gr.addColorStop(1, bottom);
  ctx.fillStyle = c ? lighten(base, 0.3) : gr;
  roundRect(ctx, inset, inset, w, w, w * (theme.style === 'pixel' ? 0 : 0.2));
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.moveTo(inset, inset); ctx.lineTo(inset + w * 0.7, inset); ctx.lineTo(inset, inset + w * 0.7);
  ctx.closePath();
  ctx.fill();
}

function paintSparkle(ctx, s) {
  const c = s / 2;
  const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
  glow.addColorStop(0, 'rgba(255,255,255,0.75)');
  glow.addColorStop(0.25, 'rgba(255,255,255,0.22)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = '#FFFFFF';
  sparklePath(ctx, c, c, c * 0.95, 0.16);
  ctx.fill();
}

function paintDot(ctx, s, color) {
  const c = s / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, rgba('#FFFFFF', 1));
  g.addColorStop(0.3, rgba(color, 0.8));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
}

function paintRing(ctx, s) {
  const c = s / 2;
  const g = ctx.createRadialGradient(c, c, c * 0.62, c, c, c);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
}

function paintConfetti(ctx, color, w, h) {
  roundRect(ctx, 0, 0, w, h, Math.min(w, h) * 0.25);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(0, 0, w / 2, h);
}

/**
 * Glow bar along one board line (light sweep / hover highlight).
 * Horizontal: len × thick; the core is the line, the rest is soft falloff.
 */
function paintLineGlow(ctx, len, thick, color, vertical) {
  const tmp = makeCanvas(len, thick);
  const t = tmp.getContext('2d');
  const g = t.createLinearGradient(0, 0, 0, thick);
  g.addColorStop(0, rgba(color, 0));
  g.addColorStop(0.3, rgba(color, 0.55));
  g.addColorStop(0.5, rgba(lighten(color, 0.6), 1));
  g.addColorStop(0.7, rgba(color, 0.55));
  g.addColorStop(1, rgba(color, 0));
  t.fillStyle = g;
  t.fillRect(0, 0, len, thick);
  // soft ends
  t.globalCompositeOperation = 'destination-in';
  const e = t.createLinearGradient(0, 0, len, 0);
  e.addColorStop(0, 'rgba(0,0,0,0)');
  e.addColorStop(0.06, 'rgba(0,0,0,1)');
  e.addColorStop(0.94, 'rgba(0,0,0,1)');
  e.addColorStop(1, 'rgba(0,0,0,0)');
  t.fillStyle = e;
  t.fillRect(0, 0, len, thick);
  if (vertical) {
    ctx.save();
    ctx.translate(thick, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
  } else {
    ctx.drawImage(tmp, 0, 0);
  }
}

/** Cartoon pointing hand (tutorial hint). Fingertip hotspot at (0.3, 0.04) of the sprite box. */
function paintHand(ctx, s, cuffColor) {
  const u = s / 100; // design units 0..100 (height 100)
  ctx.save();
  ctx.scale(u, u);
  ctx.translate(4, 2);
  const shapes = (fn) => {
    // index finger
    roundRect(ctx, 21, 2, 18, 56, 9); fn();
    // palm
    roundRect(ctx, 21, 40, 50, 46, 16); fn();
    // folded fingers (knuckles)
    ctx.beginPath(); ctx.arc(47, 44, 9, 0, Math.PI * 2); fn();
    ctx.beginPath(); ctx.arc(61, 47, 8.5, 0, Math.PI * 2); fn();
    ctx.beginPath(); ctx.arc(71, 54, 7.5, 0, Math.PI * 2); fn();
    // thumb
    ctx.beginPath(); ctx.ellipse(18, 60, 8, 15, -0.55, 0, Math.PI * 2); fn();
  };
  ctx.lineJoin = 'round';
  // outline pass (thick dark stroke under the white union)
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 3;
  ctx.strokeStyle = '#2A1F55';
  ctx.lineWidth = 7;
  shapes(() => ctx.stroke());
  ctx.restore();
  const skin = ctx.createLinearGradient(0, 0, 80, 90);
  skin.addColorStop(0, '#FFFFFF');
  skin.addColorStop(1, '#E4E0F5');
  ctx.fillStyle = skin;
  shapes(() => ctx.fill());
  // knuckle creases
  ctx.strokeStyle = 'rgba(42,31,85,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(40, 48); ctx.lineTo(40, 56); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(55, 52); ctx.lineTo(55, 59); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(66, 58); ctx.lineTo(66, 63); ctx.stroke();
  // nail
  ctx.fillStyle = 'rgba(255,190,210,0.7)';
  roundRect(ctx, 25, 6, 10, 9, 4); ctx.fill();
  // cuff
  roundRect(ctx, 26, 80, 42, 16, 5);
  ctx.strokeStyle = '#2A1F55';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = cuffColor;
  ctx.fill();
  ctx.restore();
}

/** Small hammer icon (booster target mode). */
function paintHammer(ctx, s) {
  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.rotate(-0.6);
  ctx.lineJoin = 'round';
  const u = s / 100;
  ctx.scale(u, u);
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 4;
  // handle
  roundRect(ctx, -7, -10, 14, 58, 6);
  ctx.fillStyle = '#B9733A';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#4A2A10';
  ctx.lineWidth = 4;
  ctx.stroke();
  // head
  roundRect(ctx, -32, -36, 64, 30, 8);
  const hg = ctx.createLinearGradient(0, -36, 0, -6);
  hg.addColorStop(0, '#E8EEF8');
  hg.addColorStop(1, '#7D8AA6');
  ctx.fillStyle = hg;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  roundRect(ctx, -26, -32, 40, 7, 3);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Text sprites
// ---------------------------------------------------------------------------------------------

/**
 * Text style presets. Sizes are relative to the font size (em).
 * kind: 'praise' (needs level), 'combo', 'points', 'nospace', 'newbest', 'info'
 */
function textLook(kind, theme, level) {
  switch (kind) {
    case 'praise': {
      const st = PRAISE_STYLES[level] || PRAISE_STYLES.good;
      return { stops: st.stops, rainbow: !!st.rainbow, stroke: theme.textStroke, glow: st.glow, strokeW: 0.24, gloss: true };
    }
    case 'combo':
      return { stops: ['#FFFFFF', '#FFF1A8', '#FFC93C'], stroke: theme.textStroke, glow: '#FFC93C', strokeW: 0.26, gloss: true };
    case 'points':
      return { stops: ['#FFFFFF', '#FFFFFF', '#FFE48A'], stroke: theme.textStroke, glow: null, strokeW: 0.26, gloss: false };
    case 'nospace':
      return { stops: ['#FFFFFF', '#FFE1E6', '#FF9AAE'], stroke: '#5A0A22', glow: '#FF3D6E', strokeW: 0.24, gloss: true };
    case 'newbest':
      return { stops: ['#FFFBD0', '#FFD84A', '#FF9A1A'], stroke: theme.textStroke, glow: '#FFD23F', strokeW: 0.24, gloss: true };
    default:
      return { stops: ['#FFFFFF', '#FFFFFF', '#E8E8FF'], stroke: theme.textStroke, glow: null, strokeW: 0.24, gloss: false };
  }
}

/**
 * Renders styled text into `canvas` (resized as needed) and returns its CSS size.
 * Called when an effect starts – never per frame.
 * @param {HTMLCanvasElement} canvas
 * @param {string} text
 * @param {{ kind: string, level?: string, size: number, maxWidth?: number, dpr: number, theme: Object }} o
 * @returns {{ w: number, h: number }}
 */
export function renderTextSprite(canvas, text, o) {
  const look = textLook(o.kind, o.theme, o.level);
  const pixelate = o.theme.style === 'pixel';
  let size = o.size;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `900 ${size}px ${FONT_FAMILY}`;
  let tw = ctx.measureText(text).width;
  if (o.maxWidth && tw + size * 0.6 > o.maxWidth) {
    size = Math.max(10, (size * o.maxWidth) / (tw + size * 0.6));
    ctx.font = `900 ${size}px ${FONT_FAMILY}`;
    tw = ctx.measureText(text).width;
  }
  const padX = size * 0.5;
  const padY = size * 0.45;
  const cssW = Math.ceil(tw + padX * 2);
  const cssH = Math.ceil(size * 1.25 + padY * 2);
  // pixel theme: paint at low resolution and upscale nearest-neighbour for a retro font look
  const res = pixelate ? Math.max(0.5, Math.min(o.dpr, 16 / Math.max(8, size / 2.2))) : o.dpr;
  const target = pixelate ? makeCanvas(cssW * res, cssH * res) : canvas;
  canvas.width = Math.ceil(cssW * o.dpr);
  canvas.height = Math.ceil(cssH * o.dpr);
  const c = target.getContext('2d');
  c.setTransform(res, 0, 0, res, 0, 0);
  c.clearRect(0, 0, cssW, cssH);
  c.font = `900 ${size}px ${FONT_FAMILY}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineJoin = 'round';
  c.miterLimit = 2;
  const cx = cssW / 2;
  const cy = cssH / 2 + size * 0.04;
  const sw = size * look.strokeW;
  // glow + extruded shadow
  c.save();
  if (look.glow && !pixelate) {
    c.shadowColor = rgba(look.glow, 0.75);
    c.shadowBlur = size * 0.35;
  }
  c.strokeStyle = look.stroke;
  c.lineWidth = sw * 2;
  c.strokeText(text, cx, cy + size * 0.07);
  c.restore();
  c.strokeStyle = look.stroke;
  c.lineWidth = sw * 2;
  c.strokeText(text, cx, cy);
  // gradient fill
  let fill;
  if (look.rainbow) {
    fill = c.createLinearGradient(cx - tw / 2, 0, cx + tw / 2, 0);
    look.stops.forEach((s, i) => fill.addColorStop(i / (look.stops.length - 1), s));
  } else {
    fill = c.createLinearGradient(0, cy - size * 0.5, 0, cy + size * 0.5);
    fill.addColorStop(0, look.stops[0]);
    fill.addColorStop(0.45, look.stops[1]);
    fill.addColorStop(1, look.stops[2]);
  }
  c.fillStyle = fill;
  c.fillText(text, cx, cy);
  if (look.gloss) {
    c.save();
    c.beginPath();
    c.rect(0, 0, cssW, cy - size * 0.02);
    c.clip();
    c.fillStyle = 'rgba(255,255,255,0.38)';
    c.fillText(text, cx, cy);
    c.restore();
  }
  if (pixelate) {
    const ctx2 = canvas.getContext('2d');
    ctx2.setTransform(1, 0, 0, 1, 0, 0);
    ctx2.clearRect(0, 0, canvas.width, canvas.height);
    ctx2.imageSmoothingEnabled = false;
    ctx2.drawImage(target, 0, 0, canvas.width, canvas.height);
    ctx2.imageSmoothingEnabled = true;
  }
  return { w: cssW, h: cssH };
}

// ---------------------------------------------------------------------------------------------
// Sprite set
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {Object} Sprite
 * @property {HTMLCanvasElement} img
 * @property {number} w CSS width
 * @property {number} h CSS height
 */

/**
 * All cached sprites for one (theme, layout, dpr) combination.
 */
export class SpriteSet {
  constructor() {
    this.theme = null;
    this.dpr = 1;
    this.cell = 0;
    this.trayCell = 0;
    /** @type {HTMLCanvasElement[]} block per palette color at board cell size */
    this.block = [];
    /** @type {HTMLCanvasElement[]} at tray cell size */
    this.blockTray = [];
    this.grey = [];
    this.greyTray = [];
    /** @type {HTMLCanvasElement[]} gem type 1..3 at board / tray size */
    this.gem = [];
    this.gemTray = [];
    this.flash = null;
    this.flashTray = null;
    this.shadow = null;
    this.shadowPad = 0;
    /** board panel: canvas + CSS rect */
    this.board = null;
    this.boardRect = { x: 0, y: 0, w: 0, h: 0 };
    this.background = null;
    this.shard = [];
    this.confetti = [];
    this.confettiW = 0;
    this.confettiH = 0;
    this.sparkle = null;
    this.dot = [];
    this.dotWhite = null;
    this.ring = null;
    /** white light-sweep bars [horizontal, vertical] */
    this.sweepH = null;
    this.sweepV = null;
    this.sweepThick = 0;
    /** colored hover glow bars, lazily built per color */
    this.glowH = [];
    this.glowV = [];
    this.hand = null;
    this.handSize = 0;
    this.frame = null;
    this.target = null;
    this.targetPad = 0;
    /** background edge that blends into the DOM HUD: 'top' | 'left' | null (auto when undefined) */
    this.seamEdge = undefined;
    this.hammer = null;
    /** text sprite cache: key → { img, w, h } */
    this.texts = new Map();
  }

  /**
   * (Re)builds every sprite. Cost: a few ms; only on theme / size / dpr changes.
   * @param {Object} theme
   * @param {Object} layout renderer layout (CSS px)
   * @param {number} dpr
   * @param {number} cssW canvas CSS width
   * @param {number} cssH canvas CSS height
   */
  build(theme, layout, dpr, cssW, cssH) {
    this.theme = theme;
    this.dpr = dpr;
    this.cell = layout.cell;
    this.trayCell = layout.trayCell;
    const cs = Math.round(layout.cell * dpr);
    const ts = Math.round(layout.trayCell * dpr);
    const one = (s, fn) => {
      const c = makeCanvas(s, s);
      fn(c.getContext('2d'), s);
      return c;
    };
    for (let i = 0; i < 8; i++) {
      this.block[i] = one(cs, (ctx, s) => paintBlock(ctx, theme, i, 0, 0, s));
      this.blockTray[i] = one(ts, (ctx, s) => paintBlock(ctx, theme, i, 0, 0, s));
      this.grey[i] = one(cs, (ctx, s) => paintBlock(ctx, theme, i, 0, 0, s, { grey: true }));
      this.greyTray[i] = one(ts, (ctx, s) => paintBlock(ctx, theme, i, 0, 0, s, { grey: true }));
    }
    for (let k = 1; k <= 3; k++) {
      this.gem[k] = one(cs, (ctx, s) => paintGem(ctx, k, 0, 0, s));
      this.gemTray[k] = one(ts, (ctx, s) => paintGem(ctx, k, 0, 0, s));
    }
    this.flash = one(cs, (ctx, s) => paintFlash(ctx, theme, s));
    this.flashTray = one(ts, (ctx, s) => paintFlash(ctx, theme, s));
    this.shadowPad = 0.3;
    const sp = Math.round(cs * (1 + 2 * this.shadowPad));
    this.shadow = one(sp, (ctx) => paintShadow(ctx, cs, cs * this.shadowPad));

    // board panel incl. its drop shadow margin
    const pad = layout.cell * BOARD_PAD;
    const margin = layout.cell * 1.0;
    const bw = layout.boardPx + 2 * (pad + margin);
    this.boardRect = { x: layout.boardX - pad - margin, y: layout.boardY - pad - margin, w: bw, h: bw };
    this.board = makeCanvas(bw * dpr, bw * dpr);
    {
      const ctx = this.board.getContext('2d');
      const off = (pad + margin) * dpr;
      paintBoardPanel(ctx, theme, off, off, layout.cell * dpr, 8);
    }

    // background (device px, full canvas)
    const W = Math.round(cssW * dpr);
    const H = Math.round(cssH * dpr);
    this.background = makeCanvas(W, H);
    paintBackground(this.background.getContext('2d'), theme, W, H, {
      x: (layout.boardX + layout.boardPx / 2) * dpr,
      y: (layout.boardY + layout.boardPx * 0.45) * dpr,
      size: layout.boardPx * dpr,
      cell: layout.cell * dpr,
    }, this.seamEdge === undefined ? (layout.landscape ? 'left' : 'top') : this.seamEdge);

    // target-mode frame (same box as the board sprite) and 3x3 target
    this.frame = makeCanvas(bw * dpr, bw * dpr);
    {
      const off = (pad + margin) * dpr;
      paintFrame(this.frame.getContext('2d'), theme, off, off, layout.cell * dpr);
    }
    this.targetPad = layout.cell * 0.5;
    this.target = makeCanvas((layout.cell * 3 + 2 * this.targetPad) * dpr, (layout.cell * 3 + 2 * this.targetPad) * dpr);
    paintTarget(this.target.getContext('2d'), theme, layout.cell * dpr, this.targetPad * dpr);

    // particles
    const shs = Math.max(8, Math.round(cs * 0.5));
    for (let i = 0; i < 8; i++) {
      this.shard[i] = one(shs, (ctx, s) => paintShard(ctx, theme, i, s));
      this.dot[i] = one(Math.max(8, Math.round(cs * 0.6)), (ctx, s) => paintDot(ctx, s, theme.palette[i]));
    }
    this.dotWhite = one(Math.max(8, Math.round(cs * 0.6)), (ctx, s) => paintDot(ctx, s, '#FFFFFF'));
    this.sparkle = one(Math.max(12, Math.round(cs * 0.9)), (ctx, s) => paintSparkle(ctx, s));
    this.ring = one(Math.max(32, Math.round(cs * 4)), (ctx, s) => paintRing(ctx, s));
    const confPalette = theme.palette.concat(['#FFFFFF', theme.accent]);
    this.confettiW = Math.max(4, Math.round(cs * 0.18));
    this.confettiH = Math.max(6, Math.round(cs * 0.3));
    this.confetti = confPalette.map((col) => {
      const c = makeCanvas(this.confettiW, this.confettiH);
      paintConfetti(c.getContext('2d'), col, this.confettiW, this.confettiH);
      return c;
    });

    // light sweep bars
    const len = Math.round(layout.boardPx * dpr);
    const thick = Math.round(cs * 1.7);
    this.sweepThick = thick / dpr;
    this.sweepH = makeCanvas(len, thick);
    paintLineGlow(this.sweepH.getContext('2d'), len, thick, '#FFFFFF', false);
    this.sweepV = makeCanvas(thick, len);
    paintLineGlow(this.sweepV.getContext('2d'), len, thick, '#FFFFFF', true);
    this.glowH = [];
    this.glowV = [];

    // tutorial hand + hammer
    this.handSize = layout.cell * 1.7;
    this.hand = one(Math.round(this.handSize * dpr), (ctx, s) => paintHand(ctx, s, theme.accent2));
    this.hammer = one(Math.round(cs * 1.3), (ctx, s) => paintHammer(ctx, s));

    this.texts.clear();
  }

  /** Colored glow bar for the hover highlight (lazily cached per color). */
  lineGlow(color, vertical) {
    const list = vertical ? this.glowV : this.glowH;
    if (!list[color]) {
      const len = this.sweepH.width;
      const thick = this.sweepH.height;
      const col = this.theme.palette[color];
      const c = vertical ? makeCanvas(thick, len) : makeCanvas(len, thick);
      paintLineGlow(c.getContext('2d'), len, thick, saturate(col, 0.2), vertical);
      list[color] = c;
    }
    return list[color];
  }

  /**
   * Cached text sprite (praise words, 'No space!', 'New best!'…).
   * @returns {{ img: HTMLCanvasElement, w: number, h: number }}
   */
  text(key, text, opts) {
    let s = this.texts.get(key);
    if (!s) {
      const img = makeCanvas(1, 1);
      const { w, h } = renderTextSprite(img, text, { ...opts, dpr: this.dpr, theme: this.theme });
      s = { img, w, h };
      this.texts.set(key, s);
    }
    return s;
  }
}

/** rgb() re-export for callers that need channel values. */
export { rgb };
