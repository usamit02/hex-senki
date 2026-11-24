import { enemyProduce } from './ai';
import { settleCaptures } from './rules';
import { income, liveUnits } from './state';
import type { Game, Unit } from './types';

/** 敵のターンを始める。収入を得て、生産し、このターンに動く駒の一覧を返す(2ターン目から収入あり) */
export function beginEnemyTurn(g: Game): Unit[] {
  if (g.turn > 1) g.gold.e += income(g, 'e');
  for (const u of g.units) if (u.side === 'e') u.moved = u.acted = false;
  const actors = liveUnits(g, 'e');
  enemyProduce(g);
  return actors;
}

/** 敵のターンを終え、プレイヤーのターンを始める */
export function finishEnemyTurn(g: Game): void {
  // 行動を終えた敵歩兵の占領を確定し、敵ユニットは行動済み表示(静止)にする
  settleCaptures(g, 'e');
  for (const u of g.units) if (u.side === 'e') { u.moved = true; u.acted = true; }
  g.turn++;
  g.gold.p += income(g, 'p');
  for (const u of g.units) if (u.side === 'p') u.moved = u.acted = false;
  g.busy = false;
  if (!g.over) g.message = 'あなたのターンです。';
}
