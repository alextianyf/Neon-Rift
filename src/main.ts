import '@fontsource/orbitron/600.css';
import '@fontsource/orbitron/800.css';
import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/700.css';
import './style.css';
import { Game } from './game/game';

const game = new Game();
game.run();

// Dev builds only: inspect or poke the running game from the browser console via `window.game`.
if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
