import '@fontsource/orbitron/600.css';
import '@fontsource/orbitron/800.css';
import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/700.css';
import './style.css';
import { LANG, translateDom } from './core/i18n';
import { TEST } from './core/testMode';
import { Game } from './game/game';
import { buildTestPanel } from './ui/testPanel';
import { loadSettings, saveSettings } from './ui/settings';
import { version } from '../package.json';

translateDom(document.body);
document.getElementById('version')!.textContent = `v${version}`;

// Language switch: save the choice and reload, since all text is resolved at load time.
const langBtn = document.getElementById('langBtn')!;
langBtn.textContent = LANG === 'en' ? '中文' : 'EN';
langBtn.addEventListener('click', () => {
  saveSettings({ ...loadSettings(), lang: LANG === 'en' ? 'zh' : 'en' });
  location.reload();
});

const game = new Game();
game.run();
if (TEST) {
  buildTestPanel(game);
  document.getElementById('version')!.textContent += ' · TEST';
}

// Dev builds only: inspect or poke the running game from the browser console via `window.game`.
if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
