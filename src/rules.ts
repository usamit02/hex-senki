import { distance, key, neighbors, pos, setPos } from './hex';
import { capitalOf, cheapestCost, liveUnits, spawn, tileAt, unitAt } from './state';
import { TERRAINS } from './terrain';
import type { Cube, Game, Side, Tile, Unit } from './types';

const sideName = (s: Side): string => (s === 'p' ? 'あなた' : '敵');

/** 駒が移動できるマスと、その移動コスト(地形ごとの移動コストを足していく。水と敵の駒のいるマスは通れない。味方の駒は通り抜けられるが、止まれない) */
export function reachable(g: Game, u: Unit): Map<string, number> {
  const def = g.defs[u.kind];
  const res = new Map<string, number>([[key(u), 0]]);
  const open: Array<{ at: Cube; cost: number }> = [{ at: pos(u), cost: 0 }];
  while (open.length) {
    open.sort((a, b) => a.cost - b.cost);
    const { at, cost } = open.shift()!;
    if (cost > (res.get(key(at)) ?? Infinity)) continue;
    for (const n of neighbors(at)) {
      const t = tileAt(g, n);
      if (!t) continue;
      const other = unitAt(g, t);
      if (other && other.side !== u.side) continue;
      const nc = cost + TERRAINS[t.terrain].moveCost;
      if (nc > def.move) continue;
      const k = key(t);
      const old = res.get(k);
      if (old === undefined || nc < old) {
        res.set(k, nc);
        open.push({ at: t, cost: nc });
      }
    }
  }
  // 味方の駒がいるマスは通り抜けられるだけで、移動先にはできない
  const start = key(u);
  for (const k of [...res.keys()]) {
    if (k === start) continue;
    const t = g.tiles.get(k);
    if (t && unitAt(g, t)) res.delete(k);
  }
  return res;
}

export function inRange(g: Game, a: Unit, d: Unit): boolean {
  const x = distance(a, d);
  const def = g.defs[a.kind];
  return x >= def.minRange && x <= def.range;
}

export function moveUnit(g: Game, u: Unit, t: Tile): void {
  u.from = { pos: pos(u), cityOwner: t.city ? t.city.owner : null };
  setPos(u, t);
  u.moved = true;
  if (t.city && t.city.owner !== u.side) {
    t.city.owner = u.side;
    g.message = `${sideName(u.side)}が${t.city.capital ? '城' : '村'}を占領しました。`;
  }
  checkGameOver(g);
}

export function undoMove(g: Game, u: Unit): void {
  const f = u.from;
  if (!f) return;
  const t = tileAt(g, u);
  if (t?.city) t.city.owner = f.cityOwner;
  setPos(u, f.pos);
  u.moved = false;
  u.from = null;
  g.message = '移動を取り消しました。';
}

export function confirmUnit(g: Game, u: Unit): void {
  u.moved = u.acted = true;
  u.from = null;
  g.message = 'この駒の行動を確定しました。';
}

export function attack(g: Game, a: Unit, d: Unit): void {
  const ta = tileAt(g, a);
  const td = tileAt(g, d);
  const A = g.defs[a.kind];
  const D = g.defs[d.kind];
  const dmg = Math.max(1, A.attack + Math.floor(Math.random() * 3) - (td ? TERRAINS[td.terrain].defense : 0));
  d.hp -= dmg;
  let m = `${a.side === 'p' ? 'あなたの' : '敵の'}${A.name}が${dmg}ダメージを与えた。`;
  if (d.hp <= 0) {
    m += `${D.name}を倒した!`;
  } else {
    const x = distance(a, d);
    if (x >= D.minRange && x <= D.range) {
      const counter = Math.max(1, D.attack - 2 - (ta ? TERRAINS[ta.terrain].defense : 0));
      a.hp -= counter;
      m += ` 反撃で${counter}ダメージ。`;
      if (a.hp <= 0) m += `${A.name}が倒れた。`;
    }
  }
  a.moved = a.acted = true;
  a.from = null;
  g.message = m;
  checkGameOver(g);
}

export function checkGameOver(g: Game): void {
  if (g.over) return;
  const broke = (s: Side): boolean => liveUnits(g, s).length === 0 && g.gold[s] < cheapestCost(g);
  if (capitalOf(g, 'p').city?.owner === 'e' || broke('p')) {
    g.over = true;
    g.message = '敗北…。「新規ゲーム」で再挑戦できます。';
  } else if (capitalOf(g, 'e').city?.owner === 'p' || broke('e')) {
    g.over = true;
    g.message = '勝利!「新規ゲーム」でもう一度遊べます。';
  }
}

export function canRecruit(g: Game, kind: string): boolean {
  const def = g.defs[kind];
  if (!def || g.busy || g.over) return false;
  const c = capitalOf(g, 'p');
  return c.city?.owner === 'p' && !unitAt(g, c) && g.gold.p >= def.cost;
}

export function recruit(g: Game, kind: string): boolean {
  if (!canRecruit(g, kind)) return false;
  g.gold.p -= g.defs[kind].cost;
  spawn(g, 'p', kind, capitalOf(g, 'p'));
  g.message = `${g.defs[kind].name}を雇いました。`;
  return true;
}
