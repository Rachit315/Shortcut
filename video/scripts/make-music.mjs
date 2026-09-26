#!/usr/bin/env node
// Original soundtrack for the Clazy demo video, synthesised from scratch (no samples, no
// third-party audio), so it's free to use anywhere. 120 BPM minimal tech-house in A minor.
// UI sound effects (key presses, pastes, whooshes) are placed from src/timeline.json so they
// land exactly on the on-screen events.
//
// Usage: node scripts/make-music.mjs [out.wav]   (default: public/music.wav)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const T = JSON.parse(readFileSync(join(here, "../src/timeline.json"), "utf8"));
const OUT = process.argv[2] ?? join(here, "../public/music.wav");

const SR = 48000;
const DUR = T.durationInFrames / T.fps; // seconds
const N = Math.ceil(DUR * SR);
const BEAT = 60 / T.bpm;
const BAR = BEAT * 4;
const TAU = Math.PI * 2;

// ---------- utilities ----------
let seed = 1337;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const frameTime = (f) => f / T.fps;

class Biquad {
  constructor(type, freq, q = 0.707) {
    this.type = type;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.set(freq, q);
  }
  set(freq, q = this.q) {
    this.q = q;
    const w = (TAU * Math.min(freq, SR * 0.45)) / SR;
    const cos = Math.cos(w), alpha = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    const a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
    if (this.type === "lp") (b0 = (1 - cos) / 2), (b1 = 1 - cos), (b2 = (1 - cos) / 2);
    else if (this.type === "hp") (b0 = (1 + cos) / 2), (b1 = -(1 + cos)), (b2 = (1 + cos) / 2);
    else (b0 = alpha), (b1 = 0), (b2 = -alpha); // band-pass
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// Buses (stereo). "dry" goes straight to the mix, "verb" feeds the reverb, "delay" the ping-pong delay.
const bus = () => [new Float32Array(N), new Float32Array(N)];
const dry = bus(), verb = bus(), delay = bus(), duck = bus(); // duck = sidechained by the kick
const sidechain = new Float32Array(N).fill(1);

function add(target, i, v, pan = 0) {
  if (i < 0 || i >= N) return;
  target[0][i] += v * Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
  target[1][i] += v * Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
}

// polyBLEP saw for a less buzzy oscillator
function saw(phase, dt) {
  let v = 2 * phase - 1;
  if (phase < dt) { const t = phase / dt; v -= t + t - t * t - 1; }
  else if (phase > 1 - dt) { const t = (phase - 1) / dt; v -= t * t + t + t + 1; }
  return v;
}

// ---------- instruments ----------
function kick(t, gain = 1) {
  const s0 = Math.round(t * SR), len = Math.round(0.45 * SR);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const tt = i / SR;
    const f = 45 + 110 * Math.exp(-tt * 38);
    ph += (TAU * f) / SR;
    const amp = Math.exp(-tt * 7.5) * (tt < 0.002 ? tt / 0.002 : 1);
    const click = i < 90 ? rnd() * 0.25 * (1 - i / 90) : 0;
    add(dry, s0 + i, (Math.sin(ph) * amp + click) * 0.9 * gain);
  }
  // duck pads/bass under the kick
  const dl = Math.round(0.32 * SR);
  for (let i = 0; i < dl && s0 + i < N; i++) {
    const g = 0.35 + 0.65 * Math.min(1, (i / dl) ** 1.6);
    sidechain[s0 + i] = Math.min(sidechain[s0 + i], g);
  }
}

function noiseHit(t, { hp = 7000, lp = 16000, decay = 0.04, gain = 0.2, pan = 0, send = 0 }) {
  const s0 = Math.round(t * SR), len = Math.round(decay * 6 * SR);
  const h = new Biquad("hp", hp), l = new Biquad("lp", lp);
  for (let i = 0; i < len; i++) {
    const v = l.run(h.run(rnd())) * Math.exp(-i / SR / decay) * gain;
    add(dry, s0 + i, v, pan);
    if (send) add(verb, s0 + i, v * send, pan);
  }
}

function clap(t, gain = 0.5) {
  const s0 = Math.round(t * SR);
  const bp = new Biquad("bp", 1400, 0.9);
  const len = Math.round(0.35 * SR);
  for (let i = 0; i < len; i++) {
    const tt = i / SR;
    // three quick bursts then a tail
    const env = tt < 0.03 ? Math.exp(-((tt % 0.01) / 0.003)) : Math.exp(-(tt - 0.03) / 0.09);
    const v = bp.run(rnd()) * env * gain * 1.6;
    add(dry, s0 + i, v, 0.05);
    add(verb, s0 + i, v * 0.35);
  }
}

function bassNote(t, midi, len, gain = 0.32) {
  const s0 = Math.round(t * SR), n = Math.round(len * SR);
  const f = mtof(midi), dt = f / SR;
  const lp = new Biquad("lp", 380, 1.1);
  let ph = 0, sub = 0;
  for (let i = 0; i < n + 800; i++) {
    const tt = i / SR;
    const env = Math.min(1, tt / 0.004) * (i < n ? Math.exp(-tt * 2.2) : Math.exp(-tt * 2.2) * (1 - (i - n) / 800));
    ph = (ph + dt) % 1;
    sub += (TAU * f) / SR;
    lp.set(220 + 900 * Math.exp(-tt * 16), 1.1);
    const v = (lp.run(saw(ph, dt)) * 0.55 + Math.sin(sub) * 0.75) * env * gain;
    add(duck, s0 + i, v);
  }
}

function padChord(t, midis, len, gain = 0.07, cutoff = 1400) {
  const s0 = Math.round(t * SR), n = Math.round(len * SR);
  for (const m of midis) {
    for (const [det, pan] of [[-0.09, -0.6], [0, 0], [0.08, 0.6]]) {
      const f = mtof(m + det), dt = f / SR;
      const lp = new Biquad("lp", cutoff, 0.8);
      let ph = Math.abs(rnd());
      const rel = Math.round(0.6 * SR);
      for (let i = 0; i < n + rel; i++) {
        const tt = i / SR;
        const env = Math.min(1, tt / 0.35) * (i < n ? 1 : 1 - (i - n) / rel);
        ph = (ph + dt) % 1;
        const v = lp.run(saw(ph, dt)) * env * gain;
        add(duck, s0 + i, v, pan);
        add(verb, s0 + i, v * 0.5, pan);
      }
    }
  }
}

function pluck(t, midi, gain = 0.12, pan = 0) {
  const s0 = Math.round(t * SR), n = Math.round(0.4 * SR);
  const f = mtof(midi);
  const lp = new Biquad("lp", 3200, 1.4);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    ph = (ph + f / SR) % 1;
    const tri = 1 - 4 * Math.abs(ph - 0.5);
    const sq = ph < 0.5 ? 1 : -1;
    lp.set(600 + 4200 * Math.exp(-tt * 18), 1.4);
    const v = lp.run(tri * 0.7 + sq * 0.3) * Math.exp(-tt * 9) * Math.min(1, tt / 0.002) * gain;
    add(dry, s0 + i, v, pan);
    add(delay, s0 + i, v * 0.45, pan);
    add(verb, s0 + i, v * 0.3, pan);
  }
}

function riser(t0, t1, gain = 0.12) {
  const s0 = Math.round(t0 * SR), n = Math.round((t1 - t0) * SR);
  const bp = new Biquad("bp", 400, 1.2);
  for (let i = 0; i < n; i++) {
    const p = i / n;
    bp.set(300 + 5000 * p * p, 1.2);
    const v = bp.run(rnd()) * p * p * gain * 2.2;
    add(dry, s0 + i, v, Math.sin(p * 9) * 0.4);
    add(verb, s0 + i, v * 0.4);
  }
}

// ---------- UI sound effects ----------
const SFX = {
  pop(t) {
    const s0 = Math.round(t * SR), n = Math.round(0.12 * SR);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const tt = i / SR;
      ph += (TAU * (520 + 900 * Math.exp(-tt * 40))) / SR;
      const v = Math.sin(ph) * Math.exp(-tt * 32) * 0.28;
      add(dry, s0 + i, v);
      add(verb, s0 + i, v * 0.3);
    }
  },
  whoosh(t) {
    // peaks just after the transition frame
    const pre = 0.28, post = 0.32;
    const s0 = Math.round((t - pre) * SR), n = Math.round((pre + post) * SR);
    const bp = new Biquad("bp", 500, 0.9);
    for (let i = 0; i < n; i++) {
      const p = i / n;
      const env = p < pre / (pre + post) ? (p / (pre / (pre + post))) ** 2 : Math.exp(-(p - pre / (pre + post)) * 9);
      bp.set(400 + 3600 * Math.sin(p * Math.PI), 0.9);
      const v = bp.run(rnd()) * env * 0.16;
      add(dry, s0 + i, v, (p - 0.5) * 1.2);
      add(verb, s0 + i, v * 0.4);
    }
  },
  ding(t) {
    const s0 = Math.round(t * SR), n = Math.round(1.6 * SR);
    const partials = [[1, 1, 1.5], [2.76, 0.4, 3], [5.4, 0.18, 5], [0.5, 0.25, 1.2]];
    for (let i = 0; i < n; i++) {
      const tt = i / SR;
      let v = 0;
      for (const [r, a, d] of partials) v += Math.sin(TAU * 1318.5 * r * tt) * a * Math.exp(-tt * d);
      v *= 0.07 * Math.min(1, tt / 0.002);
      add(dry, s0 + i, v, 0.1);
      add(verb, s0 + i, v * 0.6);
      add(delay, s0 + i, v * 0.3);
    }
  },
  key(t) {
    noiseHit(t, { hp: 1800, lp: 7000, decay: 0.012, gain: 0.34, pan: rnd() * 0.3 });
    const s0 = Math.round(t * SR);
    for (let i = 0; i < 1400; i++) add(dry, s0 + i, Math.sin((TAU * 180 * i) / SR) * Math.exp(-i / 250) * 0.22);
  },
  tick(t) {
    noiseHit(t, { hp: 3000, lp: 9000, decay: 0.008, gain: 0.22, pan: rnd() * 0.4 });
  },
  click(t) {
    noiseHit(t, { hp: 2500, lp: 12000, decay: 0.006, gain: 0.3 });
    const s0 = Math.round(t * SR);
    for (let i = 0; i < 700; i++) add(dry, s0 + i, Math.sin((TAU * 2100 * i) / SR) * Math.exp(-i / 120) * 0.12);
  },
  paste(t) {
    const s0 = Math.round(t * SR), n = Math.round(0.45 * SR);
    let ph = 0, ph2 = 0;
    for (let i = 0; i < n; i++) {
      const tt = i / SR;
      const f = 660 * 2 ** Math.min(1, tt / 0.09);
      ph += (TAU * f) / SR;
      ph2 += (TAU * f * 1.5) / SR;
      const v = (Math.sin(ph) + 0.35 * Math.sin(ph2)) * Math.exp(-tt * 9) * Math.min(1, tt / 0.004) * 0.11;
      add(dry, s0 + i, v, -0.1);
      add(verb, s0 + i, v * 0.5);
      add(delay, s0 + i, v * 0.35);
    }
  },
  hit(t) {
    kick(t, 1.2);
    noiseHit(t, { hp: 4000, lp: 14000, decay: 0.5, gain: 0.12, send: 0.8 });
    const s0 = Math.round(t * SR), n = Math.round(2.2 * SR);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const tt = i / SR;
      ph += (TAU * (55 + 20 * Math.exp(-tt * 6))) / SR;
      add(dry, s0 + i, Math.sin(ph) * Math.exp(-tt * 1.4) * 0.45);
    }
  },
};

// ---------- arrangement ----------
// A minor: Am9 – Fmaj7 – Cmaj7 – Em7, one chord per bar.
const CHORDS = [
  { root: 33, notes: [57, 60, 64, 67, 71] },
  { root: 29, notes: [53, 57, 60, 64] },
  { root: 36, notes: [55, 60, 64, 71] },
  { root: 28, notes: [55, 59, 62, 64] },
];
const bars = Math.ceil(DUR / BAR);
const outroBar = Math.round(frameTime(T.scenes.outro) / BAR); // 14
const featuresBar = Math.round(frameTime(T.scenes.features) / BAR); // 13

for (let b = 0; b < bars; b++) {
  const t0 = b * BAR;
  const chord = CHORDS[b % 4];
  const intro = b < 2;
  const build = b === featuresBar;
  const tail = b > outroBar;

  // pad: always, brighter once the groove is in
  padChord(t0, chord.notes, BAR, intro ? 0.05 : 0.06, intro ? 700 + b * 400 : tail ? 900 : 1600);

  if (intro) continue;

  if (!tail) {
    for (let beat = 0; beat < 4; beat++) {
      const tb = t0 + beat * BEAT;
      if (!(build && beat === 3)) kick(tb);
      if (b >= 3 && (beat === 1 || beat === 3) && !build) clap(tb, 0.45);
      noiseHit(tb + BEAT / 2, { hp: 6500, decay: 0.07, gain: 0.13, pan: 0.25 }); // open hat
      for (let s = 0; s < 4; s++) {
        if (s === 2) continue;
        const acc = s === 0 ? 0.05 : 0.08;
        noiseHit(tb + (s * BEAT) / 4, { hp: 9000, decay: 0.018, gain: acc, pan: -0.3 }); // closed hat
      }
    }
    // bass: syncopated eighths on the root
    const pattern = [0.5, 1.5, 1.75, 2.5, 3.5];
    for (const p of pattern) bassNote(t0 + p * BEAT, chord.root + (p === 1.75 ? 12 : 0), BEAT * 0.4);
  } else {
    // outro tail: sparse kick on the first beat only
    if (b === outroBar + 1) kick(t0, 0.7);
  }

  // pluck arpeggio from bar 5 onward, with a ping-pong delay
  if (b >= 5) {
    const arp = [0, 2, 1, 3, 2, 4, 1, 3];
    for (let s = 0; s < 8; s++) {
      if (tail && s > 3) break;
      const note = chord.notes[arp[s] % chord.notes.length] + 12;
      pluck(t0 + (s * BEAT) / 2, note, tail ? 0.08 : 0.1, s % 2 ? 0.35 : -0.35);
    }
  }

  // snare roll + riser into the outro drop
  if (build) {
    for (let s = 0; s < 16; s++) clap(t0 + (s * BEAT) / 4, 0.12 + (s / 16) * 0.35);
    riser(t0, t0 + BAR, 0.14);
  }
}
riser(0.2, BAR * 2, 0.08); // intro swell

for (const e of T.sfx) SFX[e.kind](frameTime(e.f));

// ---------- effects ----------
// Ping-pong delay (dotted eighth)
{
  const d = Math.round(BEAT * 0.75 * SR);
  const [L, R] = delay;
  for (let i = d; i < N; i++) {
    L[i] += R[i - d] * 0.42;
    R[i] += L[i - d] * 0.42;
  }
  for (let i = 0; i < N; i++) (dry[0][i] += L[i] * 0.5), (dry[1][i] += R[i] * 0.5), (verb[0][i] += L[i] * 0.2), (verb[1][i] += R[i] * 0.2);
}

// Freeverb-style reverb
function reverb([inL, inR]) {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((c) => Math.round((c * SR) / 44100));
  const aps = [556, 441, 341, 225].map((c) => Math.round((c * SR) / 44100));
  const out = [new Float32Array(N), new Float32Array(N)];
  [inL, inR].forEach((input, ch) => {
    const spread = ch ? 23 : 0;
    const cb = combs.map((c) => ({ buf: new Float32Array(c + spread), i: 0, lp: 0 }));
    const ab = aps.map((c) => ({ buf: new Float32Array(c + spread), i: 0 }));
    for (let n = 0; n < N; n++) {
      const x = input[n] * 0.015;
      let s = 0;
      for (const c of cb) {
        const y = c.buf[c.i];
        c.lp = y * 0.6 + c.lp * 0.4;
        c.buf[c.i] = x + c.lp * 0.86;
        c.i = (c.i + 1) % c.buf.length;
        s += y;
      }
      for (const a of ab) {
        const y = a.buf[a.i];
        a.buf[a.i] = s + y * 0.5;
        a.i = (a.i + 1) % a.buf.length;
        s = y - s;
      }
      out[ch][n] = s;
    }
  });
  return out;
}
const wet = reverb(verb);

// ---------- mix + master ----------
const mix = [new Float32Array(N), new Float32Array(N)];
for (let ch = 0; ch < 2; ch++) {
  for (let i = 0; i < N; i++) mix[ch][i] = dry[ch][i] + duck[ch][i] * sidechain[i] + wet[ch][i] * 0.9;
}
// gentle low-cut on the whole mix, soft clip, fades
const fadeIn = Math.round(0.02 * SR), fadeOut = Math.round(1.6 * SR);
let peak = 0;
for (let ch = 0; ch < 2; ch++) {
  const hp = new Biquad("hp", 28);
  for (let i = 0; i < N; i++) {
    let v = Math.tanh(hp.run(mix[ch][i]) * 1.15);
    if (i < fadeIn) v *= i / fadeIn;
    if (i > N - fadeOut) v *= ((N - i) / fadeOut) ** 1.5;
    mix[ch][i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
}
const norm = 0.89 / peak;

// ---------- write 16-bit stereo WAV ----------
const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mix[0][i] * norm)) * 32767), i * 4);
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mix[1][i] * norm)) * 32767), i * 4 + 2);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
header.writeUInt32LE(SR, 24); header.writeUInt32LE(SR * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
header.write("data", 36); header.writeUInt32LE(data.length, 40);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.concat([header, data]));
console.log(`wrote ${OUT} (${DUR.toFixed(1)}s, peak normalised from ${peak.toFixed(2)})`);
