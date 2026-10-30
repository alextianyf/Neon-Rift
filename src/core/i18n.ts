import { EN } from '../data/en';

// Chinese is the source language: every UI string is written in Chinese and passed through t().
// In English mode t() looks the string up in the EN table (falling back to the original).
// Placeholders like {n} are filled from `vars`. Switching language reloads the page.

export type Lang = 'zh' | 'en';

function detect(): Lang {
  try {
    const s = JSON.parse(localStorage.getItem('neonrift.settings') ?? '{}') as { lang?: string };
    if (s.lang === 'zh' || s.lang === 'en') return s.lang;
  } catch {
    // ignore
  }
  return /^zh/i.test(navigator.language) ? 'zh' : 'en';
}

export const LANG: Lang = detect();

export function t(zh: string, vars?: Record<string, string | number>): string {
  let s = LANG === 'en' ? EN[zh] ?? zh : zh;
  if (vars) for (const k in vars) s = s.split(`{${k}}`).join(String(vars[k]));
  return s;
}

// Join a list the way the language expects (、 in Chinese, commas in English).
export const joinList = (items: string[]): string => items.join(LANG === 'en' ? ', ' : '、');

// Translate the static text in index.html (text nodes and data-text attributes).
export function translateDom(root: HTMLElement): void {
  document.documentElement.lang = LANG === 'en' ? 'en' : 'zh-CN';
  if (LANG !== 'en') return;
  document.title = t(document.title);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const raw = n.textContent ?? '';
    const key = raw.trim();
    if (key && EN[key]) n.textContent = raw.replace(key, EN[key]);
  }
}
