import './style.css';
import { enemyAct } from './ai';
import { AiWorkerPool } from './ai/pool';
import { loadMap, loadUnitDefs } from './data';
import { confirmSelected, describeHex, handleHexClick, undoSelectedMove, type InputDeps } from './input';
import { createRenderer, type BoardCallbacks } from './render';
import { recruit } from './rules';
import { createGame, tileAt } from './state';
import { beginEnemyTurn, finishEnemyTurn } from './turn';
import type { Game, MapData, UnitDefs } from './types';
import { createHud, type ContextAction } from './ui';

const ENEMY_START_DELAY_MS = 300;
const ENEMY_STEP_DELAY_MS = 450;

// 要件7: AI Worker Pool の入れ物。生成だけ行い、Worker はまだ起動しない
// (思考は当面 src/ai.ts の簡易AI)。将来は endTurn で aiPool.think() に差し替える。
const aiPool = new AiWorkerPool();
void aiPool;

const container = document.getElementById('game-container');
if (!container) throw new Error('#game-container が見つかりません');
const renderer = createRenderer(container);

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
  renderer.start(game, boardCallbacks);
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
  onFitView: () => renderer.fitView(),
});

const inputDeps: InputDeps = { getGame: current, refresh };

const boardCallbacks: BoardCallbacks = {
  onHexClick: (c) => {
    hud.hideContext();
    handleHexClick(inputDeps, c);
  },
  // 要件3・5: 右クリックで情報+コマンドのメニュー
  onHexRightClick: (c, screen) => {
    const g = current();
    if (!c) {
      hud.showContext(screen.x, screen.y, 'マップの外です', [
        { label: '全体表示', run: () => renderer.fitView() },
        { label: 'ターン終了', disabled: g.busy || g.over, run: endTurn },
      ]);
      return;
    }
    const t = tileAt(g, c);
    if (!t) return;
    const html = describeHex(g, t);
    hud.showInfo(html);
    const actions: ContextAction[] = [];
    const sel = g.selected;
    if (sel && sel.moved && !sel.acted && sel.from) {
      actions.push({ label: '移動を取り消す', run: () => undoSelectedMove(inputDeps) });
    }
    if (sel && !sel.acted) {
      actions.push({ label: '選択中の駒の行動を確定', run: () => confirmSelected(inputDeps) });
    }
    actions.push({ label: '全体表示', run: () => renderer.fitView() });
    actions.push({ label: 'ターン終了', disabled: g.busy || g.over, run: endTurn });
    hud.showContext(screen.x, screen.y, html, actions);
  },
};

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
