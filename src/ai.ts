import { distance, equals } from './hex';
import { attack, canProduce, inRange, moveUnit, produce, reachable, tryCapture } from './rules';
import { capitalOf, liveUnits, producibleHexKeys } from './state';
import { TERRAINS } from './terrain';
import type { Cube, Game, Tile, Unit } from './types';

/**
 * 敵CPUの思考(現行の簡易版・メインスレッド実行)。
 * 将来は src/ai/ の Worker Pool(Comlink + Web Workers)に移す。
 */

/** 敵の生産: 生産可能ヘックスが空いていて資金があれば、買える駒の中からランダムに1体生産する */
export function enemyProduce(g: Game): void {
  const keys = producibleHexKeys(g, 'e');
  if (keys.size === 0) return;
  const options = Object.keys(g.defs).filter((k) => g.defs[k].cost <= g.gold.e);
  if (options.length === 0) return;
  // 最大で数回試して、生産できる組み合わせがあれば1体だけ生産する
  for (let i = 0; i < 12; i++) {
    const kind = options[Math.floor(Math.random() * options.length)];
    const keyArr = [...keys];
    const t = g.tiles.get(keyArr[Math.floor(Math.random() * keyArr.length)]);
    if (t && canProduce(g, 'e', kind, t)) {
      produce(g, 'e', kind, t);
      return;
    }
  }
}

/** 旧名の互換(turn.ts は enemyProduce を使う) */
export const enemyRecruit = enemyProduce;

/** 敵の駒1体の行動: 最も近い味方に向かって移動し、攻撃できれば最も弱い相手を攻撃する */
export function enemyAct(g: Game, u: Unit): void {
  const def = g.defs[u.kind];
  const foes = liveUnits(g, 'p');
  const pCap = capitalOf(g, 'p');
  const target: Cube | null =
    [...foes].sort((a, b) => distance(u, a) - distance(u, b))[0] ?? pCap;
  if (!target) return;

  let best: Tile | null = null;
  let bestScore = -Infinity;
  for (const k of reachable(g, u).keys()) {
    const t = g.tiles.get(k);
    if (!t) continue;
    let score = -distance(t, target) * 2;
    // 地形防御は地上ユニットのみ評価する
    if (def.domain === 'ground') score += TERRAINS[t.terrain].defense;
    if (t.city && t.city.owner !== 'e') score += 4;
    // 占領できるのは歩兵だけなので、towns への移動ボーナスは歩兵のみ
    const town = g.towns.find((tw) => tw.hexId === t.id);
    if (def.canCapture && town && town.owner !== 'e') score += 5;
    if (foes.some((f) => { const d = distance(t, f); return d >= def.minRange && d <= def.range; })) score += 5;
    if (def.minRange > 1 && foes.some((f) => distance(t, f) === 1)) score -= 4;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  if (best && !equals(best, u)) moveUnit(g, u, best);
  if (g.over) return;

  const targets = foes.filter((f) => f.hp > 0 && inRange(g, u, f)).sort((a, b) => a.hp - b.hp);
  if (targets.length > 0) {
    attack(g, u, targets[0]);
  } else {
    // 攻撃せずに行動を終える場合も、その場の town を占領する
    const label = tryCapture(g, u);
    if (label) g.message = `敵が${label}を占領しました。`;
  }
}
