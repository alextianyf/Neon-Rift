import type { WeaponId } from '../data/weapons';

// All sounds are synthesized with WebAudio, no audio files needed.
const BASE_GAIN = 0.25;
let actx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let volume = 1;

// Browsers only allow audio after a user gesture, so call this from a click handler.
export function initAudio(): void {
  if (actx) return;
  try {
    actx = new AudioContext();
    master = actx.createGain();
    master.gain.value = BASE_GAIN * volume;
    master.connect(actx.destination);
  } catch {
    actx = null;
  }
}

export function setVolume(v: number): void {
  volume = v;
  if (master) master.gain.value = BASE_GAIN * v;
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

function noise(dur: number, vol = 0.4, freq = 1200, type: BiquadFilterType = 'lowpass'): void {
  if (!actx || !master) return;
  if (!noiseBuf) {
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = actx.currentTime, s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  s.buffer = noiseBuf;
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  f.frequency.exponentialRampToValueAtTime(60, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t);
  s.stop(t + dur);
}

// Wrap a sound so it plays at most once per `ms`, for rapid-fire events.
function throttled<A extends unknown[]>(ms: number, play: (...args: A) => void): (...args: A) => void {
  let last = 0;
  return (...args: A) => {
    const now = performance.now();
    if (now - last < ms) return;
    last = now;
    play(...args);
  };
}

export const sfx = {
  shoot: {
    pulse: () => tone(900, 0.05, 'square', 0.05, 0.5),
    smg: throttled(45, () => tone(1200, 0.035, 'square', 0.035, 0.6)),
    shotgun: () => { noise(0.18, 0.35, 2600); tone(180, 0.1, 'sawtooth', 0.08, 0.5); },
    arc: () => { tone(1400, 0.08, 'sawtooth', 0.05, 0.3); noise(0.06, 0.12, 5000, 'highpass'); },
    frost: () => tone(1800, 0.07, 'sine', 0.06, 0.7),
    flame: throttled(90, () => noise(0.12, 0.12, 900)),
    grenade: () => tone(220, 0.12, 'square', 0.08, 1.6),
    rocket: () => tone(320, 0.3, 'sawtooth', 0.09, 0.3),
    rail: () => { tone(2400, 0.35, 'sawtooth', 0.08, 0.15); noise(0.3, 0.3, 4000, 'highpass'); },
  } satisfies Record<WeaponId, () => void>,
  weaponSwitch: (i: number) => tone(700 + i * 120, 0.06, 'triangle', 0.08),
  hit: throttled(40, () => tone(320, 0.04, 'triangle', 0.08, 0.6)),
  crit: throttled(60, () => tone(1600, 0.06, 'square', 0.05, 0.5)),
  zap: throttled(60, () => noise(0.12, 0.2, 6000, 'highpass')),
  kill: () => noise(0.22, 0.25, 1600),
  boom: () => { noise(0.6, 0.6, 900); tone(90, 0.4, 'sine', 0.3, 0.4); },
  hurt: () => { tone(160, 0.3, 'sawtooth', 0.22, 0.4); noise(0.2, 0.3, 800); },
  shieldBlock: () => { tone(900, 0.25, 'sine', 0.18, 0.5); tone(1350, 0.25, 'sine', 0.1, 0.5); },
  dash: () => tone(420, 0.14, 'sine', 0.12, 2.2),
  pickup: () => tone(660, 0.12, 'sine', 0.15, 1.6),
  coin: throttled(50, () => tone(1320, 0.07, 'square', 0.04, 1.3)),
  buy: () => { tone(880, 0.08, 'square', 0.08); setTimeout(() => tone(1320, 0.14, 'square', 0.08), 70); },
  denied: () => tone(140, 0.18, 'square', 0.1, 0.8),
  levelUp: () => { tone(523, 0.1, 'triangle', 0.12); setTimeout(() => tone(659, 0.1, 'triangle', 0.12), 80); setTimeout(() => tone(1046, 0.2, 'triangle', 0.12), 160); },
  riftOpen: throttled(80, (big: boolean) => {
    noise(big ? 0.9 : 0.35, big ? 0.4 : 0.12, big ? 1500 : 3000, 'bandpass');
    tone(big ? 70 : 140, big ? 0.8 : 0.3, 'sawtooth', big ? 0.18 : 0.05, 0.5);
  }),
  enemyShot: () => tone(520, 0.06, 'triangle', 0.04, 0.7),
  clear: () => { tone(523, 0.15, 'sine', 0.15); setTimeout(() => tone(784, 0.25, 'sine', 0.15), 120); },
  portal: () => tone(300, 0.5, 'sine', 0.2, 3),
};
