import { canProduce } from '../game/rules';
import { income, producibleHexKeys } from '../game/state';
import { key } from '../game/hex';
import { getTheme } from '../game/themes';
import type { Game, Unit } from '../game/types';
import { FALLBACK_SPEAKERS, fetchSpeakers } from '../audio/voicevox';

/** 師団長の声の選択肢。VOICEVOX に届けば実際の話者一覧に差し替わる */
let speakerOptions: Array<{ name: string; styleId: number }> = FALLBACK_SPEAKERS;
void fetchSpeakers().then((list) => { if (list) speakerOptions = list; });

export interface HudHandlers {
  onProduce(kind: string): void;
  onEndTurn(): void;
  onNewGame(): void;
  onSave(): void;
  onLoad(): void;
  onFitView(): void;
  /** 部隊表でユニットが選ばれた */
  onSelectUnit(u: Unit): void;
  /** ミニマップの赤枠ドラッグ: 表示中心を全体に対する割合(0..1)で指定 */
  onMinimapPan(fx: number, fy: number): void;
  /** 部隊表の ⚑: 師団長の指定/解除(全滅した師団があればその再指定) */
  onToggleCommander(u: Unit): void;
  /** 師団の目標変更 */
  onSetObjective(dIndex: number, objectiveKey: string): void;
  /** 師団長の声の変更(師団パネル) */
  onSetAllySpeaker(speaker: number): void;
  /** 師団を委任実行 */
  onRunDelegation(dIndex: number): void;
  /** 師団を解散 */
  onReleaseDelegation(dIndex: number): void;
  /** 全師団を委任実行 */
  onRunAllDelegations(): void;
  /** 委任思考の「もう打ってよい」 */
  onStopThinking(): void;
  /** 資金ボタン: 収入表を表示 */
  onShowIncome(): void;
  /** CPU対CPU観戦を開始(AI設計テスト用。AI完成後に削除予定) */
  onStartSpectate(): void;
  /** 観戦を停止 */
  onStopSpectate(): void;
}

export interface ContextAction {
  label: string;
  disabled?: boolean;
  run(): void;
}

export type PaneSide = 'left' | 'right' | 'bottom' | 'top';

export interface Hud {
  setup(g: Game): void;
  update(g: Game): void;
  showError(text: string): void;
  showContext(x: number, y: number, infoHtml: string, actions: ContextAction[]): void;
  hideContext(): void;
  showInfo(html: string): void;
  /** 戦闘結果ポップアップ(数秒でフェードアウト) */
  showBattlePopup(html: string): void;
  /** 指定したペインを開く(他は閉じる) */
  openPane(side: PaneSide): void;
  /** ミニマップ全体図を描き直す(地形・town・ユニット・表示範囲の赤枠) */
  drawMinimap(g: Game, viewport: { x: number; y: number; w: number; h: number } | null, world: { x: number; y: number; w: number; h: number }): void;
  /** 字幕ログへ1行追加する */
  appendLog(line: string): void;
  /** 字幕ログを消す */
  clearLog(): void;
  /** 思考中表示(「もう打ってよい」ボタンの出し入れ) */
  setThinking(on: boolean): void;
  /** 観戦中表示(開始/停止ボタンの出し入れ) */
  setSpectating(on: boolean): void;
  /** 収入表の表示/非表示を切り替える(資金ボタンの直下に出る)。表示したら true */
  toggleIncome(html: string): boolean;
}

const el = <T extends HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} が見つかりません`);
  return e as T;
};

export function createHud(handlers: HudHandlers): Hud {
  const turnLabel = el('tn');
  const goldLabel = el('gd');
  (goldLabel as HTMLButtonElement).onclick = () => handlers.onShowIncome();
  const message = el('msg');
  const info = el('info');
  const produceBox = el('produce');
  const produceTarget = el('produce-target');
  const endTurn = el<HTMLButtonElement>('be');
  const newGame = el<HTMLButtonElement>('bn');
  const fitView = el<HTMLButtonElement>('bf');
  const ctx = el('ctx');
  const produceButtons = new Map<string, HTMLButtonElement>();

  endTurn.onclick = handlers.onEndTurn;
  newGame.onclick = handlers.onNewGame;
  el('bsv').onclick = () => handlers.onSave();
  el('bld').onclick = () => handlers.onLoad();
  fitView.onclick = handlers.onFitView;

  const paneIds: Record<PaneSide, string> = { left: 'pane-left', right: 'pane-right', bottom: 'pane-bottom', top: 'pane-top' };
  // ピン留め(出しっぱなし)中のペインは、他のペインを開いても閉じない
  const pinnedPanes = new Set<PaneSide>();
  const closeOthers = (except: PaneSide): void => {
    (Object.keys(paneIds) as PaneSide[]).forEach((s2) => {
      if (s2 !== except && !pinnedPanes.has(s2)) el(paneIds[s2]).classList.remove('open');
    });
  };
  const openPane = (side: PaneSide): void => {
    closeOthers(side);
    el(paneIds[side]).classList.add('open');
  };
  const tabs: Array<[string, PaneSide]> = [
    ['tab-left', 'left'],
    ['tab-right', 'right'],
    ['tab-bottom', 'bottom'],
    ['tab-top', 'top'],
  ];
  for (const [tabId, side] of tabs) {
    el(tabId).addEventListener('click', () => {
      const pane = el(paneIds[side]);
      const isOpen = pane.classList.contains('open');
      if (isOpen) {
        if (!pinnedPanes.has(side)) pane.classList.remove('open');
      } else {
        closeOthers(side);
        pane.classList.add('open');
      }
    });
  }
  // ピンボタン: 出しっぱなしの切り替え
  document.querySelectorAll<HTMLButtonElement>('.pin-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const side = btn.dataset.pin as PaneSide;
      const pane = el(paneIds[side]);
      if (pinnedPanes.has(side)) {
        pinnedPanes.delete(side);
        pane.classList.remove('pinned');
      } else {
        pinnedPanes.add(side);
        pane.classList.add('pinned', 'open');
      }
    });
  });

  const minimap = el<HTMLCanvasElement>('minimap');
  const unitTable = el('unit-table');
  // 部隊表の絞込(未行動のみ)と「次部隊」ボタン
  let unactedOnly = false;
  let lastGame: Game | null = null;
  const btnUnacted = el<HTMLButtonElement>('btn-unacted');
  const btnNext = el<HTMLButtonElement>('btn-next-unit');
  btnUnacted.onclick = () => {
    unactedOnly = !unactedOnly;
    btnUnacted.classList.toggle('active', unactedOnly);
    if (lastGame) hudRef.update(lastGame);
  };
  btnNext.onclick = () => {
    if (!lastGame) return;
    const g = lastGame;
    const ready = g.units.filter((u) => u.side === 'p' && u.hp > 0 && !u.carriedBy && !u.acted);
    if (ready.length === 0) return;
    const idx = g.selected ? ready.indexOf(g.selected) : -1;
    handlers.onSelectUnit(ready[(idx + 1) % ready.length]);
  };
  const btnStop = el<HTMLButtonElement>('btn-stop-thinking');
  btnStop.onclick = () => handlers.onStopThinking();
  el<HTMLButtonElement>('btn-run-all-delegations').onclick = () => handlers.onRunAllDelegations();
  const btnSpectate = el<HTMLButtonElement>('btn-spectate');
  const btnSpectateStop = el<HTMLButtonElement>('btn-spectate-stop');
  btnSpectate.onclick = () => handlers.onStartSpectate();
  btnSpectateStop.onclick = () => handlers.onStopSpectate();
  const aiLog = el('ai-log');
  let minimapDrag = false;
  const minimapPan = (e: PointerEvent): void => {
    const r = minimap.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    handlers.onMinimapPan(Math.min(1, Math.max(0, fx)), Math.min(1, Math.max(0, fy)));
  };
  minimap.addEventListener('pointerdown', (e) => {
    minimapDrag = true;
    minimap.setPointerCapture(e.pointerId);
    minimapPan(e);
  });
  minimap.addEventListener('pointermove', (e) => {
    if (minimapDrag) minimapPan(e);
  });
  minimap.addEventListener('pointerup', () => {
    minimapDrag = false;
  });

  const hideContext = (): void => {
    ctx.hidden = true;
    ctx.replaceChildren();
  };
  document.addEventListener('pointerdown', (e) => {
    if (!ctx.hidden && !ctx.contains(e.target as Node)) hideContext();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideContext();
  });

  let hudRef: Hud;
  hudRef = {
    setup(g) {
      produceBox.replaceChildren();
      produceButtons.clear();
      for (const [kind, def] of Object.entries(g.defs)) {
        const b = document.createElement('button');
        b.textContent = `${def.name}を生産 (${def.cost}G)`;
        b.onclick = () => handlers.onProduce(kind);
        produceBox.append(b);
        produceButtons.set(kind, b);
      }
      const hr = document.createElement('div');
      hr.className = 'unit-row';
      hr.textContent = '― ユニット性能 ―';
      produceBox.append(hr);
      for (const def of Object.values(g.defs)) {
        const d = document.createElement('div');
        d.className = 'unit-row';
        const wText = def.weapons.map((w) => `${w.name}(威力${w.power}/射程${w.minRange}〜${w.range}/弾${w.ammo < 0 ? '∞' : w.ammo})`).join(' ');
        d.textContent =
          `${def.name}(${def.domain === 'air' ? '航空' : '地上'}) HP${def.hp} 移${def.move} 防${def.defense}${wText ? ` ${wText}` : ' 武装なし'}` +
          (def.canCapture ? ' / 占領可' : '') + (def.isSupply ? ' / 補給' : '');
        produceBox.append(d);
      }
    },
    update(g) {
      lastGame = g;
      turnLabel.textContent = `ターン ${g.turn}`;
      goldLabel.textContent = `資金 ${g.gold.p}(次ターン +${income(g, 'p')})`;
      message.textContent = g.message;
      const t = g.selectedHex;
      const producible = !!t && producibleHexKeys(g, 'p').has(key(t));
      produceTarget.textContent = !t
        ? 'ヘックスを選択すると、生産できる場合はここから生産できます。'
        : producible
          ? `生産先: col ${t.col} / row ${t.row}(生産可能)`
          : `選択中: col ${t.col} / row ${t.row}(ここでは生産できません)`;
      for (const [kind, b] of produceButtons) {
        b.disabled = !(t && canProduce(g, 'p', kind, t));
      }
      endTurn.disabled = g.busy || g.over;
      // 部隊表(上ペイン)
      unitTable.replaceChildren();
      const mineAll = g.units.filter((u) => u.side === 'p' && u.hp > 0);
      const mine = unactedOnly ? mineAll.filter((u) => !u.acted) : mineAll;
      const foes = g.units.filter((u) => u.side === 'e' && u.hp > 0);
      const head = document.createElement('div');
      head.className = 'unit-row';
      head.textContent = `味方 ${mine.length} 部隊${unactedOnly ? '(未行動のみ)' : ''} / 敵 ${foes.length} 部隊(クリックで選択)`;
      unitTable.append(head);
      for (const u of mine) {
        const def = g.defs[u.kind];
        const tile = [...g.tiles.values()].find((t) => t.x === u.x && t.y === u.y && t.z === u.z);
        const row = document.createElement('div');
        row.className = 'unit-row-flex';
        const b = document.createElement('button');
        b.className = 'unit-pick';
        if (g.selected === u) b.classList.add('selected');
        const ammoText = def.weapons
          .filter((w) => g.settings.supply && w.ammo >= 0)
          .map((w) => `${w.name}:${u.ammo[w.name] ?? 0}`)
          .join(' ');
        b.textContent = `${def.name} HP${u.hp}/${def.hp} 燃料${u.fuel}/${def.fuel}${ammoText ? ` ${ammoText}` : ''} @${tile ? `${tile.col},${tile.row}` : '?'} ${u.carriedBy ? '(搭乗中)' : u.acted ? '行動済' : '未行動'}`;
        b.onclick = () => handlers.onSelectUnit(u.carriedBy ?? u);
        row.append(b);
        if (!u.carriedBy) {
          const flag = document.createElement('button');
          flag.className = 'flag-btn';
          const isCommander = (g.delegations ?? []).some((d) => g.units[d.unit] === u);
          if (isCommander) flag.classList.add('active');
          flag.textContent = '⚑';
          flag.title = isCommander ? '師団長(クリックで解除)' : '師団長にする';
          flag.onclick = () => handlers.onToggleCommander(u);
          row.append(flag);
        }
        unitTable.append(row);
      }
      // 師団パネル(上ペイン): 師団長・目標・委任実行
      const divisionsBox = el('divisions');
      divisionsBox.replaceChildren();
      // 師団長の声: 師団長を指定する流れでここから選べる(委任の読み上げと立ち絵に使われる)
      {
        const row = document.createElement('div');
        row.className = 'div-row';
        const label = document.createElement('span');
        label.textContent = '師団長の声: ';
        row.append(label);
        const voiceSel = document.createElement('select');
        for (const sp of speakerOptions) {
          const o = document.createElement('option');
          o.value = String(sp.styleId);
          o.textContent = sp.name;
          voiceSel.append(o);
        }
        voiceSel.value = String(g.allySpeaker ?? g.settings.voiceSpeakerAlly);
        voiceSel.onchange = () => handlers.onSetAllySpeaker(Number(voiceSel.value));
        row.append(voiceSel);
        divisionsBox.append(row);
      }
      const delegations = g.delegations ?? [];
      if (delegations.length === 0) {
        const p = document.createElement('div');
        p.className = 'unit-row';
        p.textContent = '師団は未編成です。部隊表の ⚑ で師団長を指定してください。';
        divisionsBox.append(p);
      }
      delegations.forEach((d, di) => {
        const row = document.createElement('div');
        row.className = 'div-row';
        const cmd = d.unit >= 0 ? g.units[d.unit] : undefined;
        const head = document.createElement('div');
        head.textContent = !cmd
          ? `師団${di + 1}: 師団長が全滅しました。部隊表の ⚑ で別のユニットを指定してください`
          : `師団${di + 1}: 師団長 ${g.defs[cmd.kind].name}${cmd.acted ? '(行動済み・今ターンは委任不可)' : ''}`;
        row.append(head);
        const sel = document.createElement('select');
        for (const t of g.towns) {
          const tile = g.tilesById.get(t.hexId);
          if (!tile) continue;
          const o = document.createElement('option');
          o.value = key(tile);
          o.textContent = `目標: ${t.name}${t.owner === 'p' ? '(自軍)' : t.owner === 'e' ? '(敵)' : ''}`;
          sel.append(o);
        }
        for (const a of g.airports) {
          const tile = g.tilesById.get(a.hexId);
          if (!tile) continue;
          const o = document.createElement('option');
          o.value = key(tile);
          o.textContent = `目標: ${a.name}(空港)`;
          sel.append(o);
        }
        sel.value = d.objectiveKey;
        sel.onchange = () => handlers.onSetObjective(di, sel.value);
        row.append(sel);
        const run = document.createElement('button');
        run.textContent = '委任実行';
        run.disabled = g.busy || g.over || !cmd || cmd.acted;
        run.onclick = () => handlers.onRunDelegation(di);
        row.append(run);
        const rel = document.createElement('button');
        rel.textContent = '解散';
        rel.onclick = () => handlers.onReleaseDelegation(di);
        row.append(rel);
        divisionsBox.append(row);
      });
      // 状況表(上ペイン・部隊表の横): 陣営ごとの占領都市数・人口・ユニット数(種別ごと)
      const situation = el('situation');
      const sideRow = (side: 'p' | 'e', label: string): string => {
        const towns = g.towns.filter((t) => t.owner === side);
        const pop = towns.reduce((sum, t) => sum + t.population, 0);
        const airports = g.airports.filter((a) => a.owner === side).length;
        const units = g.units.filter((u) => u.side === side && u.hp > 0);
        const byKind = new Map<string, number>();
        for (const u of units) byKind.set(u.kind, (byKind.get(u.kind) ?? 0) + 1);
        const kinds = [...byKind.entries()].map(([k, n]) => `${g.defs[k].name}×${n}`).join('、') || 'なし';
        return `<tr><th>${label}</th><td>都市 ${towns.length} / 人口 ${pop.toLocaleString('ja-JP')} / 空港 ${airports}<br>ユニット ${units.length}: ${kinds}</td></tr>`;
      };
      situation.innerHTML = `<table>${sideRow('p', '味方')}${sideRow('e', '敵')}</table>`;
    },
    showError(text) {
      message.textContent = text;
      el('pane-bottom').classList.add('open');
    },
    showContext(x, y, infoHtml, actions) {
      ctx.replaceChildren();
      const infoDiv = document.createElement('div');
      infoDiv.className = 'ctx-info';
      infoDiv.innerHTML = infoHtml;
      ctx.append(infoDiv);
      for (const a of actions) {
        const b = document.createElement('button');
        b.textContent = a.label;
        b.disabled = !!a.disabled;
        b.onclick = () => {
          hideContext();
          a.run();
        };
        ctx.append(b);
      }
      ctx.hidden = false;
      const w = ctx.offsetWidth;
      const h = ctx.offsetHeight;
      ctx.style.left = `${Math.max(4, Math.min(x, window.innerWidth - w - 8))}px`;
      ctx.style.top = `${Math.max(4, Math.min(y, window.innerHeight - h - 8))}px`;
    },
    hideContext,
    showBattlePopup(html) {
      const popup = el('battle-popup');
      popup.innerHTML = html;
      popup.hidden = false;
      popup.classList.remove('show');
      void popup.offsetWidth; // アニメーションを最初から再生する
      popup.classList.add('show');
    },
    showInfo(html) {
      info.innerHTML = html;
    },
    appendLog(line) {
      const div = document.createElement('div');
      div.textContent = line;
      aiLog.append(div);
      // 常に最新の行が見えるよう末尾へスクロールする
      aiLog.scrollTop = aiLog.scrollHeight;
      aiLog.scrollTop = aiLog.scrollHeight;
    },
    clearLog() {
      aiLog.replaceChildren();
    },
    setThinking(on) {
      btnStop.hidden = !on;
    },
    setSpectating(on) {
      btnSpectate.hidden = on;
      btnSpectateStop.hidden = !on;
    },
    toggleIncome(html) {
      const box = el('income-box');
      if (!box.hidden) { box.hidden = true; return false; }
      box.innerHTML = html;
      box.hidden = false;
      return true;
    },
    openPane,
    drawMinimap(g, viewport, world) {
      // fill を除いた実ヘックスの範囲だけを全体図にする
      let minCol = Infinity, minRow = Infinity, maxCol = -Infinity, maxRow = -Infinity;
      for (const t of g.tiles.values()) {
        if (t.terrain === 'fill') continue;
        minCol = Math.min(minCol, t.col); maxCol = Math.max(maxCol, t.col);
        minRow = Math.min(minRow, t.row); maxRow = Math.max(maxRow, t.row);
      }
      if (!Number.isFinite(minCol)) return;
      const cols = maxCol - minCol + 1;
      const rows = maxRow - minRow + 1;
      const W = 440;
      const H = Math.max(80, Math.round((W * rows) / cols));
      if (minimap.width !== W || minimap.height !== H) {
        minimap.width = W;
        minimap.height = H;
      }
      const c = minimap.getContext('2d');
      if (!c) return;
      const theme = getTheme(g.settings.theme);
      const cw = W / cols;
      const ch = H / rows;
      c.fillStyle = theme.palette.bg;
      c.fillRect(0, 0, W, H);
      for (const t of g.tiles.values()) {
        if (t.terrain === 'fill') continue;
        c.fillStyle = theme.palette[t.terrain];
        c.fillRect((t.col - minCol) * cw, (t.row - minRow) * ch, Math.ceil(cw), Math.ceil(ch));
      }
      for (const airport of g.airports) {
        c.fillStyle = airport.owner === 'p' ? '#3f8fe0' : airport.owner === 'e' ? '#e0483f' : '#bfe9ff';
        c.fillRect((airport.col - minCol) * cw - 1, (airport.row - minRow) * ch - 1, Math.max(3, cw + 2), Math.max(3, ch + 2));
      }
      for (const town of g.towns) {
        c.fillStyle = town.owner === 'p' ? '#3f8fe0' : town.owner === 'e' ? '#e0483f' : '#e8e8e8';
        c.beginPath();
        c.arc((town.col - minCol + 0.5) * cw, (town.row - minRow + 0.5) * ch, town.capital ? 3.4 : 2.2, 0, Math.PI * 2);
        c.fill();
      }
      for (const u of g.units) {
        if (u.hp <= 0) continue;
        const tile = [...g.tiles.values()].find((t) => t.x === u.x && t.y === u.y && t.z === u.z);
        if (!tile || tile.terrain === 'fill') continue;
        c.fillStyle = u.side === 'p' ? '#1f6fb5' : '#c2392f';
        c.fillRect((tile.col - minCol) * cw + 0.5, (tile.row - minRow) * ch + 0.5, Math.max(2.4, cw - 1), Math.max(2.4, ch - 1));
      }
      if (viewport && world.w > 0 && world.h > 0) {
        c.strokeStyle = '#ff2222';
        c.lineWidth = 2;
        c.strokeRect(
          ((viewport.x - world.x) / world.w) * W,
          ((viewport.y - world.y) / world.h) * H,
          (viewport.w / world.w) * W,
          (viewport.h / world.h) * H,
        );
      }
    },
  };
  return hudRef;
}
