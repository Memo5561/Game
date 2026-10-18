// Mixer: the complete audio graph for one BaseAudioContext.
//
//   sfx voices ──► sfxBus ──────────────────────────────┐
//                    └─► room send ─► small reverb ─────┤
//   music pads ───► padFade ───┐                        ├─► master ─► compressor ─► soft clip ─► out
//   music plucks ─► pluckFade ─┼─► musicIn ─► duck ─► musicBus
//                              └─► music echo ─► musicIn
//
// It also implements polyphony limiting (voice stealing), per-sound retrigger limits, music
// ducking under big effects, and music sessions that fade in/out (and crossfade on restart).
// The Mixer is context-agnostic: the game uses it with the live AudioContext (see sfx.js),
// tools/audio-check.mjs uses it with OfflineAudioContexts to measure the real output.

import { renderToContext } from './sounds.js';
import { MusicPlanner, renderMusicEvent, EIGHTH } from './music.js';
import { nodeStats } from './synth.js';

/** Bus levels (linear gain). Music sits well below the effects. */
export const MIX = Object.freeze({
  master: 0.8,
  sfx: 1.0,
  music: 0.36,
  sfxRoom: 0.2,
  musicEcho: 0.32,
});

/** Max simultaneous sound-effect events; the oldest is faded out when exceeded. */
export const MAX_VOICES = 24;
/** Max simultaneous instances of one sound (oldest stolen); default for unlisted names. */
const NAME_CAP = { coin: 4, place: 3, click: 2, tick: 2, pickup: 2, return: 2, invalid: 2, star: 3 };
const DEFAULT_CAP = 2;
/** Minimum time between two starts of the same sound (s) – protects against spamming. */
const MIN_INTERVAL = { coin: 0.04, click: 0.04, tick: 0.08, place: 0.03 };
const DEFAULT_MIN_INTERVAL = 0.03;
/** Scheduling margin so attacks are never truncated by the render-quantum boundary (s). */
const START_MARGIN = 0.005;

/**
 * Music ducking for big moments → [gain while ducked, hold time (s)] or null.
 * @returns {number[]|null}
 */
function duckFor(name, o) {
  switch (name) {
    case 'allclear': case 'newbest': case 'levelwin': case 'gameover':
      return [0.45, 1.0];
    case 'revive': case 'reward': case 'unlock': case 'levelfail':
      return [0.6, 0.7];
    case 'clear':
      return (o.lines || 1) >= 2 || (o.combo || 1) >= 3 ? [0.6, 0.4] : [0.8, 0.25];
    case 'praise': case 'combo': case 'hammer':
      return [0.7, 0.35];
    default:
      return null;
  }
}

/** Soft-clip transfer curve: linear up to 0.8, then a tanh knee approaching 0.9 (never above). */
function softClipCurve() {
  const n = 2049;
  const curve = new Float32Array(n);
  const knee = 0.8;
  const range = 0.1;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + range * Math.tanh((a - knee) / range);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

/** Schedules `param` to move linearly from its current value to `value` between t and t + dur. */
function rampParam(param, value, t, dur) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
  else {
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
  }
  param.linearRampToValueAtTime(value, t + dur);
}

/**
 * Builds a small, bright "room" reverb: a ConvolverNode with a generated impulse response (0.6 s
 * of decorrelated stereo noise, exponentially decaying and getting darker over time). Gives the
 * chimes air without the flutter of discrete echoes. Mono in (cheaper), stereo out. Chromium
 * stops processing a convolver once its input has been silent for longer than the IR, so it costs
 * next to nothing between sounds. Returns the input node.
 */
function buildRoom(ctx, output, { seconds = 0.6, preDelay = 0.006, highpass = 250 } = {}) {
  const sr = ctx.sampleRate;
  const len = Math.round(seconds * sr);
  const ir = ctx.createBuffer(2, len, sr);
  const fadeLen = Math.round(0.01 * sr);
  const start = Math.round(preDelay * sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    let energy = 0;
    for (let i = start; i < len; i++) {
      const k = (i - start) / (len - start); // 0 → 1 over the tail
      const smooth = 0.75 - 0.6 * k; // one-pole low-pass coefficient: darker towards the end
      lp += smooth * ((Math.random() * 2 - 1) - lp);
      let x = lp * Math.exp(-6.9 * k); // −60 dB at the end
      if (i - start < 48) x *= (i - start) / 48; // soft onset
      if (i > len - fadeLen) x *= (len - i) / fadeLen;
      d[i] = x;
      energy += x * x;
    }
    const norm = 1 / Math.sqrt(energy || 1); // unit energy: the send gain sets the wet level
    for (let i = 0; i < len; i++) d[i] *= norm;
  }
  const input = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = highpass;
  const conv = ctx.createConvolver();
  conv.normalize = false;
  try {
    conv.channelCount = 1;
    conv.channelCountMode = 'explicit';
  } catch (e) { /* older engines: stereo input is fine too */ }
  conv.buffer = ir;
  input.connect(hp);
  hp.connect(conv);
  conv.connect(output);
  return input;
}

/**
 * Builds a feedback echo: input ─► high-pass ─► N delay taps (each darker on every repeat,
 * panned apart) ─► output. Returns the input node. All nodes are persistent (built once).
 */
function buildEcho(ctx, output, { times, feedback, cutoff, pans, highpass = 300 }) {
  const input = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = highpass;
  input.connect(hp);
  for (let i = 0; i < times.length; i++) {
    const delay = ctx.createDelay(2);
    delay.delayTime.value = times[i];
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = cutoff;
    damp.Q.value = 0.5;
    const fb = ctx.createGain();
    fb.gain.value = feedback;
    hp.connect(delay);
    delay.connect(damp);
    damp.connect(fb);
    fb.connect(delay);
    let tail = damp;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pans[i] || 0;
      damp.connect(p);
      tail = p;
    }
    tail.connect(output);
  }
  return input;
}

export class Mixer {
  /**
   * @param {BaseAudioContext} ctx
   * @param {object} [o]
   * @param {boolean} [o.softClip]   final safety soft-clipper (default true)
   * @param {number} [o.maxVoices]   polyphony limit for sound effects
   * @param {AudioNode} [o.destination] final output (default ctx.destination)
   */
  constructor(ctx, { softClip = true, maxVoices = MAX_VOICES, destination = ctx.destination } = {}) {
    this.ctx = ctx;
    this.maxVoices = maxVoices;
    /** Active sound-effect voices, oldest first. */
    this.voices = [];
    /** Last start time per sound name (retrigger limit). */
    this.lastStart = Object.create(null);
    /** Current music session or null; sessions still fading out after stopMusic(). */
    this.music = null;
    this._fading = [];
    this._events = [];
    this._duckLevel = 1;
    this._duckUntil = 0;
    this._onSfxDispose = (v) => {
      const i = this.voices.indexOf(v);
      if (i >= 0) this.voices.splice(i, 1);
    };

    // Master: gain → gentle limiter (compressor) → optional soft clip → destination.
    this.master = ctx.createGain();
    this.master.gain.value = MIX.master;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 6;
    comp.ratio.value = 12;
    comp.attack.value = 0.002;
    comp.release.value = 0.2;
    this.master.connect(comp);
    this.compressor = comp;
    if (softClip) {
      const clip = ctx.createWaveShaper();
      clip.curve = softClipCurve();
      clip.oversample = 'none';
      comp.connect(clip);
      clip.connect(destination);
    } else {
      comp.connect(destination);
    }

    // Sound-effect bus with a subtle stereo room reverb.
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = MIX.sfx;
    this.sfxBus.connect(this.master);
    const roomSend = ctx.createGain();
    roomSend.gain.value = MIX.sfxRoom;
    this.sfxBus.connect(roomSend);
    roomSend.connect(buildRoom(ctx, this.master));

    // Music bus: sessions → musicIn → duck → musicBus → master. Plucks also feed a tempo-synced
    // ping-pong echo (dotted eighth / quarter).
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = MIX.music;
    this.musicBus.connect(this.master);
    this.musicDuck = ctx.createGain();
    this.musicDuck.connect(this.musicBus);
    this.musicIn = ctx.createGain();
    this.musicIn.connect(this.musicDuck);
    this.musicEchoIn = ctx.createGain();
    this.musicEchoIn.gain.value = MIX.musicEcho;
    this.musicEchoIn.connect(buildEcho(ctx, this.musicIn, {
      times: [EIGHTH * 1.5, EIGHTH * 2], feedback: 0.38, cutoff: 2200, pans: [-0.5, 0.5], highpass: 200,
    }));
  }

  // --- sound effects -------------------------------------------------------------------------

  /**
   * Plays a sound effect.
   * @param {string} name
   * @param {object} [opts]
   * @param {number} [when] context time (default: now)
   * @returns {import('./synth.js').Voice|null}
   */
  play(name, opts, when) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const t = Math.max(typeof when === 'number' && isFinite(when) ? when : now + START_MARGIN, now);
    const o = opts || {};

    const last = this.lastStart[name];
    const gap = MIN_INTERVAL[name] ?? DEFAULT_MIN_INTERVAL;
    if (last !== undefined && t >= last && t - last < gap) return null;

    this.prune(now);
    // Per-sound cap, then global cap: fade out the oldest active voice.
    const cap = NAME_CAP[name] || DEFAULT_CAP;
    let same = 0;
    let oldestSame = null;
    let active = 0;
    let oldest = null;
    for (const v of this.voices) {
      if (v.released) continue;
      active++;
      if (!oldest) oldest = v;
      if (v.name === name) {
        same++;
        if (!oldestSame) oldestSame = v;
      }
    }
    if (same >= cap && oldestSame) {
      oldestSame.release(t, 0.025);
      if (oldestSame === oldest) oldest = null;
      active--;
    }
    if (active >= this.maxVoices) {
      if (!oldest) oldest = this.voices.find((v) => !v.released) || null;
      if (oldest) oldest.release(t, 0.025);
    }

    const v = renderToContext(ctx, this.sfxBus, name, o, t);
    if (!v) return null;
    this.lastStart[name] = t;
    if (!v.done) {
      v.onDispose = this._onSfxDispose;
      this.voices.push(v);
    }
    const duck = duckFor(name, o);
    if (duck) this.duck(duck[0], duck[1], t);
    return v;
  }

  /** Fades all sound effects out quickly (mute / app background). */
  stopAllSfx(when) {
    const t = Math.max(when ?? this.ctx.currentTime, this.ctx.currentTime);
    for (const v of this.voices.slice()) v.release(t, 0.03);
  }

  /**
   * Lowers the music to `level` for `hold` seconds, then recovers smoothly. Overlapping ducks
   * combine (deepest level, latest end), so a small effect never lifts the music during a big one.
   */
  duck(level, hold, when) {
    const t = Math.max(when ?? this.ctx.currentTime, this.ctx.currentTime);
    let end = t + 0.06 + hold;
    const active = t < this._duckUntil;
    if (active) {
      if (this._duckLevel <= level && this._duckUntil >= end) return;
      level = Math.min(level, this._duckLevel);
      end = Math.max(end, this._duckUntil);
    }
    this._duckLevel = level;
    this._duckUntil = end;
    const p = this.musicDuck.gain;
    try {
      rampParam(p, level, t, 0.06);
      p.setValueAtTime(level, end);
      p.linearRampToValueAtTime(1, end + 0.9);
    } catch (e) { /* ignore */ }
  }

  /**
   * Ramps the master level (0..1 of the nominal level) over `dur` seconds, optionally jumping to
   * `from` first – e.g. fadeMaster(1, 0.35, undefined, 0) for a smooth return from background.
   */
  fadeMaster(level, dur, when, from) {
    const t = Math.max(when ?? this.ctx.currentTime, this.ctx.currentTime);
    const p = this.master.gain;
    try {
      if (typeof from === 'number') {
        p.cancelScheduledValues(t);
        p.setValueAtTime(MIX.master * from, t);
        p.linearRampToValueAtTime(MIX.master * level, t + dur);
      } else {
        rampParam(p, MIX.master * level, t, dur);
      }
    } catch (e) { /* ignore */ }
  }

  /** Disposes voices whose end time passed long ago (safety net if an `ended` event was lost). */
  prune(now = this.ctx.currentTime) {
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      if (v && v.end + 0.5 < now) v.dispose();
    }
    for (let s = -1; s < this._fading.length; s++) {
      const m = s < 0 ? this.music : this._fading[s];
      if (!m) continue;
      for (let i = m.voices.length - 1; i >= 0; i--) {
        const v = m.voices[i];
        if (v && v.end + 0.5 < now) v.dispose();
      }
    }
  }

  // --- music ---------------------------------------------------------------------------------

  get musicPlaying() {
    return !!this.music;
  }

  /**
   * Starts a new music session (fade-in). A previous session that is still fading out keeps
   * fading, so a quick stop → start crossfades instead of cutting.
   * @returns {boolean} true if a session was started
   */
  startMusic(when, fadeIn = 3) {
    if (this.music) return false;
    const ctx = this.ctx;
    const t = Math.max(when ?? ctx.currentTime, ctx.currentTime);
    const padFade = ctx.createGain();
    const pluckFade = ctx.createGain();
    for (const g of [padFade, pluckFade]) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + fadeIn);
    }
    padFade.connect(this.musicIn);
    pluckFade.connect(this.musicIn);
    pluckFade.connect(this.musicEchoIn);
    const session = {
      padFade,
      pluckFade,
      outs: { pad: padFade, pluck: pluckFade },
      planner: new MusicPlanner({ startTime: t + 0.05 }),
      voices: [],
      stopped: false,
    };
    session.onVoiceDispose = (v) => {
      const i = session.voices.indexOf(v);
      if (i >= 0) session.voices.splice(i, 1);
      if (session.stopped && !session.voices.length) this._disposeSession(session);
    };
    this.music = session;
    return true;
  }

  /** Schedules music events up to context time `until` (call regularly with a lookahead). */
  scheduleMusic(until) {
    const m = this.music;
    if (!m) return;
    const events = m.planner.planUntil(until, this._events);
    for (let i = 0; i < events.length; i++) {
      const v = renderMusicEvent(this.ctx, m.outs, events[i]);
      if (v && !v.done) {
        v.onDispose = m.onVoiceDispose;
        m.voices.push(v);
      }
    }
    events.length = 0;
  }

  /** Fades the current music session out and releases its nodes afterwards. */
  stopMusic(when, fadeOut = 1.5) {
    const m = this.music;
    if (!m) return;
    this.music = null;
    m.stopped = true;
    const t = Math.max(when ?? this.ctx.currentTime, this.ctx.currentTime);
    try {
      rampParam(m.padFade.gain, 0, t, fadeOut);
      rampParam(m.pluckFade.gain, 0, t, fadeOut);
    } catch (e) { /* ignore */ }
    for (const v of m.voices.slice()) v.release(t + fadeOut, 0.02);
    if (m.voices.length) this._fading.push(m);
    else this._disposeSession(m);
  }

  _disposeSession(m) {
    const i = this._fading.indexOf(m);
    if (i >= 0) this._fading.splice(i, 1);
    for (const g of [m.padFade, m.pluckFade]) {
      try { g.disconnect(); } catch (e) { /* ignore */ }
    }
  }

  // --- diagnostics ---------------------------------------------------------------------------

  stats() {
    let active = 0;
    for (const v of this.voices) if (!v.released) active++;
    return {
      sfxVoices: this.voices.length,
      sfxActive: active,
      musicVoices: this.music ? this.music.voices.length : 0,
      musicPlaying: !!this.music,
      liveNodes: nodeStats.live,
    };
  }
}
