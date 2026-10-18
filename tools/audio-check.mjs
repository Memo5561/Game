// Objective audio QA for the synthesized sound (game/js/audio/*): renders every sound effect and
// 30 s of music through the real master chain into OfflineAudioContexts in headless Chromium,
// measures them and checks them against limits (no clipping, no NaN, no DC, click-free edges,
// consistent loudness, sane brightness, bounded polyphony, music variety over 10 minutes).
//
// Usage: node tools/audio-check.mjs [--no-wav] [--music=30] [--no-live]
//   Writes WAV files to tools/out/audio/ (gitignored) unless --no-wav is given.
//   Exit code 1 if any check fails.
//
// Also used by tests/e2e/audio.spec.mjs via runAudioCheck().

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';
import { MusicPlanner, EIGHTH } from '../game/js/audio/music.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'tools', 'out', 'audio');
const PAGE_PATH = '__audio-check.html';
const SAMPLE_RATE = 48000;

/** Sounds (and option variants) to measure; `cat` selects the loudness window. */
export const CASES = [
  { name: 'click', cat: 'ui' },
  { name: 'tick', cat: 'ui' },
  { name: 'pickup', cat: 'light' },
  { name: 'return', cat: 'light' },
  { name: 'invalid', cat: 'light' },
  { name: 'place', opts: { cells: 1 }, cat: 'core', label: 'place cells=1' },
  { name: 'place', cat: 'core' },
  { name: 'place', opts: { cells: 9 }, cat: 'core', label: 'place cells=9' },
  { name: 'clear', opts: { lines: 1, combo: 1 }, cat: 'core', label: 'clear 1L c1' },
  { name: 'clear', opts: { lines: 2, combo: 3 }, cat: 'core', label: 'clear 2L c3' },
  { name: 'clear', opts: { lines: 3, combo: 6 }, cat: 'core', label: 'clear 3L c6' },
  { name: 'clear', opts: { lines: 4, combo: 10 }, cat: 'core', label: 'clear 4L c10' },
  { name: 'clear', opts: { lines: 6, combo: 14 }, cat: 'core', label: 'clear 6L c14' },
  { name: 'combo', opts: { combo: 2 }, cat: 'core', label: 'combo 2' },
  { name: 'combo', opts: { combo: 10 }, cat: 'core', label: 'combo 10' },
  { name: 'praise', opts: { level: 1 }, cat: 'core', label: 'praise 1' },
  { name: 'praise', opts: { level: 3 }, cat: 'core', label: 'praise 3' },
  { name: 'praise', opts: { level: 5 }, cat: 'core', label: 'praise 5' },
  { name: 'coin', cat: 'core' },
  { name: 'star', opts: { index: 0 }, cat: 'core', label: 'star 0' },
  { name: 'star', opts: { index: 1 }, cat: 'core', label: 'star 1' },
  { name: 'star', opts: { index: 2 }, cat: 'core', label: 'star 2' },
  { name: 'hammer', cat: 'core' },
  { name: 'shuffle', cat: 'core' },
  { name: 'unlock', cat: 'core' },
  { name: 'reward', cat: 'core' },
  { name: 'gameover', cat: 'core' },
  { name: 'levelfail', cat: 'core' },
  { name: 'revive', cat: 'big' },
  { name: 'levelwin', cat: 'big' },
  { name: 'newbest', cat: 'big' },
  { name: 'allclear', cat: 'big' },
];

/**
 * Loudness windows (dBFS) per category, measured as "speaker loudness": the loudest 100 ms of the
 * signal after a phone-speaker weighting (high-pass 250 Hz + K-style +4 dB shelf above 1.5 kHz).
 */
export const LOUDNESS = {
  ui: [-33, -21],
  light: [-28, -16],
  core: [-25, -14],
  big: [-19, -9],
};

export const LIMITS = {
  peak: 0.9, // after the full master chain
  preClipPeak: 0.8, // compressor output: the safety soft-clipper must never engage
  maxDuration: 3.5, // s until −60 dB
  dc: 0.002,
  edge: 1e-4, // |first sample| and |last sample| of the render
  onset: 0.5, // level after 0.5 ms relative to the peak (no instant-on clicks)
  centroid: 4500, // Hz, spectral centroid of the loudest moment (harshness proxy)
  click: 6, // max isolated 2nd-difference spike relative to its local RMS (see self-test)
  musicPeak: 0.5,
  musicRms: [-38, -24],
  musicMinSecond: -52, // quietest 1 s window after the fade-in (never goes silent)
  musicMaxSecond: -18,
  stressPeak: 0.9,
  musicSources: 48, // simultaneous oscillators in the music (CPU budget)
};

const START = 0.05; // sound start inside the offline render (s)

// -------------------------------------------------------------------------------------------
// Page-side code (serialized by Playwright – must be self-contained)
// -------------------------------------------------------------------------------------------

/* eslint-disable no-inner-declarations */
async function pageMain(cfg) {
  const audio = await import('/game/js/audio/sfx.js');
  const { Mixer } = audio;
  const sr = cfg.sampleRate;

  // --- DSP helpers -------------------------------------------------------------------------
  function biquadCoeffs(type, f0, q, gainDb) {
    const A = Math.pow(10, gainDb / 40);
    const w0 = (2 * Math.PI * f0) / sr;
    const cs = Math.cos(w0);
    const sn = Math.sin(w0);
    const alpha = sn / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'highpass') {
      b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2;
      a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
    } else { // highshelf
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cs + s);
      b1 = -2 * A * ((A - 1) + (A + 1) * cs);
      b2 = A * ((A + 1) + (A - 1) * cs - s);
      a0 = (A + 1) - (A - 1) * cs + s;
      a1 = 2 * ((A - 1) - (A + 1) * cs);
      a2 = (A + 1) - (A - 1) * cs - s;
    }
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  }
  function filter(x, c) {
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = c[0] * x[i] + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  }
  function prefixPower(x) {
    const p = new Float64Array(x.length + 1);
    for (let i = 0; i < x.length; i++) p[i + 1] = p[i] + x[i] * x[i];
    return p;
  }
  function maxWindowRms(p, from, to, win) {
    let best = 0;
    let bestAt = from;
    const hop = Math.max(1, Math.floor(win / 5));
    for (let i = from; i + win <= to || i === from; i += hop) {
      const j = Math.min(to, i + win);
      const ms = (p[j] - p[i]) / Math.max(1, j - i);
      if (ms > best) { best = ms; bestAt = i; }
      if (j >= to) break;
    }
    return [Math.sqrt(best), bestAt];
  }
  function db(x) {
    return x > 0 ? 20 * Math.log10(x) : -Infinity;
  }
  function centroid(x, center) {
    const N = 4096;
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    const off = Math.max(0, Math.min(x.length - N, center - N / 2));
    for (let i = 0; i < N; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
      re[i] = (x[off + i] || 0) * w;
    }
    for (let i = 1, j = 0; i < N; i++) { // bit reversal
      let bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= N; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      for (let i = 0; i < N; i += len) {
        for (let k = 0; k < len / 2; k++) {
          const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
          const ur = re[i + k], ui = im[i + k];
          const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
          const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        }
      }
    }
    let num = 0, den = 0;
    for (let k = 1; k < N / 2; k++) {
      const mag = Math.hypot(re[k], im[k]);
      num += mag * (k * sr) / N;
      den += mag;
    }
    return den > 0 ? num / den : 0;
  }

  /** Measures a rendered buffer; `start` = scheduled sound start (s). */
  function analyze(buf, start) {
    const n = buf.length;
    const chs = [];
    for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
    const mono = new Float32Array(n);
    const env = new Float32Array(n);
    let nonFinite = 0;
    let peak = 0;
    let power = 0;
    for (let i = 0; i < n; i++) {
      let m = 0, e = 0;
      for (const ch of chs) {
        const x = ch[i];
        if (!Number.isFinite(x)) { nonFinite++; continue; }
        const a = Math.abs(x);
        if (a > e) e = a;
        m += x;
      }
      mono[i] = m / chs.length;
      env[i] = e;
      if (e > peak) peak = e;
    }
    let first = -1, last = -1;
    for (let i = 0; i < n; i++) {
      if (env[i] > 0.001) { if (first < 0) first = i; last = i; }
    }
    const s0 = Math.round(start * sr);
    const res = {
      nonFinite, peak,
      duration: last >= 0 ? (last + 1) / sr - start : 0,
      firstSample: env[0], lastSample: env[n - 1],
      tailMax: 0,
      onset: 0,
      clickAt: 0,
      rmsDb: -Infinity, loudDb: -Infinity, spkDb: -Infinity, dc: 0, centroid: 0, click: 0,
    };
    for (let i = Math.max(0, n - Math.round(0.01 * sr)); i < n; i++) res.tailMax = Math.max(res.tailMax, env[i]);
    if (first < 0) return res;
    // Onset steepness: level reached within 0.5 ms after the signal first exceeds −80 dBFS,
    // relative to the sound's peak (an instant-on click would be close to 1).
    let o0 = s0;
    while (o0 < n && env[o0] < 1e-4) o0++;
    for (let i = o0; i < Math.min(n, o0 + Math.round(0.0005 * sr)); i++) res.onset = Math.max(res.onset, env[i]);
    res.onset /= peak || 1;

    let dcSum = 0;
    for (let i = first; i <= last; i++) {
      dcSum += mono[i];
      for (const ch of chs) power += ch[i] * ch[i];
    }
    res.dc = dcSum / (last - first + 1);
    res.rmsDb = db(Math.sqrt(power / ((last - first + 1) * chs.length)));
    const pMono = prefixPower(mono);
    const [loud, loudAt] = maxWindowRms(pMono, first, last + 1, Math.round(0.05 * sr));
    res.loudDb = db(loud);
    const spk = filter(filter(mono, biquadCoeffs('highpass', 250, 0.707, 0)), biquadCoeffs('highshelf', 1500, 0.707, 4));
    res.spkDb = db(maxWindowRms(prefixPower(spk), first, last + 1, Math.round(0.1 * sr))[0]);
    res.centroid = centroid(mono, loudAt + Math.round(0.025 * sr));

    // Click detector: isolated spikes of the 2nd difference relative to its local RMS (±2.7 ms,
    // excluding ±3 samples around the candidate so a click's own doublet does not mask it).
    const d2 = new Float32Array(n);
    for (let i = 2; i < n; i++) d2[i] = mono[i] - 2 * mono[i - 1] + mono[i - 2];
    const pd = prefixPower(d2);
    const half = 128;
    for (let i = first; i <= last; i++) {
      const a = Math.abs(d2[i]);
      if (a < 1e-4) continue;
      const lo = Math.max(0, i - half), hi = Math.min(n, i + half);
      const ex0 = Math.max(lo, i - 3), ex1 = Math.min(hi, i + 4);
      const local = Math.sqrt((pd[hi] - pd[lo] - (pd[ex1] - pd[ex0])) / Math.max(1, hi - lo - (ex1 - ex0)));
      const score = a / (local + 2e-4);
      if (score > res.click) { res.click = score; res.clickAt = i / sr; }
    }
    return res;
  }

  function toBase64Pcm(buf) {
    const n = buf.length;
    const chs = [];
    for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
    const pcm = new Int16Array(n * chs.length);
    for (let i = 0, k = 0; i < n; i++) {
      for (const ch of chs) {
        const x = Math.max(-1, Math.min(1, ch[i] || 0));
        pcm[k++] = Math.round(x * 32767);
      }
    }
    const bytes = new Uint8Array(pcm.buffer);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  async function render(seconds, softClip, schedule) {
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
    const mixer = new Mixer(ctx, { softClip });
    const extra = schedule(ctx, mixer) || {};
    const buf = await ctx.startRendering();
    return { buf, extra };
  }

  const out = { sounds: [], music: null, stress: null, spam: null, controls: {} };

  // --- detector self-test: deliberately clicky signals must be flagged -----------------------
  const controlsJob = (async () => {
    const step = await render(0.5, true, (ctx, mixer) => {
      // A 440 Hz cosine switched on and off instantly (classic click at both ends).
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(ctx.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0])));
      osc.frequency.value = 440;
      const g = ctx.createGain();
      g.gain.value = 0.2;
      osc.connect(g);
      g.connect(mixer.sfxBus);
      osc.start(0.1);
      osc.stop(0.2);
    });
    const subtle = await render(0.5, true, (ctx, mixer) => {
      // A soft 1.5 kHz tone whose level jumps by half mid-way (a small zipper click).
      const osc = ctx.createOscillator();
      osc.frequency.value = 1500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, 0.05);
      g.gain.linearRampToValueAtTime(0.12, 0.07);
      g.gain.setValueAtTime(0.12, 0.2003);
      g.gain.setValueAtTime(0.18, 0.2004);
      g.gain.linearRampToValueAtTime(0, 0.35);
      osc.connect(g);
      g.connect(mixer.sfxBus);
      osc.start(0.05);
      osc.stop(0.36);
    });
    out.controls.hardClick = analyze(step.buf, 0.1).click;
    out.controls.subtleClick = analyze(subtle.buf, 0.05).click;
  })();

  // --- every sound effect (offline contexts render on their own threads: run a few at once) --
  const measureCase = async (c) => {
    const seconds = cfg.quick ? 3.3 : 4.5;
    let nodes = 0;
    let sources = 0;
    const play = (ctx, mixer) => {
      const v = mixer.play(c.name, c.opts, cfg.start);
      nodes = v ? v.nodes.length : 0;
      sources = v ? v.sources.length : 0;
    };
    const [main, pre] = await Promise.all([render(seconds, true, play), render(seconds, false, play)]);
    const m = analyze(main.buf, cfg.start);
    m.nodes = nodes;
    m.sources = sources;
    m.preClipPeak = analyze(pre.buf, cfg.start).peak;
    m.label = c.label || c.name;
    m.name = c.name;
    m.cat = c.cat;
    if (cfg.wav) m.wav = toBase64Pcm(main.buf);
    return m;
  };
  for (let i = 0; i < cfg.cases.length; i += 4) {
    out.sounds.push(...(await Promise.all(cfg.cases.slice(i, i + 4).map(measureCase))));
  }

  // --- music -------------------------------------------------------------------------------
  const musicJob = (async () => {
    const seconds = cfg.musicSeconds;
    let budget = null;
    const { buf } = await render(seconds + 3, true, (ctx, mixer) => {
      mixer.startMusic(0);
      mixer.scheduleMusic(seconds);
      // Max concurrently alive music nodes / sources (sweep over the voices' lifetimes).
      const edges = [];
      for (const v of mixer.music.voices) {
        edges.push([v.start, v.nodes.length, v.sources.length], [v.end, -v.nodes.length, -v.sources.length]);
      }
      edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let n = 0, s = 0, maxN = 0, maxS = 0;
      for (const e of edges) {
        n += e[1]; s += e[2];
        maxN = Math.max(maxN, n); maxS = Math.max(maxS, s);
      }
      budget = { nodes: maxN, sources: maxS, voices: mixer.music.voices.length };
    });
    const m = analyze(buf, 0);
    m.budget = budget;
    const chs = [buf.getChannelData(0), buf.getChannelData(1)];
    const perSecond = [];
    for (let s = 0; s + 1 <= seconds; s++) {
      let p = 0;
      for (let i = s * sr; i < (s + 1) * sr; i++) p += (chs[0][i] ** 2 + chs[1][i] ** 2) / 2;
      perSecond.push(db(Math.sqrt(p / sr)));
    }
    m.perSecond = perSecond;
    if (cfg.wav) m.wav = toBase64Pcm(buf);
    out.music = m;
  })();

  // --- stress: the biggest moment of the game, all at once, over music -----------------------
  const stressJob = (async () => {
    const schedule = (ctx, mixer) => {
      mixer.startMusic(0, 0.5);
      mixer.scheduleMusic(6);
      const t = 1.0;
      mixer.play('place', { cells: 9 }, t);
      mixer.play('clear', { lines: 4, combo: 10 }, t);
      mixer.play('combo', { combo: 10 }, t);
      mixer.play('praise', { level: 5 }, t);
      mixer.play('allclear', {}, t + 0.05);
      mixer.play('newbest', {}, t + 0.1);
      mixer.play('star', { index: 2 }, t + 0.1);
      mixer.play('coin', {}, t + 0.15);
    };
    const main = await render(6, true, schedule);
    const pre = await render(6, false, schedule);
    const m = analyze(main.buf, 1.0);
    m.preClipPeak = analyze(pre.buf, 1.0).peak;
    if (cfg.wav) m.wav = toBase64Pcm(main.buf);
    out.stress = m;
  })();

  // --- spam: 150 random play() calls within 1.5 s (polyphony limiter + retrigger limits) -----
  const spamJob = (async () => {
    let maxActive = 0;
    let started = 0;
    const names = cfg.cases.map((c) => c.name);
    const { buf } = await render(6, true, (ctx, mixer) => {
      for (let i = 0; i < 150; i++) {
        const name = names[Math.floor(Math.random() * names.length)];
        const v = mixer.play(name, { lines: 1 + (i % 4), combo: 1 + (i % 10), level: 1 + (i % 5), index: i % 3 }, 0.05 + i * 0.01);
        if (v) started++;
        const active = mixer.voices.filter((x) => !x.released).length;
        if (active > maxActive) maxActive = active;
      }
    });
    const m = analyze(buf, 0.05);
    m.maxActive = maxActive;
    m.started = started;
    out.spam = m;
  })();

  await Promise.all([controlsJob, musicJob, stressJob, spamJob]);
  return out;
}

/** Live-API behaviour in a real (real-time) AudioContext. Returns a list of failure strings. */
async function pageLiveChecks() {
  const failures = [];
  const stats = {};
  const check = (cond, msg) => { if (!cond) failures.push(msg); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const { Sfx, audioDebugInfo, SOUND_NAMES } = await import('/game/js/audio/sfx.js');

  // Before unlock: everything is a silent no-op.
  Sfx.play('click');
  Sfx.startMusic();
  let info = audioDebugInfo();
  check(info.sfxVoices === 0 && !info.musicPlaying, `play/startMusic before unlock must be no-ops (${JSON.stringify(info)})`);
  Sfx.init();
  Sfx.play('place');
  check(audioDebugInfo().sfxVoices === 0, 'play() after init() but before unlock() must be a no-op');

  // Unlock via the button's gesture (the test page's click handler calls Sfx.unlock()).
  while (!window.__waitForUnlockClick) await wait(20);
  await window.__waitForUnlockClick;
  await wait(150);
  info = audioDebugInfo();
  check(info.contextState === 'running', `context should run after unlock (state ${info.contextState})`);
  check(info.musicPlaying && info.schedulerRunning, 'music requested before unlock should start after unlock');

  // All sounds play without throwing; spam is bounded by the polyphony limit.
  for (const n of SOUND_NAMES) Sfx.play(n, { lines: 3, combo: 4, level: 3, index: 1 });
  Sfx.play('no-such-sound');
  let maxActive = 0;
  for (let i = 0; i < 400; i++) {
    Sfx.play(SOUND_NAMES[i % SOUND_NAMES.length], { lines: 2, combo: i % 12, level: 1 + (i % 5), index: i % 3 });
    maxActive = Math.max(maxActive, audioDebugInfo().sfxActive);
  }
  check(maxActive <= 24, `polyphony limit exceeded: ${maxActive} active voices`);
  stats.spamMaxActive = maxActive;
  stats.spamStarted = audioDebugInfo().sfxVoices;
  await wait(700);
  check(audioDebugInfo().musicVoices > 0, 'music should have scheduled voices');

  // Music off → session fades and the scheduler stops.
  Sfx.setMusicEnabled(false);
  await wait(50);
  info = audioDebugInfo();
  check(!info.musicPlaying && !info.schedulerRunning, 'setMusicEnabled(false) should stop the music');
  // Sound off → play() is a no-op.
  Sfx.setSoundEnabled(false);
  Sfx.play('allclear');
  Sfx.setSoundEnabled(true);

  // Everything must be cleaned up after the tails ended (no node leaks).
  await wait(3200);
  info = audioDebugInfo();
  check(info.sfxVoices === 0, `sfx voices leaked: ${info.sfxVoices}`);
  check(info.liveNodes === 0, `audio nodes leaked: ${info.liveNodes}`);

  // Background / foreground.
  Sfx.setMusicEnabled(true);
  await wait(100);
  check(audioDebugInfo().musicPlaying, 'setMusicEnabled(true) should restart the requested music');
  Sfx.suspend();
  await wait(200);
  info = audioDebugInfo();
  check(info.contextState === 'suspended', `suspend() should suspend the context (${info.contextState})`);
  check(!info.schedulerRunning, 'scheduler must not run while suspended');
  Sfx.play('coin');
  check(audioDebugInfo().sfxVoices === 0, 'play() while suspended must be a no-op');
  Sfx.resume();
  await wait(250);
  info = audioDebugInfo();
  check(info.contextState === 'running', `resume() should resume the context (${info.contextState})`);
  check(info.musicPlaying && info.schedulerRunning, 'music should continue after resume()');
  // Music disabled while in background stays off after resume.
  Sfx.suspend();
  Sfx.setMusicEnabled(false);
  Sfx.resume();
  await wait(100);
  check(!audioDebugInfo().musicPlaying, 'music must stay off after resume() when disabled');
  Sfx.stopMusic();
  return { failures, stats };
}

/** Same API on a page without WebAudio: nothing may throw. */
async function pageNoAudioChecks() {
  const failures = [];
  try {
    const { Sfx, audioDebugInfo, SOUND_NAMES } = await import('/game/js/audio/sfx.js');
    Sfx.init();
    Sfx.unlock();
    Sfx.setSoundEnabled(true);
    Sfx.setMusicEnabled(true);
    Sfx.startMusic();
    for (const n of SOUND_NAMES) Sfx.play(n, {});
    Sfx.suspend();
    Sfx.resume();
    Sfx.stopMusic();
    const info = audioDebugInfo();
    if (info.supported) failures.push('audioDebugInfo().supported should be false without WebAudio');
  } catch (e) {
    failures.push(`API threw without WebAudio: ${e && e.message}`);
  }
  return failures;
}

// -------------------------------------------------------------------------------------------
// Node side
// -------------------------------------------------------------------------------------------

const TEST_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>audio check</title></head>
<body><button id="unlock" style="width:200px;height:80px">unlock</button>
<script type="module">
  const { Sfx } = await import('/game/js/audio/sfx.js');
  window.__waitForUnlockClick = new Promise((resolve) => {
    document.getElementById('unlock').addEventListener('click', () => { Sfx.unlock(); resolve(); });
  });
</script></body></html>`;

function writeWav(file, base64, channels, sr) {
  const data = Buffer.from(base64, 'base64');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sr, 24);
  header.writeUInt32LE(sr * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

/** Analyses `minutes` of planned music (pure planner, no audio) for variety and range. */
export function analyzePlan(minutes = 10) {
  const planner = new MusicPlanner({ startTime: 0 });
  const events = planner.planUntil(minutes * 60);
  const chords = events.filter((e) => e.type === 'chord');
  const plucks = events.filter((e) => e.type === 'pluck');
  const seq = chords.map((c) => `${c.key}:${c.name}`);
  const grams = new Map();
  for (let i = 0; i + 4 <= seq.length; i++) {
    const g = seq.slice(i, i + 4).join(' ');
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  let keyChanges = 0;
  for (let i = 1; i < chords.length; i++) if (chords[i].key !== chords[i - 1].key) keyChanges++;
  let immediateRepeats = 0;
  for (let i = 1; i < seq.length; i++) if (seq[i] === seq[i - 1]) immediateRepeats++;
  const padNotes = chords.flatMap((c) => c.notes);
  const perMinute = [];
  for (let m = 0; m < minutes; m++) perMinute.push(plucks.filter((p) => p.time >= m * 60 && p.time < (m + 1) * 60).length);
  // Longest stretch without any pluck (breathers are fine, long holes are not).
  let maxGap = 0;
  for (let i = 1; i < plucks.length; i++) maxGap = Math.max(maxGap, plucks[i].time - plucks[i - 1].time);
  const durations = chords.slice(0, -1).map((c, i) => chords[i + 1].time - c.time);
  return {
    minutes,
    chords: chords.length,
    distinctChords: new Set(seq).size,
    keyChanges,
    immediateRepeats,
    fourGrams: Math.max(0, seq.length - 3),
    distinctFourGrams: grams.size,
    maxFourGramCount: Math.max(0, ...grams.values()),
    chordSeconds: [Math.min(...durations), Math.max(...durations)],
    padRange: [Math.min(...padNotes), Math.max(...padNotes)],
    pluckRange: [Math.min(...plucks.map((p) => p.midi)), Math.max(...plucks.map((p) => p.midi))],
    plucksPerMinute: perMinute,
    maxPluckGap: maxGap,
    eighth: EIGHTH,
  };
}

function evaluate(report) {
  const f = [];
  for (const s of report.sounds) {
    const id = s.label;
    if (s.nonFinite) f.push(`${id}: ${s.nonFinite} non-finite samples`);
    if (s.peak > LIMITS.peak) f.push(`${id}: peak ${s.peak.toFixed(3)} > ${LIMITS.peak}`);
    if (s.preClipPeak > LIMITS.preClipPeak) f.push(`${id}: pre-clip peak ${s.preClipPeak.toFixed(3)} > ${LIMITS.preClipPeak}`);
    if (!(s.duration > 0.02)) f.push(`${id}: silent`);
    if (s.duration > LIMITS.maxDuration) f.push(`${id}: duration ${s.duration.toFixed(2)} s > ${LIMITS.maxDuration}`);
    if (Math.abs(s.dc) > LIMITS.dc) f.push(`${id}: DC offset ${s.dc.toExponential(2)}`);
    if (s.firstSample > LIMITS.edge || s.lastSample > LIMITS.edge || s.tailMax > LIMITS.edge) {
      f.push(`${id}: edges not silent (first ${s.firstSample}, last ${s.lastSample}, tail ${s.tailMax})`);
    }
    if (s.onset > LIMITS.onset) f.push(`${id}: onset too abrupt (${s.onset.toFixed(2)} of peak in 0.5 ms)`);
    if (s.centroid > LIMITS.centroid) f.push(`${id}: too bright/harsh (centroid ${Math.round(s.centroid)} Hz)`);
    if (s.click > LIMITS.click) f.push(`${id}: click suspected (score ${s.click.toFixed(1)})`);
    const [lo, hi] = LOUDNESS[s.cat];
    if (!(s.spkDb >= lo && s.spkDb <= hi)) f.push(`${id}: loudness ${s.spkDb.toFixed(1)} dB outside [${lo}, ${hi}] (${s.cat})`);
  }
  const mean = (cat) => {
    const xs = report.sounds.filter((s) => s.cat === cat).map((s) => s.spkDb);
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  if (!(mean('ui') < mean('light') && mean('light') < mean('core') && mean('core') < mean('big'))) {
    f.push(`loudness order ui < light < core < big violated (${['ui', 'light', 'core', 'big'].map((c) => mean(c).toFixed(1)).join(', ')})`);
  }
  const ladder = ['clear 1L c1', 'clear 2L c3', 'clear 3L c6', 'clear 4L c10'].map((l) => report.sounds.find((s) => s.label === l));
  if (ladder.every(Boolean) && !(ladder[3].spkDb > ladder[0].spkDb)) f.push('bigger clears should be louder than a single line');

  const m = report.music;
  if (m) {
    if (m.nonFinite) f.push(`music: ${m.nonFinite} non-finite samples`);
    if (m.peak > LIMITS.musicPeak) f.push(`music: peak ${m.peak.toFixed(3)} > ${LIMITS.musicPeak}`);
    if (!(m.rmsDb >= LIMITS.musicRms[0] && m.rmsDb <= LIMITS.musicRms[1])) f.push(`music: RMS ${m.rmsDb.toFixed(1)} dB outside ${LIMITS.musicRms}`);
    const body = m.perSecond.slice(4);
    if (Math.min(...body) < LIMITS.musicMinSecond) f.push(`music: drops to ${Math.min(...body).toFixed(1)} dB in a 1 s window`);
    if (Math.max(...body) > LIMITS.musicMaxSecond) f.push(`music: 1 s window too loud (${Math.max(...body).toFixed(1)} dB)`);
    if (Math.abs(m.dc) > LIMITS.dc) f.push(`music: DC offset ${m.dc.toExponential(2)}`);
    if (m.firstSample > LIMITS.edge) f.push('music: does not start from silence');
    if (m.budget && m.budget.sources > LIMITS.musicSources) f.push(`music: ${m.budget.sources} simultaneous sources (limit ${LIMITS.musicSources})`);
  }
  const st = report.stress;
  if (st) {
    if (st.nonFinite) f.push(`stress: ${st.nonFinite} non-finite samples`);
    if (st.peak > LIMITS.stressPeak) f.push(`stress: peak ${st.peak.toFixed(3)} > ${LIMITS.stressPeak}`);
  }
  const sp = report.spam;
  if (sp) {
    if (sp.nonFinite) f.push(`spam: ${sp.nonFinite} non-finite samples`);
    if (sp.peak > LIMITS.stressPeak) f.push(`spam: peak ${sp.peak.toFixed(3)} > ${LIMITS.stressPeak}`);
    if (sp.maxActive > 24) f.push(`spam: ${sp.maxActive} simultaneous voices (limit 24)`);
  }
  const c = report.controls;
  if (c && !(c.hardClick > LIMITS.click && c.subtleClick > LIMITS.click)) {
    f.push(`click detector self-test failed (hard ${fmt(c.hardClick)}, subtle ${fmt(c.subtleClick)}, limit ${LIMITS.click})`);
  }
  const p = report.plan;
  if (p) {
    if (p.distinctFourGrams / Math.max(1, p.fourGrams) < 0.45) f.push(`music plan: repetitive (${p.distinctFourGrams}/${p.fourGrams} distinct 4-chord sequences)`);
    if (p.immediateRepeats) f.push('music plan: chord repeated back-to-back');
    if (p.distinctChords < 8) f.push(`music plan: only ${p.distinctChords} distinct chords in ${p.minutes} min`);
    if (p.padRange[0] < 48 || p.padRange[1] > 84) f.push(`music plan: pad range drifted ${p.padRange}`);
    if (p.pluckRange[0] < 60 || p.pluckRange[1] > 96) f.push(`music plan: pluck range ${p.pluckRange}`);
    if (p.maxPluckGap > 40) f.push(`music plan: ${p.maxPluckGap.toFixed(1)} s without melody`);
  }
  return f;
}

const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-inf');

export function formatReport(report) {
  const lines = [];
  const head = ['sound', 'dur s', 'peak', 'preclip', 'rms dB', 'loud dB', 'spk dB', 'centroid', 'click', 'DC', 'onset', 'nodes'];
  const rows = report.sounds.map((s) => [
    s.label, fmt(s.duration, 2), fmt(s.peak, 3), fmt(s.preClipPeak, 3), fmt(s.rmsDb), fmt(s.loudDb), fmt(s.spkDb),
    `${Math.round(s.centroid)} Hz`, `${fmt(s.click)}@${fmt(s.clickAt, 3)}`, s.dc.toExponential(1), fmt(s.onset, 2),
    `${s.nodes}/${s.sources}`,
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => r.map((c, i) => (i === 0 ? String(c).padEnd(widths[i]) : String(c).padStart(widths[i]))).join('  ');
  lines.push(line(head));
  lines.push(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) lines.push(line(r));
  lines.push('');
  lines.push('dur = until -60 dB; peak = after master chain; preclip = compressor output (soft-clip bypassed);');
  lines.push('rms = whole sound; loud = loudest 50 ms; spk = loudest 100 ms with phone-speaker weighting;');
  lines.push('click = max isolated 2nd-difference spike / local RMS (@ time s); onset = level after 0.5 ms / peak;');
  lines.push('nodes = audio nodes / source nodes created for one instance.');
  const m = report.music;
  if (m) {
    lines.push('');
    lines.push(`music (${m.perSecond.length} s): peak ${fmt(m.peak, 3)}, RMS ${fmt(m.rmsDb)} dB, loudest 50 ms ${fmt(m.loudDb)} dB, ` +
      `1 s windows after fade-in ${fmt(Math.min(...m.perSecond.slice(4)))} … ${fmt(Math.max(...m.perSecond.slice(4)))} dB, ` +
      `centroid ${Math.round(m.centroid)} Hz, DC ${m.dc.toExponential(1)}`);
    lines.push(`  per second: ${m.perSecond.map((x) => fmt(x, 0)).join(' ')}`);
    if (m.budget) lines.push(`  budget: max ${m.budget.nodes} live nodes / ${m.budget.sources} sources at once (${m.budget.voices} voices in ${m.perSecond.length} s)`);
  }
  if (report.stress) {
    const s = report.stress;
    lines.push(`stress (8 big sfx at once over music): peak ${fmt(s.peak, 3)}, pre-clip ${fmt(s.preClipPeak, 3)}, loudest 50 ms ${fmt(s.loudDb)} dB, NaN ${s.nonFinite}`);
  }
  if (report.spam) {
    const s = report.spam;
    lines.push(`spam (150 play() in 1.5 s): ${s.started} started, max ${s.maxActive} simultaneous voices, peak ${fmt(s.peak, 3)}, NaN ${s.nonFinite}`);
  }
  if (report.plan) {
    const p = report.plan;
    lines.push(`music plan (${p.minutes} min): ${p.chords} chords (${p.distinctChords} distinct incl. key), ${p.keyChanges} key changes, ` +
      `${p.distinctFourGrams}/${p.fourGrams} distinct 4-chord sequences (most frequent ×${p.maxFourGramCount}), ` +
      `chord length ${fmt(p.chordSeconds[0])}–${fmt(p.chordSeconds[1])} s, pad MIDI ${p.padRange.join('–')}, ` +
      `pluck MIDI ${p.pluckRange.join('–')}, plucks/min ${p.plucksPerMinute.join(' ')}, longest melody gap ${fmt(p.maxPluckGap)} s`);
  }
  if (report.controls) {
    lines.push(`click detector self-test: hard click ${fmt(report.controls.hardClick)}, subtle level jump ${fmt(report.controls.subtleClick)} (limit ${LIMITS.click})`);
  }
  if (report.live) lines.push(`live API checks: ${report.live.length ? report.live.join('; ') : 'ok'}`);
  if (report.liveStats) {
    const s = report.liveStats;
    lines.push(`live spam (421 play() calls in one task): ${s.spamStarted} voices created, max ${s.spamMaxActive} active at once`);
  }
  return lines.join('\n');
}

/**
 * Runs all measurements.
 * @param {object} [o]
 * @param {boolean} [o.wav]          write WAV files to tools/out/audio/
 * @param {number} [o.musicSeconds]  length of the rendered music excerpt
 * @param {boolean} [o.live]         also exercise the live API in a real-time context
 * @param {number} [o.planMinutes]   length of the music-plan analysis
 * @param {boolean} [o.quick]        shorter renders (e2e)
 * @returns {Promise<{sounds, music, stress, spam, plan, live, failures: string[]}>}
 */
export async function runAudioCheck({ wav = false, musicSeconds = 30, live = true, planMinutes = 10, quick = false } = {}) {
  const server = await startServer(0, ROOT);
  const browser = await chromium.launch({ args: ['--autoplay-policy=user-gesture-required'] });
  const pageErrors = [];
  try {
    const context = await browser.newContext();
    await context.route(`**/${PAGE_PATH}`, (route) => route.fulfill({ contentType: 'text/html', body: TEST_PAGE }));
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(`pageerror: ${e.message}`));
    page.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push(`console.error: ${msg.text()}`); });
    await page.goto(`${server.url}${PAGE_PATH}`, { waitUntil: 'load' });

    const report = await page.evaluate(pageMain, {
      sampleRate: SAMPLE_RATE, cases: CASES, start: START, musicSeconds, wav, quick,
    });
    report.plan = analyzePlan(planMinutes);

    if (live) {
      // Fresh page: the offline renders above must not influence the node-leak accounting.
      const livePage = await context.newPage();
      livePage.on('pageerror', (e) => pageErrors.push(`pageerror (live): ${e.message}`));
      livePage.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push(`console.error (live): ${msg.text()}`); });
      await livePage.goto(`${server.url}${PAGE_PATH}`, { waitUntil: 'load' });
      const livePromise = livePage.evaluate(pageLiveChecks);
      await livePage.waitForTimeout(300);
      await livePage.click('#unlock');
      const liveResult = await livePromise;
      report.live = liveResult.failures;
      report.liveStats = liveResult.stats;

      const noAudio = await context.newPage();
      await noAudio.addInitScript(() => {
        delete window.AudioContext;
        delete window.webkitAudioContext;
        delete window.OfflineAudioContext;
      });
      noAudio.on('pageerror', (e) => pageErrors.push(`pageerror (no WebAudio): ${e.message}`));
      await noAudio.goto(`${server.url}${PAGE_PATH}`, { waitUntil: 'load' });
      await noAudio.click('#unlock');
      report.live.push(...(await noAudio.evaluate(pageNoAudioChecks)));
    }

    if (wav) {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      for (const s of report.sounds) {
        writeWav(path.join(OUT_DIR, `${s.label.replace(/[^a-z0-9]+/gi, '_')}.wav`), s.wav, 2, SAMPLE_RATE);
        delete s.wav;
      }
      for (const key of ['music', 'stress']) {
        if (report[key] && report[key].wav) {
          writeWav(path.join(OUT_DIR, `_${key}.wav`), report[key].wav, 2, SAMPLE_RATE);
          delete report[key].wav;
        }
      }
    }

    report.failures = [...evaluate(report), ...(report.live || []).map((x) => `live: ${x}`), ...pageErrors];
    return report;
  } finally {
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const musicArg = args.find((a) => a.startsWith('--music='));
  const report = await runAudioCheck({
    wav: !args.includes('--no-wav'),
    musicSeconds: musicArg ? Number(musicArg.split('=')[1]) : 30,
    live: !args.includes('--no-live'),
  });
  console.log(formatReport(report));
  if (!args.includes('--no-wav')) console.log(`\nWAV files: ${path.relative(ROOT, OUT_DIR)}/`);
  if (report.failures.length) {
    console.log(`\n${report.failures.length} check(s) FAILED:\n  - ${report.failures.join('\n  - ')}`);
    process.exit(1);
  }
  console.log('\nAll audio checks passed.');
}
