import { canRecruit } from './rules';
import { income } from './state';
import type { Game } from './types';

export interface HudHandlers {
  onRecruit(kind: string): void;
  onEndTurn(): void;
  onNewGame(): void;
}

export interface Hud {
  /** ゲームの開始時に、駒の種類ごとの「雇う」ボタンを作り直す */
  setup(g: Game): void;
  update(g: Game): void;
  showError(text: string): void;
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
  const recruitBox = el('recruit');
  const endTurn = el<HTMLButtonElement>('be');
  const newGame = el<HTMLButtonElement>('bn');
  const recruitButtons = new Map<string, HTMLButtonElement>();

  endTurn.onclick = handlers.onEndTurn;
  newGame.onclick = handlers.onNewGame;

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
      goldLabel.textContent = `資金 ${g.gold.p}(+${income(g, 'p')})`;
      message.textContent = g.message;
      for (const [kind, b] of recruitButtons) b.disabled = !canRecruit(g, kind);
      endTurn.disabled = g.busy || g.over;
    },
    showError(text) {
      message.textContent = text;
    },
  };
}
