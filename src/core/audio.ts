import type { WeaponSfx } from '../data/weapons';

// All sounds are synthesized with WebAudio, no audio files needed.
let actx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

// Browsers only allow audio after a user gesture, so call this from a click handler.
export function initAudio(): void {
  if (actx) return;
  try {
    actx = new AudioContext();
    master = actx.createGain();
    master.gain.value = 0.25;
    master.connect(actx.destination);
  } catch {
    actx = null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.2, slide = 1): void {
  if (!actx || !master) return;
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur);
}

function noise(dur: number, vol = 0.4, freq = 1200): void {
  if (!actx || !master) return;
  if (!noiseBuf) {
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = actx.currentTime, s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  s.buffer = noiseBuf;
  f.type = 'lowpass';
  f.frequency.setValueAtTime(freq, t);
  f.frequency.exponentialRampToValueAtTime(60, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t);
  s.stop(t + dur);
}

let lastHitSfx = 0;

export const sfx = {
  shoot: {
    blaster: () => tone(900, 0.05, 'square', 0.05, 0.5),
    shotgun: () => { noise(0.18, 0.35, 2600); tone(180, 0.1, 'sawtooth', 0.08, 0.5); },
    rocket: () => tone(320, 0.3, 'sawtooth', 0.09, 0.3),
  } satisfies Record<WeaponSfx, () => void>,
  weaponSwitch: (i: number) => tone(700 + i * 120, 0.06, 'triangle', 0.08),
  hit: () => {
    // throttled so rapid fire doesn't stack dozens of oscillators
    const now = performance.now();
    if (now - lastHitSfx > 40) { lastHitSfx = now; tone(320, 0.04, 'triangle', 0.08, 0.6); }
  },
  kill: () => noise(0.22, 0.25, 1600),
  boom: () => { noise(0.6, 0.6, 900); tone(90, 0.4, 'sine', 0.3, 0.4); },
  hurt: () => { tone(160, 0.3, 'sawtooth', 0.22, 0.4); noise(0.2, 0.3, 800); },
  dash: () => tone(420, 0.14, 'sine', 0.12, 2.2),
  pickup: () => tone(660, 0.12, 'sine', 0.15, 1.6),
  enemyShot: () => tone(520, 0.06, 'triangle', 0.04, 0.7),
  clear: () => { tone(523, 0.15, 'sine', 0.15); setTimeout(() => tone(784, 0.25, 'sine', 0.15), 120); },
  portal: () => tone(300, 0.5, 'sine', 0.2, 3),
};
