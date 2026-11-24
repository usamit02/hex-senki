import { canRecruit } from './rules';
import { income, liveUnits } from './state';
import { MAX_UNITS_PER_SIDE, type Game } from './types';

export interface HudHandlers {
  onRecruit(kind: string): void;
  onEndTurn(): void;
  onNewGame(): void;
  onFitView(): void;
}

export interface ContextAction {
  label: string;
  disabled?: boolean;
  run(): void;
}

export interface Hud {
  setup(g: Game): void;
  update(g: Game): void;
  showError(text: string): void;
  /** 要件3・5: 右クリックメニュー(情報HTML + コマンド) */
  showContext(x: number, y: number, infoHtml: string, actions: ContextAction[]): void;
  hideContext(): void;
  /** 左ペインにも同じ情報を出す */
  showInfo(html: string): void;
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
  const recruitBox = el('recruit');
  const endTurn = el<HTMLButtonElement>('be');
  const newGame = el<HTMLButtonElement>('bn');
  const fitView = el<HTMLButtonElement>('bf');
  const ctx = el('ctx');
  const recruitButtons = new Map<string, HTMLButtonElement>();

  endTurn.onclick = handlers.onEndTurn;
  newGame.onclick = handlers.onNewGame;
  fitView.onclick = handlers.onFitView;

  // 隠れるペインの開閉(画面端タブ)
  const panes: Array<[string, string]> = [
    ['tab-left', 'pane-left'],
    ['tab-right', 'pane-right'],
    ['tab-bottom', 'pane-bottom'],
  ];
  for (const [tabId, paneId] of panes) {
    el(tabId).addEventListener('click', () => {
      const pane = el(paneId);
      const willOpen = !pane.classList.contains('open');
      for (const [, otherId] of panes) el(otherId).classList.remove('open');
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
      recruitBox.replaceChildren();
      recruitButtons.clear();
      for (const [kind, def] of Object.entries(g.defs)) {
        const b = document.createElement('button');
        b.textContent = `${def.name}を雇う(${def.cost})`;
        b.onclick = () => handlers.onRecruit(kind);
        recruitBox.append(b);
        recruitButtons.set(kind, b);
      }
    },
    update(g) {
      turnLabel.textContent = `ターン ${g.turn}`;
      goldLabel.textContent = `資金 ${g.gold.p}(+${income(g, 'p')}) / 部隊 ${liveUnits(g, 'p').length}/${MAX_UNITS_PER_SIDE}`;
      message.textContent = g.message;
      for (const [kind, b] of recruitButtons) b.disabled = !canRecruit(g, kind);
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
      // 画面端ではみ出さないよう位置を調整
      const w = ctx.offsetWidth;
      const h = ctx.offsetHeight;
      ctx.style.left = `${Math.max(4, Math.min(x, window.innerWidth - w - 8))}px`;
      ctx.style.top = `${Math.max(4, Math.min(y, window.innerHeight - h - 8))}px`;
    },
    hideContext,
    showInfo(html) {
      info.innerHTML = html;
    },
  };
}
