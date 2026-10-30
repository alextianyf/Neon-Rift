import '@fontsource/orbitron/600.css';
import '@fontsource/orbitron/800.css';
import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/700.css';
import './style.css';
import { LANG, translateDom } from './core/i18n';
import { Game } from './game/game';
import { loadSettings, saveSettings } from './ui/settings';

translateDom(document.body);

// Language switch: save the choice and reload, since all text is resolved at load time.
const langBtn = document.getElementById('langBtn')!;
langBtn.textContent = LANG === 'en' ? '中文' : 'EN';
langBtn.addEventListener('click', () => {
  saveSettings({ ...loadSettings(), lang: LANG === 'en' ? 'zh' : 'en' });
  location.reload();
});

const game = new Game();
game.run();

// Dev builds only: inspect or poke the running game from the browser console via `window.game`.
if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
