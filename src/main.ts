import './style.css';
import { enemyAct } from './ai';
import { AiWorkerPool } from './ai/pool';
import { loadMap, loadUnitDefs } from './data';
import { confirmSelected, describeHex, handleHexClick, undoSelectedMove, type InputDeps } from './input';
import { createRenderer, type BoardCallbacks } from './render';
import { UnitModelLayer } from './render3d';
import { produce, settleCaptures } from './rules';
import { createGame, producibleHexKeys, tileAt, unitAt } from './state';
import { beginEnemyTurn, finishEnemyTurn } from './turn';
import { key } from './hex';
import type { Game, MapData, UnitDefs } from './types';
import { createHud, type ContextAction } from './ui';

const ENEMY_START_DELAY_MS = 300;
const ENEMY_STEP_DELAY_MS = 450;

// AI Worker Pool の入れ物(生成のみ。思考は当面 src/ai.ts の簡易AI)
const aiPool = new AiWorkerPool();
void aiPool;

const container = document.getElementById('game-container');
if (!container) throw new Error('#game-container が見つかりません');
const renderer = createRenderer(container);

// ユニットの3Dモデル表示層(読み込めた場合だけ有効になる)
const modelLayer = new UnitModelLayer();
modelLayer.onAvailable = (ok) => {
  if (ok) refresh();
};

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
  // 行動を終えた歩兵の占領を確定する(未確定のままターン終了した場合)
  settleCaptures(g, 'p');
  for (const u of g.units) if (u.side === 'p') { u.moved = true; u.acted = true; }
  if (g.over) return refresh();
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
  onProduce: (kind) => {
    const g = current();
    const t = g.selectedHex;
    if (t && produce(g, 'p', kind, t)) refresh();
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
    g.selectedHex = t;
    const html = describeHex(g, t);
    hud.showInfo(html);
    const actions: ContextAction[] = [];

    // 生産: メニュー内ではユニットを選ばず、そのヘックスを選択して右ペインを開く(生産は右ペインから)
    if (!g.busy && !g.over && !unitAt(g, t) && producibleHexKeys(g, 'p').has(key(t))) {
      actions.push({
        label: '生産する(右ペインを開く)',
        run: () => {
          g.selectedHex = t;
          refresh();
          hud.openPane('right');
        },
      });
    }

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
    modelLayer.start(() => game);
    void modelLayer.loadModels(defs);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    hud.showError(`データの読み込みに失敗しました(${detail})。`);
  }
}

void boot();
