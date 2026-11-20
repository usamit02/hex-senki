import { key } from './hex';
import type { Renderer } from './render';
import { attack, confirmUnit, inRange, moveUnit, reachable, undoMove } from './rules';
import { tileAt, unitAt } from './state';
import type { Game, Unit } from './types';

/** この時間(ms)以内に同じ駒を続けてクリックすると、ダブルクリックとして扱う */
const DOUBLE_CLICK_MS = 300;
/** 移動後の駒を1回クリックしてから、移動を取り消すまでの待ち時間(ダブルクリックを見分けるため) */
const UNDO_DELAY_MS = 300;

export interface InputDeps {
  canvas: HTMLCanvasElement;
  renderer: Renderer;
  getGame(): Game;
  refresh(): void;
}

export function bindBoardInput({ canvas, renderer, getGame, refresh }: InputDeps): void {
  let lastUnit: Unit | null = null;
  let lastTime = 0;
  let undoTimer: number | undefined;

  canvas.addEventListener('pointerdown', (e) => {
    const g = getGame();
    if (g.over || g.busy) return;
    const h = renderer.pick(e.clientX, e.clientY);
    const t = tileAt(g, h.q, h.r);
    if (!t) {
      g.selected = null;
      g.reach = null;
      refresh();
      return;
    }

    const u = unitAt(g, t.q, t.r);
    const now = Date.now();
    const isDouble = !!u && u === lastUnit && now - lastTime < DOUBLE_CLICK_MS;
    lastUnit = u ?? null;
    lastTime = now;

    const sel = g.selected;
    if (sel) {
      if (u === sel && !sel.acted) {
        if (isDouble) {
          window.clearTimeout(undoTimer);
          confirmUnit(g, sel);
          g.selected = null;
          g.reach = null;
          refresh();
          return;
        }
        if (sel.moved && sel.from) {
          window.clearTimeout(undoTimer);
          undoTimer = window.setTimeout(() => {
            const cur = getGame();
            const s = cur.selected;
            if (s && s.moved && !s.acted && s.from) {
              undoMove(cur, s);
              cur.reach = reachable(cur, s);
              refresh();
            }
          }, UNDO_DELAY_MS);
          return;
        }
      }
      if (u && u.side === 'e' && !sel.acted && inRange(g, sel, u)) {
        attack(g, sel, u);
        g.selected = null;
        g.reach = null;
        refresh();
        return;
      }
      if (!u && g.reach?.has(key(t.q, t.r)) && !sel.moved) {
        moveUnit(g, sel, t);
        g.reach = null;
        refresh();
        return;
      }
    }

    if (u && u.side === 'p' && !(u.moved && u.acted)) {
      g.selected = u;
      g.reach = u.moved ? null : reachable(g, u);
      g.message = `${g.defs[u.kind].name}を選択。移動先か攻撃対象をタップ。`;
    } else {
      g.selected = null;
      g.reach = null;
    }
    refresh();
  });
}
