// Allocation-free particle pool (typed arrays, swap-remove) for shards, sparkles, glow dots,
// confetti and collected gems flying to the HUD. Positions are CSS px in canvas space.

/** Particle kinds. */
export const P_SHARD = 0;     // block fragment, gravity, spin
export const P_SPARKLE = 1;   // white 4-point star, twinkles (additive)
export const P_DOT = 2;       // colored glow dot (additive)
export const P_CONFETTI = 3;  // paper confetti, flutters (drawn in the top layer)
export const P_GEM = 4;       // collected gem flying on a curve to (tx, ty) (top layer)

/** Draw layers. */
export const LAYER_BOARD = 0;
export const LAYER_TOP = 1;

export class Particles {
  /** @param {number} capacity */
  constructor(capacity = 256) {
    this.cap = capacity;
    this.n = 0;
    this.kind = new Uint8Array(capacity);
    this.color = new Uint8Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.rot = new Float32Array(capacity);
    this.vr = new Float32Array(capacity);
    this.delay = new Float32Array(capacity);
    // P_GEM path: start (x0, y0) → target (tx, ty)
    this.x0 = new Float32Array(capacity);
    this.y0 = new Float32Array(capacity);
    this.tx = new Float32Array(capacity);
    this.ty = new Float32Array(capacity);
  }

  /** Removes every particle. */
  clear() {
    this.n = 0;
  }

  /**
   * @returns {number} index of the new particle, or -1 when the pool is full (spawn is dropped)
   */
  spawn(kind, color, x, y, vx, vy, size, life, rot = 0, vr = 0, delay = 0) {
    if (this.n >= this.cap) return -1;
    const i = this.n++;
    this.kind[i] = kind;
    this.color[i] = color;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.size[i] = size;
    this.life[i] = life;
    this.age[i] = 0;
    this.rot[i] = rot;
    this.vr[i] = vr;
    this.delay[i] = delay;
    this.x0[i] = x;
    this.y0[i] = y;
    this.tx[i] = x;
    this.ty[i] = y;
    return i;
  }

  /** Sets the flight target of a P_GEM particle. */
  setTarget(i, tx, ty) {
    if (i < 0) return;
    this.tx[i] = tx;
    this.ty[i] = ty;
  }

  /**
   * Advances the simulation.
   * @param {number} dtMs scaled frame time in ms
   * @param {number} gravity px/s² for shards
   */
  update(dtMs, gravity) {
    const dt = dtMs / 1000;
    const shardDrag = Math.exp(-1.2 * dt);
    const confDrag = Math.exp(-2.4 * dt);
    for (let i = 0; i < this.n; i++) {
      if (this.delay[i] > 0) {
        // delayed spawn: starts moving the frame after its delay ran out
        this.delay[i] -= dtMs;
        continue;
      }
      this.age[i] += dtMs;
      if (this.age[i] >= this.life[i]) {
        this._remove(i);
        i--;
        continue;
      }
      const k = this.kind[i];
      if (k === P_GEM) {
        const t = this.age[i] / this.life[i];
        const e = t * t * (3 - 2 * t);
        const mx = this.x0[i] + (this.tx[i] - this.x0[i]) * 0.2;
        const my = Math.min(this.y0[i], this.ty[i]) - this.size[i] * 1.6;
        const u = 1 - e;
        this.x[i] = u * u * this.x0[i] + 2 * u * e * mx + e * e * this.tx[i];
        this.y[i] = u * u * this.y0[i] + 2 * u * e * my + e * e * this.ty[i];
        continue;
      }
      if (k === P_CONFETTI) {
        this.vy[i] += gravity * 0.32 * dt;
        this.vx[i] *= confDrag;
        this.vy[i] *= confDrag;
        this.x[i] += (this.vx[i] + Math.sin(this.age[i] * 0.006 + i) * this.size[i] * 1.5) * dt;
      } else if (k === P_SHARD) {
        this.vy[i] += gravity * dt;
        this.vx[i] *= shardDrag;
        this.x[i] += this.vx[i] * dt;
      } else {
        this.vx[i] *= confDrag;
        this.vy[i] *= confDrag;
        this.x[i] += this.vx[i] * dt;
      }
      this.y[i] += this.vy[i] * dt;
      this.rot[i] += this.vr[i] * dt;
    }
  }

  _remove(i) {
    const j = --this.n;
    if (i === j) return;
    this.kind[i] = this.kind[j];
    this.color[i] = this.color[j];
    this.x[i] = this.x[j];
    this.y[i] = this.y[j];
    this.vx[i] = this.vx[j];
    this.vy[i] = this.vy[j];
    this.age[i] = this.age[j];
    this.life[i] = this.life[j];
    this.size[i] = this.size[j];
    this.rot[i] = this.rot[j];
    this.vr[i] = this.vr[j];
    this.delay[i] = this.delay[j];
    this.x0[i] = this.x0[j];
    this.y0[i] = this.y0[j];
    this.tx[i] = this.tx[j];
    this.ty[i] = this.ty[j];
  }

  /**
   * Draws one layer. The caller's transform is replaced per particle and NOT restored; the
   * renderer resets it afterwards.
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('./sprites.js').SpriteSet} sp
   * @param {number} dpr
   * @param {number} ox shake offset x (CSS px)
   * @param {number} oy shake offset y
   * @param {number} layer LAYER_BOARD | LAYER_TOP
   */
  draw(ctx, sp, dpr, ox, oy, layer) {
    const n = this.n;
    if (!n) return;
    // pass 1: normal blending
    for (let i = 0; i < n; i++) {
      if (this.delay[i] > 0) continue;
      const k = this.kind[i];
      const top = k === P_CONFETTI || k === P_GEM;
      if ((layer === LAYER_TOP) !== top || k === P_SPARKLE || k === P_DOT) continue;
      const t = this.age[i] / this.life[i];
      let img;
      let w = this.size[i];
      let h = w;
      let fy = 1;
      let alpha = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
      if (k === P_SHARD) {
        img = sp.shard[this.color[i]];
        w = h = this.size[i] * (1 - t * 0.35);
      } else if (k === P_CONFETTI) {
        img = sp.confetti[this.color[i] % sp.confetti.length];
        h = w * 1.6;
        fy = Math.cos(this.age[i] * 0.012 + i * 1.7);
        alpha = t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1;
      } else {
        img = sp.gem[this.color[i]];
        const s = 1 - 0.45 * t;
        w = h = this.size[i] * s;
        alpha = t > 0.85 ? 1 - (t - 0.85) / 0.15 : 1;
      }
      if (!img) continue;
      const c = Math.cos(this.rot[i]);
      const s = Math.sin(this.rot[i]);
      ctx.globalAlpha = alpha;
      ctx.setTransform(dpr * c, dpr * s, -dpr * s * fy, dpr * c * fy, (this.x[i] + ox) * dpr, (this.y[i] + oy) * dpr);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    }
    if (layer !== LAYER_BOARD) {
      ctx.globalAlpha = 1;
      return;
    }
    // pass 2: additive glows
    ctx.globalCompositeOperation = 'lighter';
    ctx.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr);
    for (let i = 0; i < n; i++) {
      if (this.delay[i] > 0) continue;
      const k = this.kind[i];
      if (k !== P_SPARKLE && k !== P_DOT) continue;
      const t = this.age[i] / this.life[i];
      let w;
      let img;
      if (k === P_SPARKLE) {
        img = sp.sparkle;
        w = this.size[i] * Math.sin(Math.PI * Math.min(1, t * 1.15));
        ctx.globalAlpha = 1;
      } else {
        img = this.color[i] === 255 ? sp.dotWhite : sp.dot[this.color[i]] || sp.dotWhite;
        w = this.size[i] * (1 - 0.5 * t);
        ctx.globalAlpha = 1 - t;
      }
      if (w <= 0.5) continue;
      ctx.drawImage(img, this.x[i] - w / 2, this.y[i] - w / 2, w, w);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}
