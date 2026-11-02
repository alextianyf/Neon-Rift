export interface Settings {
  volume: number;          // 0..1
  shake: boolean;
  damageNumbers: boolean;
  hints: boolean;
  music: number;           // 0..1, relative to the master volume
  musicOn: boolean;        // quick mute (top-right button / M key), keeps the music slider as it is
  lang?: 'zh' | 'en';      // unset: follow the browser language
}

const KEY = 'neonrift.settings';
const DEFAULTS: Settings = { volume: 0.8, shake: true, damageNumbers: true, hints: true, music: 0.6, musicOn: true };

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}
