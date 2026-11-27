import { distance, equals, key } from '../hex';
import { attack, canProduce, hasLongRangeWeapon, inRange, moveUnit, produce, reachable, resupplyFromAdjacentSupply, tryCapture } from '../rules';
import { capitalOf, liveUnits, producibleHexKeys } from '../state';
import { TERRAINS } from '../terrain';
import type { Cube, Game, Side, Tile, Unit } from '../types';

/**
 * 敵CPUの思考(現行の簡易版・メインスレッド実行)。
 * 将来は src/ai/ の Worker Pool(Comlink + Web Workers)に移す。
 */

/** 生産: 生産可能ヘックスが空いていて資金があれば、買える駒の中からランダムに1体生産する */
export function enemyProduce(g: Game, side: Side = 'e'): void {
  const keys = producibleHexKeys(g, side);
  if (keys.size === 0) return;
  const options = Object.keys(g.defs).filter((k) => g.defs[k].cost <= g.gold[side]);
  if (options.length === 0) return;
  // 最大で数回試して、生産できる組み合わせがあれば1体だけ生産する
  for (let i = 0; i < 12; i++) {
    const kind = options[Math.floor(Math.random() * options.length)];
    const keyArr = [...keys];
    const t = g.tiles.get(keyArr[Math.floor(Math.random() * keyArr.length)]);
    if (t && canProduce(g, side, kind, t)) {
      produce(g, side, kind, t);
      return;
    }
  }
}

/** 旧名の互換(turn.ts は enemyProduce を使う) */
export const enemyRecruit = enemyProduce;

/** 駒1体の行動: 最も近い敵に向かって移動し、攻撃できれば最も弱い相手を攻撃する(どちらの陣営でも動く) */
export function enemyAct(g: Game, u: Unit): void {
  const foe: Side = u.side === 'p' ? 'e' : 'p';
  resupplyFromAdjacentSupply(g, u); // 移動前: 補給ユニット隣接で残弾・燃料回復
  // 射程2以上のユニットは移動前しか攻撃できないので、撃てる相手がいるなら移動せず攻撃する
  if (hasLongRangeWeapon(g, u)) {
    const targets0 = liveUnits(g, foe).filter((f) => f.hp > 0 && inRange(g, u, f)).sort((a, b) => a.hp - b.hp);
    if (targets0.length > 0) {
      attack(g, u, targets0[0]);
      return;
    }
  }
  const def = g.defs[u.kind];
  const foes = liveUnits(g, foe).filter((f) => !f.carriedBy); // 搭乗中の歩兵は狙えない
  const foeCap = capitalOf(g, foe);
  const target: Cube | null =
    [...foes].sort((a, b) => distance(u, a) - distance(u, b))[0] ?? foeCap;
  if (!target) return;

  let best: Tile | null = null;
  let bestScore = -Infinity;
  const reach = reachable(g, u);
  for (const k of reach.keys()) {
    const t = g.tiles.get(k);
    if (!t) continue;
    let score = -distance(t, target) * 2;
    // 地形防御は地上ユニットのみ評価する
    if (def.domain === 'ground') score += TERRAINS[t.terrain].defense;
    if (t.city && t.city.owner !== u.side) score += 4;
    // 占領できるのは歩兵だけなので、towns への移動ボーナスは歩兵のみ
    const town = g.towns.find((tw) => tw.hexId === t.id);
    if (def.canCapture && town && town.owner !== u.side) score += 5;
    const maxRange = Math.max(1, ...def.weapons.map((w) => w.range));
    const minRange = Math.min(1, ...def.weapons.map((w) => w.minRange));
    if (foes.some((f) => { const d = distance(t, f); return d >= minRange && d <= maxRange; })) score += 5;
    if (minRange > 1 && foes.some((f) => distance(t, f) === 1)) score -= 4;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  if (best && !equals(best, u)) moveUnit(g, u, best, reach.get(key(best)) ?? 0);
  if (g.over) return;

  const targets = foes.filter((f) => f.hp > 0 && inRange(g, u, f)).sort((a, b) => a.hp - b.hp);
  if (targets.length > 0) {
    attack(g, u, targets[0]);
  } else {
    // 攻撃せずに行動を終える場合も、その場の town を占領する
    const label = tryCapture(g, u);
    if (label) g.message = `${u.side === 'p' ? 'あなた' : '敵'}が${label}を占領しました。`;
  }
}
