// Sound-effect recipes. Every sound is synthesized on the fly from the primitives in synth.js.
//
// Design language: soft, rounded, "candy / marimba / glass" tones with fast, clean attacks and
// natural exponential decays. All pitched material uses the C major pentatonic scale, which is
// consonant with every key the background music visits (C, F and G major), so effects never
// clash with the music and any number of overlapping chimes still sounds musical.
//
// renderToContext() targets any BaseAudioContext + destination node, so the exact same code is
// used live in the game and offline in tools/audio-check.mjs.

import {
  Voice, tone, fm, mallet, ping, noise, sparkles, padChord, brass, filterNode, stereoPair,
  mtof, pentaNote, clamp, rand,
} from './synth.js';

/** Every sound name accepted by play() / renderToContext(). */
export const SOUND_NAMES = Object.freeze([
  'pickup', 'place', 'invalid', 'return', 'clear', 'combo', 'praise', 'allclear', 'gameover',
  'newbest', 'coin', 'click', 'reward', 'levelwin', 'levelfail', 'hammer', 'shuffle', 'revive',
  'tick', 'unlock', 'star',
]);

/** MIDI note of C-major-pentatonic step `step` counted from C4 (0 = C4, 5 = C5, 10 = C6 …). */
function N(step) {
  return pentaNote(60, step);
}

/**
 * Glass/bell chime on pentatonic step `step`: an FM "ting" that mellows into a pure tone, plus a
 * soft octave partial for sweetness. The modulation index shrinks for high notes so the top of
 * the combo ladder stays sweet instead of shrill. `dest` is typically one side of a stereoPair().
 */
function chime(v, t, step, peak, decay, dest = v.out) {
  const freq = mtof(N(step));
  const end = fm(v, {
    t, freq, peak, decay, ratio: 3, index: 1.3 * clamp(700 / freq, 0.35, 1), dest,
  });
  const octave = peak * 0.22 * clamp(1500 / freq, 0.3, 1);
  tone(v, { t, freq: freq * 2, peak: octave, attack: 0.002, decay: decay * 0.45, dest });
  return end;
}

/**
 * Arpeggio shapes for line clears, in pentatonic steps relative to the top note (which climbs
 * with the combo): more lines → more notes, sweeping up from further below.
 */
const CLEAR_PATTERNS = [
  [-4, -2, 0],
  [-5, -4, -2, 0],
  [-7, -5, -4, -2, 0],
  [-9, -7, -5, -4, -2, 0],
];

/** Subtle per-placement pitch offsets (cents), cycled so repeated placements never sound robotic. */
const PLACE_VARIATION = [0, 35, -25, 15, -40, 25, -10];
let placeCounter = 0;

/** @type {Object<string, (v: Voice, t: number, o: object) => void>} */
const SOUNDS = {
  /** Piece lifted from the tray: a quick, bubbly upward blip. */
  pickup(v, t) {
    tone(v, { t, freq: 520, glideTo: 780, glideTime: 0.06, peak: 0.34, attack: 0.004, decay: 0.12 });
    tone(v, {
      t, freq: 1040, glideTo: 1560, glideTime: 0.06, type: 'triangle', peak: 0.06, attack: 0.004, decay: 0.07,
    });
  },

  /**
   * Piece dropped onto the board: a soft wooden "tock" with a little low body. Optional
   * `{ cells }` (piece size) makes big pieces sound slightly lower and weightier.
   */
  place(v, t, o) {
    const size = clamp(((o.cells || 4) - 1) / 8, 0, 1);
    const cents = PLACE_VARIATION[placeCounter++ % PLACE_VARIATION.length] + rand(-15, 15) - size * 250;
    const k = Math.pow(2, cents / 1200);
    tone(v, {
      t, freq: 210 * k, glideTo: 95 * k, glideTime: 0.06, peak: 0.2 + 0.1 * size, attack: 0.002, decay: 0.14 + 0.06 * size,
    });
    tone(v, { t, freq: 640 * k, glideTo: 560 * k, glideTime: 0.03, peak: 0.42, attack: 0.002, decay: 0.11 });
    tone(v, { t, freq: 640 * 2.71 * k, peak: 0.1, attack: 0.001, decay: 0.03 });
    noise(v, { t, freq: 2800, q: 1.2, peak: 0.08, attack: 0.001, decay: 0.018 });
  },

  /** Drop on an invalid spot: a gentle low "bonk-bonk" (no buzzer). */
  invalid(v, t) {
    const lp = filterNode(v, 'lowpass', 1800, 0.5);
    tone(v, {
      t, freq: 392, glideTo: 345, glideTime: 0.08, wave: 'hollow', peak: 0.24, attack: 0.006, decay: 0.12, dest: lp,
    });
    tone(v, {
      t: t + 0.11, freq: 330, glideTo: 290, glideTime: 0.1, wave: 'hollow', peak: 0.24, attack: 0.006, decay: 0.16, dest: lp,
    });
  },

  /** Piece flies back to the tray: a soft downward swoosh. */
  return(v, t) {
    tone(v, { t, freq: 700, glideTo: 420, glideTime: 0.14, peak: 0.24, attack: 0.012, decay: 0.16 });
    noise(v, { t, freq: 2400, freqTo: 700, q: 0.9, peak: 0.08, attack: 0.03, decay: 0.12 });
  },

  /**
   * Line clear `{ lines, combo }`: a bright chime arpeggio whose top note climbs the pentatonic
   * scale with the combo (E5 at combo 1 … D7 at combo 10+), more notes and sparkle for more
   * lines, a soft whoosh, and (for big clears) a low body.
   */
  clear(v, t, o) {
    const lines = clamp(Math.round(o.lines || 1), 1, 12);
    const combo = Math.max(1, Math.round(o.combo || 1));
    const rung = clamp(combo, 1, 10) - 1;
    const top = 7 + rung;
    const shape = Math.min(lines, 4);
    const pattern = CLEAR_PATTERNS[shape - 1];
    const gap = 0.052 - 0.004 * shape;
    const n = pattern.length;
    const sides = stereoPair(v, 0.25);
    for (let i = 0; i < n; i++) {
      const last = i === n - 1;
      chime(v, t + i * gap, top + pattern[i], 0.15 - 0.008 * (n - 1 - i), last ? 0.9 : 0.42, last ? v.out : sides[i & 1]);
    }
    const first = N(top + pattern[0]);
    mallet(v, { t, freq: mtof(first - 12 >= 55 ? first - 12 : first), peak: 0.12 + 0.03 * shape, decay: 0.45 });
    noise(v, {
      t, freq: 400, freqTo: 3200, sweep: 0.25, q: 0.7, peak: 0.05 + 0.018 * shape, attack: 0.04, decay: 0.28,
    });
    if (lines >= 2) {
      sparkles(v, {
        t: t + 0.08, count: (shape - 1) * 2 + (rung >> 2), spread: 0.35,
        root: rung >= 5 ? 84 : 72, steps: 10, peak: 0.045,
      });
    }
    if (lines >= 3) tone(v, { t, freq: mtof(48 + ((N(top) - 48) % 12)), peak: 0.13, attack: 0.008, decay: 0.55 });
    if (combo > 10) ping(v, { t: t + n * gap, freq: mtof(N(Math.min(top + 2, 17))), peak: 0.05, decay: 0.5 });
  },

  /** Combo `{ combo }`: a short rising swell (filtered chord glide + noise riser + top chime). */
  combo(v, t, o) {
    const c = clamp(Math.round(o.combo || 2), 2, 12);
    const root = c - 2; // C4 … C6
    const lp = filterNode(v, 'lowpass', 700, 0.9);
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.exponentialRampToValueAtTime(5000, t + 0.3);
    for (const step of [0, 2, 5]) {
      const f = mtof(N(root + step));
      tone(v, {
        t, freq: f / 1.5, glideTo: f, glideTime: 0.28, type: 'triangle', peak: 0.07, attack: 0.24, hold: 0.03, decay: 0.3, dest: lp,
      });
    }
    noise(v, { t, freq: 500, freqTo: 5000, sweep: 0.3, q: 1.0, peak: 0.045, attack: 0.26, decay: 0.12 });
    chime(v, t + 0.27, root + 5, 0.09, 0.5);
  },

  /**
   * Praise text `{ level 1..5 }` ("Good" … "Unbelievable"): an escalating sparkle run. Starts a
   * beat after the clear chime it usually accompanies so the two read as one gesture.
   */
  praise(v, t, o) {
    const L = clamp(Math.round(o.level || 1), 1, 5);
    t += 0.1;
    const count = 2 + L * 2;
    const start = 9 - L;
    const gap = 0.05 - L * 0.004;
    const sides = stereoPair(v, 0.4);
    for (let i = 0; i < count; i++) {
      ping(v, {
        t: t + i * gap, freq: mtof(N(start + i)), peak: 0.15 * (1 - 0.03 * i), decay: 0.35, dest: sides[i & 1],
      });
    }
    if (L >= 3) {
      padChord(v, {
        t, notes: L >= 5 ? [72, 76, 79, 84] : [72, 76, 79], peak: 0.03, attack: 0.04, hold: 0.15, decay: 0.9, cutoff: 3000,
      });
    }
    if (L >= 4) noise(v, { t, freq: 600, freqTo: 6000, sweep: 0.4, q: 0.8, peak: 0.05, attack: 0.15, decay: 0.3 });
    if (L >= 5) sparkles(v, { t: t + count * gap, count: 8, spread: 0.5, root: 84, peak: 0.06 });
  },

  /** Board completely cleared: the biggest moment – boom, chord bloom, two-octave bell run, shower. */
  allclear(v, t) {
    tone(v, { t, freq: 130, glideTo: 50, glideTime: 0.25, peak: 0.3, attack: 0.004, decay: 0.5 });
    noise(v, { t, freq: 300, freqTo: 5000, sweep: 0.4, q: 0.6, peak: 0.1, attack: 0.05, decay: 0.45 });
    padChord(v, {
      t, notes: [48, 55, 60, 64, 67, 74], peak: 0.045, attack: 0.03, hold: 0.35, decay: 1.5,
      cutoff: 600, cutoffTo: 3500, sweep: 0.2,
    });
    const run = [5, 7, 8, 10, 12, 13, 15];
    const sides = stereoPair(v, 0.35);
    for (let i = 0; i < run.length; i++) {
      chime(v, t + 0.02 + i * 0.05, run[i], 0.16, i === run.length - 1 ? 1.2 : 0.7, sides[i & 1]);
    }
    sparkles(v, { t: t + 0.25, count: 14, spread: 1.0, root: 84, peak: 0.07 });
  },

  /** Game over: a gentle descending mallet line resolving on a warm major 6/9 chord (not sad). */
  gameover(v, t) {
    const line = [8, 7, 6, 5, 3]; // G5 E5 D5 C5 G4
    for (let i = 0; i < line.length; i++) {
      mallet(v, { t: t + i * 0.15, freq: mtof(N(line[i])), peak: 0.16 - 0.01 * i, decay: 0.7, bright: 0.7 });
    }
    const tc = t + 0.78;
    padChord(v, { t: tc, notes: [48, 55, 64, 69, 74], peak: 0.03, attack: 0.15, hold: 0.4, decay: 1.6, cutoff: 1600 });
    chime(v, tc, 5, 0.07, 1.2);
  },

  /** New personal best: a short, bright fanfare. */
  newbest(v, t) {
    const pick = [3, 5, 7]; // G4 C5 E5
    for (let i = 0; i < pick.length; i++) {
      const tt = t + i * 0.085;
      brass(v, { t: tt, freq: mtof(N(pick[i])), peak: 0.09, attack: 0.012, hold: 0.03, decay: 0.15 });
      chime(v, tt, pick[i] + 5, 0.05, 0.25);
    }
    const tf = t + 0.26;
    for (const m of [72, 76, 79, 84]) {
      brass(v, { t: tf, freq: mtof(m), peak: 0.05, attack: 0.02, hold: 0.35, decay: 0.9 });
    }
    const sides = stereoPair(v, 0.2);
    chime(v, tf, 10, 0.14, 1.1, sides[0]);
    chime(v, tf + 0.04, 12, 0.09, 0.9, sides[1]);
    tone(v, { t: tf, freq: mtof(48), peak: 0.12, attack: 0.02, hold: 0.2, decay: 0.8 });
    sparkles(v, { t: tf + 0.05, count: 10, spread: 0.7, root: 84, peak: 0.055 });
  },

  /**
   * Coin: a bright two-note "bling" (D6 → G6). Short and dry so rapid repeats (coin counting)
   * stay crisp; a tiny random detune avoids phasing between overlapping copies.
   */
  coin(v, t) {
    const det = rand(-12, 12);
    fm(v, { t, freq: mtof(86), ratio: 2, index: 0.7, peak: 0.11, attack: 0.002, hold: 0.045, decay: 0.06, detune: det });
    fm(v, { t: t + 0.065, freq: mtof(91), ratio: 2, index: 0.8, peak: 0.15, attack: 0.002, decay: 0.38, detune: det });
    ping(v, { t: t + 0.065, freq: mtof(103), peak: 0.02, decay: 0.12 });
  },

  /** UI button click: a tiny soft tick. */
  click(v, t) {
    tone(v, { t, freq: 1300, glideTo: 850, glideTime: 0.025, peak: 0.33, attack: 0.002, decay: 0.04 });
    noise(v, { t, filter: 'highpass', freq: 3000, peak: 0.035, attack: 0.002, decay: 0.01 });
  },

  /** Reward granted (ad reward, daily reward, mission claim): rising bells with a bling on top. */
  reward(v, t) {
    const arp = [5, 7, 8, 10, 12]; // C5 E5 G5 C6 E6
    const sides = stereoPair(v, 0.3);
    for (let i = 0; i < arp.length; i++) {
      const last = i === arp.length - 1;
      chime(v, t + i * 0.065, arp[i], last ? 0.16 : 0.13, last ? 1.0 : 0.55, last ? v.out : sides[i & 1]);
    }
    padChord(v, { t, notes: [60, 64, 67, 72], peak: 0.03, attack: 0.06, hold: 0.2, decay: 0.9 });
    fm(v, { t: t + 0.33, freq: mtof(91), ratio: 2, index: 0.8, peak: 0.09, attack: 0.002, decay: 0.4 });
    sparkles(v, { t: t + 0.3, count: 6, spread: 0.4, root: 84, peak: 0.05 });
  },

  /** Journey level / daily challenge won: a little "da-da-da-DAA" melody, chord bloom, shower. */
  levelwin(v, t) {
    const mel = [5, 7, 8, 10]; // C5 E5 G5 C6
    for (let i = 0; i < mel.length; i++) {
      const last = i === mel.length - 1;
      const tt = t + i * 0.12;
      mallet(v, { t: tt, freq: mtof(N(mel[i])), peak: last ? 0.16 : 0.135, decay: last ? 1.0 : 0.4, bright: 0.8 });
      chime(v, tt, mel[i] + (last ? 5 : 0), last ? 0.1 : 0.07, last ? 1.2 : 0.4);
    }
    const tc = t + 0.36;
    padChord(v, {
      t: tc, notes: [48, 60, 64, 67, 72, 76], peak: 0.03, attack: 0.04, hold: 0.4, decay: 1.3,
      cutoff: 800, cutoffTo: 3000, sweep: 0.25,
    });
    tone(v, { t: tc, freq: 140, glideTo: 60, glideTime: 0.2, peak: 0.16, attack: 0.004, decay: 0.35 });
    noise(v, { t: t + 0.12, freq: 500, freqTo: 5000, sweep: 0.3, q: 0.7, peak: 0.035, attack: 0.22, decay: 0.3 });
    sparkles(v, { t: tc + 0.04, count: 12, spread: 0.9, root: 84, peak: 0.045 });
  },

  /** Level failed: three soft falling notes with a gentle droop – kind, not punishing. */
  levelfail(v, t) {
    const lp = filterNode(v, 'lowpass', 1800, 0.5);
    const notes = [4, 2, 1]; // A4 E4 D4
    for (let i = 0; i < notes.length; i++) {
      const last = i === notes.length - 1;
      const f = mtof(N(notes[i]));
      tone(v, {
        t: t + i * 0.2, freq: f, glideTo: last ? f * 0.982 : f, glideTime: 0.5, wave: 'hollow',
        peak: 0.105, attack: 0.012, hold: last ? 0.12 : 0.03, decay: last ? 0.9 : 0.35, dest: lp,
      });
    }
    padChord(v, { t, notes: [57, 60, 64], peak: 0.015, attack: 0.25, hold: 0.3, decay: 1.0, cutoff: 1200 });
  },

  /** Hammer booster: a punchy impact with a crunchy crack and a few flying shards. */
  hammer(v, t) {
    tone(v, { t, freq: 170, glideTo: 45, glideTime: 0.14, peak: 0.24, attack: 0.002, decay: 0.38 });
    tone(v, { t, freq: 360, glideTo: 240, glideTime: 0.06, type: 'triangle', peak: 0.38, attack: 0.002, decay: 0.12 });
    noise(v, { t, filter: 'lowpass', freq: 3500, freqTo: 400, sweep: 0.2, q: 0.6, peak: 0.4, attack: 0.002, decay: 0.25 });
    noise(v, { t, freq: 1700, q: 2.5, peak: 0.36, attack: 0.001, decay: 0.05 });
    for (let i = 0; i < 6; i++) {
      noise(v, {
        t: t + rand(0.05, 0.3), freq: rand(2500, 5000), q: 4, peak: 0.08 * rand(0.5, 1),
        attack: 0.001, decay: rand(0.02, 0.04), pan: rand(-0.6, 0.6),
      });
    }
  },

  /** Shuffle booster: a card riffle, an airy whoosh and three soft plucks. */
  shuffle(v, t) {
    for (let i = 0; i < 8; i++) {
      noise(v, {
        t: t + i * 0.032, freq: 1800 + i * 180, q: 1.6, peak: 0.1, attack: 0.002, decay: 0.03, pan: i % 2 ? 0.3 : -0.3,
      });
    }
    noise(v, { t, freq: 600, freqTo: 2800, sweep: 0.25, q: 0.8, peak: 0.08, attack: 0.12, decay: 0.3 });
    const plucks = [5, 7, 8];
    for (let i = 0; i < plucks.length; i++) {
      mallet(v, { t: t + 0.3 + i * 0.06, freq: mtof(N(plucks[i])), peak: 0.16, decay: 0.3 });
    }
  },

  /** Revive: a magical upward swell that blooms into bright chimes. */
  revive(v, t) {
    const lp = filterNode(v, 'lowpass', 500, 0.8);
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.exponentialRampToValueAtTime(4500, t + 0.6);
    for (const step of [0, 2, 5]) {
      const f = mtof(N(step));
      tone(v, {
        t, freq: f / 2, glideTo: f, glideTime: 0.6, type: 'triangle', peak: 0.09, attack: 0.5, hold: 0.1, decay: 0.6, dest: lp,
      });
    }
    noise(v, { t, freq: 250, freqTo: 5000, sweep: 0.6, q: 0.9, peak: 0.05, attack: 0.55, decay: 0.15 });
    const tb = t + 0.6;
    tone(v, { t: tb, freq: 180, glideTo: 70, glideTime: 0.2, peak: 0.22, attack: 0.003, decay: 0.3 });
    const run = [10, 12, 13, 15]; // C6 E6 G6 C7
    const sides = stereoPair(v, 0.3);
    for (let i = 0; i < run.length; i++) chime(v, tb + i * 0.035, run[i], 0.15, 0.8, sides[i & 1]);
    sparkles(v, { t: tb + 0.05, count: 10, spread: 0.6, root: 84, peak: 0.06 });
  },

  /** Countdown tick (revive offer): a small woodblock. */
  tick(v, t) {
    tone(v, { t, freq: 1250, glideTo: 1150, glideTime: 0.02, peak: 0.32, attack: 0.002, decay: 0.05 });
    tone(v, { t, freq: 1250 * 2.76, peak: 0.055, attack: 0.0015, decay: 0.02 });
  },

  /** Something unlocked (theme, level): a latch click, two bell tones and a rising sparkle. */
  unlock(v, t) {
    noise(v, { t, freq: 4000, q: 3, peak: 0.07, attack: 0.001, decay: 0.02 });
    tone(v, { t, freq: 900, peak: 0.08, attack: 0.001, decay: 0.03 });
    const sides = stereoPair(v, 0.2);
    chime(v, t + 0.06, 9, 0.15, 0.9, sides[0]);
    chime(v, t + 0.18, 12, 0.15, 1.0, sides[1]);
    padChord(v, { t: t + 0.06, notes: [55, 60, 64], peak: 0.03, attack: 0.1, hold: 0.2, decay: 0.9 });
    sparkles(v, { t: t + 0.2, count: 8, spread: 0.5, root: 84, peak: 0.05, rising: true });
  },

  /** Star awarded `{ index 0..2 }`: a stamp and a bell whose pitch rises per star. */
  star(v, t, o) {
    const i = clamp(Math.round(o.index || 0), 0, 2);
    const step = [7, 8, 10][i]; // E5, G5, C6
    tone(v, { t, freq: 320, glideTo: 160, glideTime: 0.05, peak: 0.12, attack: 0.002, decay: 0.08 });
    chime(v, t, step, 0.155, 0.8);
    chime(v, t + 0.02, step + 5, 0.05, 0.5);
    sparkles(v, { t: t + 0.04, count: 3 + i * 3, spread: 0.3 + 0.1 * i, root: 84, steps: 5, peak: 0.04 });
    if (i === 2) padChord(v, { t, notes: [72, 76, 79], peak: 0.02, attack: 0.03, hold: 0.15, decay: 0.9 });
  },
};

/**
 * Synthesizes sound `name` into `ctx`, connected to `dest`, starting at context time `when`.
 * Works with any BaseAudioContext (live or offline). Unknown names are ignored.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} dest
 * @param {string} name   one of SOUND_NAMES
 * @param {object} [opts] per-sound options (see the recipes above)
 * @param {number} [when] context time (default: now)
 * @returns {Voice|null}  the voice owning all created nodes (null for unknown names)
 */
export function renderToContext(ctx, dest, name, opts, when) {
  const recipe = Object.prototype.hasOwnProperty.call(SOUNDS, name) ? SOUNDS[name] : null;
  if (!recipe) return null;
  const t = Math.max(typeof when === 'number' && isFinite(when) ? when : 0, ctx.currentTime);
  const v = new Voice(ctx, dest, name);
  try {
    recipe(v, t, opts || {});
  } catch (e) {
    // Never leave a half-built voice connected (e.g. after an unexpected engine exception).
    v.release(ctx.currentTime, 0.005);
    v.dispose();
    throw e;
  }
  return v.seal();
}
