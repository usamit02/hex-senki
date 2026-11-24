import { canProduce } from './rules';
import { income, liveUnits, producibleHexKeys } from './state';
import { key } from './hex';
import { MAX_UNITS_PER_SIDE, type Game } from './types';

export interface HudHandlers {
  onProduce(kind: string): void;
  onEndTurn(): void;
  onNewGame(): void;
  onFitView(): void;
}

export interface ContextAction {
  label: string;
  disabled?: boolean;
  run(): void;
}

export type PaneSide = 'left' | 'right' | 'bottom';

export interface Hud {
  setup(g: Game): void;
  update(g: Game): void;
  showError(text: string): void;
  showContext(x: number, y: number, infoHtml: string, actions: ContextAction[]): void;
  hideContext(): void;
  showInfo(html: string): void;
  /** 指定したペインを開く(他は閉じる) */
  openPane(side: PaneSide): void;
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
  fitView.onclick = handlers.onFitView;

  const paneIds: Record<PaneSide, string> = { left: 'pane-left', right: 'pane-right', bottom: 'pane-bottom' };
  const openPane = (side: PaneSide): void => {
    for (const id of Object.values(paneIds)) el(id).classList.remove('open');
    el(paneIds[side]).classList.add('open');
  };
  const tabs: Array<[string, PaneSide]> = [
    ['tab-left', 'left'],
    ['tab-right', 'right'],
    ['tab-bottom', 'bottom'],
  ];
  for (const [tabId, side] of tabs) {
    el(tabId).addEventListener('click', () => {
      const pane = el(paneIds[side]);
      const willOpen = !pane.classList.contains('open');
      for (const id of Object.values(paneIds)) el(id).classList.remove('open');
      if (willOpen) pane.classList.add('open');
    });
  }

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
        d.textContent =
          `${def.name}(${def.domain === 'air' ? '航空' : '地上'}) HP${def.hp} 移${def.move} 攻${def.attack} 防${def.defense} 射${def.minRange}〜${def.range}` +
          (def.canCapture ? ' / 占領可' : '');
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
  };
}
