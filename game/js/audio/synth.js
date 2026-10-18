// Low-level WebAudio synthesis primitives shared by the sound effects (sounds.js) and the music
// generator (music.js).
//
// Every function here works on any BaseAudioContext – the live AudioContext in the game or an
// OfflineAudioContext in tools/audio-check.mjs – and schedules sample-accurately at an absolute
// context time `t`. All amplitude envelopes start at exactly 0 and end at exactly 0, so no sound
// ever produces a click, and every source node is registered with a Voice that stops and
// disconnects it once it is done (no node leaks).

/** Amplitude treated as silence by exponential envelopes (−60 dB below the peak). */
const DECAY_FLOOR = 0.001;
/** Final linear ramp from the exponential floor to true zero (s). */
const ZERO_RAMP = 0.008;

/** Counters for leak detection (live = nodes created and not yet disconnected). */
export const nodeStats = { created: 0, live: 0 };

// ---------------------------------------------------------------------------------------------
// Music theory helpers
// ---------------------------------------------------------------------------------------------

/** MIDI note number → frequency in Hz (A4 = 69 = 440 Hz). */
export function mtof(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Major pentatonic scale (semitones above the root). Any combination of these is consonant. */
export const PENTATONIC = Object.freeze([0, 2, 4, 7, 9]);

/** MIDI note of pentatonic `step` above `rootMidi` (steps may be negative; 5 steps = 1 octave). */
export function pentaNote(rootMidi, step) {
  const octave = Math.floor(step / 5);
  return rootMidi + octave * 12 + PENTATONIC[step - octave * 5];
}

export function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Uniform random number in [a, b). Sound design only – never used by game logic. */
export function rand(a, b) {
  return a + Math.random() * (b - a);
}

// ---------------------------------------------------------------------------------------------
// Per-context shared resources (created once per context, then reused)
// ---------------------------------------------------------------------------------------------

const noiseBuffers = new WeakMap();
const waveCache = new WeakMap();

/** One second of white noise, created once per context and shared by every noise source. */
export function getNoiseBuffer(ctx) {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    const len = Math.round(ctx.sampleRate);
    buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    // Remove the (tiny) DC offset of this particular random sequence.
    let mean = 0;
    for (let i = 0; i < len; i++) mean += data[i];
    mean /= len;
    for (let i = 0; i < len; i++) data[i] -= mean;
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

/**
 * Harmonic amplitude tables for custom oscillator timbres (index = harmonic number, 1-based).
 *  - warm:  soft sawtooth-like roll-off (pads, bass, "brass")
 *  - hollow: odd-harmonic heavy, flute/clarinet-like (gentle descending notes)
 */
const WAVE_TABLES = {
  warm: [0, 1, 0.42, 0.22, 0.12, 0.07, 0.04, 0.025, 0.015],
  hollow: [0, 1, 0.08, 0.3, 0.04, 0.12, 0.02, 0.05],
};

/** Cached PeriodicWave for a named timbre (see WAVE_TABLES). */
export function getWave(ctx, name) {
  let map = waveCache.get(ctx);
  if (!map) {
    map = new Map();
    waveCache.set(ctx, map);
  }
  let wave = map.get(name);
  if (!wave) {
    const table = WAVE_TABLES[name];
    const real = new Float32Array(table.length);
    const imag = Float32Array.from(table);
    wave = ctx.createPeriodicWave(real, imag);
    map.set(name, wave);
  }
  return wave;
}

// ---------------------------------------------------------------------------------------------
// Voice: owns the nodes of one sound event
// ---------------------------------------------------------------------------------------------

/**
 * A Voice groups all nodes of one sound event (e.g. one 'clear' or one music chord). Its `out`
 * gain node feeds `dest`. When the last source ends, every node is disconnected. A Voice can be
 * released early (voice stealing / mute) with a short fade, which also stops its sources.
 */
export class Voice {
  /**
   * @param {BaseAudioContext} ctx
   * @param {AudioNode} dest  node the voice output connects to
   * @param {string} [name]   sound name (used for per-sound polyphony caps)
   */
  constructor(ctx, dest, name = '') {
    this.ctx = ctx;
    this.name = name;
    this.out = ctx.createGain();
    this.out.connect(dest);
    this.nodes = [this.out];
    this.sources = [];
    /** Earliest scheduled source start / latest scheduled source stop (context time). */
    this.start = Infinity;
    this.end = 0;
    this.done = false;
    this.released = false;
    /** Called once after the voice has been disposed. */
    this.onDispose = null;
    this._pending = 0;
    this._onEnded = () => {
      if (--this._pending <= 0) this.dispose();
    };
    nodeStats.created++;
    nodeStats.live++;
  }

  /** Registers a processing node so it is disconnected when the voice is disposed. */
  node(n) {
    this.nodes.push(n);
    nodeStats.created++;
    nodeStats.live++;
    return n;
  }

  /** Registers, starts and schedules the stop of a source node. */
  play(src, t0, t1, offset = 0) {
    this.node(src);
    src.onended = this._onEnded;
    this._pending++;
    this.sources.push(src);
    if (offset) src.start(t0, offset);
    else src.start(t0);
    src.stop(t1);
    if (t0 < this.start) this.start = t0;
    if (t1 > this.end) this.end = t1;
    return src;
  }

  /** Call after all nodes were created: a voice without sources is disposed immediately. */
  seal() {
    if (!this.sources.length) this.dispose();
    return this;
  }

  /** Fades the voice out from time `t` and stops all its sources (voice stealing, mute). */
  release(t, fade = 0.03) {
    if (this.done || this.released) return;
    this.released = true;
    const g = this.out.gain;
    try {
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
      else {
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
      }
      g.linearRampToValueAtTime(0, t + fade);
    } catch (e) { /* ignore: context closed */ }
    const stopAt = t + fade + 0.01;
    for (const s of this.sources) {
      try { s.stop(stopAt); } catch (e) { /* already stopped */ }
    }
    if (stopAt < this.end) this.end = stopAt;
  }

  /** Disconnects all nodes. Idempotent. */
  dispose() {
    if (this.done) return;
    this.done = true;
    for (const n of this.nodes) {
      try { n.disconnect(); } catch (e) { /* ignore */ }
      if (n.onended) n.onended = null;
    }
    nodeStats.live -= this.nodes.length;
    this.nodes.length = 0;
    this.sources.length = 0;
    const cb = this.onDispose;
    this.onDispose = null;
    if (cb) cb(this);
  }
}

// ---------------------------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------------------------

/**
 * Percussive envelope on `param`: 0 → `peak` (linear attack) → optional hold → exponential
 * decay to −60 dB over `decay` → exact 0. Returns the time the envelope reaches 0.
 */
export function percEnv(param, t, peak, attack, decay, hold = 0) {
  if (!(peak > 1e-6)) peak = 1e-6; // exponential ramps need a positive target
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  let tt = t + attack;
  if (hold > 0) {
    tt += hold;
    param.setValueAtTime(peak, tt);
  }
  tt += decay;
  param.exponentialRampToValueAtTime(peak * DECAY_FLOOR, tt);
  param.linearRampToValueAtTime(0, tt + ZERO_RAMP);
  return tt + ZERO_RAMP;
}

/**
 * Swell envelope (pads): 0 → `peak` linear over `attack`, sustained until `sustainEnd`, then a
 * linear release to 0. Returns the end time.
 */
export function swellEnv(param, t, peak, attack, sustainEnd, release) {
  const top = t + attack;
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, top);
  if (sustainEnd > top) param.setValueAtTime(peak, sustainEnd);
  const end = Math.max(top, sustainEnd) + release;
  param.linearRampToValueAtTime(0, end);
  return end;
}

// ---------------------------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------------------------

/** Highest partial frequency we synthesize (keeps everything soft and alias-free). */
function maxFreq(ctx) {
  return Math.min(12000, ctx.sampleRate * 0.45);
}

/** Creates a gain node owned by the voice. */
export function gainNode(v, value = 1, dest = null) {
  const g = v.node(v.ctx.createGain());
  g.gain.value = value;
  if (dest) g.connect(dest);
  return g;
}

/** Creates a biquad filter owned by the voice, connected to `dest`. */
export function filterNode(v, type, freq, q = 0.7, dest = v.out) {
  const f = v.node(v.ctx.createBiquadFilter());
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  f.connect(dest);
  return f;
}

/** Stereo panner owned by the voice (falls back to `dest` when StereoPannerNode is missing). */
export function panNode(v, pan, dest = v.out) {
  if (!pan || !v.ctx.createStereoPanner) return dest;
  const p = v.node(v.ctx.createStereoPanner());
  p.pan.value = clamp(pan, -1, 1);
  p.connect(dest);
  return p;
}

/** A left/right pair of panners at ±`width` (shared by the notes of one sound to save nodes). */
export function stereoPair(v, width = 0.35, dest = v.out) {
  return [panNode(v, -width, dest), panNode(v, width, dest)];
}

/**
 * Single oscillator with a percussive envelope.
 * @param {Voice} v
 * @param {object} o
 * @param {number} o.t          start time
 * @param {number} o.freq       frequency (Hz)
 * @param {number} o.peak       peak gain
 * @param {string} [o.type]     'sine'|'triangle'|'sawtooth'|'square'
 * @param {string} [o.wave]     named PeriodicWave (overrides type)
 * @param {number} [o.attack]   attack time (s)
 * @param {number} [o.decay]    time to decay to −60 dB (s)
 * @param {number} [o.hold]     hold at peak before decaying (s)
 * @param {number} [o.glideTo]  target frequency of an exponential pitch glide
 * @param {number} [o.glideTime]
 * @param {number} [o.detune]   cents
 * @param {AudioNode} [o.dest]
 * @returns {number} end time
 */
export function tone(v, o) {
  const ctx = v.ctx;
  if (o.freq >= maxFreq(ctx)) return o.t;
  const osc = ctx.createOscillator();
  if (o.wave) osc.setPeriodicWave(getWave(ctx, o.wave));
  else osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(o.freq, o.t);
  if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(o.glideTo, o.t + (o.glideTime || 0.1));
  if (o.detune) osc.detune.value = o.detune;
  const g = gainNode(v, 0, o.dest || v.out);
  osc.connect(g);
  const end = percEnv(g.gain, o.t, o.peak, o.attack ?? 0.003, o.decay ?? 0.3, o.hold || 0);
  v.play(osc, o.t, end + 0.005);
  return end;
}

/**
 * Two-operator FM note: a sine carrier phase-modulated by a sine at `ratio` × freq. The
 * modulation index decays faster than the amplitude, so each note starts bright ("ting") and
 * mellows into a pure tone – the basis of the glass / bell / kalimba timbres.
 * @param {object} o  like tone(), plus ratio (default 3), index (default 1.5),
 *                    indexDecay (s, default decay * 0.35)
 * @returns {number} end time
 */
export function fm(v, o) {
  const ctx = v.ctx;
  const f = o.freq;
  if (f >= maxFreq(ctx)) return o.t;
  const ratio = o.ratio || 3;
  const decay = o.decay ?? 0.5;
  const attack = o.attack ?? 0.002;
  // Keep the brightest sideband (≈ f + (index + 1) · ratio · f) under the synthesis ceiling.
  const maxIndex = Math.max(0, (maxFreq(ctx) / f - 1) / ratio - 1);
  const index = Math.min(o.index ?? 1.5, maxIndex);

  // Chromium quirk: an oscillator whose frequency has an AudioParam *input* and that starts in
  // the middle of a 128-frame render quantum gets its modulation misaligned for that first
  // quantum, which leaves a small kink at the next quantum boundary. Starting both oscillators
  // one quantum early – while the envelope is still at 0 – keeps the audible part clean.
  const preRoll = Math.max(ctx.currentTime, o.t - (128 / ctx.sampleRate + 0.0005));
  const car = ctx.createOscillator();
  car.frequency.value = f;
  if (o.detune) car.detune.value = o.detune;
  const g = gainNode(v, 0, o.dest || v.out);
  car.connect(g);
  const end = percEnv(g.gain, o.t, o.peak, attack, decay, o.hold || 0);
  v.play(car, preRoll, end + 0.005);

  if (index > 0.01) {
    const mod = ctx.createOscillator();
    mod.frequency.value = f * ratio;
    if (o.detune) mod.detune.value = o.detune;
    const depth = gainNode(v, 0);
    mod.connect(depth);
    depth.connect(car.frequency);
    const dev = index * f * ratio; // peak frequency deviation (Hz)
    const iDecay = o.indexDecay ?? decay * 0.35;
    const iEnd = Math.min(end - ZERO_RAMP, o.t + attack + iDecay);
    depth.gain.setValueAtTime(dev, o.t);
    depth.gain.exponentialRampToValueAtTime(dev * 0.02, iEnd);
    depth.gain.linearRampToValueAtTime(0, iEnd + ZERO_RAMP);
    v.play(mod, preRoll, iEnd + ZERO_RAMP + 0.005);
  }
  return end;
}

/**
 * Marimba / wooden mallet: fundamental plus the characteristic 4th and 10th partials, which
 * die away much faster than the fundamental.
 * @returns {number} end time
 */
export function mallet(v, { t, freq, peak, decay = 0.5, dest = v.out, bright = 1 }) {
  const end = tone(v, { t, freq, peak, attack: 0.002, decay, dest });
  tone(v, { t, freq: freq * 4, peak: peak * 0.3 * bright, attack: 0.001, decay: decay * 0.16, dest });
  tone(v, { t, freq: freq * 10, peak: peak * 0.07 * bright, attack: 0.001, decay: decay * 0.05, dest });
  return end;
}

/** Glassy high "ping" (sparkle): soft FM with a short, bright transient. */
export function ping(v, { t, freq, peak, decay = 0.25, pan = 0, dest = v.out }) {
  return fm(v, {
    t, freq, peak, decay, ratio: 2, index: 0.6, indexDecay: 0.04,
    dest: panNode(v, pan, dest),
  });
}

/**
 * Filtered noise burst (whooshes, impacts, card riffles).
 * @param {object} o
 * @param {number} o.t
 * @param {number} o.peak
 * @param {number} [o.attack]
 * @param {number} [o.decay]
 * @param {number} [o.hold]
 * @param {string} [o.filter]   biquad type (default 'bandpass')
 * @param {number} o.freq       filter frequency at t
 * @param {number} [o.freqTo]   filter frequency at t + sweep (exponential)
 * @param {number} [o.sweep]    sweep time (default attack + hold + decay)
 * @param {number} [o.q]
 * @param {number} [o.pan]
 * @param {AudioNode} [o.dest]
 * @returns {number} end time
 */
export function noise(v, o) {
  const ctx = v.ctx;
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  src.loop = true;
  const dest = panNode(v, o.pan || 0, o.dest || v.out);
  const g = gainNode(v, 0, dest);
  const f = filterNode(v, o.filter || 'bandpass', o.freq, o.q ?? 0.8, g);
  src.connect(f);
  const attack = o.attack ?? 0.005;
  const decay = o.decay ?? 0.2;
  const end = percEnv(g.gain, o.t, o.peak, attack, decay, o.hold || 0);
  if (o.freqTo) {
    const sweep = o.sweep ?? (attack + (o.hold || 0) + decay);
    f.frequency.setValueAtTime(o.freq, o.t);
    f.frequency.exponentialRampToValueAtTime(o.freqTo, o.t + sweep);
  }
  // Random read position so repeated bursts never sound identical.
  v.play(src, o.t, end + 0.005, Math.random() * 0.9);
  return end;
}

/**
 * A shower of glassy pings on random pentatonic notes.
 * @param {Voice} v
 * @param {object} o
 * @param {number} o.t        start
 * @param {number} o.count
 * @param {number} o.spread   time span (s)
 * @param {number} o.root     MIDI root of the pentatonic range
 * @param {number} [o.steps]  number of pentatonic steps above root to choose from
 * @param {number} o.peak
 * @param {boolean} [o.rising] notes climb instead of being random
 */
export function sparkles(v, { t, count, spread, root, steps = 7, peak, rising = false, dest = v.out }) {
  // Two shared panners (left / right) instead of one per ping keeps the node count low.
  const sides = stereoPair(v, 0.6, dest);
  for (let i = 0; i < count; i++) {
    const k = count > 1 ? i / (count - 1) : 0;
    const step = rising ? Math.round(k * steps) : Math.floor(Math.random() * steps);
    const when = t + (rising ? k * spread : Math.random() * spread);
    ping(v, {
      t: when,
      freq: mtof(pentaNote(root, step)),
      peak: peak * rand(0.6, 1) * (1 - 0.35 * k),
      decay: rand(0.12, 0.3),
      dest: sides[rising ? i & 1 : Math.random() < 0.5 ? 0 : 1],
    });
  }
}

/**
 * Sustained soft chord (warm timbre, two slightly detuned oscillators per note) through one
 * shared low-pass filter. Used for celebratory beds under the bell arpeggios.
 * @returns {number} end time
 */
export function padChord(v, {
  t, notes, peak, attack = 0.05, hold = 0.2, decay = 1.2, cutoff = 2200, cutoffTo = 0, sweep = 0.3, dest = v.out,
}) {
  const f = filterNode(v, 'lowpass', cutoff, 0.5, dest);
  if (cutoffTo) {
    // Filter "bloom": opens to cutoffTo, then settles back towards the base cutoff.
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(cutoffTo, t + sweep);
    f.frequency.exponentialRampToValueAtTime(Math.max(cutoff, cutoffTo * 0.4), t + attack + hold + decay);
  }
  let end = t;
  for (const m of notes) {
    const freq = mtof(m);
    for (const det of [-7, 7]) {
      end = Math.max(end, tone(v, { t, freq, wave: 'warm', peak, attack, hold, decay, detune: det, dest: f }));
    }
  }
  return end;
}

/**
 * Soft "brass" note for fanfares: warm oscillator through a low-pass whose cutoff opens with the
 * attack and closes as the note decays.
 * @returns {number} end time
 */
export function brass(v, { t, freq, peak, attack = 0.02, hold = 0.05, decay = 0.4, dest = v.out }) {
  const f = filterNode(v, 'lowpass', freq * 1.5, 0.6, dest);
  f.frequency.setValueAtTime(freq * 1.5, t);
  f.frequency.exponentialRampToValueAtTime(Math.min(freq * 6, 6000), t + attack + 0.01);
  f.frequency.exponentialRampToValueAtTime(freq * 2, t + attack + hold + decay);
  let end = t;
  for (const det of [-6, 6]) {
    end = Math.max(end, tone(v, { t, freq, wave: 'warm', peak, attack, hold, decay, detune: det, dest: f }));
  }
  return end;
}
