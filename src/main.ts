import './style.css';
import { enemyAct, enemyProduce } from './game/ai/ai';
import { executePlan, type AiAction } from './game/ai/planner';
import { AiWorkerPool } from './game/ai/pool';
import type { AiThinkRequest } from './game/ai/protocol';
import { loadMap, loadThemeUnitDefs } from './game/data';
import { addSave, applySave, deleteSave, listSaves, makeSaveData, type SaveData } from './game/save';
import { showSaveScreen } from './ui/savescreen';
import { confirmSelected, describeHex, describeUnit, handleHexClick, undoSelectedMove, type InputDeps } from './ui/input';
import { createRenderer, type BoardCallbacks } from './view/render';
import { UnitModelLayer } from './view/render3d';
import { canProduce, produce, reachable, resupplyFromAdjacentSupply, settleCaptures } from './game/rules';
import { airportAt, createGame, liveUnits, tileAt, townAt, unitAt } from './game/state';
import { showSettingsScreen } from './ui/settings';
import { playAttackSfx, playCaptureSfx, playExplosionSfx, playMoveSfx } from './audio/sfx';
import { speak, stopSpeaking } from './audio/voicevox';
import { getTheme } from './game/themes';
import { validateUnitDefs } from './game/validate';
import { DEFAULT_SETTINGS, type GameSettings } from './game/types';
import { beginCpuTurn, finishEnemyTurn } from './game/turn';
import { distance, key } from './game/hex';
import type { Game, MapData, ThemeId, Tile, Unit, UnitDefs } from './game/types';
import { createHud, type ContextAction } from './ui/ui';

const ENEMY_STEP_DELAY_MS = 450;
/** プレイヤー側委任の思考時間の上限(ms)。「もう打ってよい」でも打ち切れる */
const DELEGATION_BUDGET_MS = 30_000;

// AI思考用 Worker(思考はメインスレッドを止めない)
const aiPool = new AiWorkerPool(1);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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
    const fx = g.pendingFx;
    renderer.playBattleFx(fx.a, fx.d);
    playAttackSfx(fx.sfx);
    // 戦闘結果ポップアップ(数秒でフェードアウト)
    let html = `<b>${fx.aName}</b> の ${fx.weapon} → <b>${fx.dName}</b> に <b>${fx.damage}</b> ダメージ`;
    if (fx.destroyed) html += '<br>💥 ' + fx.dName + ' を全滅させた!';
    if (fx.counterDamage > 0) {
      html += `<br>反撃で <b>${fx.counterDamage}</b> ダメージを受けた`;
      if (fx.counterDestroyed) html += '<br>💥 ' + fx.aName + ' が全滅した…';
    }
    hud.showBattlePopup(html);
    if (fx.destroyed) {
      renderer.playExplosion(fx.d);
      playExplosionSfx();
    }
    if (fx.counterDestroyed) {
      renderer.playExplosion(fx.a);
      playExplosionSfx();
    }
    g.pendingFx = null;
  }
  if (g.pendingCapture) {
    renderer.playCaptureFx(g.pendingCapture.at, g.pendingCapture.side);
    playCaptureSfx();
    g.pendingCapture = null;
  }
  if (g.pendingMoveSfx) {
    playMoveSfx(g.pendingMoveSfx);
    g.pendingMoveSfx = null;
  }
  renderer.draw(g);
  hud.update(g);
  // 左ペイン: 右クリックで固定した情報 > ユニット情報 > 選択中ヘックスの情報
  const selectedTile = g.selected ? tileAt(g, g.selected) : undefined;
  const infoHtml = g.pinnedInfo
    ?? (g.selected
      ? describeUnit(g, g.selected) + (selectedTile ? `<hr>${describeHex(g, selectedTile)}` : '')
      : g.selectedHex
        ? describeHex(g, g.selectedHex)
        : 'ヘックスやユニットをクリックすると情報が表示されます。');
  if (infoHtml !== lastInfoHtml) {
    lastInfoHtml = infoHtml;
    hud.showInfo(infoHtml);
  }
  hud.drawMinimap(g, renderer.getViewport(), renderer.worldSize());
}

function startGame(settings: GameSettings): boolean {
  settings = { ...DEFAULT_SETTINGS, ...settings }; // 旧セーブなど新項目が無い設定でも既定値で補う
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
  hud.clearLog();
  stopSpeaking();
  renderer.start(game, boardCallbacks);
  // 3Dモデルは現代テーマのみ(他テーマは2D駒表示)
  if (settings.theme === 'modern') {
    modelLayer.start(() => game);
    void modelLayer.loadModels(game.defs);
  }
  refresh();
  return true;
}

/** セーブデータからゲームを開始する */
function startFromSave(data: SaveData): boolean {
  if (!startGame(data.settings)) return false;
  if (!game) return false;
  try {
    applySave(game, data);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    hud.showError(`セーブデータを読み込めませんでした: ${detail}`);
    return false;
  }
  refresh();
  return true;
}

function newGame(): void {
  showSettingsScreen(lastSettings, startGame);
}

/** AIの言語化: 字幕ログ(設定でONのとき)と VOICEVOX 音声(設定でONのとき)へ流す */
function narrate(g: Game, line: string): void {
  if (g.settings.subtitles) hud.appendLog(line);
  if (g.settings.voice) speak(line);
}

/**
 * 現在の盤面をセーブ形式で Worker へ送り、行動リストを受け取る。
 * 行動リストのユニット番号はセーブ形式(生存ユニットのみ)の番号なので、実ゲームの番号へ変換して返す
 */
async function requestPlan(g: Game, partial: Omit<AiThinkRequest, 'save' | 'defs' | 'map'>): Promise<AiAction[]> {
  const save = makeSaveData(g);
  const alive = g.units.filter((u) => u.hp > 0);
  const toLive = (i: number): number => (alive[i] ? g.units.indexOf(alive[i]) : -1);
  const res = await aiPool.think(
    { save, defs: g.defs, map: mapData, ...partial },
    (line) => narrate(g, line),
  );
  const out: AiAction[] = [];
  for (const a of res.actions) {
    switch (a.type) {
      case 'produce':
        out.push(a);
        break;
      case 'move':
      case 'confirm': {
        const u = toLive(a.unit);
        if (u >= 0) out.push({ ...a, unit: u });
        break;
      }
      case 'attack': {
        const u = toLive(a.unit);
        const t = toLive(a.target);
        if (u >= 0 && t >= 0) out.push({ ...a, unit: u, target: t });
        break;
      }
      case 'board': {
        const u = toLive(a.unit);
        const c = toLive(a.carrier);
        if (u >= 0 && c >= 0) out.push({ ...a, unit: u, carrier: c });
        break;
      }
      case 'disembark': {
        const c = toLive(a.carrier);
        if (c >= 0) out.push({ ...a, carrier: c });
        break;
      }
    }
  }
  return out;
}

/** 行動リストを1手ずつ、実エンジンで再検証しながら実行し、盤面を見せながら進める */
async function executeActionsAnimated(g: Game, side: 'p' | 'e', actions: AiAction[]): Promise<void> {
  for (const a of actions) {
    if (g.over) break;
    executePlan(g, side, [a]);
    refresh();
    await sleep(ENEMY_STEP_DELAY_MS);
  }
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
  beginCpuTurn(g);
  g.message = '敵のターン…';
  refresh();

  void (async () => {
    try {
      const actions = await requestPlan(g, {
        side: 'e',
        budgetMs: g.settings.aiThinkMs,
        personality: g.settings.aiPersonality,
      });
      await executeActionsAnimated(g, 'e', actions);
    } catch {
      // Worker が使えない場合は旧AIでターンを続行する
      enemyProduce(g);
      for (const u of liveUnits(g, 'e')) {
        if (g.over) break;
        if (!u.acted && u.hp > 0) enemyAct(g, u);
        refresh();
        await sleep(ENEMY_STEP_DELAY_MS);
      }
    }
    finishEnemyTurn(g);
    refresh();
  })();
}

/** 目標ヘックスの表示名 */
function objectiveName(g: Game, t: Tile): string {
  const town = townAt(g, t);
  if (town) return town.name;
  const airport = airportAt(g, t);
  if (airport) return airport.name;
  if (t.city?.capital === 'e') return '敵首都';
  if (t.city?.capital === 'p') return '自軍首都';
  return '目標地点';
}

/** 師団の初期目標: 最寄りの未占領 town。無ければ敵首都 */
function defaultObjectiveKey(g: Game, u: Unit): string {
  let best: Tile | null = null;
  let bestDist = Infinity;
  for (const t of g.towns) {
    if (t.owner === 'p') continue;
    const tile = g.tilesById.get(t.hexId);
    if (!tile) continue;
    const d = distance(u, tile);
    if (d < bestDist) { bestDist = d; best = tile; }
  }
  if (!best) {
    for (const t of g.tiles.values()) {
      if (t.city?.capital === 'e') { best = t; break; }
    }
  }
  return best ? key(best) : key(u);
}

/** 師団長の指定/解除。全滅した師団(師団長未指定)があれば、そちらへ再指定する */
function toggleCommander(u: Unit): void {
  const g = current();
  const idx = g.units.indexOf(u);
  const existing = g.delegations.findIndex((d) => d.unit === idx);
  if (existing >= 0) {
    g.delegations.splice(existing, 1);
    g.message = '師団長を解除しました。';
    refresh();
    return;
  }
  const orphan = g.delegations.find((d) => d.unit < 0 || !g.units[d.unit] || g.units[d.unit].hp <= 0);
  if (orphan) {
    orphan.unit = idx;
    g.message = `${g.defs[u.kind].name} を師団長に再指定しました。`;
    refresh();
    return;
  }
  g.delegations.push({ unit: idx, objectiveKey: defaultObjectiveKey(g, u) });
  g.message = `${g.defs[u.kind].name} を師団長に指定しました。目標は師団パネルで変更できます。`;
  refresh();
}

/** 師団を委任実行する。師団長と周囲8ヘックス以内の未行動ユニットだけが動く(生産は委任しない) */
async function runDelegation(di: number): Promise<boolean> {
  const g = current();
  if (g.busy || g.over) return false;
  const del = g.delegations[di];
  if (!del || del.unit < 0) return false;
  const cmd = g.units[del.unit];
  if (!cmd || cmd.hp <= 0) {
    g.message = '師団長が全滅しています。部隊表の ⚑ で別のユニットを指定してください。';
    refresh();
    return false;
  }
  if (cmd.acted) {
    g.message = '師団長は行動済みのため、今ターンは委任できません。';
    refresh();
    return false;
  }
  const objTile = g.tiles.get(del.objectiveKey);
  if (!objTile) return false;
  // 範囲内の未行動ユニット(実ゲームのインデックス)を集め、セーブ形式のインデックスへ変換する
  const alive = g.units.filter((x) => x.hp > 0);
  const liveToSave = new Map<number, number>();
  alive.forEach((x, si) => liveToSave.set(g.units.indexOf(x), si));
  const scopeIndices: number[] = [];
  g.units.forEach((x, i) => {
    if (x.side === 'p' && x.hp > 0 && !x.acted && !x.carriedBy && distance(x, cmd) <= 8) {
      const si = liveToSave.get(i);
      if (si !== undefined) scopeIndices.push(si);
    }
  });
  g.busy = true;
  hud.setThinking(true);
  g.message = `師団${di + 1}が行動中…`;
  refresh();
  try {
    const actions = await requestPlan(g, {
      side: 'p',
      budgetMs: DELEGATION_BUDGET_MS,
      personality: 'balanced',
      delegated: true,
      scopeIndices,
      fixedObjective: { at: { x: objTile.x, y: objTile.y, z: objTile.z }, name: objectiveName(g, objTile) },
    });
    await executeActionsAnimated(g, 'p', actions);
    settleCaptures(g, 'p');
    g.message = `師団${di + 1}の委任行動が終わりました。`;
  } catch {
    g.message = '委任に失敗しました。';
  }
  hud.setThinking(false);
  g.busy = false;
  refresh();
  return true;
}

const hud = createHud({
  onProduce: (kind) => {
    const g = current();
    const t = g.selectedHex;
    if (t && produce(g, 'p', kind, t)) refresh();
  },
  onEndTurn: endTurn,
  onNewGame: newGame,
  onSave: () => {
    const g = game;
    if (!g) return;
    const label = `${getTheme(g.settings.theme).label} ターン${g.turn}`;
    if (addSave(g, label)) {
      g.message = 'セーブしました。';
    } else {
      hud.showError('セーブは最大16件までです。ロード画面から不要なセーブを削除してください。');
      return;
    }
    refresh();
  },
  onLoad: () => {
    const entries = listSaves();
    if (entries.length === 0) {
      hud.showError('セーブデータがありません。');
      return;
    }
    showSaveScreen(entries, {
      onLoad: (i) => startFromSave(entries[i].data),
      onDelete: (i) => deleteSave(i),
      onNewGame: () => newGame(),
      onClose: () => undefined,
    });
  },
  onFitView: () => renderer.fitView(),
  onSelectUnit: (u) => {
    const g = current();
    g.pinnedInfo = null;
    g.selected = u;
    g.selectedHex = tileAt(g, u) ?? null;
    // 盤面クリックで選択したときと同じく、移動範囲を表示する(表示されないと次のクリックが行動確定になってしまう)
    if (!u.moved && !u.acted) resupplyFromAdjacentSupply(g, u);
    g.reach = u.moved || u.acted ? null : reachable(g, u);
    renderer.focusOn(u);
    refresh();
  },
  onMinimapPan: (fx, fy) => {
    const g = current();
    const world = renderer.worldSize();
    renderer.centerOnWorld(world.x + fx * world.w, world.y + fy * world.h);
    hud.drawMinimap(g, renderer.getViewport(), world);
  },
  onToggleCommander: (u) => toggleCommander(u),
  onSetObjective: (di, objectiveKey) => {
    const g = current();
    if (g.delegations[di]) g.delegations[di].objectiveKey = objectiveKey;
    refresh();
  },
  onRunDelegation: (di) => {
    void runDelegation(di);
  },
  onReleaseDelegation: (di) => {
    const g = current();
    g.delegations.splice(di, 1);
    g.message = '師団を解散しました。';
    refresh();
  },
  onRunAllDelegations: () => {
    void (async () => {
      const g = current();
      for (let di = 0; di < g.delegations.length; di++) {
        if (g.over) break;
        await runDelegation(di);
      }
    })();
  },
  onStopThinking: () => {
    void aiPool.requestStop();
  },
});

const inputDeps: InputDeps = { getGame: current, refresh };

const boardCallbacks: BoardCallbacks = {
  onHexClick: (c) => {
    hud.hideContext();
    current().pinnedInfo = null; // 左クリックで右クリック固定表示を解除する
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
    // ヘックス情報に、そのマスのユニット情報(燃料含む)も添える
    const occupant = unitAt(g, t);
    const html = describeHex(g, t) + (occupant ? `<hr>${describeUnit(g, occupant)}` : '');
    // ユニットが居るヘックスでも、右クリックではヘックス情報を左ペインに固定表示する
    g.pinnedInfo = html;
    hud.showInfo(html);
    const actions: ContextAction[] = [];

    // 生産: メニュー内ではユニットを選ばず、そのヘックスを選択して右ペインを開く(生産は右ペインから)
    if (!g.busy && !g.over && !unitAt(g, t) && Object.keys(g.defs).some((kind) => canProduce(g, 'p', kind, t))) {
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
    // 起動時のセーブ判定: なければ通常起動、1件だけならそれを読み込み、複数なら選択画面を出す。
    // 設定画面は「新規ゲーム」を押したときにだけ表示する
    const entries = listSaves();
    if (entries.length === 0) {
      startGame(DEFAULT_SETTINGS);
    } else if (entries.length === 1) {
      if (!startFromSave(entries[0].data)) startGame(DEFAULT_SETTINGS);
    } else {
      showSaveScreen(entries, {
        onLoad: (i) => startFromSave(listSaves()[i].data),
        onDelete: (i) => deleteSave(i),
        onNewGame: () => startGame(DEFAULT_SETTINGS),
      });
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    hud.showError(`データの読み込みに失敗しました(${detail})。`);
  }
}

void boot();
