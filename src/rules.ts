import { DIRS, distance, key } from './hex';
import { capitalOf, cheapestCost, liveUnits, spawn, tileAt, unitAt } from './state';
import type { Game, Side, Tile, Unit } from './types';

const sideName = (s: Side): string => (s === 'p' ? 'あなた' : '敵');

/** 駒が移動できるマスと、その移動コスト(森は2、水と他の駒のいるマスは通れない) */
export function reachable(g: Game, u: Unit): Map<string, number> {
  const def = g.defs[u.kind];
  const res = new Map<string, number>([[key(u.q, u.r), 0]]);
  const open: Array<[number, number, number]> = [[u.q, u.r, 0]];
  while (open.length) {
    open.sort((a, b) => a[2] - b[2]);
    const [q, r, c] = open.shift()!;
    if (c > (res.get(key(q, r)) ?? Infinity)) continue;
    for (const [dq, dr] of DIRS) {
      const t = tileAt(g, q + dq, r + dr);
      if (!t || t.terrain === 'water' || unitAt(g, t.q, t.r)) continue;
      const nc = c + (t.terrain === 'forest' ? 2 : 1);
      if (nc > def.move) continue;
      const k = key(t.q, t.r);
      const old = res.get(k);
      if (old === undefined || nc < old) {
        res.set(k, nc);
        open.push([t.q, t.r, nc]);
      }
    }
  }
  return res;
}

export function inRange(g: Game, a: Unit, d: Unit): boolean {
  const x = distance(a, d);
  const def = g.defs[a.kind];
  return x >= def.minRange && x <= def.range;
}

export function moveUnit(g: Game, u: Unit, t: Tile): void {
  u.from = { q: u.q, r: u.r, cityOwner: t.city ? t.city.owner : null };
  u.q = t.q;
  u.r = t.r;
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
  const t = tileAt(g, u.q, u.r);
  if (t?.city) t.city.owner = f.cityOwner;
  u.q = f.q;
  u.r = f.r;
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
  const ta = tileAt(g, a.q, a.r);
  const td = tileAt(g, d.q, d.r);
  const A = g.defs[a.kind];
  const D = g.defs[d.kind];
  const dmg = Math.max(1, A.attack + Math.floor(Math.random() * 3) - (td?.terrain === 'forest' ? 1 : 0));
  d.hp -= dmg;
  let m = `${a.side === 'p' ? 'あなたの' : '敵の'}${A.name}が${dmg}ダメージを与えた。`;
  if (d.hp <= 0) {
    m += `${D.name}を倒した!`;
  } else {
    const x = distance(a, d);
    if (x >= D.minRange && x <= D.range) {
      const counter = Math.max(1, D.attack - 2 - (ta?.terrain === 'forest' ? 1 : 0));
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
  return c.city?.owner === 'p' && !unitAt(g, c.q, c.r) && g.gold.p >= def.cost;
}

export function recruit(g: Game, kind: string): boolean {
  if (!canRecruit(g, kind)) return false;
  g.gold.p -= g.defs[kind].cost;
  spawn(g, 'p', kind, capitalOf(g, 'p'));
  g.message = `${g.defs[kind].name}を雇いました。`;
  return true;
}
