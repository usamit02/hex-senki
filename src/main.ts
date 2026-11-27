import './style.css';
import { executePlan, type AiAction } from './game/ai/planner';
import { AiWorkerPool } from './game/ai/pool';
import type { AiThinkRequest } from './game/ai/protocol';
import { loadMap, loadThemeUnitDefs } from './game/data';
import { addSave, applySave, deleteSave, listSaves, makeSaveData, type SaveData } from './game/save';
import { showSaveScreen } from './ui/savescreen';
import { confirmSelected, describeHex, describeIncome, describeUnit, handleHexClick, undoSelectedMove, type InputDeps } from './ui/input';
import { createRenderer, type BoardCallbacks } from './view/render';
import { UnitModelLayer } from './view/render3d';
import { canProduce, produce, reachable, resupplyFromAdjacentSupply, settleCaptures } from './game/rules';
import { airportAt, createGame, tileAt, townAt, unitAt } from './game/state';
import { showSettingsScreen } from './ui/settings';
import { playAttackSfx, playCaptureSfx, playExplosionSfx, playMoveSfx } from './audio/sfx';
import { checkVoicevox, dropQueued, setSpeechListener, setVoiceErrorHandler, speak, stopSpeaking, unlockAudio, type SpeechChannel } from './audio/voicevox';
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
  spectating = false;
  hud.setSpectating(false);
  hud.setup(game);
  hud.clearLog();
  stopSpeaking();
  // 音声ONのときは、開始時点で VOICEVOX へ接続できるか確認し、再生許可も得ておく
  cmdEnabled = settings.voice;
  if (game && game.allySpeaker === undefined) game.allySpeaker = settings.voiceSpeakerAlly;
  cmdSpeakers = { enemy: settings.voiceSpeaker, ally: game?.allySpeaker ?? settings.voiceSpeakerAlly };
  if (settings.voice) {
    unlockAudio();
    setVoiceErrorHandler((msg) => hud.showError(msg));
    const started = game;
    void checkVoicevox(settings.voiceSpeaker).then((reason) => {
      if (reason && game === started) {
        hud.showError(`VOICEVOXを使用できません: ${reason}。音声は出ません(字幕ログは動作します)。`);
      }
    });
  }
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
  cmdSpeakers.ally = game.allySpeaker ?? game.settings.voiceSpeakerAlly;
  refresh();
  return true;
}

function newGame(): void {
  showSettingsScreen(lastSettings, startGame);
}

/** AIの言語化: 字幕ログ(設定でONのとき)と VOICEVOX 音声(設定でONのとき)へ流す */
function narrate(g: Game, line: string, channel: SpeechChannel = 'enemy', tag?: string): void {
  if (g.settings.subtitles) hud.appendLog(line);
  if (g.settings.voice) {
    const speaker = channel === 'ally' ? (g.allySpeaker ?? g.settings.voiceSpeakerAlly) : g.settings.voiceSpeaker;
    speak(line, speaker, channel, tag);
  }
}

/** CPUターン開始時の状況読み上げ(状況表の内容を1行で。思考の待ち時間を持たせる)。
 * tag='situation' を付け、戦略目標の行が来たら待ち行列から譲らせる(優先して喋らせる) */
function narrateSituation(g: Game, channel: SpeechChannel = 'enemy'): void {
  const pT = g.towns.filter((t) => t.owner === 'p').length;
  const eT = g.towns.filter((t) => t.owner === 'e').length;
  const pU = g.units.filter((u) => u.side === 'p' && u.hp > 0).length;
  const eU = g.units.filter((u) => u.side === 'e' && u.hp > 0).length;
  narrate(g, `第${g.turn}ターン。先手: 都市${pT}、部隊${pU}。後手: 都市${eT}、部隊${eU}。`, channel, 'situation');
}

// ---------- 司令官の立ち絵(VOICEVOX読み上げ連動) ----------
type CmdExpression = 'normal' | 'smile' | 'troubled';
let cmdEnabled = false;
let cmdSpeakers: Record<SpeechChannel, number> = { enemy: 8, ally: 3 };

/** 話者IDから立ち絵セットを引く(画像があるキャラクターのみ。他の声では吹き出しだけ出す) */
function portraitSet(speaker: number): { base: string; ext: string } | null {
  if (speaker === 8) return { base: 'portraits/tsumugi', ext: 'png' };
  if (speaker === 3) return { base: 'portraits/zunda', ext: 'jpg' };
  return null;
}

function expressionFor(line: string): CmdExpression {
  if (/撃破された|失った|危機|後退|苦しい|まずい/.test(line)) return 'troubled';
  if (/撃破|占領|確保|制圧|よし|いいぞ/.test(line)) return 'smile';
  return 'normal';
}

interface CmdPanel {
  box: HTMLElement | null;
  img: HTMLImageElement | null;
  bubble: HTMLElement | null;
  expr: CmdExpression;
  mouthTimer: number | null;
  hideTimer: number | null;
}
const cmdPanels: Record<SpeechChannel, CmdPanel> = {
  enemy: { box: null, img: null, bubble: null, expr: 'normal', mouthTimer: null, hideTimer: null },
  ally: { box: null, img: null, bubble: null, expr: 'normal', mouthTimer: null, hideTimer: null },
};

function cmdSrc(channel: SpeechChannel, expr: CmdExpression, mouth: 'open' | 'closed'): string | null {
  const set = portraitSet(cmdSpeakers[channel]);
  return set ? `${set.base}-${expr}-${mouth}.${set.ext}` : null;
}

function stopMouth(p: CmdPanel): void {
  if (p.mouthTimer !== null) { clearInterval(p.mouthTimer); p.mouthTimer = null; }
}

function scheduleHide(p: CmdPanel, ms: number): void {
  if (p.hideTimer !== null) clearTimeout(p.hideTimer);
  p.hideTimer = window.setTimeout(() => {
    p.box?.classList.remove('show');
    p.hideTimer = null;
  }, ms);
}

function setupCommander(): void {
  cmdPanels.enemy = { ...cmdPanels.enemy, box: document.getElementById('commander'), img: document.getElementById('cmd-img') as HTMLImageElement | null, bubble: document.getElementById('cmd-bubble') };
  cmdPanels.ally = { ...cmdPanels.ally, box: document.getElementById('commander-ally'), img: document.getElementById('cmd-img-ally') as HTMLImageElement | null, bubble: document.getElementById('cmd-bubble-ally') };
  // 口パク・表情用の画像を先読みしておく(切り替え時のちらつき防止)
  for (const speaker of [8, 3]) {
    const set = portraitSet(speaker);
    if (!set) continue;
    for (const e of ['normal', 'smile', 'troubled'] as CmdExpression[]) {
      for (const m of ['open', 'closed'] as const) { const im = new Image(); im.src = `${set.base}-${e}-${m}.${set.ext}`; }
    }
  }
  setSpeechListener({
    onLineStart(text, channel) {
      if (!cmdEnabled) return;
      const p = cmdPanels[channel];
      if (!p.box || !p.img || !p.bubble) return;
      if (p.hideTimer !== null) { clearTimeout(p.hideTimer); p.hideTimer = null; }
      p.expr = expressionFor(text);
      p.bubble.textContent = text;
      const closed = cmdSrc(channel, p.expr, 'closed');
      if (closed) {
        p.img.style.display = '';
        p.img.src = closed;
      } else {
        p.img.style.display = 'none'; // 立ち絵の無い声では吹き出しだけ出す
      }
      p.box.classList.add('show');
      // 口パク: その行の再生中だけ、口の開閉画像を交互に切り替える
      stopMouth(p);
      if (closed) {
        let open = false;
        p.mouthTimer = window.setInterval(() => {
          open = !open;
          const src = cmdSrc(channel, p.expr, open ? 'open' : 'closed');
          if (src && p.img) p.img.src = src;
        }, 150);
      }
    },
    onLineEnd(_text, channel) {
      // 行が終わったら口パクを止め、次の行がすぐ来ない場合は画面端へ引っ込める
      // (表示時間がセリフより長くなりすぎないように、行単位で出し入れする)
      const p = cmdPanels[channel];
      stopMouth(p);
      const closed = cmdSrc(channel, p.expr, 'closed');
      if (closed && p.img) p.img.src = closed;
      scheduleHide(p, 350);
    },
    onIdle() {
      for (const channel of ['enemy', 'ally'] as SpeechChannel[]) {
        const p = cmdPanels[channel];
        stopMouth(p);
        scheduleHide(p, 350);
      }
    },
  });
}

/**
 * 現在の盤面をセーブ形式で Worker へ送り、行動リストを受け取る。
 * 行動リストのユニット番号はセーブ形式(生存ユニットのみ)の番号なので、実ゲームの番号へ変換して返す
 */
async function requestPlan(g: Game, partial: Omit<AiThinkRequest, 'save' | 'defs' | 'map'>, channel: SpeechChannel = 'enemy'): Promise<AiAction[]> {
  const save = makeSaveData(g);
  const alive = g.units.filter((u) => u.hp > 0);
  const toLive = (i: number): number => (alive[i] ? g.units.indexOf(alive[i]) : -1);
  const res = await aiPool.think(
    { save, defs: g.defs, map: mapData, ...partial },
    (line) => {
      // 戦略目標などの本命の行が来たら、まだ喋っていない状況読み上げは譲らせる
      dropQueued('situation');
      narrate(g, line, channel);
    },
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

/** 指定陣営の首都を画面中央に表示する(拡大縮小は変えない) */
function centerOnCapital(side: 'p' | 'e'): void {
  const g = current();
  const t = [...g.tiles.values()].find((t) => t.city?.capital === side);
  if (t) {
    renderer.centerOnTile(t);
    refresh(); // ミニマップの表示範囲も追随させる
  }
}

/** 行動リストを1手ずつ、実エンジンで再検証しながら実行し、盤面を見せながら進める */
async function executeActionsAnimated(g: Game, side: 'p' | 'e', actions: AiAction[], follow = false, cancelled?: () => boolean): Promise<void> {
  for (const a of actions) {
    if (g.over || cancelled?.()) break;
    // 敵のターン(と観戦時): 行動するユニット(または生産ヘックス)が画面外なら、その位置を中央に表示する
    if (side === 'e' || follow) {
      const subject: Tile | Unit | undefined = a.type === 'produce'
        ? g.tiles.get(a.hex)
        : g.units[a.type === 'disembark' ? a.carrier : a.unit];
      if (subject && !renderer.isVisible(subject)) {
        renderer.centerOnTile(subject);
        await sleep(120);
      }
    }
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
  // 敵のターン開始: 敵首都を画面中央に表示する
  centerOnCapital('e');
  // 思考が始まる前に状況表の内容を読み上げて、待ち時間を持たせる
  narrateSituation(g);

  void (async () => {
    try {
      const actions = await requestPlan(g, {
        side: 'e',
        budgetMs: g.settings.aiThinkMs,
        personality: g.settings.aiPersonality,
      });
      await executeActionsAnimated(g, 'e', actions);
    } catch (e) {
      // Worker が使えない環境ではゲームとして成立しないため、エラーで停止する
      const detail = e instanceof Error ? e.message : String(e);
      g.message = 'AI Worker を起動できませんでした。ゲームを停止します。';
      hud.showError(`AI Worker を起動できませんでした(${detail})。この環境ではゲームを続行できません。`);
      refresh();
      return;
    }
    finishEnemyTurn(g);
    refresh();
    // プレイヤーのターン開始: 自軍首都を画面中央に表示する
    centerOnCapital('p');
  })();
}

/**
 * CPU対CPU観戦(AI設計テスト用。AIが完成したら削除予定の機能)。
 * 両陣営とも新AIが打ち、盤面で眺められる。
 * 条件は本番・ベンチマークと同じ: 思考時間は設定値そのまま(最大10分/ターン)、
 * ターン上限はベンチマーク定義 = fill を除く実マップの (短辺+長辺)/2。
 * 上限に達したら打ち切り、スコア(占領town数)で結果を表示する
 */
let spectating = false;

/** ベンチマーク定義の打ち切りターン数(fill を除く実マップの (短辺+長辺)/2) */
function spectateTurnCap(g: Game): number {
  let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const t of g.tiles.values()) {
    if (t.terrain === 'fill') continue;
    minC = Math.min(minC, t.col); maxC = Math.max(maxC, t.col);
    minR = Math.min(minR, t.row); maxR = Math.max(maxR, t.row);
  }
  const w = maxC - minC + 1, h = maxR - minR + 1;
  return Math.round((Math.min(w, h) + Math.max(w, h)) / 2);
}

async function runSpectateLoop(): Promise<void> {
  const g = current();
  const budgetMs = g.settings.aiThinkMs;
  const turnCap = spectateTurnCap(g);
  let cutoff = false;
  try {
    while (spectating && !g.over) {
      if (g.turn > turnCap) { cutoff = true; break; }
      g.busy = true;
      centerOnCapital('p'); // ターン開始と同時に自首都を表示する
      g.message = `観戦中: 先手の第${g.turn}ターン(上限${turnCap}ターン)…`;
      refresh();
      // 観戦でも先手側は「プレイヤー側師団長」として、味方側の声・右下の立ち絵で喋る
      narrateSituation(g, 'ally');
      const pa = await requestPlan(g, { side: 'p', budgetMs, personality: g.settings.aiPersonality }, 'ally');
      await executeActionsAnimated(g, 'p', pa, true, () => !spectating);
      if (g.over || !spectating) break;
      settleCaptures(g, 'p');
      for (const u of g.units) if (u.side === 'p') { u.moved = true; u.acted = true; }
      refresh();
      if (g.over || !spectating) break;
      beginCpuTurn(g);
      centerOnCapital('e'); // ターンが入れ替わった時点で即座に敵首都へ移動する(思考を待たない)
      g.message = `観戦中: 後手の第${g.turn}ターン(上限${turnCap}ターン)…`;
      refresh();
      narrateSituation(g);
      const ea = await requestPlan(g, { side: 'e', budgetMs, personality: g.settings.aiPersonality });
      await executeActionsAnimated(g, 'e', ea, true, () => !spectating);
      finishEnemyTurn(g);
      centerOnCapital('p'); // プレイヤーのターンになった時点で即座に自首都へ移動する
      refresh();
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    hud.showError(`観戦中にAI Workerを起動できませんでした(${detail})。観戦を停止します。`);
  }
  spectating = false;
  hud.setSpectating(false);
  if (cutoff && !g.over) {
    // 打ち切り: スコア(占領town数)で結果を表示して終了する
    const pTowns = g.towns.filter((t) => t.owner === 'p').length;
    const eTowns = g.towns.filter((t) => t.owner === 'e').length;
    const result = pTowns > eTowns ? '先手の勝ち' : eTowns > pTowns ? '後手の勝ち' : '引き分け';
    g.over = true;
    g.message = `打ち切り(第${turnCap}ターン): スコア 先手 ${pTowns} - ${eTowns} 後手。${result}です。`;
    hud.appendLog(`観戦結果(打ち切り): 先手 ${pTowns} - ${eTowns} 後手、${result}。`);
  } else if (!g.over) {
    g.busy = false;
    g.message = '観戦を終了しました。あなたのターンです。';
  }
  refresh();
}

function startSpectate(): void {
  const g = current();
  if (spectating || g.busy || g.over) return;
  spectating = true;
  hud.setSpectating(true);
  void runSpectateLoop();
}

function stopSpectate(): void {
  spectating = false;
  void aiPool.requestStop();
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
    }, 'ally');
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
  onSetAllySpeaker: (speaker) => {
    const g = current();
    g.allySpeaker = speaker;
    cmdSpeakers.ally = speaker; // 立ち絵も声に追随させる
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
  onShowIncome: () => {
    const g = current();
    hud.toggleIncome(describeIncome(g));
  },
  onStartSpectate: () => {
    startSpectate();
  },
  onStopSpectate: () => {
    stopSpectate();
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
    const html = occupant ? `${describeUnit(g, occupant)}<hr>${describeHex(g, t)}` : describeHex(g, t);
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
  setupCommander();
  // ゲーム内の右クリック(情報表示・生産メニュー)と競合するため、ブラウザ既定の右クリックメニューを抑止する
  // (テキスト入力欄の上だけは、貼り付け等のために既定メニューを残す)
  window.addEventListener('contextmenu', (e) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    e.preventDefault();
  });
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
