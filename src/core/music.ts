import { audioContext } from './audio';

// Procedural synthwave soundtrack: a step sequencer scheduled ahead on the WebAudio clock.
// Layers fade in and out by mood; mood changes take effect on the next bar.
export type Mood = 'off' | 'menu' | 'calm' | 'combat' | 'boss';

const BPM = 108;
const STEP = 60 / BPM / 4;           // one 16th note
const LOOKAHEAD = 0.15;              // seconds scheduled ahead
const BASE_GAIN = 0.32;

// Chord roots as semitones above A, four bars per loop.
const PROGRESSIONS: Record<'main' | 'boss', { root: number; minor: boolean }[]> = {
  main: [{ root: 0, minor: true }, { root: 8, minor: false }, { root: 3, minor: false }, { root: 10, minor: false }],  // Am F C G
  boss: [{ root: 0, minor: true }, { root: 1, minor: false }, { root: 5, minor: true }, { root: 7, minor: false }],    // Am Bb Dm E
};

interface Layers {
  pad: number;
  bass: number;
  bassBusy: boolean;   // 8ths instead of quarters
  kick: number;
  snare: number;
  hat: number;
  arp: number;
  bright: number;      // filter cutoff for bass / arp
}

const MOODS: Record<Exclude<Mood, 'off'>, Layers> = {
  menu: { pad: 0.5, bass: 0.35, bassBusy: false, kick: 0, snare: 0, hat: 0, arp: 0.12, bright: 700 },
  calm: { pad: 0.45, bass: 0.45, bassBusy: true, kick: 0, snare: 0, hat: 0.25, arp: 0.1, bright: 900 },
  combat: { pad: 0.35, bass: 0.6, bassBusy: true, kick: 0.9, snare: 0.5, hat: 0.4, arp: 0.22, bright: 1600 },
  boss: { pad: 0.4, bass: 0.7, bassBusy: true, kick: 1, snare: 0.65, hat: 0.5, arp: 0.3, bright: 2400 },
};

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const A2 = 45;  // MIDI note for the bass root

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let delay: DelayNode | null = null;
let noise: AudioBuffer | null = null;
let timer = 0;
let step = 0;
let nextTime = 0;
let mood: Mood = 'off';
let pending: Mood = 'off';
let volume = 0.6;

function setup(): boolean {
  if (ctx) return true;
  ctx = audioContext();
  if (!ctx) return false;
  out = ctx.createGain();
  out.gain.value = 0;
  out.connect(ctx.destination);
  // ping-pong-ish echo for the arpeggio
  delay = ctx.createDelay(1);
  delay.delayTime.value = STEP * 3;
  const fb = ctx.createGain();
  fb.gain.value = 0.35;
  const wet = ctx.createGain();
  wet.gain.value = 0.4;
  delay.connect(fb).connect(delay);
  delay.connect(wet).connect(out);
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return true;
}

export function setMusicVolume(v: number): void {
  volume = v;
  applyGain(0.3);
}

function applyGain(ramp: number): void {
  if (!ctx || !out) return;
  const target = mood === 'off' ? 0 : BASE_GAIN * volume;
  out.gain.cancelScheduledValues(ctx.currentTime);
  out.gain.setTargetAtTime(target, ctx.currentTime, ramp);
}

// Switch the soundtrack mood. Safe to call every frame; only real changes do anything.
export function setMood(m: Mood): void {
  if (m === pending || !setup() || !ctx) return;
  pending = m;
  if (m === 'off') {
    mood = 'off';
    applyGain(0.4);
    return;
  }
  if (mood === 'off') {
    // (re)start on a fresh bar
    mood = m;
    step = 0;
    nextTime = ctx.currentTime + 0.05;
    applyGain(0.5);
  }
  if (!timer) timer = window.setInterval(tick, 25);
}

// Duck the music (pause menu, upgrade pick).
export function duck(on: boolean): void {
  if (!ctx || !out || mood === 'off') return;
  out.gain.cancelScheduledValues(ctx.currentTime);
  out.gain.setTargetAtTime(BASE_GAIN * volume * (on ? 0.35 : 1), ctx.currentTime, 0.2);
}

function tick(): void {
  if (!ctx) return;
  if (mood === 'off' && (!out || out.gain.value < 0.001)) {
    clearInterval(timer);
    timer = 0;
    return;
  }
  // after the tab was hidden the clock ran ahead; skip instead of bursting notes
  if (nextTime < ctx.currentTime - 0.2) nextTime = ctx.currentTime + 0.05;
  while (nextTime < ctx.currentTime + LOOKAHEAD) {
    if (step % 16 === 0 && pending !== 'off' && pending !== mood) mood = pending;
    if (mood !== 'off') playStep(step, nextTime);
    nextTime += STEP;
    step = (step + 1) % 64;
  }
}

function playStep(s: number, t: number): void {
  const L = MOODS[mood as Exclude<Mood, 'off'>];
  const prog = PROGRESSIONS[mood === 'boss' ? 'boss' : 'main'];
  const chord = prog[Math.floor(s / 16) % prog.length];
  const third = chord.minor ? 3 : 4;
  const inBar = s % 16;
  const root = A2 + chord.root;

  if (inBar === 0 && L.pad) pad([root + 12, root + 12 + third, root + 19], t, STEP * 16, L.pad);
  if (L.bass && (L.bassBusy ? inBar % 2 === 0 : inBar % 4 === 0)) {
    const oct = L.bassBusy && inBar % 4 === 2 ? 12 : 0;
    bass(root + oct, t, STEP * (L.bassBusy ? 1.6 : 3.5), L.bass, L.bright);
  }
  if (L.kick && inBar % 4 === 0) kick(t, L.kick);
  if (L.snare && (inBar === 4 || inBar === 12)) snare(t, L.snare);
  if (L.hat && inBar % 2 === 1) hat(t, L.hat * (inBar % 4 === 3 ? 1 : 0.6));
  if (L.arp) {
    // chord tones walking up and down, 16ths in combat, 8ths otherwise
    const busy = mood === 'combat' || mood === 'boss';
    if (busy || inBar % 2 === 0) {
      const tones = [0, third, 7, 12, 7, third];
      const i = (busy ? inBar : inBar / 2) % tones.length;
      arp(root + 24 + tones[i], t, STEP * 0.9, L.arp, L.bright * 1.5);
    }
  }
}

function env(g: GainNode, t: number, vol: number, attack: number, dur: number): void {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

function pad(notes: number[], t: number, dur: number, vol: number): void {
  if (!ctx || !out) return;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 900;
  const g = ctx.createGain();
  env(g, t, vol * 0.09, dur * 0.3, dur);
  f.connect(g).connect(out);
  for (const n of notes) {
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midiHz(n);
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }
}

function bass(note: number, t: number, dur: number, vol: number, cutoff: number): void {
  if (!ctx || !out) return;
  const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  o.type = 'sawtooth';
  o.frequency.value = midiHz(note);
  f.type = 'lowpass';
  f.Q.value = 6;
  f.frequency.setValueAtTime(cutoff * 0.9, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff * 0.15), t + dur);
  env(g, t, vol * 0.35, 0.005, dur);
  o.connect(f).connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function arp(note: number, t: number, dur: number, vol: number, cutoff: number): void {
  if (!ctx || !out || !delay) return;
  const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  o.type = 'square';
  o.frequency.value = midiHz(note);
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  env(g, t, vol * 0.12, 0.004, dur);
  o.connect(f).connect(g);
  g.connect(out);
  g.connect(delay);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function kick(t: number, vol: number): void {
  if (!ctx || !out) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
  env(g, t, vol * 0.8, 0.003, 0.28);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.3);
}

function noiseHit(t: number, vol: number, dur: number, type: BiquadFilterType, freq: number): void {
  if (!ctx || !out || !noise) return;
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noise;
  f.type = type;
  f.frequency.value = freq;
  env(g, t, vol, 0.002, dur);
  s.connect(f).connect(g).connect(out);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.02);
}

function snare(t: number, vol: number): void {
  noiseHit(t, vol * 0.35, 0.18, 'bandpass', 1900);
  if (!ctx || !out) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(220, t);
  o.frequency.exponentialRampToValueAtTime(120, t + 0.08);
  env(g, t, vol * 0.25, 0.002, 0.1);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.12);
}

function hat(t: number, vol: number): void {
  noiseHit(t, vol * 0.12, 0.045, 'highpass', 7500);
}
