import { canProduce } from './rules';
import { income, liveUnits, producibleHexKeys } from './state';
import { key } from './hex';
import { getTheme } from './themes';
import { MAX_UNITS_PER_SIDE, type Game, type Unit } from './types';

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
  /** 指定したペインを開く(他は閉じる) */
  openPane(side: PaneSide): void;
  /** ミニマップ全体図を描き直す(地形・town・ユニット・表示範囲の赤枠) */
  drawMinimap(g: Game, viewport: { x: number; y: number; w: number; h: number } | null, world: { x: number; y: number; w: number; h: number }): void;
}

const el = <T extends HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} が見つかりません`);
  return e as T;
};

export function createHud(handlers: HudHandlers): Hud {
  const turnLabel = el('tn');
  const goldLabel = el('gd');
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
  const openPane = (side: PaneSide): void => {
    for (const id of Object.values(paneIds)) el(id).classList.remove('open');
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
      const willOpen = !pane.classList.contains('open');
      for (const id of Object.values(paneIds)) el(id).classList.remove('open');
      if (willOpen) pane.classList.add('open');
    });
  }

  const minimap = el<HTMLCanvasElement>('minimap');
  const unitTable = el('unit-table');
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

  return {
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
      turnLabel.textContent = `ターン ${g.turn}`;
      goldLabel.textContent = `資金 ${g.gold.p}(+${income(g, 'p')}) / 部隊 ${liveUnits(g, 'p').length}/${MAX_UNITS_PER_SIDE}`;
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
      const mine = g.units.filter((u) => u.side === 'p' && u.hp > 0);
      const foes = g.units.filter((u) => u.side === 'e' && u.hp > 0);
      const head = document.createElement('div');
      head.className = 'unit-row';
      head.textContent = `味方 ${mine.length} 部隊 / 敵 ${foes.length} 部隊(クリックで選択)`;
      unitTable.append(head);
      for (const u of mine) {
        const def = g.defs[u.kind];
        const tile = [...g.tiles.values()].find((t) => t.x === u.x && t.y === u.y && t.z === u.z);
        const b = document.createElement('button');
        b.className = 'unit-pick';
        if (g.selected === u) b.classList.add('selected');
        const ammoText = def.weapons
          .filter((w) => g.settings.supply && w.ammo >= 0)
          .map((w) => `${w.name}:${u.ammo[w.name] ?? 0}`)
          .join(' ');
        b.textContent = `${def.name} HP${u.hp}/${def.hp} 燃料${u.fuel}/${def.fuel}${ammoText ? ` ${ammoText}` : ''} @${tile ? `${tile.col},${tile.row}` : '?'} ${u.acted ? '行動済' : '未行動'}`;
        b.onclick = () => handlers.onSelectUnit(u);
        unitTable.append(b);
      }
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
    showInfo(html) {
      info.innerHTML = html;
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
}
