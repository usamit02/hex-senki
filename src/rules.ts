import { distance, equals, key, neighbors, pos, setPos } from './hex';
import { capitalOf, cheapestCost, liveUnits, producibleHexKeys, refillAmmo, spawn, tileAt, townAt, unitAt } from './state';
import { TERRAINS, moveCostFor } from './terrain';
import type { Cube, Game, Side, Tile, Unit, WeaponDef } from './types';

const sideName = (s: Side): string => (s === 'p' ? 'あなた' : '敵');

/** 河川の移動コスト(移動できない) */
export const RIVER_MOVE_COST = 255;

/**
 * 移動コスト。
 * - fill は誰も通行できない
 * - 航空は地形・道路・河川を無視して常に1
 * - 地上: 道路と河川の両方があるヘックスは橋で1、道路のみは1、河川のみは255(通行不可)、それ以外は地形コスト
 */
export function moveCostOf(g: Game, u: Unit, t: Tile): number {
  if (t.terrain === 'fill') return Infinity;
  if (g.defs[u.kind].domain === 'air') return 1;
  if (t.facility) return 1; // towns・空港のヘックスは河川や水であってもコスト1
  if (t.hasRoad) return 1; // 道路のみ=1、道路+河川=橋で1
  if (t.hasRiver) return RIVER_MOVE_COST;
  return moveCostFor(g.defs[u.kind], t.terrain);
}

/** 防御側の実効防御: 本体の防御力 + (地上ユニットのみ)地形の防御ボーナス。航空は地形ボーナスなし */
export function effectiveDefense(g: Game, defender: Unit, at: Tile): number {
  const def = g.defs[defender.kind];
  const terrainBonus = def.domain === 'ground' ? TERRAINS[at.terrain].defense : 0;
  return def.defense + terrainBonus;
}

/** 武装ごとの相性倍率 */
export function weaponVs(w: WeaponDef, defenderCategory: string): number {
  return w.vs?.[defenderCategory] ?? 1;
}

/** その距離で使える武装のうち、最も有効なもの(残弾切れは使えない)。無ければ null */
export function pickWeapon(g: Game, attacker: Unit, defender: Unit): WeaponDef | null {
  const dist = distance(attacker, defender);
  const dCat = g.defs[defender.kind].category;
  let best: WeaponDef | null = null;
  let bestScore = -1;
  for (const w of g.defs[attacker.kind].weapons) {
    if (dist < w.minRange || dist > w.range) continue;
    if (g.settings.supply && w.ammo >= 0 && (attacker.ammo[w.name] ?? 0) <= 0) continue;
    const score = w.power * weaponVs(w, dCat);
    if (score > bestScore) { bestScore = score; best = w; }
  }
  return best;
}

/** 射程2以上の武装を持つユニットか(自走砲など) */
export function hasLongRangeWeapon(g: Game, u: Unit): boolean {
  return g.defs[u.kind].weapons.some((w) => w.range >= 2);
}

/** その相手を攻撃できる武装があるか。射程2以上のユニットは移動前しか攻撃できない */
export function canAttackTarget(g: Game, a: Unit, d: Unit): boolean {
  if (a.moved && hasLongRangeWeapon(g, a)) return false;
  return pickWeapon(g, a, d) !== null;
}

/** ダメージ計算: 武装の攻撃力×相性 - 実効防御、最低1。反撃は追加で-2。乱数は使わない(結果は固定) */
export function calcDamage(g: Game, defender: Unit, weapon: WeaponDef, counter = false): number {
  const defTile = tileAt(g, defender);
  const effDef = defTile ? effectiveDefense(g, defender, defTile) : g.defs[defender.kind].defense;
  const base = weapon.power * weaponVs(weapon, g.defs[defender.kind].category);
  // 戦闘結果は乱数なしで固定する(パラメータと地形だけで決まる。CPU AI の高速化のため)
  const raw = Math.round(base) - effDef - (counter ? 2 : 0);
  return Math.max(1, raw);
}

/** ZOC: そのヘックスが敵ユニットに隣接しているか(航空ユニットは地上のZOCを無視する扱い) */
export function inEnemyZoc(g: Game, u: Unit, at: Cube): boolean {
  if (!g.settings.zoc) return false;
  if (g.defs[u.kind].domain === 'air') return false;
  for (const n of neighbors(at)) {
    const t = tileAt(g, n);
    if (!t) continue;
    const e = unitAt(g, t);
    if (e && e.side !== u.side && e.hp > 0) return true;
  }
  return false;
}

/** 補給ユニットに隣接していれば残弾を全回復する。回復したら true */
export function resupplyFromAdjacentSupply(g: Game, u: Unit): boolean {
  if (!g.settings.supply) return false;
  // 戦闘機は補給ユニットからも補給できない(空港でのみ補充・補給できる)
  if (g.defs[u.kind].fighter) return false;
  for (const n of neighbors(u)) {
    const t = tileAt(g, n);
    if (!t) continue;
    const other = unitAt(g, t);
    if (other && other.side === u.side && other.hp > 0 && g.defs[other.kind].isSupply) {
      const before = JSON.stringify(u.ammo);
      refillAmmo(g, u);
      return JSON.stringify(u.ammo) !== before;
    }
  }
  return false;
}

/** 駒が移動できるマスと、その移動コスト。移動力と燃料の両方の範囲内。ZOC有効時は敵隣接ヘックスに入ったらそこで移動終了 */
export function reachable(g: Game, u: Unit): Map<string, number> {
  const def = g.defs[u.kind];
  const budget = g.settings.supply ? Math.min(def.move, u.fuel) : def.move;
  const res = new Map<string, number>([[key(u), 0]]);
  const open: Array<{ at: Cube; cost: number }> = [{ at: pos(u), cost: 0 }];
  while (open.length) {
    open.sort((a, b) => a.cost - b.cost);
    const { at, cost } = open.shift()!;
    if (cost > (res.get(key(at)) ?? Infinity)) continue;
    if (!equals(at, u) && inEnemyZoc(g, u, at)) continue; // ZOCヘックスからは先へ進めない
    for (const n of neighbors(at)) {
      const t = tileAt(g, n);
      if (!t) continue;
      const other = unitAt(g, t);
      if (other && other.side !== u.side) continue;
      const nc = cost + moveCostOf(g, u, t);
      if (nc > budget) continue;
      const k = key(t);
      const old = res.get(k);
      if (old === undefined || nc < old) {
        res.set(k, nc);
        open.push({ at: t, cost: nc });
      }
    }
  }
  const start = key(u);
  for (const k of [...res.keys()]) {
    if (k === start) continue;
    const t = g.tiles.get(k);
    if (t && unitAt(g, t)) res.delete(k);
  }
  return res;
}

export function inRange(g: Game, a: Unit, d: Unit): boolean {
  return canAttackTarget(g, a, d);
}

/** 輸送ユニットに搭乗中の歩兵(いなければ null) */
export function cargoOf(g: Game, carrier: Unit): Unit | null {
  return g.units.find((u) => u.carriedBy === carrier && u.hp > 0) ?? null;
}

/** 歩兵が輸送ユニットに搭乗できるか(輸送側の行動前後は問わない) */
export function canBoard(g: Game, inf: Unit, carrier: Unit): boolean {
  if (inf.hp <= 0 || inf.carriedBy || inf.acted) return false;
  if (!g.defs[inf.kind].canCapture) return false; // 搭乗できるのは歩兵のみ
  if (carrier.hp <= 0 || carrier.side !== inf.side) return false;
  if (!g.defs[carrier.kind].transport) return false;
  if (cargoOf(g, carrier)) return false; // 定員1
  return true;
}

/** 搭乗する。歩兵は盤面から消え、輸送ユニットは行動済みになる */
export function boardUnit(g: Game, inf: Unit, carrier: Unit, cost = 0): void {
  if (g.settings.supply) inf.fuel = Math.max(0, inf.fuel - cost);
  setPos(inf, carrier);
  inf.carriedBy = carrier;
  inf.moved = true;
  inf.acted = true;
  inf.from = null;
  carrier.acted = true; // 搭乗したら輸送側は行動済み
  g.message = `${g.defs[inf.kind].name}が${g.defs[carrier.kind].name}に搭乗しました。`;
}

/** 降車する。輸送ユニット・歩兵とも行動済みになる */
export function disembarkUnit(g: Game, carrier: Unit, t: Tile): boolean {
  const cargo = cargoOf(g, carrier);
  if (!cargo) return false;
  if (unitAt(g, t)) return false;
  cargo.carriedBy = null;
  setPos(cargo, t);
  cargo.moved = true;
  cargo.acted = true;
  cargo.from = null;
  carrier.acted = true; // 降車したら輸送側も行動済み
  g.message = `${g.defs[cargo.kind].name}が${g.defs[carrier.kind].name}から降車しました。`;
  return true;
}

export function moveUnit(g: Game, u: Unit, t: Tile, cost = 0): void {
  const town = townAt(g, t);
  u.from = {
    pos: pos(u),
    cityOwner: t.city ? t.city.owner : null,
    townHexId: town ? town.hexId : null,
    townOwner: town ? town.owner : null,
  };
  setPos(u, t);
  u.moved = true;
  // 搭乗中の歩兵も一緒に移動する
  const cargo = cargoOf(g, u);
  if (cargo) setPos(cargo, t);
  if (g.settings.supply) {
    u.fuel = Math.max(0, u.fuel - cost);
    // 航空ユニットは燃料が尽きたら墜落する
    if (u.fuel <= 0 && g.defs[u.kind].domain === 'air') {
      u.hp = 0;
      g.message = `${sideName(u.side)}の${g.defs[u.kind].name}は燃料切れで墜落した。`;
    }
  }
  // 輸送ユニットが全滅したら搭乗中の歩兵も全滅する
  if (u.hp <= 0 && cargo) cargo.hp = 0;
  g.pendingMoveSfx = g.defs[u.kind].moveSfx;
  // 移動後: 補給ユニットに隣接していれば残弾回復
  resupplyFromAdjacentSupply(g, u);
  // 占領は移動しただけでは発生しない。行動を終えた時点(確定・攻撃後・ターン終了時)に tryCapture で判定する
}

/**
 * 占領判定: 歩兵(canCapture)が未占領/敵の town 上で行動を終えたら、その town を獲得する。
 * 占領できたら表示名(例: 都市「札幌市」)を返し、できなければ null。
 * 攻撃後に全滅した場合は呼ばれない(呼び出し側で生存を確認する)。
 */
export function tryCapture(g: Game, u: Unit): string | null {
  if (u.hp <= 0 || !g.defs[u.kind].canCapture) return null;
  const t = tileAt(g, u);
  if (!t) return null;
  const airport = g.airports.find((a) => a.hexId === t.id);
  if (airport && airport.owner !== u.side) {
    airport.owner = u.side;
    g.pendingCapture = { at: { x: t.x, y: t.y, z: t.z }, side: u.side };
    checkGameOver(g);
    return `空港「${airport.name}」`;
  }
  const town = townAt(g, t);
  if (town && town.owner !== u.side) {
    town.owner = u.side;
    if (t.city) t.city.owner = u.side;
    g.pendingCapture = { at: { x: t.x, y: t.y, z: t.z }, side: u.side };
    checkGameOver(g);
    return `${town.capital ? '首都' : '都市'}「${town.name}」`;
  }
  if (!town && t.city && t.city.owner !== u.side) {
    t.city.owner = u.side;
    checkGameOver(g);
    return t.city.capital ? '城' : '村';
  }
  return null;
}

/** ターン終了時などに、その陣営の全歩兵の占領を確定させる */
export function settleCaptures(g: Game, side: Side): void {
  for (const u of liveUnits(g, side)) {
    const label = tryCapture(g, u);
    if (label) g.message = `${sideName(side)}が${label}を占領しました。`;
  }
}

export function undoMove(g: Game, u: Unit): void {
  const f = u.from;
  if (!f) return;
  const t = tileAt(g, u);
  if (t?.city) t.city.owner = f.cityOwner;
  if (f.townHexId !== null) {
    const town = g.towns.find((tw) => tw.hexId === f.townHexId);
    if (town) town.owner = f.townOwner;
  }
  setPos(u, f.pos);
  u.moved = false;
  u.from = null;
  g.message = '移動を取り消しました。';
}

export function confirmUnit(g: Game, u: Unit): void {
  u.moved = u.acted = true;
  u.from = null;
  const label = tryCapture(g, u);
  g.message = label
    ? `${sideName(u.side)}が${label}を占領しました。`
    : 'この駒の行動を確定しました。';
}

export function attack(g: Game, a: Unit, d: Unit): void {
  const A = g.defs[a.kind];
  const D = g.defs[d.kind];
  const w = pickWeapon(g, a, d);
  if (!w) return;
  if (g.settings.supply && w.ammo >= 0) a.ammo[w.name] = (a.ammo[w.name] ?? w.ammo) - 1;
  const dmg = calcDamage(g, d, w);
  d.hp -= dmg;
  let counterDmg = 0;
  let m = `${a.side === 'p' ? 'あなたの' : '敵の'}${A.name}が${w.name}で${dmg}ダメージを与えた。`;
  if (d.hp <= 0) {
    const dCargo = cargoOf(g, d);
    if (dCargo) dCargo.hp = 0;
    m += `${D.name}を倒した!`;
  } else if (g.settings.counter) {
    const cw = pickWeapon(g, d, a);
    if (cw) {
      if (g.settings.supply && cw.ammo >= 0) d.ammo[cw.name] = (d.ammo[cw.name] ?? cw.ammo) - 1;
      const counter = calcDamage(g, a, cw, true);
      counterDmg = counter;
      a.hp -= counter;
      m += ` 反撃(${cw.name})で${counter}ダメージ。`;
      if (a.hp <= 0) {
        const aCargo = cargoOf(g, a);
        if (aCargo) aCargo.hp = 0;
        m += `${A.name}が倒れた。`;
      }
    }
  }
  a.moved = a.acted = true;
  a.from = null;
  g.pendingFx = {
    a: pos(a), d: pos(d), sfx: w.sfx, id: ++g.fxSeq,
    aName: A.name, dName: D.name, weapon: w.name, damage: dmg,
    destroyed: d.hp <= 0, counterDamage: counterDmg, counterDestroyed: a.hp <= 0,
  };
  // 攻撃後に生き残っていれば、その場の town を占領する(反撃で全滅した場合は占領しない)
  if (a.hp > 0) {
    const label = tryCapture(g, a);
    if (label) m += ` ${label}を占領した。`;
  }
  g.message = m;
  checkGameOver(g);
}

export function checkGameOver(g: Game): void {
  if (g.over) return;
  const broke = (s: Side): boolean => liveUnits(g, s).length === 0 && g.gold[s] < cheapestCost(g);
  const annihilated = (s: Side): boolean => liveUnits(g, s).length === 0 && capitalOf(g, s) === null;
  const pCap = capitalOf(g, 'p');
  const eCap = capitalOf(g, 'e');
  if ((pCap && pCap.city?.owner === 'e') || broke('p') || annihilated('p')) {
    g.over = true;
    g.message = '敗北…。「新規ゲーム」で再挑戦できます。';
  } else if ((eCap && eCap.city?.owner === 'p') || broke('e') || annihilated('e')) {
    g.over = true;
    g.message = '勝利!「新規ゲーム」でもう一度遊べます。';
  }
}

/** そのヘックスにその駒を生産できるか(場所・地形・資金・上限) */
export function canProduce(g: Game, side: Side, kind: string, t: Tile): boolean {
  const def = g.defs[kind];
  if (!def || g.over) return false;
  if (!g.settings.production) return false;
  if (side === 'p' && g.busy) return false;
  if (g.gold[side] < def.cost) return false;
  if (liveUnits(g, side).length >= g.settings.maxUnits) return false;
  if (unitAt(g, t)) return false;
  if (t.terrain === 'fill') return false;
  // 生産場所のルール:
  // - 戦闘機(fighter)は空港のある自軍 town のヘックスでのみ生産できる
  // - その他の航空ユニット(ヘリ等)は通常の生産範囲に加えて空港でも生産できる
  // - 地上ユニットは空港では何も起きず、通常の生産範囲のみ
  const airport = g.airports.find((a) => a.hexId === t.id);
  // town と同一ヘックスの空港は空港として扱わない(編集アプリでも同一ヘックス不可)
  const atOwnedAirport = t.airport && !townAt(g, t) && airport?.owner === side;
  if (def.fighter) {
    if (!atOwnedAirport) return false;
  } else if (def.domain === 'air') {
    if (!producibleHexKeys(g, side).has(key(t)) && !atOwnedAirport) return false;
  } else {
    if (!producibleHexKeys(g, side).has(key(t))) return false;
  }
  // 地上ユニットは通行できない地形(水)には生産できない。航空はどこでも可
  if (def.domain === 'ground' && !Number.isFinite(TERRAINS[t.terrain].moveCost)) return false;
  return true;
}

export function produce(g: Game, side: Side, kind: string, t: Tile): boolean {
  if (!canProduce(g, side, kind, t)) return false;
  g.gold[side] -= g.defs[kind].cost;
  spawn(g, side, kind, t);
  g.message = `${sideName(side)}が${g.defs[kind].name}を生産しました。`;
  return true;
}

