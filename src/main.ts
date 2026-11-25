import './style.css';
import { enemyAct } from './ai';
import { AiWorkerPool } from './ai/pool';
import { loadMap, loadThemeUnitDefs } from './data';
import { confirmSelected, describeHex, describeUnit, handleHexClick, undoSelectedMove, type InputDeps } from './input';
import { createRenderer, type BoardCallbacks } from './render';
import { UnitModelLayer } from './render3d';
import { produce, settleCaptures } from './rules';
import { createGame, producibleHexKeys, tileAt, unitAt } from './state';
import { showSettingsScreen } from './settings';
import { playAttackSfx, playMoveSfx } from './sfx';
import { getTheme } from './themes';
import { validateUnitDefs } from './validate';
import { DEFAULT_SETTINGS, type GameSettings } from './types';
import { beginEnemyTurn, finishEnemyTurn } from './turn';
import { key } from './hex';
import type { Game, MapData, ThemeId, UnitDefs } from './types';
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
let mapData: MapData;
/** public/units.json から読んだテーマ別ユニット定義(あれば themes.ts の組み込みより優先) */
let fileDefs: Partial<Record<ThemeId, UnitDefs>> = {};
let lastSettings: GameSettings = DEFAULT_SETTINGS;
let lastInfoHtml = '';

const current = (): Game => {
  if (!game) throw new Error('ゲームがまだ始まっていません');
  return game;
};

function refresh(): void {
  if (!game) return;
  const g = game;
  // 交戦演出と効果音(rules が積んだイベントをここで消費する)
  if (g.pendingFx) {
    renderer.playBattleFx(g.pendingFx.a, g.pendingFx.d);
    playAttackSfx(g.pendingFx.sfx);
    g.pendingFx = null;
  }
  if (g.pendingMoveSfx) {
    playMoveSfx(g.pendingMoveSfx);
    g.pendingMoveSfx = null;
  }
  renderer.draw(g);
  hud.update(g);
  // 左ペイン: ユニット選択中はユニット情報、それ以外は選択中ヘックスの情報
  const infoHtml = g.selected
    ? describeUnit(g, g.selected)
    : g.selectedHex
      ? describeHex(g, g.selectedHex)
      : 'ヘックスやユニットをクリックすると情報が表示されます。';
  if (infoHtml !== lastInfoHtml) {
    lastInfoHtml = infoHtml;
    hud.showInfo(infoHtml);
  }
  hud.drawMinimap(g, renderer.getViewport(), renderer.worldSize(g));
}

function startGame(settings: GameSettings): boolean {
  lastSettings = settings;
  try {
    const theme = getTheme(settings.theme);
    const defs = fileDefs[settings.theme] ?? theme.defs;
    validateUnitDefs(defs);
    game = createGame(defs, mapData, settings);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    hud.showError(`ゲームを開始できませんでした: ${detail}`);
    return false;
  }
  hud.setup(game);
  renderer.start(game, boardCallbacks);
  // 3Dモデルは現代テーマのみ(他テーマは2D駒表示)
  if (settings.theme === 'modern') {
    modelLayer.start(() => game);
    void modelLayer.loadModels(game.defs);
  }
  refresh();
  return true;
}

function newGame(): void {
  showSettingsScreen(lastSettings, startGame);
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
  onSelectUnit: (u) => {
    const g = current();
    g.selected = u;
    g.selectedHex = tileAt(g, u) ?? null;
    g.reach = null;
    renderer.focusOn(u);
    refresh();
  },
  onMinimapPan: (fx, fy) => {
    const g = current();
    const { w, h } = renderer.worldSize(g);
    renderer.centerOnWorld(fx * w, fy * h);
    hud.drawMinimap(g, renderer.getViewport(), renderer.worldSize(g));
  },
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
    if (!t || t.terrain === 'fill') {
      hud.showContext(screen.x, screen.y, 'マップの外です', [
        { label: '全体表示', run: () => renderer.fitView() },
        { label: 'ターン終了', disabled: g.busy || g.over, run: endTurn },
      ]);
      return;
    }
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
    [mapData, fileDefs] = await Promise.all([loadMap(), loadThemeUnitDefs()]);
    // 起動時は設定画面を出さず、現代戦(既定設定)でそのまま開始する。
    // 設定画面は「新規ゲーム」を押したときにだけ表示する
    startGame(DEFAULT_SETTINGS);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    hud.showError(`データの読み込みに失敗しました(${detail})。`);
  }
}

void boot();
