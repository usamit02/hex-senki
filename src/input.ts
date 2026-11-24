import { key } from './hex';
import { attack, confirmUnit, inRange, moveUnit, reachable, undoMove } from './rules';
import { linesAt, tileAt, townAt, unitAt } from './state';
import { TERRAINS } from './terrain';
import type { Cube, Game, Tile } from './types';

export interface InputDeps {
  getGame(): Game;
  refresh(): void;
}

/**
 * 左クリックのゲーム操作(旧 input.ts のロジックを Phaser 側から呼ぶ形に分離)。
 * 盤面のピック・ドラッグ・右クリック判定は render.ts(Phaser)が担当する。
 */
export function handleHexClick({ getGame, refresh }: InputDeps, h: Cube): void {
  const g = getGame();
  if (g.over || g.busy) return;
  const t = tileAt(g, h);
  if (!t) {
    g.selected = null;
    g.reach = null;
    refresh();
    return;
  }

  const u = unitAt(g, t);
  const sel = g.selected;
  if (sel) {
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
    if (!u && g.reach?.has(key(t)) && !sel.moved) {
      moveUnit(g, sel, t);
      g.reach = null;
      refresh();
      return;
    }
  }

  if (u && u.side === 'p' && !(u.moved && u.acted)) {
    g.selected = u;
    g.reach = u.moved ? null : reachable(g, u);
    g.message = `${g.defs[u.kind].name}を選択。移動先か攻撃対象をクリック。もう一度クリックすると行動を確定。`;
  } else {
    g.selected = null;
    g.reach = null;
  }
  refresh();
}

/** 選択中駒の移動取り消し(右クリックメニューからも呼ぶ) */
export function undoSelectedMove({ getGame, refresh }: InputDeps): boolean {
  const g = getGame();
  const s = g.selected;
  if (!s || !s.moved || s.acted || !s.from) return false;
  undoMove(g, s);
  g.reach = reachable(g, s);
  refresh();
  return true;
}

export function confirmSelected({ getGame, refresh }: InputDeps): boolean {
  const g = getGame();
  const s = g.selected;
  if (!s || s.acted) return false;
  confirmUnit(g, s);
  g.selected = null;
  g.reach = null;
  refresh();
  return true;
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** 要件5: 右クリックで表示するヘックス情報(都市・部隊・地形・道路河川) */
export function describeHex(g: Game, t: Tile): string {
  const lines: string[] = [];
  const town = townAt(g, t);
  if (town) {
    lines.push(`<strong>🏙 ${esc(town.name)}</strong>`);
    lines.push(`人口: ${town.population.toLocaleString('ja-JP')}人`);
    lines.push(`コード: ${esc(town.jiscode)} / ヘックス #${town.hexId}`);
  }
  const u = unitAt(g, t);
  if (u) {
    const def = g.defs[u.kind];
    lines.push(`<strong>${u.side === 'p' ? '味方' : '敵'}: ${esc(def.name)}</strong>`);
    lines.push(`HP ${u.hp}/${def.hp} / 移動 ${def.move} / 攻撃 ${def.attack} / 射程 ${def.minRange}〜${def.range}`);
    if (u.side === 'p') lines.push(u.acted ? '行動済み' : u.moved ? '移動済み(攻撃・確定が可能)' : '未行動');
  }
  const terrain = TERRAINS[t.terrain];
  lines.push(`地形: ${terrain.label}(移動コスト ${terrain.moveCost === Infinity ? '通行不可' : terrain.moveCost} / 防御 +${terrain.defense})`);
  lines.push(`座標: col ${t.col} / row ${t.row} / ヘックス #${t.id}`);
  if (t.city) {
    lines.push(`拠点: ${t.city.capital ? '城(首都)' : '村'} / 所有: ${t.city.owner === 'p' ? 'あなた' : t.city.owner === 'e' ? '敵' : '中立'}`);
  }
  for (const l of linesAt(g, t)) {
    lines.push(`${l.kind === 'road' ? '道路' : '河川'}: ${esc(l.name)}`);
  }
  return lines.join('<br>');
}
