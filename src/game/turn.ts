import { settleCaptures } from './rules';
import { income, resupplyOnOwnedTowns } from './state';
import type { Game } from './types';

/** CPUのターンを始める。収入・行動リセット・補給までで、生産と行動は planner が行う */
export function beginCpuTurn(g: Game): void {
  if (g.turn > 1) g.gold.e += income(g, 'e');
  for (const u of g.units) if (u.side === 'e') u.moved = u.acted = false;
  resupplyOnOwnedTowns(g, 'e');
}

/** 敵のターンを終え、プレイヤーのターンを始める */
export function finishEnemyTurn(g: Game): void {
  // 行動を終えた敵歩兵の占領を確定し、敵ユニットは行動済み表示(静止)にする
  settleCaptures(g, 'e');
  for (const u of g.units) if (u.side === 'e') { u.moved = true; u.acted = true; }
  g.turn++;
  g.gold.p += income(g, 'p');
  for (const u of g.units) if (u.side === 'p') u.moved = u.acted = false;
  resupplyOnOwnedTowns(g, 'p');
  g.busy = false;
  if (!g.over) g.message = 'あなたのターンです。';
}
