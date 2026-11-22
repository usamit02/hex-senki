import { distance, equals } from './hex';
import { attack, inRange, moveUnit, reachable } from './rules';
import { capitalOf, liveUnits, spawn, unitAt } from './state';
import { TERRAINS } from './terrain';
import type { Cube, Game, Tile, Unit } from './types';

/** 敵の首都が空いていて資金があれば、買える駒の中からランダムに1体雇う */
export function enemyRecruit(g: Game): void {
  const c = capitalOf(g, 'e');
  if (c.city?.owner !== 'e' || unitAt(g, c)) return;
  const options = Object.keys(g.defs).filter((k) => g.defs[k].cost <= g.gold.e);
  if (options.length === 0) return;
  const kind = options[Math.floor(Math.random() * options.length)];
  g.gold.e -= g.defs[kind].cost;
  spawn(g, 'e', kind, c);
}

/** 敵の駒1体の行動: 最も近い味方に向かって移動し、攻撃できれば最も弱い相手を攻撃する */
export function enemyAct(g: Game, u: Unit): void {
  const def = g.defs[u.kind];
  const foes = liveUnits(g, 'p');
  const target: Cube =
    [...foes].sort((a, b) => distance(u, a) - distance(u, b))[0] ?? capitalOf(g, 'p');

  let best: Tile | null = null;
  let bestScore = -Infinity;
  for (const k of reachable(g, u).keys()) {
    const t = g.tiles.get(k);
    if (!t) continue;
    let score = -distance(t, target) * 2;
    score += TERRAINS[t.terrain].defense;
    if (t.city && t.city.owner !== 'e') score += 4;
    if (foes.some((f) => { const d = distance(t, f); return d >= def.minRange && d <= def.range; })) score += 5;
    // 隣接されると撃てない駒(最小射程が2以上)は、隣接を避ける
    if (def.minRange > 1 && foes.some((f) => distance(t, f) === 1)) score -= 4;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  if (best && !equals(best, u)) moveUnit(g, u, best);
  if (g.over) return;

  const targets = foes.filter((f) => f.hp > 0 && inRange(g, u, f)).sort((a, b) => a.hp - b.hp);
  if (targets.length > 0) attack(g, u, targets[0]);
}
