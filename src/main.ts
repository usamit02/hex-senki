import './style.css';
import { enemyAct } from './ai';
import { loadMap, loadUnitDefs } from './data';
import { bindBoardInput } from './input';
import { createRenderer } from './render';
import { recruit } from './rules';
import { createGame } from './state';
import { beginEnemyTurn, finishEnemyTurn } from './turn';
import type { Game, MapData, UnitDefs } from './types';
import { createHud } from './ui';

const ENEMY_START_DELAY_MS = 300;
const ENEMY_STEP_DELAY_MS = 450;

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = createRenderer(canvas);

let game: Game | null = null;
let defs: UnitDefs;
let mapData: MapData;

const current = (): Game => {
  if (!game) throw new Error('ゲームがまだ始まっていません');
  return game;
};

function refresh(): void {
  if (!game) return;
  renderer.draw(game);
  hud.update(game);
}

function newGame(): void {
  game = createGame(defs, mapData);
  hud.setup(game);
  renderer.resize(game);
  hud.update(game);
}

function endTurn(): void {
  const g = current();
  if (g.over || g.busy) return;
  g.selected = null;
  g.reach = null;
  g.busy = true;
  const actors = beginEnemyTurn(g);
  g.message = '敵のターン…';
  refresh();

  let i = 0;
  const step = (): void => {
    if (g.over) return refresh();
    if (i >= actors.length) {
      finishEnemyTurn(g);
      return refresh();
    }
    const u = actors[i++];
    if (u.hp > 0) enemyAct(g, u);
    refresh();
    setTimeout(step, ENEMY_STEP_DELAY_MS);
  };
  setTimeout(step, ENEMY_START_DELAY_MS);
}

const hud = createHud({
  onRecruit: (kind) => {
    if (recruit(current(), kind)) refresh();
  },
  onEndTurn: endTurn,
  onNewGame: newGame,
});

bindBoardInput({ canvas, renderer, getGame: current, refresh });
window.addEventListener('resize', () => game && renderer.resize(game));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refresh);

async function boot(): Promise<void> {
  try {
    [defs, mapData] = await Promise.all([loadUnitDefs(), loadMap()]);
    newGame();
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    hud.showError(`データの読み込みに失敗しました(${detail})。`);
  }
}

void boot();
