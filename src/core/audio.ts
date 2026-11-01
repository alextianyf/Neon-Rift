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

export const audioContext = (): AudioContext | null => actx;

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

// ±3% pitch so the same gun firing over and over doesn't sound like a loop.
const vary = (f: number) => f * (0.97 + Math.random() * 0.06);

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
  // Every weapon has its own firing sound and hit sound (docs/武装.md, 视觉和声音).
  // Standard tier: short and dry. Advanced: elemental texture. Elite: low end and a tail.
  shoot: {
    pulse: () => tone(vary(900), 0.05, 'triangle', 0.07, 0.55),
    smg: throttled(45, () => { noise(0.03, 0.09, vary(3200), 'bandpass'); tone(vary(1500), 0.02, 'square', 0.025, 0.7); }),
    shotgun: () => { noise(0.2, 0.4, 1800); tone(80, 0.18, 'sine', 0.3, 0.5); },
    frost: () => { tone(vary(2400), 0.08, 'sine', 0.05, 0.9); tone(vary(3600), 0.06, 'sine', 0.03, 0.8); },
    arc: () => { tone(vary(1200), 0.09, 'sawtooth', 0.045, 0.4); noise(0.07, 0.12, 6000, 'highpass'); },
    flame: throttled(90, () => noise(0.14, 0.12, vary(700), 'bandpass')),
    grenade: () => { tone(vary(180), 0.1, 'square', 0.08, 0.6); noise(0.05, 0.1, 800); },
    rocket: () => { tone(240, 0.35, 'sawtooth', 0.08, 2.2); noise(0.3, 0.12, 1200); },
    rail: () => { tone(3000, 0.3, 'sawtooth', 0.07, 0.12); noise(0.25, 0.3, 5000, 'highpass'); tone(70, 0.25, 'sine', 0.25, 0.5); },
    // detuned pair = a spinning whirr
    disc: () => { tone(vary(520), 0.28, 'sine', 0.06, 1.5); tone(vary(531), 0.28, 'sine', 0.05, 1.45); },
    blade: () => { noise(0.12, 0.2, vary(3500), 'bandpass'); tone(160, 0.2, 'sawtooth', 0.05, 2.5); },
    prism: () => { tone(vary(1318), 0.1, 'sine', 0.04); tone(vary(1661), 0.1, 'sine', 0.03); tone(vary(1976), 0.1, 'sine', 0.03); },
    spike: () => { tone(vary(700), 0.03, 'square', 0.06, 0.5); noise(0.03, 0.1, 2500, 'highpass'); },
    swarm: () => { for (let i = 0; i < 4; i++) setTimeout(() => noise(0.12, 0.12, vary(4000), 'highpass'), i * 45); },
    singularity: () => { tone(60, 0.5, 'sine', 0.25, 0.6); noise(0.4, 0.15, 400); },
  } satisfies Record<WeaponId, () => void>,
  hitBy: {
    pulse: throttled(40, () => tone(vary(500), 0.03, 'triangle', 0.06, 0.6)),
    smg: throttled(55, () => noise(0.025, 0.07, vary(4500), 'highpass')),
    shotgun: throttled(70, () => noise(0.08, 0.18, 600)),
    frost: throttled(50, () => tone(vary(3200), 0.05, 'sine', 0.04, 1.1)),
    arc: throttled(50, () => noise(0.05, 0.12, 7000, 'highpass')),
    flame: throttled(120, () => noise(0.1, 0.06, 2200, 'highpass')),
    grenade: throttled(60, () => tone(260, 0.05, 'square', 0.05, 0.6)),
    rocket: throttled(60, () => tone(200, 0.06, 'square', 0.06, 0.6)),
    rail: throttled(40, () => { tone(vary(1800), 0.06, 'sawtooth', 0.04, 0.5); }),
    disc: throttled(45, () => noise(0.05, 0.12, vary(5500), 'bandpass')),
    blade: throttled(40, () => { noise(0.07, 0.16, vary(2800), 'bandpass'); tone(220, 0.06, 'sawtooth', 0.04, 0.5); }),
    prism: throttled(50, () => tone(vary(2093), 0.07, 'sine', 0.04, 1)),
    spike: throttled(40, () => tone(vary(300), 0.04, 'square', 0.05, 0.5)),
    swarm: throttled(60, () => tone(240, 0.05, 'square', 0.05, 0.6)),
    singularity: throttled(80, () => tone(90, 0.08, 'sine', 0.08, 0.7)),
  } satisfies Record<WeaponId, () => void>,
  weaponSwitch: (i: number) => tone(700 + i * 120, 0.06, 'triangle', 0.08),
  hit: throttled(40, () => tone(320, 0.04, 'triangle', 0.08, 0.6)),
  crit: throttled(60, () => tone(1600, 0.06, 'square', 0.05, 0.5)),
  deflect: throttled(70, () => tone(2200, 0.05, 'square', 0.04, 0.6)),
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
  charge: () => tone(300, 0.6, 'sawtooth', 0.05, 3),
  catchDisc: () => { tone(1500, 0.08, 'triangle', 0.08, 1.2); tone(2250, 0.12, 'sine', 0.05, 1); },
  reflect: throttled(50, () => tone(2600, 0.1, 'triangle', 0.07, 1.3)),
  refract: throttled(50, (n: number) => { for (let i = 0; i < n; i++) setTimeout(() => tone(1046 * 2 ** ((i * 4) / 12), 0.12, 'sine', 0.05, 1), i * 45); }),
  stick: throttled(30, () => tone(500, 0.04, 'square', 0.05, 0.6)),
  lock: (n: number) => tone(880 * 2 ** (n / 12), 0.06, 'sine', 0.06, 1),
  well: () => tone(55, 1.2, 'sine', 0.25, 0.7),
  pulseCharged: () => { tone(220, 0.14, 'sine', 0.14, 0.7); tone(880, 0.08, 'triangle', 0.06, 0.5); },
  pop: throttled(60, () => { noise(0.18, 0.25, 1400); tone(160, 0.12, 'sine', 0.12, 0.5); }),
  bounce: (n: number) => tone(330 * 2 ** (n / 6), 0.08, 'square', 0.07, 0.9),
  slam: throttled(80, () => { noise(0.22, 0.35, 500); tone(80, 0.2, 'sine', 0.25, 0.6); }),
  freeze: throttled(80, () => { tone(2600, 0.12, 'sine', 0.06, 0.6); tone(3900, 0.1, 'sine', 0.04, 0.5); }),
  shatter: throttled(60, () => { noise(0.25, 0.25, 7000, 'highpass'); tone(3200, 0.2, 'triangle', 0.05, 0.35); }),
  overload: throttled(80, () => { noise(0.3, 0.3, 5000, 'highpass'); tone(600, 0.25, 'sawtooth', 0.08, 2.5); }),
  // magazine out, then a click as the new one seats
  reload: () => { noise(0.06, 0.12, 2500, 'highpass'); setTimeout(() => tone(1100, 0.04, 'square', 0.05, 0.7), 140); },
  levelUp: () => { tone(523, 0.1, 'triangle', 0.12); setTimeout(() => tone(659, 0.1, 'triangle', 0.12), 80); setTimeout(() => tone(1046, 0.2, 'triangle', 0.12), 160); },
  riftOpen: throttled(80, (big: boolean) => {
    noise(big ? 0.9 : 0.35, big ? 0.4 : 0.12, big ? 1500 : 3000, 'bandpass');
    tone(big ? 70 : 140, big ? 0.8 : 0.3, 'sawtooth', big ? 0.18 : 0.05, 0.5);
  }),
  enemyShot: () => tone(520, 0.06, 'triangle', 0.04, 0.7),
  // enemy signature sounds
  sizzle: throttled(260, () => noise(0.22, 0.07, 3200, 'highpass')),
  deploy: throttled(120, () => { tone(180, 0.12, 'square', 0.06, 1.6); setTimeout(() => tone(420, 0.05, 'square', 0.05, 0.8), 110); }),
  towerShot: throttled(90, () => tone(vary(760), 0.05, 'triangle', 0.035, 0.8)),
  burrow: throttled(120, () => { noise(0.45, 0.2, 260); tone(50, 0.4, 'sine', 0.18, 0.7); }),
  erupt: throttled(80, () => { noise(0.3, 0.35, 700); tone(70, 0.25, 'sine', 0.25, 1.6); }),
  replicate: throttled(120, () => { tone(vary(420), 0.14, 'sine', 0.06, 2); tone(vary(630), 0.12, 'sine', 0.04, 2); }),
  shieldBreak: throttled(80, () => { noise(0.18, 0.2, 6000, 'highpass'); tone(1200, 0.18, 'triangle', 0.06, 0.4); }),
  blink: throttled(80, () => tone(1600, 0.12, 'sine', 0.06, 0.3)),
  tether: throttled(120, () => { tone(220, 0.25, 'sawtooth', 0.06, 2.4); noise(0.15, 0.1, 4000, 'highpass'); }),
  linkHum: throttled(380, () => tone(vary(110), 0.4, 'sawtooth', 0.012, 1.02)),
  phaseOut: throttled(80, () => { tone(1500, 0.3, 'sine', 0.06, 0.25); noise(0.2, 0.06, 6000, 'highpass'); }),
  phaseIn: throttled(80, () => tone(380, 0.12, 'sine', 0.07, 4)),
  slash: throttled(60, () => { noise(0.12, 0.25, 5000, 'highpass'); tone(900, 0.08, 'triangle', 0.05, 0.4); }),
  mend: throttled(700, () => tone(vary(880), 0.3, 'sine', 0.015, 1.2)),
  mirror: throttled(60, () => tone(vary(2400), 0.15, 'sine', 0.05)),
  clear: () => { tone(523, 0.15, 'sine', 0.15); setTimeout(() => tone(784, 0.25, 'sine', 0.15), 120); },
  portal: () => tone(300, 0.5, 'sine', 0.2, 3),
};
