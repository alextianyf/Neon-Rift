// "Mech epic" soundtrack: heavy, cinematic giant-robot music, all synthesized. Original material in
// that style: D minor, ~128 BPM, distorted power-chord guitar riffs, big drums with a reverb tail,
// brass swells and a heroic horn line, taiko hits on phrase starts. Boss fights pile on more
// (furyStep): double bass, rolls, strings, choir and a climbing horn. music.ts schedules the steps;
// this file only knows how to play one 16th-note step for a given mood.

export type EpicMood = 'menu' | 'calm' | 'combat' | 'boss';

export const EPIC_BPM = 128;

// Chords as semitones above D, one per bar, four bars per loop.
const PROG: Record<'main' | 'boss', { root: number; minor: boolean }[]> = {
  main: [{ root: 0, minor: true }, { root: 0, minor: true }, { root: 8, minor: false }, { root: 10, minor: false }],  // Dm Dm Bb C
  boss: [{ root: 0, minor: true }, { root: 8, minor: false }, { root: 5, minor: true }, { root: 7, minor: false }],   // Dm Bb Gm A
};
const D2 = 38;  // MIDI: guitar / bass root

// The heroic horn line (scale steps above D4, null = rest), two bars, played over bars 3-4.
const HORN: (number | null)[] = [0, null, null, null, 3, null, 5, null, 7, null, null, null, 5, null, 3, null,
  2, null, null, null, 0, null, -2, null, 0, null, null, null, null, null, null, null];
// The boss gets a four-bar version: the same opening, then an answer that climbs to the top.
const HORN_BOSS: (number | null)[] = [...HORN.slice(0, 16), 4, null, 5, null, 7, null, 9, null, 10, null, null, null, 9, null, 7, null,
  7, null, null, null, 9, null, 10, null, 11, null, null, null, 12, null, 11, null,
  9, null, null, null, 10, null, 11, null, 14, null, null, null, null, null, null, null];
const D_MINOR = [0, 2, 3, 5, 7, 8, 10];

interface Layers {
  chug: number;      // palm-muted guitar riff
  power: number;     // sustained power chords
  drums: number;     // kick / snare / hats
  double: boolean;   // double-time kicks
  brass: number;     // chord swells
  horn: number;      // the melody
  taiko: number;     // impacts on phrase starts
  pulse: number;     // low synth pulse (the quiet moods)
  fury: boolean;     // the boss extras: double bass, rolls, strings, choir, the climbing horn
}

const MOODS: Record<EpicMood, Layers> = {
  menu: { chug: 0, power: 0.35, drums: 0, double: false, brass: 0.55, horn: 0.45, taiko: 0.8, pulse: 0.5, fury: false },
  calm: { chug: 0.25, power: 0, drums: 0.35, double: false, brass: 0.35, horn: 0, taiko: 0.5, pulse: 0.6, fury: false },
  combat: { chug: 0.8, power: 0.4, drums: 0.9, double: false, brass: 0.45, horn: 0.35, taiko: 0.7, pulse: 0, fury: false },
  boss: { chug: 1, power: 0.55, drums: 1, double: true, brass: 0.65, horn: 0.7, taiko: 1, pulse: 0, fury: true },
};

// Gallop-ish chug pattern on 16ths (1 = hit, 2 = accent), two variants alternating by bar.
const CHUG = [
  [2, 0, 1, 1, 2, 0, 1, 1, 2, 0, 1, 0, 2, 1, 0, 1],
  [2, 0, 1, 1, 2, 0, 1, 1, 2, 1, 1, 0, 2, 0, 2, 0],
];

export interface EpicBus {
  ctx: AudioContext;
  out: AudioNode;      // dry mix
  guitar: AudioNode;   // into the distortion
  verb: AudioNode;     // reverb send
  noise: AudioBuffer;
}

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// Distortion for the guitar bus: a soft-clipping curve.
export function distortionCurve(k = 40): Float32Array<ArrayBuffer> {
  const n = 1024, c = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return c;
}

// A decaying noise burst as the reverb's impulse response.
export function reverbImpulse(ctx: AudioContext, seconds = 2.2): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  return buf;
}

function env(g: GainNode, t: number, vol: number, attack: number, dur: number): void {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

export function playEpicStep(b: EpicBus, mood: EpicMood, s: number, t: number, step: number): void {
  const L = MOODS[mood];
  const prog = PROG[mood === 'boss' ? 'boss' : 'main'];
  const bar = Math.floor(s / 16) % 4, inBar = s % 16;
  const chord = prog[bar];
  const root = D2 + chord.root, third = chord.minor ? 3 : 4;

  // taiko impact at the start of each 4-bar phrase (and bar 3 in the big moods)
  if (L.taiko && inBar === 0 && (bar === 0 || (bar === 2 && L.drums > 0.8))) taiko(b, t, L.taiko);
  if (L.fury) furyStep(b, bar, inBar, root, third, t, step);
  if (L.pulse && inBar % 2 === 0) pulse(b, root - 12, t, step * 1.8, L.pulse * (inBar % 8 === 0 ? 1 : 0.7));

  // guitars: chugging low root in the riff pattern, power chords on the downbeats
  if (L.chug) {
    const hit = CHUG[bar % 2][inBar];
    if (hit) guitar(b, L.fury && hit === 2 ? [root, root + 7, root + 12] : [root, root + 7], t, step * 0.8, L.chug * (hit === 2 ? 1 : 0.6));
  }
  if (L.power && (inBar === 0 || (mood !== 'menu' && inBar === 8))) {
    guitar(b, [root, root + 7, root + 12], t, step * (mood === 'menu' ? 15 : 7), L.power);
  }

  // drums: driving rock beat; double-time kicks for the boss
  if (L.drums) {
    const kickHits = L.double ? inBar % 2 === 0 : inBar === 0 || inBar === 6 || inBar === 8 || inBar === 11;
    if (kickHits) kick(b, t, L.drums);
    if (inBar === 4 || inBar === 12) snare(b, t, L.drums);
    if (inBar % 2 === 0) hat(b, t, L.drums * (inBar % 4 === 0 ? 0.5 : 0.8));
    if (bar === 0 && inBar === 0) crash(b, t, L.drums);
    // tom fill closing the phrase
    if (bar === 3 && inBar >= 12) tom(b, t, L.drums, 160 - (inBar - 12) * 25);
  }

  // brass: a swelling chord each bar
  if (L.brass && inBar === 0) brass(b, [root + 12, root + 12 + third, root + 19, root + 24], t, step * 16, L.brass);
  // the horn melody over bars 3-4 (the second half of the phrase); the boss plays its four-bar version
  const line = L.fury ? HORN_BOSS : HORN, at = L.fury ? bar * 16 + inBar : (bar - 2) * 16 + inBar;
  if (L.horn && (L.fury || bar >= 2)) {
    const deg = line[at];
    if (deg !== null && deg !== undefined) {
      const oct = Math.floor(deg / 7), idx = ((deg % 7) + 7) % 7;
      const note = 62 + oct * 12 + D_MINOR[idx];  // D4 and up
      let len = 1;
      while (line[at + len] === null && len < 8) len++;
      horn(b, note, t, step * len, L.horn);
      if (L.fury && bar >= 2) horn(b, note - 12, t, step * len, L.horn * 0.6);  // doubled an octave down for the climb
    }
  }
}

// Boss only: galloping double bass, 16th hats, a crash every bar and a snare roll into the next
// phrase, taiko on every bar with a roll at the end, a sub drop, a string ostinato, a choir.
function furyStep(b: EpicBus, bar: number, inBar: number, root: number, third: number, t: number, step: number): void {
  if ([0, 2, 3].includes(inBar % 4)) kick(b, t, 0.55);       // gallop between the main kicks
  if (inBar % 2 === 1) hat(b, t, 0.7);
  if (inBar === 0 && bar !== 0) crash(b, t, 0.8);
  if (bar === 3 && inBar >= 8) snare(b, t, 0.35 + (inBar - 8) * 0.08);  // roll
  if (inBar === 8 && bar !== 3) taiko(b, t, 0.7);
  if (inBar === 0 && bar !== 0) taiko(b, t, 0.85);
  if (bar === 3 && inBar >= 12) taiko(b, t, 0.5 + (inBar - 12) * 0.15);
  if (bar === 0 && inBar === 0) sub(b, t);
  // strings: 16th-note ostinato on the chord, up an octave
  const tones = [0, 7, 12, 7, 0, 7, 12, 12 + third];
  strings(b, root + 12 + tones[inBar % 8], t, step * 0.9, 0.55);
  // choir: a sustained "aah" swelling over two bars
  if (inBar === 0 && bar % 2 === 0) choir(b, [root + 24, root + 24 + third, root + 31], t, step * 32, 0.6);
}

function guitar(b: EpicBus, notes: number[], t: number, dur: number, vol: number): void {
  const { ctx } = b, g = ctx.createGain();
  env(g, t, vol * 0.11, 0.004, dur);
  g.connect(b.guitar);
  for (const n of notes) for (const det of [-9, 9]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = midiHz(n);
    o.detune.value = det;
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

function strings(b: EpicBus, note: number, t: number, dur: number, vol: number): void {
  const { ctx } = b, o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  o.type = 'sawtooth';
  o.frequency.value = midiHz(note);
  f.type = 'bandpass';
  f.frequency.value = 1400;
  f.Q.value = 0.8;
  env(g, t, vol * 0.07, 0.006, dur);
  o.connect(f).connect(g);
  g.connect(b.out);
  g.connect(b.verb);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// An "aah" choir: detuned saws through two vowel formants, slow swell, mostly reverb.
function choir(b: EpicBus, notes: number[], t: number, dur: number, vol: number): void {
  const { ctx } = b, g = ctx.createGain(), f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter();
  f1.type = f2.type = 'bandpass';
  f1.frequency.value = 750;
  f2.frequency.value = 1180;
  f1.Q.value = f2.Q.value = 4;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol * 0.12, t + dur * 0.4);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  f1.connect(g);
  f2.connect(g);
  g.connect(b.out);
  g.connect(b.verb);
  for (const n of notes) for (const det of [-14, -4, 6, 15]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = midiHz(n);
    o.detune.value = det;
    o.connect(f1);
    o.connect(f2);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

// A sub-bass drop under the phrase start.
function sub(b: EpicBus, t: number): void {
  const { ctx } = b, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(70, t);
  o.frequency.exponentialRampToValueAtTime(28, t + 1.4);
  env(g, t, 0.7, 0.01, 1.5);
  o.connect(g).connect(b.out);
  o.start(t);
  o.stop(t + 1.55);
}

function pulse(b: EpicBus, note: number, t: number, dur: number, vol: number): void {
  const { ctx } = b, o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  o.type = 'sawtooth';
  o.frequency.value = midiHz(note);
  f.type = 'lowpass';
  f.frequency.setValueAtTime(600, t);
  f.frequency.exponentialRampToValueAtTime(120, t + dur);
  env(g, t, vol * 0.3, 0.005, dur);
  o.connect(f).connect(g).connect(b.out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function brass(b: EpicBus, notes: number[], t: number, dur: number, vol: number): void {
  const { ctx } = b, f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = 'lowpass';
  f.Q.value = 2;
  // the filter opens as the chord swells: a brassy "blare"
  f.frequency.setValueAtTime(400, t);
  f.frequency.linearRampToValueAtTime(2600, t + dur * 0.35);
  f.frequency.linearRampToValueAtTime(900, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol * 0.06, t + dur * 0.3);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  f.connect(g);
  g.connect(b.out);
  g.connect(b.verb);
  for (const n of notes) for (const det of [-12, 0, 12]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = midiHz(n);
    o.detune.value = det;
    o.connect(f);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

function horn(b: EpicBus, note: number, t: number, dur: number, vol: number): void {
  const { ctx } = b, f = ctx.createBiquadFilter(), g = ctx.createGain(), lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(700, t);
  f.frequency.linearRampToValueAtTime(3000, t + Math.min(0.12, dur * 0.4));
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol * 0.09, t + 0.05);
  g.gain.setValueAtTime(vol * 0.09, t + dur * 0.8);
  g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.08);
  lfo.frequency.value = 5.5;  // vibrato
  lfoGain.gain.value = 9;
  lfo.connect(lfoGain);
  f.connect(g);
  g.connect(b.out);
  g.connect(b.verb);
  for (const [type, det] of [['sawtooth', -6], ['sawtooth', 6], ['square', 0]] as const) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = midiHz(note);
    o.detune.value = det;
    lfoGain.connect(o.detune);
    o.connect(f);
    o.start(t);
    o.stop(t + dur + 0.1);
  }
  lfo.start(t);
  lfo.stop(t + dur + 0.1);
}

function noiseHit(b: EpicBus, t: number, vol: number, dur: number, type: BiquadFilterType, freq: number, wet = 0): void {
  const { ctx } = b, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = b.noise;
  f.type = type;
  f.frequency.value = freq;
  env(g, t, vol, 0.002, dur);
  s.connect(f).connect(g);
  g.connect(b.out);
  if (wet) {
    const w = ctx.createGain();
    w.gain.value = wet;
    g.connect(w).connect(b.verb);
  }
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.02);
}

function kick(b: EpicBus, t: number, vol: number): void {
  const { ctx } = b, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(160, t);
  o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
  env(g, t, vol * 0.95, 0.002, 0.32);
  o.connect(g).connect(b.out);
  o.start(t);
  o.stop(t + 0.34);
  noiseHit(b, t, vol * 0.12, 0.02, 'highpass', 3000);  // beater click
}

function snare(b: EpicBus, t: number, vol: number): void {
  noiseHit(b, t, vol * 0.42, 0.22, 'bandpass', 1700, 0.6);
  const { ctx } = b, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(240, t);
  o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
  env(g, t, vol * 0.3, 0.002, 0.12);
  o.connect(g).connect(b.out);
  o.start(t);
  o.stop(t + 0.14);
}

function hat(b: EpicBus, t: number, vol: number): void {
  noiseHit(b, t, vol * 0.08, 0.04, 'highpass', 8000);
}

function crash(b: EpicBus, t: number, vol: number): void {
  noiseHit(b, t, vol * 0.16, 1.4, 'highpass', 5000, 0.4);
}

function tom(b: EpicBus, t: number, vol: number, hz: number): void {
  const { ctx } = b, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(hz, t);
  o.frequency.exponentialRampToValueAtTime(hz * 0.55, t + 0.2);
  env(g, t, vol * 0.55, 0.003, 0.25);
  o.connect(g);
  g.connect(b.out);
  g.connect(b.verb);
  o.start(t);
  o.stop(t + 0.27);
}

function taiko(b: EpicBus, t: number, vol: number): void {
  const { ctx } = b, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(90, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.5);
  env(g, t, vol * 0.9, 0.004, 0.9);
  o.connect(g);
  g.connect(b.out);
  g.connect(b.verb);
  o.start(t);
  o.stop(t + 0.95);
  noiseHit(b, t, vol * 0.2, 0.08, 'lowpass', 900, 0.5);
}
