import { enemyRecruit } from './ai';
import { income, liveUnits } from './state';
import type { Game, Unit } from './types';

/** 敵のターンを始める。収入を得て、駒を雇い、このターンに動く駒の一覧を返す(2ターン目から収入あり) */
export function beginEnemyTurn(g: Game): Unit[] {
  if (g.turn > 1) g.gold.e += income(g, 'e');
  for (const u of g.units) if (u.side === 'e') u.moved = u.acted = false;
  const actors = liveUnits(g, 'e');
  enemyRecruit(g);
  return actors;
}

/** 敵のターンを終え、プレイヤーのターンを始める */
export function finishEnemyTurn(g: Game): void {
  g.turn++;
  g.gold.p += income(g, 'p');
  for (const u of g.units) if (u.side === 'p') u.moved = u.acted = false;
  g.busy = false;
  if (!g.over) g.message = 'あなたのターンです。';
}
