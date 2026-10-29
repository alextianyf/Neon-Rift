import './style.css';
import { Game } from './game/game';

const game = new Game();
game.run();

// Dev builds only: inspect or poke the running game from the browser console via `window.game`.
if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
