// Generative background music: soft pad chords with slow attacks, a gentle bass and sparse
// pentatonic plucks (~76 BPM). Nothing loops: chords follow a weighted Markov chain (with
// anti-ping-pong rules and occasional modulation between C, F and G major), chord lengths vary,
// pluck density drifts in "sections" (including pads-only breathers), and melodic motifs are
// remembered and sometimes re-used on later chords – which keeps it musical rather than random
// and pleasant for long sessions.
//
// The planner (MusicPlanner) is pure logic that emits timed note events – it does not touch
// WebAudio, so it can be analysed in Node (tools/audio-check.mjs). renderMusicEvent() turns one
// event into a few nodes. The live engine (mixer.js) asks the planner for events a couple of
// seconds ahead from a timer (lookahead scheduling), so only a handful of nodes exist at once.

import { Voice, fm, gainNode, filterNode, panNode, swellEnv, mtof, pentaNote, getWave } from './synth.js';

export const MUSIC_BPM = 76;
/** Duration of one eighth note (the planner's grid), in seconds. */
export const EIGHTH = 60 / MUSIC_BPM / 2;
const STEPS_PER_BAR = 8;

/** Pad level (envelope peak; 9 oscillators sum into it) and pluck level, before the music bus. */
const PAD_LEVEL = 0.025;
const PLUCK_LEVEL = 0.3;
/** Pad envelope: slow attack, release overlapping the next chord (= crossfade). */
const PAD_ATTACK = 1.8;
const PAD_RELEASE = 2.6;
/** Chords start swelling slightly before their downbeat. */
const PRE_SWELL = 0.3;

/**
 * Diatonic chords of the current key (semitones above the tonic). `tones` is a rootless,
 * jazz-flavoured voicing (the bass plays the root), which keeps the pad soft and open.
 */
const CHORDS = [
  { name: 'I', root: 0, tones: [4, 7, 11, 14] }, //   Cmaj9  (E G B D)
  { name: 'ii', root: 2, tones: [5, 9, 12, 16] }, //  Dm9    (F A C E)
  { name: 'iii', root: 4, tones: [7, 11, 14, 16] }, // Em7   (G B D E)
  { name: 'IV', root: 5, tones: [9, 12, 16, 19] }, // Fmaj9  (A C E G)
  { name: 'V', root: 7, tones: [11, 14, 16, 21] }, //  G6/9  (B D E A)
  { name: 'vi', root: 9, tones: [12, 16, 19, 23] }, // Am9   (C E G B)
];

/** Markov transition weights [from][to] (I ii iii IV V vi). No self-transitions. */
const TRANSITIONS = [
  [0, 1.5, 1, 3, 1.5, 3],
  [1, 0, 0.5, 1, 3, 1],
  [0.5, 1, 0, 2, 0.5, 3],
  [2.5, 1, 0.5, 0, 2, 1.5],
  [3, 0.5, 0.5, 1, 0, 2.5],
  [1, 2, 0.5, 3, 1.5, 0],
];

/** Keys the music visits (semitone offset from C). All contain the C pentatonic used by sfx. */
const KEYS = [0, 5, -5]; // C, F, G
/** Chord lengths in bars and their weights. */
const CHORD_BARS = [1, 2, 3, 4];
const CHORD_BAR_WEIGHTS = [0.12, 0.62, 0.08, 0.18];
/** Pluck densities (probability scale per eighth note); index drifts by ±1 per chord. */
const DENSITIES = [0.2, 0.3, 0.4, 0.5, 0.6];
/** Rhythmic accent weights for the 8 eighths of a bar. */
const ACCENT = [1, 0.3, 0.65, 0.4, 0.85, 0.3, 0.6, 0.45];
/** Melody random walk: interval choices (pentatonic steps) and their weights. */
const WALK = [-2, -1, 0, 1, 2];
const WALK_WEIGHTS = [0.12, 0.32, 0.1, 0.32, 0.14];
const MELODY_STEPS = 8; // range of the melody: 8 pentatonic steps (~1.6 octaves)

function weightedIndex(weights, r) {
  let total = 0;
  for (const w of weights) total += w;
  let x = r * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x < 0) return i;
  }
  return weights.length - 1;
}

const mod12 = (x) => ((x % 12) + 12) % 12;

/**
 * Pure note-event planner. Events:
 *  - `{ type: 'chord', time, end, notes: number[], bass: number, bright: number, name, key }`
 *    (pad starts swelling at `time`, sustains until `end`, then releases)
 *  - `{ type: 'pluck', time, midi, vel, pan }`
 */
export class MusicPlanner {
  /**
   * @param {object} [o]
   * @param {number} [o.startTime]   context time of the first downbeat
   * @param {() => number} [o.random] random source in [0, 1) (default Math.random)
   */
  constructor({ startTime = 0, random = Math.random } = {}) {
    this.random = random;
    this.time = startTime; // time of the next eighth-note step
    this.step = 0;
    this.key = 0;
    this.chordsInKey = 0;
    this.chord = -1;
    this.prevChord = -1;
    this.chordStepsLeft = 0;
    this.chordCount = 0;
    this.voicing = [64, 67, 71, 74];
    this.densityIndex = 2;
    this.density = DENSITIES[2];
    this.rest = false; // pads-only chord
    this.melody = 4; // current melody position (pentatonic step index)
    this.motif = null; // remembered bar: array of { pos, delta, vel }
    this.barNotes = [];
    this.barBase = 0;
    this.barMode = 'fresh';
    this.motifBase = 0;
    this.motifTwist = 0;
    this.fill = null; // ascending fill notes for the current bar, or null
  }

  /** Appends all events with start time < `until` to `out` (in time order) and returns it. */
  planUntil(until, out = []) {
    while (this.time < until) this._advance(out);
    return out;
  }

  _advance(out) {
    if (this.chordStepsLeft <= 0) this._nextChord(out);
    const pos = this.step % STEPS_PER_BAR;
    if (pos === 0) this._startBar();
    this._pluckStep(out, pos);
    this.step++;
    this.chordStepsLeft--;
    this.time += EIGHTH;
  }

  // --- harmony -----------------------------------------------------------------------------

  _nextChord(out) {
    const r = this.random;
    let next;
    if (this.chord < 0) {
      next = 0;
    } else if (this.chordsInKey >= 8 && r() < 0.3) {
      // Modulate to a neighbouring key (C ↔ F, C ↔ G) and land on its I or IV.
      this.key = this.key === 0 ? KEYS[1 + (r() < 0.5 ? 0 : 1)] : 0;
      this.chordsInKey = 0;
      next = r() < 0.6 ? 0 : 3;
    } else {
      const w = TRANSITIONS[this.chord].slice();
      if (this.prevChord >= 0) w[this.prevChord] *= 0.35; // avoid A-B-A-B ping-pong
      next = weightedIndex(w, r());
    }
    this.prevChord = this.chord;
    this.chord = next;
    this.chordsInKey++;
    this.chordCount++;

    const bars = this.chordCount === 1 ? 2 : CHORD_BARS[weightedIndex(CHORD_BAR_WEIGHTS, r())];
    this.chordStepsLeft = bars * STEPS_PER_BAR;

    // Section dynamics: density drifts, with an occasional pads-only breather.
    if (this.chordCount > 1) {
      const d = r();
      if (d < 0.3) this.densityIndex = Math.max(0, this.densityIndex - 1);
      else if (d < 0.6) this.densityIndex = Math.min(DENSITIES.length - 1, this.densityIndex + 1);
    }
    this.density = DENSITIES[this.densityIndex];
    // Pads-only breather: never twice in a row and at most two bars long.
    this.rest = this.chordCount > 2 && !this.rest && r() < 0.1;
    if (this.rest && this.chordStepsLeft > 2 * STEPS_PER_BAR) this.chordStepsLeft = 2 * STEPS_PER_BAR;

    const chord = CHORDS[next];
    this.voicing = this._voice(chord);
    const bass = 40 + mod12(chord.root + this.key - 4); // E2 … D#3
    const start = this.chordCount === 1 ? this.time : this.time - PRE_SWELL;
    out.push({
      type: 'chord',
      time: start,
      end: this.time + this.chordStepsLeft * EIGHTH,
      notes: this.voicing.slice(),
      bass,
      bright: 1100 + r() * 900, // filter "breath" peak (Hz)
      name: chord.name,
      key: this.key,
    });
  }

  /** Voice-leads the chord's pitch classes to the nearest notes of the previous voicing. */
  _voice(chord) {
    const prev = this.voicing;
    const notes = [];
    for (let i = 0; i < chord.tones.length; i++) {
      const pc = mod12(chord.tones[i] + this.key);
      const target = prev[Math.min(i, prev.length - 1)];
      let best = 0;
      let bestDist = Infinity;
      for (let m = 52 + mod12(pc - 52); m <= 79; m += 12) {
        const dist = Math.abs(m - target) + (notes.includes(m) ? 100 : 0);
        if (dist < bestDist) {
          bestDist = dist;
          best = m;
        }
      }
      notes.push(best);
    }
    notes.sort((a, b) => a - b);
    // No minor-second clusters: move the upper note of a semitone rub up an octave.
    for (let i = 1; i < notes.length; i++) {
      if (notes[i] - notes[i - 1] <= 1) notes[i] += 12;
    }
    notes.sort((a, b) => a - b);
    // Keep the pad centred around E4…A4 so it never drifts up or down over a long session.
    const mean = notes.reduce((a, b) => a + b, 0) / notes.length;
    if (mean > 69) notes[notes.length - 1] -= 12;
    else if (mean < 60) notes[0] += 12;
    notes.sort((a, b) => a - b);
    // Never let the pad climb above G5: fold a too-high top note down, or drop it if that would
    // create a unison / semitone rub.
    while (notes.length > 3 && notes[notes.length - 1] > 79) {
      const folded = notes.pop() - 12;
      if (notes.every((m) => Math.abs(m - folded) > 1)) {
        notes.push(folded);
        notes.sort((a, b) => a - b);
      }
    }
    return notes;
  }

  // --- melody ------------------------------------------------------------------------------

  /** Root of the melody's pentatonic range: the key's tonic closest to G4 (C5, F4 or G4). */
  _melodyRoot() {
    const pc = mod12(this.key);
    return pc <= 4 ? 72 + pc : 60 + pc;
  }

  _startBar() {
    const r = this.random;
    // Remember the previous fresh bar as a motif if it has a real contour (≥ 3 notes, ≥ 2 pitches).
    const prev = this.barNotes;
    if (this.barMode === 'fresh' && prev.length >= 3 && prev.some((n) => n.delta !== prev[0].delta)) {
      this.motif = prev;
    }
    const replayedLastBar = this.barMode === 'motif';
    this.barNotes = [];
    const lastBarOfChord = this.chordStepsLeft <= STEPS_PER_BAR;
    this.fill = lastBarOfChord && !this.rest && this.density >= 0.25 && r() < 0.18 ? this._fillNotes() : null;
    if (this.rest) {
      this.barMode = 'rest';
    } else if (this.motif && !replayedLastBar && r() < 0.35) {
      // Re-use the motif (never twice in a row), moved onto a chord tone, sometimes with a twist.
      this.barMode = 'motif';
      this.motifBase = this._motifBase();
      this.motifTwist = r() < 0.3 ? (r() < 0.5 ? -1 : 1) : 0;
    } else {
      this.barMode = 'fresh';
    }
  }

  _pluckStep(out, pos) {
    if (this.barMode === 'rest') return;
    const r = this.random;
    const root = this._melodyRoot();
    if (this.fill && pos >= 4) {
      // Sparkle fill: a soft, strictly ascending sixteenth-note run on chord tones that ends on
      // the bar line, leading into the next chord.
      const offset = 8 - this.fill.length;
      for (let k = 0; k < 2; k++) {
        const j = (pos - 4) * 2 + k - offset;
        if (j < 0) continue;
        const idx = this.fill[j];
        this.melody = clampIndex(idx);
        out.push({
          type: 'pluck', time: this.time + (k * EIGHTH) / 2, midi: pentaNote(root, idx),
          vel: 0.3 + 0.03 * j, pan: k ? 0.35 : -0.35,
        });
      }
      return;
    }
    if (this.barMode === 'motif') {
      const motif = this.motif;
      for (let i = 0; i < motif.length; i++) {
        const n = motif[i];
        if (n.pos !== pos) continue;
        const twist = i === motif.length - 1 ? this.motifTwist : 0;
        const idx = clampIndex(this.motifBase + n.delta + twist);
        this.melody = idx;
        out.push({ type: 'pluck', time: this.time, midi: pentaNote(root, idx), vel: n.vel, pan: r() * 0.8 - 0.4 });
      }
      return;
    }
    if (r() >= this.density * ACCENT[pos]) return;
    let idx = this.melody + WALK[weightedIndex(WALK_WEIGHTS, r())];
    if (idx < 0) idx = -idx;
    if (idx > MELODY_STEPS - 1) idx = 2 * (MELODY_STEPS - 1) - idx;
    if (pos === 0 || pos === 4) idx = this._nearestChordTone(idx);
    const vel = (pos === 0 ? 0.75 : 0.55) + r() * 0.3;
    if (!this.barNotes.length) this.barBase = idx;
    this.barNotes.push({ pos, delta: idx - this.barBase, vel });
    this.melody = idx;
    out.push({ type: 'pluck', time: this.time, midi: pentaNote(root, idx), vel, pan: r() * 0.8 - 0.4 });
  }

  /** Start index for a motif replay: a chord tone near the melody such that the whole motif fits. */
  _motifBase() {
    let lo = 0;
    let hi = MELODY_STEPS - 1;
    for (const n of this.motif) {
      lo = Math.max(lo, -n.delta);
      hi = Math.min(hi, MELODY_STEPS - 1 - n.delta);
    }
    if (lo > hi) return clampIndex(this.melody);
    const target = Math.min(hi, Math.max(lo, this.melody));
    for (let d = 0; d <= hi - lo; d++) {
      for (const cand of d ? [target - d, target + d] : [target]) {
        if (cand >= lo && cand <= hi && this._isChordTone(cand)) return cand;
      }
    }
    return target;
  }

  /** Ascending chord-tone indices from a little below the melody (4–8 notes), or null. */
  _fillNotes() {
    const notes = [];
    for (let i = Math.max(0, this.melody - 3); i <= MELODY_STEPS + 1 && notes.length < 8; i++) {
      if (this._isChordTone(i)) notes.push(i);
    }
    return notes.length >= 4 ? notes : null;
  }

  /** Whether melody index `idx` is a tone of the current chord (incl. its root). */
  _isChordTone(idx) {
    const chord = CHORDS[Math.max(0, this.chord)];
    const pc = mod12(pentaNote(this._melodyRoot(), idx) - this.key);
    return pc === chord.root || chord.tones.some((t) => mod12(t) === pc);
  }

  /** Nearest melody index whose pitch class belongs to the current chord. */
  _nearestChordTone(idx) {
    for (let d = 0; d <= 3; d++) {
      for (const cand of d ? [idx - d, idx + d] : [idx]) {
        if (cand >= 0 && cand <= MELODY_STEPS - 1 && this._isChordTone(cand)) return cand;
      }
    }
    return clampIndex(idx);
  }
}

function clampIndex(i) {
  return i < 0 ? 0 : i > MELODY_STEPS - 1 ? MELODY_STEPS - 1 : i;
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

/**
 * Renders one planner event.
 * @param {BaseAudioContext} ctx
 * @param {{pad: AudioNode, pluck: AudioNode}} outs  destinations for pads and plucks
 * @param {object} ev  event from MusicPlanner
 * @returns {Voice}
 */
export function renderMusicEvent(ctx, outs, ev) {
  return ev.type === 'chord' ? renderChord(ctx, outs.pad, ev) : renderPluck(ctx, outs.pluck, ev);
}

/** Pad chord: 2 detuned warm oscillators per note + bass, one breathing low-pass, one envelope. */
function renderChord(ctx, dest, ev) {
  const v = new Voice(ctx, dest, 'music');
  const t = Math.max(ev.time, ctx.currentTime);
  const env = gainNode(v, 0, v.out);
  const end = swellEnv(env.gain, t, PAD_LEVEL, PAD_ATTACK, ev.end, PAD_RELEASE);
  const lp = filterNode(v, 'lowpass', 700, 0.5, env);
  const mid = t + (ev.end - t) * 0.55;
  lp.frequency.setValueAtTime(650, t);
  lp.frequency.linearRampToValueAtTime(ev.bright, mid);
  lp.frequency.linearRampToValueAtTime(750, end);
  const wave = getWave(ctx, 'warm');
  for (const m of ev.notes) {
    const f = mtof(m);
    for (const det of [-6, 6]) {
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(wave);
      osc.frequency.value = f;
      osc.detune.value = det + (Math.random() * 2 - 1);
      osc.connect(lp);
      v.play(osc, t, end + 0.01);
    }
  }
  const bass = ctx.createOscillator();
  bass.setPeriodicWave(wave);
  bass.frequency.value = mtof(ev.bass);
  const bassLevel = gainNode(v, 0.7, lp);
  bass.connect(bassLevel);
  v.play(bass, t, end + 0.01);
  return v.seal();
}

/** Soft kalimba-like pluck: FM with a very short bright transient and a long sine tail. */
function renderPluck(ctx, dest, ev) {
  const v = new Voice(ctx, dest, 'music');
  const t = Math.max(ev.time, ctx.currentTime);
  fm(v, {
    t, freq: mtof(ev.midi), peak: PLUCK_LEVEL * ev.vel, ratio: 2, index: 0.9, indexDecay: 0.07,
    attack: 0.005, decay: 1.6, dest: panNode(v, ev.pan),
  });
  return v.seal();
}
