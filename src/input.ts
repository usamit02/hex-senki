import { key } from './hex';
import type { Renderer } from './render';
import { attack, confirmUnit, inRange, moveUnit, reachable, undoMove } from './rules';
import { tileAt, unitAt } from './state';
import type { Game } from './types';

export interface InputDeps {
  canvas: HTMLCanvasElement;
  renderer: Renderer;
  getGame(): Game;
  refresh(): void;
}

export function bindBoardInput({ canvas, renderer, getGame, refresh }: InputDeps): void {
  // 左クリック(タッチ)の操作
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
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
    const sel = g.selected;
    if (sel) {
      // 選択中の駒をもう一度クリックすると、その駒の行動を確定する(移動していなければ待機)
      if (u === sel && !sel.acted) {
        confirmUnit(g, sel);
        g.selected = null;
        g.reach = null;
        refresh();
        return;
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
      g.message = `${g.defs[u.kind].name}を選択。移動先か攻撃対象をタップ。もう一度タップすると行動を確定。`;
    } else {
      g.selected = null;
      g.reach = null;
    }
    refresh();
  });

  // 右クリック: 選択中の駒の移動を取り消す(攻撃や確定の前だけ)
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const g = getGame();
    if (g.over || g.busy) return;
    const s = g.selected;
    if (s && s.moved && !s.acted && s.from) {
      undoMove(g, s);
      g.reach = reachable(g, s);
      refresh();
    }
  });
}
