import { distance, equals, key, neighbors } from '../../hex';
import {
  attack, boardUnit, canAttackTarget, canBoard, canProduce, cargoList, confirmUnit,
  disembarkUnit, hasLongRangeWeapon, moveCostOf, moveUnit, pickWeapon, pickWeaponAfterMove, calcDamage,
  produce, reachable,
} from '../../rules';
import {
  airportAt, capitalOf, liveUnits, producibleHexKeys, tileAt, townAt, townIncome, unitAt,
} from '../../state';
import { TERRAINS } from '../../terrain';
import type { Airport, Cube, Game, Side, Tile, Town, Unit } from '../../types';

/**
 * 新CPU AI(師団方式)。
 * - 戦略層: 占領/防御目標を決め、ユニットを位置関係で師団に振り分け、カウンター編成で不足を判断して生産する
 * - 戦術層: 順序付き行動リストを実エンジンに適用しながら1体ずつ決める(撃破で開いたマスは次のユニットの経路探索に反映される)
 * - 複数の行動順を試し、最も評価の高いプランを残す。最後に実エンジンで再検証しながら実行する
 * - 歩兵・トラックは師団と別行動の占領専門。補給車は師団に混ぜる
 * 【v28版AI】行動順の複数案(3モード)を試し、評価が最良の案を採用してから一括実行する版。
 * 逐次実行には対応しない(playTurn の stream 指定は無視される)。
 * この版の改良は v29 へ自動では反映されない。比較・検証用に独立して保持する。
 */

import type { AiAction, Personality, PlanOptions, PlanResult } from '../types';
export type { AiAction, Personality, PlanOptions, PlanResult } from '../types';


export const PERSONALITIES: Record<string, Personality> = {
  balanced: { name: 'バランス型', aggression: 1, defense: 1, supply: 1, risk: 1, repair: 1 },
  aggressive: { name: '好戦的', aggression: 1.5, defense: 0.7, supply: 0.8, risk: 1.3, repair: 0.7 },
  supply: { name: '補給重視', aggression: 0.8, defense: 1, supply: 1.6, risk: 0.8, repair: 1.6 },
  defensive: { name: '守り重視', aggression: 0.6, defense: 1.6, supply: 1.1, risk: 0.6, repair: 1.2 },
  tricky: { name: '奇策好き', aggression: 1.1, defense: 0.9, supply: 0.9, risk: 1.5, repair: 0.9 },
  careless: { name: 'そそっかしい', aggression: 1, defense: 1, supply: 0.7, risk: 1.2, repair: 0.6 },
};
const DIVISION_COMMANDERS = ['balanced', 'aggressive', 'defensive', 'supply', 'tricky', 'careless'];



// ---------- 状態のスナップショット/復元(行動順の試行用) ----------
interface Snapshot {
  units: Array<Omit<Unit, 'carriedBy' | 'from'> & { carriedBy: number }>;
  townOwners: Array<Side | null>;
  airportOwners: Array<Side | null>;
  cityOwners: Array<[string, Side | null]>;
  gold: Record<Side, number>;
  over: boolean;
}

function snapshot(g: Game): Snapshot {
  const idx = new Map<Unit, number>();
  g.units.forEach((u, i) => idx.set(u, i));
  return {
    units: g.units.map((u) => ({
      x: u.x, y: u.y, z: u.z, side: u.side, kind: u.kind, hp: u.hp,
      ammo: { ...u.ammo }, fuel: u.fuel, moved: u.moved, acted: u.acted,
      carriedBy: u.carriedBy ? (idx.get(u.carriedBy) ?? -1) : -1,
    })),
    townOwners: g.towns.map((t) => t.owner),
    airportOwners: g.airports.map((a) => a.owner),
    cityOwners: [...g.tiles.values()].filter((t) => t.city).map((t) => [key(t), t.city!.owner] as [string, Side | null]),
    gold: { ...g.gold },
    over: g.over,
  };
}

function restore(g: Game, s: Snapshot): void {
  const units: Unit[] = s.units.map((u) => ({ ...u, ammo: { ...u.ammo }, carriedBy: null, from: null }));
  units.forEach((u, i) => {
    const c = s.units[i].carriedBy;
    u.carriedBy = c >= 0 ? units[c] : null;
  });
  g.units.length = 0;
  g.units.push(...units);
  g.towns.forEach((t, i) => { t.owner = s.townOwners[i]; });
  g.airports.forEach((a, i) => { a.owner = s.airportOwners[i]; });
  for (const [k, owner] of s.cityOwners) {
    const t = g.tiles.get(k);
    if (t?.city) t.city.owner = owner;
  }
  g.gold = { ...s.gold };
  g.over = s.over;
  g.selected = null;
  g.reach = null;
}

// ---------- 戦略層 ----------
interface Objective {
  kind: 'capture' | 'defend';
  at: Cube;
  name: string;
  town: Town | null;
  airport: Airport | null;
  capital: boolean;
  /** 経済価値(town は収入、空港は40、首都は+100) */
  value: number;
  /** 防衛目標の割り当て上限(重要度から決める。defend のみ) */
  guard: number;
  /** 敵がこの拠点へ到達する実移動コスト(地形込み)。防衛の緊急度の判定に使う */
  enemyCost: number;
}

interface Division {
  id: number;
  objective: Objective;
  units: Unit[];
  personality: Personality;
  /** この師団の担当区域で不足しているユニット種(カウンター編成の判断) */
  deficits: string[];
}

const foeOf = (s: Side): Side => (s === 'p' ? 'e' : 'p');

/**
 * 敵ユニット全体から各ヘックスへの「到達コスト」マップ。
 * 地上敵は地形・道路・河川込みの実移動コスト(多始点ダイクストラ)、航空敵は直線距離で見積もる。
 * 防衛の緊急度は単純なヘックス距離ではなく、この到達可能性で測る。
 * 前方に味方の拠点がある場所は、敵がそこを突破しない限り届かない=緊急度が下がる
 */
function enemyReachMap(g: Game, side: Side): Map<string, number> {
  const foe = foeOf(side);
  const out = new Map<string, number>();
  const foes = liveUnits(g, foe).filter((e) => !e.carriedBy);
  const groundKind = Object.keys(g.defs).find((k) => g.defs[k].domain === 'ground');
  if (groundKind) {
    const probe = { kind: groundKind } as unknown as Unit;
    const pq: Array<[number, Tile]> = [];
    for (const e of foes) {
      if (g.defs[e.kind].domain !== 'ground') continue;
      const t = tileAt(g, e);
      if (t) { out.set(key(t), 0); pq.push([0, t]); }
    }
    while (pq.length) {
      let bi = 0;
      for (let i = 1; i < pq.length; i++) if (pq[i][0] < pq[bi][0]) bi = i;
      const [c, t] = pq.splice(bi, 1)[0];
      if (c > (out.get(key(t)) ?? Infinity)) continue;
      if (c > 80) continue; // 遠方は緊急度の最低値で十分
      for (const n of neighbors(t)) {
        const nt = tileAt(g, n);
        if (!nt) continue;
        const step = moveCostOf(g, probe, nt);
        if (!Number.isFinite(step)) continue;
        const nc = c + step;
        if (nc < (out.get(key(nt)) ?? Infinity)) { out.set(key(nt), nc); pq.push([nc, nt]); }
      }
    }
  }
  const airFoes = foes.filter((e) => g.defs[e.kind].domain === 'air');
  if (airFoes.length > 0) {
    for (const t of g.tiles.values()) {
      if (t.terrain === 'fill') continue;
      let d = Infinity;
      for (const e of airFoes) d = Math.min(d, distance(e, t));
      if (d < (out.get(key(t)) ?? Infinity)) out.set(key(t), d);
    }
  }
  return out;
}

function buildObjectives(g: Game, side: Side): Objective[] {
  const foe = foeOf(side);
  const out: Objective[] = [];
  // 防御目標: 本当に脅威が迫っている自軍の town・空港(首都を含む)。脅威が無い拠点は防御目標にしない
  // 脅威の判定: 占領できる敵(歩兵)が近づいているか、敵が3体以上集まっている場合のみ。
  // 単独で飛び回る航空ユニット等では防御目標を立てない(防衛に兵力が張り付くのを防ぐ)
  // 首都だけは広め(14ヘックス)に見て、敵が近づく前から防衛師団を置けるようにする
  const threatNear = (at: Cube, radius: number): boolean => {
    let n = 0;
    for (const e of liveUnits(g, foe)) {
      if (e.carriedBy) continue;
      if (distance(e, at) > radius) continue;
      if (g.defs[e.kind].canCapture) return true;
      n++;
    }
    return n >= 3;
  };
  // 防衛目標の価値判定: 絶対値ではなく、マップをエリア(12ヘックス四方)に分け、
  // エリア内の town 人口合計がマップ全体の何割を占めるかで決める。
  // 人口の集まるエリアの拠点だけを守り、価値の薄いエリアには兵力を張り付けない
  const AREA = 12;
  const areaPop = new Map<string, number>();
  const areaMax = new Map<string, number>();
  let totalPop = 0;
  const areaKey = (at: Cube): string => {
    const tile = tileAt(g, at);
    return tile ? `${Math.floor(tile.col / AREA)},${Math.floor(tile.row / AREA)}` : '';
  };
  for (const t of g.towns) {
    const k = areaKey(t.at);
    areaPop.set(k, (areaPop.get(k) ?? 0) + t.population);
    areaMax.set(k, Math.max(areaMax.get(k) ?? 0, t.population));
    totalPop += t.population;
  }
  // 防衛の緊急度は「敵の到達可能性」で測る: 敵ユニット全体からの実移動コスト(地形込み)が
  // 小さい拠点ほど危ない。前方に別の自軍拠点がある場所は、敵がそこを突破しない限り
  // 届かないため緊急度を割り引く(盾)。経済価値×緊急度=重要度で、守る価値と配備数を決める
  const reach = enemyReachMap(g, side);
  const incomeOf = (t: Town): number => townIncome(t.population);
  const ownedTowns = g.towns.filter((t) => t.owner === side);
  for (const t of ownedTowns) {
    const radius = t.capital === side ? 14 : 8;
    const enemyCost = reach.get(key(t.at)) ?? Infinity;
    // すぐ近くの脅威か、到達コストが小さい(数ターンで届く)場合だけ防衛目標にする
    if (!threatNear(t.at, radius) && enemyCost > 26) continue;
    // 防衛目標は「首都」「人口シェア8%以上のエリアにある、そのエリア最大の town の3割以上の人口の town」だけ。
    // エリア内でも小さな town(白老町など)は守らず、エリアの中心都市に守りを集める
    const k = areaKey(t.at);
    const share = totalPop > 0 ? (areaPop.get(k) ?? 0) / totalPop : 0;
    if (t.capital !== side && (share < 0.08 || t.population < (areaMax.get(k) ?? 0) * 0.3)) continue;
    let urgency = Math.max(0.2, Math.min(1.6, 1.6 - enemyCost / 36));
    // 盾: 敵から見て手前に別の自軍 town があり、敵はそこを経由しないと届かないなら割り引く
    const shielded = ownedTowns.some((t2) => t2 !== t
      && (reach.get(key(t2.at)) ?? Infinity) + distance(t2.at, t.at) < enemyCost - 2);
    if (shielded) urgency *= 0.45;
    let importance = (20 + incomeOf(t)) * urgency;
    if (t.capital === side) importance = Math.max(importance, 150);
    // 重要度で配備数に差をつける: 最重要拠点には厚く、価値の薄い・届かない拠点には置かない
    const guard = importance >= 130 ? 8 : importance >= 70 ? 6 : importance >= 35 ? 4 : importance >= 15 ? 2 : 0;
    if (guard === 0 && t.capital !== side) continue;
    out.push({
      kind: 'defend', at: t.at, name: t.name, town: t, airport: null, capital: t.capital === side,
      value: incomeOf(t) + (t.capital === side ? 100 : 0), guard: Math.max(guard, t.capital === side ? 4 : 0), enemyCost,
    });
  }
  for (const a of g.airports) {
    if (a.owner !== side) continue;
    if (threatNear(a.at, 8)) {
      out.push({ kind: 'defend', at: a.at, name: a.name, town: null, airport: a, capital: false, value: 40, guard: 3, enemyCost: reach.get(key(a.at)) ?? Infinity });
    }
  }
  // 占領目標: 未占領・敵の town と空港
  for (const t of g.towns) {
    if (t.owner === side) continue;
    const isCap = t.capital === foe;
    out.push({ kind: 'capture', at: t.at, name: t.name, town: t, airport: null, capital: isCap, value: incomeOf(t) + (isCap ? 100 : 0), guard: 0, enemyCost: reach.get(key(t.at)) ?? Infinity });
  }
  for (const a of g.airports) {
    if (a.owner === side) continue;
    out.push({ kind: 'capture', at: a.at, name: a.name, town: null, airport: a, capital: false, value: 40, guard: 0, enemyCost: reach.get(key(a.at)) ?? Infinity });
  }
  return out;
}

/** 目標付近の敵カテゴリ構成に対して、最も有効な自軍ユニット種を返す */
function counterKindFor(g: Game, enemyCategory: string): string | null {
  let best: string | null = null;
  let bestScore = 0;
  for (const [kind, def] of Object.entries(g.defs)) {
    if (def.canCapture || (def.transport ?? 0) > 0 || def.isSupply) continue;
    for (const w of def.weapons) {
      const score = w.power * (w.vs?.[enemyCategory] ?? 1);
      if (score > bestScore) { bestScore = score; best = kind; }
    }
  }
  return best;
}

function buildDivisions(g: Game, side: Side, objectives: Objective[], commander: Personality, turn: number, scopeUnits?: Set<Unit>): Division[] {
  const divisions = new Map<Objective, Division>();
  const getDiv = (o: Objective): Division => {
    let d = divisions.get(o);
    if (!d) {
      const id = divisions.size;
      d = {
        id, objective: o, units: [],
        personality: PERSONALITIES[DIVISION_COMMANDERS[(id + turn) % DIVISION_COMMANDERS.length]],
        deficits: [],
      };
      divisions.set(o, d);
    }
    return d;
  };
  if (objectives.length === 0) return [];
  for (const u of liveUnits(g, side)) {
    if (u.carriedBy || u.acted) continue;
    if (scopeUnits && !scopeUnits.has(u)) continue;
    const def = g.defs[u.kind];
    // 歩兵とトラックは占領専門の別行動。ヘリは戦闘ユニットとして師団に入る
    if (def.canCapture) continue;
    if ((def.transport ?? 0) > 0 && def.weapons.length === 0) continue;
    // 目標の優先度: 距離から「価値ボーナス」を引いて比べる。
    // 経済価値の大きい都市(札幌など)は遠くても強く引きつけ、小さな拠点は近くても優先しない。
    // 防衛は重要度(価値×敵の到達可能性)に応じて引きつけ、配備上限も重要度で決まる
    const bonus = (o: Objective): number => {
      if (o.kind === 'defend') return o.guard * 1.5;
      if (o.capital) return 16;
      if (o.town) return Math.min(18, o.value / 12);
      return 4; // 空港
    };
    const prefs = [...objectives].sort((a, b) => (distance(u, a.at) - bonus(a)) - (distance(u, b.at) - bonus(b)));
    let chosen: Objective | null = null;
    for (const o of prefs) {
      if (o.kind === 'defend') {
        const d = divisions.get(o);
        if (d && d.units.length >= Math.max(1, o.guard)) continue; // 重要度ぶんの配備で打ち止め
      }
      chosen = o;
      break;
    }
    if (!chosen && prefs.length > 0) chosen = prefs.find((o) => o.kind === 'capture') ?? prefs[0];
    if (chosen) getDiv(chosen).units.push(u);
  }
  // カウンター編成: 目標付近(10ヘックス)の敵カテゴリを見て、不足している種を算出する
  const foe = foeOf(side);
  for (const d of divisions.values()) {
    const nearFoes = liveUnits(g, foe).filter((e) => !e.carriedBy && distance(e, d.objective.at) <= 10);
    const cats = new Map<string, number>();
    for (const e of nearFoes) {
      const c = g.defs[e.kind].category;
      cats.set(c, (cats.get(c) ?? 0) + 1);
    }
    const have = new Map<string, number>();
    for (const u of d.units) have.set(g.defs[u.kind].category, (have.get(g.defs[u.kind].category) ?? 0) + 1);
    for (const [cat, n] of [...cats.entries()].sort((a, b) => b[1] - a[1])) {
      const kind = counterKindFor(g, cat);
      if (!kind) continue;
      // 保有数は師団内だけでなく目標付近(10ヘックス)の自軍全体で数える。
      // 師団ごとに数えると、同じ敵集団に対して各師団が同じ種を重ねて要求してしまう
      const haveCount = liveUnits(g, side).filter((u) => !u.carriedBy && u.kind === kind && distance(u, d.objective.at) <= 10).length;
      if (haveCount < Math.ceil(n / 2)) d.deficits.push(kind);
    }
    void have;
    void commander;
  }
  return [...divisions.values()];
}

// ---------- 評価 ----------
/** そのヘックスに自軍ユニット(kind)が立つ場合に、来ターン敵から受ける見込みダメージ */
function threatAt(g: Game, side: Side, at: Cube, kind: string): number {
  const foe = foeOf(side);
  const myDef = g.defs[kind];
  const tile = tileAt(g, at);
  const terrainDef = tile && myDef.domain === 'ground' ? TERRAINS[tile.terrain].defense : 0;
  const parts: number[] = [];
  for (const e of liveUnits(g, foe)) {
    if (e.carriedBy) continue;
    const ed = g.defs[e.kind];
    if (ed.weapons.length === 0) continue;
    const maxRange = Math.max(...ed.weapons.map((w) => w.range));
    if (distance(e, at) > ed.move + maxRange) continue;
    let best = 0;
    for (const w of ed.weapons) best = Math.max(best, w.power * (w.vs?.[myDef.category] ?? 1));
    const v = Math.max(0, Math.round(best) - (myDef.defense + terrainDef));
    if (v > 0) parts.push(v);
  }
  // 1ヘックスを同時に攻撃できる敵は限られるため、脅威は大きい順に最大3体分までとする。
  // 全体を単純合計すると、戦車集団の小さな対空ダメージ(1ずつ)でも高額ユニットが過剰に怯えてしまう
  parts.sort((a, b) => b - a);
  return parts.slice(0, 3).reduce((s, v) => s + v, 0);
}

/** 盤面全体の自軍視点スコア(プラン同士の比較用) */
function evaluateState(g: Game, side: Side): number {
  const foe = foeOf(side);
  let score = 0;
  for (const u of liveUnits(g, side)) score += g.defs[u.kind].cost * (u.hp / g.defs[u.kind].hp);
  for (const u of liveUnits(g, foe)) score -= g.defs[u.kind].cost * (u.hp / g.defs[u.kind].hp);
  // town の価値は収入(人口)に比例させる。経済価値の大きい都市の占領・防衛を優先するため
  const townValue = (t: Town): number => 20 + townIncome(t.population);
  for (const t of g.towns) {
    if (t.owner === side) score += townValue(t);
    else if (t.owner === foe) score -= townValue(t);
  }
  score += g.airports.filter((a) => a.owner === side).length * 40;
  score -= g.airports.filter((a) => a.owner === foe).length * 40;
  const foeCap = capitalOf(g, foe);
  if (foeCap?.city?.owner === side) score += 100000;
  const myCap = capitalOf(g, side);
  if (myCap?.city?.owner === foe) score -= 100000;
  return score;
}

/** 未占領の town・空港のヘックスか。占領できないユニットがここに居座ると歩兵が占領できなくなる */
function blocksCapture(g: Game, side: Side, t: Tile): boolean {
  const town = townAt(g, t);
  if (town) return town.owner !== side;
  const airport = airportAt(g, t);
  return !!airport && airport.owner !== side;
}

/** そのユニットが補給を受けられるヘックスか(ターン開始時の補給条件と同じ考え方) */
function isResupplyHex(g: Game, side: Side, u: Unit, t: Tile): boolean {
  const def = g.defs[u.kind];
  const town = townAt(g, t);
  const airport = airportAt(g, t);
  const onOwnedTown = !!town && town.owner === side;
  const onOwnedAirport = !!airport && !town && airport.owner === side;
  if (def.fighter) return onOwnedAirport;
  return def.domain === 'air' ? onOwnedTown || onOwnedAirport : onOwnedTown;
}

function nearestResupplyDist(g: Game, side: Side, u: Unit, from: Cube): number {
  let best = Infinity;
  for (const t of g.tiles.values()) {
    if (t.terrain === 'fill') continue;
    if (isResupplyHex(g, side, u, t)) best = Math.min(best, distance(from, t));
  }
  return best;
}

// ---------- 戦術層 ----------
interface Ctx {
  g: Game;
  side: Side;
  foe: Side;
  commander: Personality;
  divisions: Division[];
  divOf: Map<Unit, Division>;
  objectives: Objective[];
  actions: AiAction[];
  summary: string[];
  rng: () => number;
  delegated: boolean;
  /** 占領専門部隊の割り当て(歩兵→目標)。全歩兵が同じ方向へ固まらないよう重複なく配る */
  occTargets: Map<Unit, Objective>;
  /** 委任時: 行動できるユニットの制限(null なら全ユニット) */
  scopeUnits: Set<Unit> | null;
  /** 目標ヘックスまでの実移動コスト表のキャッシュ(キー: 目標|ユニット種) */
  costCache: Map<string, Map<string, number>>;
}

/**
 * 目標ヘックスから逆向きにダイクストラし、各ヘックスから目標までの実移動コストを求める。
 * キューブ距離と違い、水や山で迂回する経路も正しく評価できる
 */
function costMapTo(ctx: Ctx, u: Unit, target: Cube): Map<string, number> {
  const cacheKey = `${key(target)}|${u.kind}`;
  const hit = ctx.costCache.get(cacheKey);
  if (hit) return hit;
  const { g } = ctx;
  const dist = new Map<string, number>();
  const start = tileAt(g, target);
  if (start) {
    dist.set(key(start), 0);
    const open: Array<{ at: Tile; cost: number }> = [{ at: start, cost: 0 }];
    while (open.length) {
      open.sort((a, b) => a.cost - b.cost);
      const { at, cost } = open.shift()!;
      if (cost > (dist.get(key(at)) ?? Infinity)) continue;
      if (cost > 400) continue;
      const enter = moveCostOf(g, u, at); // 隣のヘックスから at へ入るコスト
      if (!Number.isFinite(enter) || enter >= 255) continue;
      for (const n of neighbors(at)) {
        const t = tileAt(g, n);
        if (!t || t.terrain === 'fill') continue;
        const occ = unitAt(g, t);
        if (occ && occ.side !== u.side) continue; // 敵ユニットのヘックスは通過できない
        const nc = cost + enter;
        const k = key(t);
        if (nc < (dist.get(k) ?? Infinity)) {
          dist.set(k, nc);
          open.push({ at: t, cost: nc });
        }
      }
    }
  }
  ctx.costCache.set(cacheKey, dist);
  return dist;
}

const idxOf = (g: Game, u: Unit): number => g.units.indexOf(u);

/** 航空ユニットの燃料安全: 移動後に燃料切れで墜落せず、補給地点へ帰れる燃料を残す(全性格共通の最優先ルール) */
function fuelSafeAfter(ctx: Ctx, u: Unit, dest: Tile, cost: number): boolean {
  const { g, side } = ctx;
  if (!g.settings.supply) return true;
  const def = g.defs[u.kind];
  const after = u.fuel - cost;
  if (def.domain !== 'air') return true;
  if (after <= 0) return false; // 移動した時点で墜落する
  if (isResupplyHex(g, side, u, dest)) return true;
  const back = nearestResupplyDist(g, side, u, dest);
  return !Number.isFinite(back) || after >= back;
}

/** 反撃ダメージの近似(相手が dest にいる自軍ユニットを撃つ場合) */
function approxCounter(g: Game, foeUnit: Unit, myUnit: Unit, myTile: Tile): number {
  if (!g.settings.counter) return 0;
  const d = distance(foeUnit, myTile);
  const myDef = g.defs[myUnit.kind];
  const terrainDef = myDef.domain === 'ground' ? TERRAINS[myTile.terrain].defense : 0;
  let best = 0;
  for (const w of g.defs[foeUnit.kind].weapons) {
    if (d < w.minRange || d > w.range) continue;
    let base = w.power * (w.vs?.[myDef.category] ?? 1);
    if (g.settings.theme === 'modern' || g.settings.theme === 'sengoku') {
      base *= foeUnit.hp / g.defs[foeUnit.kind].hp;
    }
    best = Math.max(best, Math.max(1, Math.round(base) - (myDef.defense + terrainDef) - 2));
  }
  return best;
}

/** 修理対象とするHP割合のライン。師団で不足している種は粘り、余裕のある種は早めに下がる。性格でも上下する */
function repairThreshold(ctx: Ctx, u: Unit, div: Division | null): number {
  let t = 0.45 * ctx.commander.repair * (div?.personality.repair ?? 1);
  if (div) {
    if (div.deficits.includes(u.kind)) t *= 0.5;
    else if (div.units.filter((x) => x.kind === u.kind).length >= 3) t *= 1.4;
  }
  return Math.min(0.85, Math.max(0.1, t));
}

/** 最も近い補給地点へ近づく移動。移動したら true */
function moveTowardResupply(ctx: Ctx, u: Unit): boolean {
  const { g, side } = ctx;
  let target: Tile | null = null;
  let bestDist = Infinity;
  for (const t of g.tiles.values()) {
    if (t.terrain === 'fill' || !isResupplyHex(g, side, u, t)) continue;
    const d = distance(u, t);
    if (d < bestDist) { bestDist = d; target = t; }
  }
  if (!target || bestDist === 0) return false;
  return moveTowardPoint(ctx, u, target, ctx.commander);
}

interface Scored { score: number; dest: Tile | null; cost: number; target: Unit | null }

function pickBest(ctx: Ctx, cands: Scored[], personality: Personality): Scored | null {
  if (cands.length === 0) return null;
  cands.sort((a, b) => b.score - a.score);
  // そそっかしい師団長は、ときどき次善の手を選ぶ
  if (personality.name === 'そそっかしい' && cands.length > 1 && ctx.rng() < 0.25) return cands[1];
  return cands[0];
}

/** 師団ユニット1体の行動(戦闘・前進・修理後退) */
function actCombatUnit(ctx: Ctx, u: Unit, div: Division | null): void {
  const { g, side, foe } = ctx;
  if (u.hp <= 0 || u.acted || u.carriedBy) return;
  const def = g.defs[u.kind];
  const personality = div?.personality ?? ctx.commander;
  const objective = div?.objective ?? null;

  // 歩兵を搭載中は輸送役に徹する(降車まで戦闘を避ける)
  if (cargoList(g, u).length > 0) {
    actLoadedCarrier(ctx, u);
    return;
  }
  // ヘリの例外連携: トラックでは歩兵を拾えない状況なら、師団任務より輸送を優先する
  if ((def.transport ?? 0) > 0 && heliRescueTarget(ctx, u)) {
    const inf = heliRescueTarget(ctx, u)!;
    moveTowardPoint(ctx, u, inf, personality);
    if (!u.acted) { ctx.actions.push({ type: 'confirm', unit: idxOf(g, u) }); confirmUnit(g, u); }
    return;
  }

  const foes = liveUnits(g, foe).filter((f) => !f.carriedBy);
  const reach = reachable(g, u);
  const myTile = tileAt(g, u)!;
  const cands: Scored[] = [];

  // 航空ユニット: 燃料が心許なくなったら戦闘より帰投・補給を優先する(燃料切れ防止は最優先ルール)。
  // これが無いと、燃料不足で攻撃候補が次々に不成立になり、前線で滞空し続けて戦闘に参加できなくなる
  if (g.settings.supply && def.domain === 'air' && !isResupplyHex(g, side, u, myTile)) {
    const back = nearestResupplyDist(g, side, u, u);
    if (Number.isFinite(back) && u.fuel <= back + Math.ceil(def.move / 2)) {
      if (moveTowardResupply(ctx, u)) {
        if (!u.acted) { ctx.actions.push({ type: 'confirm', unit: idxOf(g, u) }); confirmUnit(g, u); }
        return;
      }
    }
  }

  // 自軍拠点の位置(敵歩兵の脅威判定用)
  const myFacilityAts: Cube[] = [
    ...g.towns.filter((t) => t.owner === side).map((t) => t.at),
    ...g.airports.filter((a) => a.owner === side).map((a) => a.at),
  ];

  // 攻撃候補(現在位置から/移動後から)。武装の選択は「移動後の位置から相手までの距離」で行う。
  // (現在位置の距離で選ぶと、移動して初めて射程に入る相手を永遠に攻撃できなくなる)
  // 移動後の攻撃は射程1の武装のみ使える
  const evalAttack = (dest: Tile, cost: number, target: Unit): number => {
    const afterMove = !equals(dest, u);
    const w = afterMove
      ? pickWeaponAfterMove(g, u, target, distance(dest, target))
      : pickWeapon(g, u, target, distance(dest, target));
    if (!w) return -Infinity;
    // 移動後の攻撃可否とダメージは位置で変わらない(ダメージは防御側の地形のみ依存)ため、現在位置基準で計算する
    const dmg = calcDamage(g, u, target, w);
    const tDef = g.defs[target.kind];
    let score = dmg * (tDef.cost / tDef.hp) * personality.aggression;
    if (target.hp - dmg <= 0) score += tDef.cost * 0.6 * personality.aggression; // 撃破ボーナス
    if (target.hp - dmg > 0) {
      const counter = approxCounter(g, target, u, dest);
      score -= counter * (def.cost / def.hp) * 0.7 * personality.defense;
    }
    score -= threatAt(g, side, dest, u.kind) * (def.cost / def.hp) * 0.22 * personality.defense / personality.risk;
    // 味方拠点に迫る敵歩兵(占領役)は陣取りにおける最大の脅威。師団目標に優先して攻撃する
    if (tDef.canCapture && myFacilityAts.some((at) => distance(target, at) <= 6)) score += 30;
    if (!fuelSafeAfter(ctx, u, dest, cost)) return -Infinity;
    return score;
  };
  for (const f of foes) {
    if (canAttackTarget(g, u, f)) {
      const s = evalAttack(myTile, 0, f);
      if (s > -Infinity) cands.push({ score: s + 0.01, dest: null, cost: 0, target: f });
    }
  }
  for (const [k, cost] of reach) {
    const t = g.tiles.get(k);
    if (!t || equals(t, u)) continue;
    if (blocksCapture(g, side, t)) continue; // 占領用ヘックスは歩兵のために空ける
    for (const f of foes) {
      // 移動後に使える武装(射程1)で、移動後の位置から射程に入るか
      if (!pickWeaponAfterMove(g, u, f, distance(t, f))) continue;
      const s = evalAttack(t, cost, f);
      if (s > -Infinity) cands.push({ score: s, dest: t, cost, target: f });
    }
  }

  const canKill = cands.some((c) => {
    if (!c.target) return false;
    const from = c.dest ?? myTile;
    const afterMove = !equals(from, u);
    const w = afterMove
      ? pickWeaponAfterMove(g, u, c.target, distance(from, c.target))
      : pickWeapon(g, u, c.target, distance(from, c.target));
    return w !== null && c.target.hp - calcDamage(g, u, c.target, w) <= 0;
  });

  // 修理後退: HPラインを割り、撃破できる相手もいなければ補給地点へ下がる
  const hpFrac = u.hp / def.hp;
  if (!canKill && hpFrac < repairThreshold(ctx, u, div) && !isResupplyHex(g, side, u, myTile)) {
    if (moveTowardResupply(ctx, u)) {
      if (!u.acted) { ctx.actions.push({ type: 'confirm', unit: idxOf(g, u) }); confirmUnit(g, u); }
      return;
    }
  }

  // 前進候補(師団目標へ。実移動コストの減少で評価する)
  // 占領目標の間近まで来ていて周囲に敵もいない場合、戦闘ユニットはその場で滞留せず、
  // 次の占領目標へ先行する(占領は歩兵の仕事。戦闘ユニットが小さな town の周りに張り付くのを防ぐ)
  let advanceObjective = objective;
  if (objective && objective.kind === 'capture' && distance(u, objective.at) <= 2
    && !foes.some((f) => distance(u, f) <= 4)) {
    let next: Objective | null = null;
    let nextDist = Infinity;
    for (const o of ctx.objectives) {
      if (o.kind !== 'capture' || equals(o.at, objective.at)) continue;
      const d = distance(u, o.at);
      if (d < nextDist) { nextDist = d; next = o; }
    }
    if (next) advanceObjective = next;
  }
  if (advanceObjective) {
    const objective = advanceObjective;
    const costs = costMapTo(ctx, u, objective.at);
    const curCost = costs.get(key(u)) ?? Infinity;
    let best: Tile | null = null;
    let bestScore = -Infinity;
    for (const [k, cost] of reach) {
      const t = g.tiles.get(k);
      if (!t || equals(t, u)) continue;
      if (!fuelSafeAfter(ctx, u, t, cost)) continue;
      if (blocksCapture(g, side, t)) continue; // 占領用ヘックスは歩兵のために空ける
      const c = costs.get(k);
      if (c === undefined) continue;
      let score = (curCost - c) * 2;
      if (def.domain === 'ground') score += TERRAINS[t.terrain].defense * personality.defense;
      score -= threatAt(g, side, t, u.kind) * (def.cost / def.hp) * 0.22 * personality.defense / personality.risk;
      if (g.settings.supply && def.domain !== 'air' && u.fuel - cost <= 0 && !isResupplyHex(g, side, u, t)) score -= 5;
      // 防衛目標では、目標ヘックスそのものに居座ることを優先する(拠点を明け渡さない)
      if (objective.kind === 'defend' && equals(t, objective.at)) score += 3;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    if (best) cands.push({ score: bestScore, dest: best, cost: reach.get(key(best)) ?? 0, target: null });
  }
  // 追撃候補: 今ターン攻撃できる敵がいない場合、近くの敵(突出した敵など)へ接近する動きも評価する。
  // これが無いと、ユニットは師団目標へしか動けず、目の前の敵を素通りしたり後退して見える
  if (!cands.some((c) => c.target)) {
    // 追撃相手は、拠点に迫る敵歩兵(占領役)を最優先し、次に最も近い敵を選ぶ
    let foeNear: Unit | null = null;
    let foeDist = Infinity;
    for (const f of foes) {
      if (!g.defs[f.kind].canCapture) continue;
      if (!myFacilityAts.some((at) => distance(f, at) <= 6)) continue;
      const d = distance(u, f);
      if (d < foeDist) { foeDist = d; foeNear = f; }
    }
    if (!foeNear) {
      for (const f of foes) {
        const d = distance(u, f);
        if (d < foeDist) { foeDist = d; foeNear = f; }
      }
    }
    if (foeNear && foeDist <= 10) {
      const costs = costMapTo(ctx, u, foeNear);
      const curCost = costs.get(key(u)) ?? Infinity;
      let best: Tile | null = null;
      let bestScore = -Infinity;
      for (const [k, cost] of reach) {
        const t = g.tiles.get(k);
        if (!t || equals(t, u)) continue;
        if (!fuelSafeAfter(ctx, u, t, cost)) continue;
        if (blocksCapture(g, side, t)) continue;
        const c = costs.get(k);
        if (c === undefined) continue;
        let score = (curCost - c) * 2 + 1.5;
        score -= threatAt(g, side, t, u.kind) * (def.cost / def.hp) * 0.22 * personality.defense / personality.risk;
        if (score > bestScore) { bestScore = score; best = t; }
      }
      if (best) cands.push({ score: bestScore, dest: best, cost: reach.get(key(best)) ?? 0, target: null });
    }
  }
  // その場で待機(占領はしないが、地形防御と脅威で評価)
  {
    let score = 0;
    if (def.domain === 'ground') score += TERRAINS[myTile.terrain].defense * personality.defense;
    score -= threatAt(g, side, myTile, u.kind) * (def.cost / def.hp) * 0.4 * personality.defense / personality.risk;
    cands.push({ score, dest: null, cost: 0, target: null });
  }

  const chosen = pickBest(ctx, cands, personality);
  if (!chosen) { ctx.actions.push({ type: 'confirm', unit: idxOf(g, u) }); confirmUnit(g, u); return; }
  if (chosen.dest && !equals(chosen.dest, u)) {
    ctx.actions.push({ type: 'move', unit: idxOf(g, u), hex: key(chosen.dest) });
    moveUnit(g, u, chosen.dest, chosen.cost);
  }
  if (g.over) return;
  if (chosen.target && chosen.target.hp > 0 && canAttackTarget(g, u, chosen.target)) {
    ctx.actions.push({ type: 'attack', unit: idxOf(g, u), target: idxOf(g, chosen.target) });
    const before = chosen.target.hp;
    attack(g, u, chosen.target);
    if (before > 0 && chosen.target.hp <= 0) ctx.summary.push(`敵の${g.defs[chosen.target.kind].name}を撃破`);
    if (u.hp <= 0) ctx.summary.push(`味方の${def.name}が撃破された`);
  } else if (!u.acted) {
    ctx.actions.push({ type: 'confirm', unit: idxOf(g, u) });
    confirmUnit(g, u);
  }
}

/** 指定地点へ、実移動コストが減る方向へ移動する。コストが減らなければ動かない */
function moveTowardPoint(ctx: Ctx, u: Unit, point: Cube, personality: Personality): boolean {
  const { g, side } = ctx;
  const costs = costMapTo(ctx, u, point);
  const cur = costs.get(key(u)) ?? Infinity;
  if (!Number.isFinite(cur) || cur === 0) return false;
  const reach = reachable(g, u);
  let best: Tile | null = null;
  let bestScore = -Infinity;
  for (const [k, cost] of reach) {
    const t = g.tiles.get(k);
    if (!t || equals(t, u)) continue;
    if (!fuelSafeAfter(ctx, u, t, cost)) continue;
    if (!g.defs[u.kind].canCapture && blocksCapture(g, side, t)) continue; // 占領用ヘックスは歩兵のために空ける
    const c = costs.get(k);
    if (c === undefined || c >= cur) continue;
    let score = (cur - c) * 2 - threatAt(g, side, t, u.kind) * 0.2 / personality.risk;
    if (g.defs[u.kind].domain === 'ground') score += TERRAINS[t.terrain].defense * 0.3;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  if (best) {
    ctx.actions.push({ type: 'move', unit: idxOf(g, u), hex: key(best) });
    moveUnit(g, u, best, reach.get(key(best)) ?? 0);
    return true;
  }
  return false;
}

/** 目標へ近づけない場合の代替: 他の占領目標のうち、実際に近づけるものへ向かう。
 * 目標が地形で到達不能(河川の向こう等)だと、ユニットが何ターンもその場に固まるため */
function moveTowardAnyObjective(ctx: Ctx, u: Unit, personality: Personality): boolean {
  const objs = ctx.objectives
    .filter((o) => o.kind === 'capture')
    .sort((a, b) => (distance(u, a.at) - Math.min(10, a.value / 20)) - (distance(u, b.at) - Math.min(10, b.value / 20)));
  for (const o of objs) {
    if (moveTowardPoint(ctx, u, o.at, personality)) return true;
  }
  return false;
}

/** 搭載中の輸送ユニット(トラック・ヘリ共通): 占領目標の town へ運び、隣接したら降車させる */
function actLoadedCarrier(ctx: Ctx, u: Unit): void {
  const { g } = ctx;
  const cargo = cargoList(g, u)[0];
  if (!cargo) return;
  // 目標がどこであれ、隣に空いている占領目標があれば先に降ろす。
  // 「より価値の大きい都市」だけを見て隣の town を通り過ぎると、占領が何ターンも遅れる
  for (const o of ctx.objectives) {
    if (o.kind !== 'capture') continue;
    const t = tileAt(g, o.at);
    if (t && distance(u, t) === 1 && !unitAt(g, t)) {
      ctx.actions.push({ type: 'disembark', carrier: idxOf(g, u), hex: key(t) });
      disembarkUnit(g, u, t);
      return;
    }
  }
  const obj = ctx.occTargets.get(cargo) ?? nearestCaptureObjective(ctx, cargo);
  if (!obj) { ctx.actions.push({ type: 'confirm', unit: idxOf(g, u) }); confirmUnit(g, u); return; }
  const townTile = tileAt(g, obj.at);
  // 目標 town が隣で空いていれば降車(占領はターン終了時に確定する)
  if (townTile && distance(u, townTile) === 1 && !unitAt(g, townTile)) {
    ctx.actions.push({ type: 'disembark', carrier: idxOf(g, u), hex: key(townTile) });
    disembarkUnit(g, u, townTile);
    return;
  }
  if (townTile && equals(u, townTile)) {
    // 目標の真上にいる場合は隣の空きマスへ降ろす
    for (const n of neighbors(u)) {
      const t = tileAt(g, n);
      if (t && !unitAt(g, t) && t.terrain !== 'fill') {
        ctx.actions.push({ type: 'disembark', carrier: idxOf(g, u), hex: key(t) });
        disembarkUnit(g, u, t);
        return;
      }
    }
  }
  if (!moveTowardPoint(ctx, u, obj.at, ctx.commander) && !moveTowardAnyObjective(ctx, u, ctx.commander)) {
    // どの目標へも近づけない(地形で孤立している等)なら、歩兵を降ろして徒歩に切り替える
    for (const n of neighbors(u)) {
      const t = tileAt(g, n);
      if (t && !unitAt(g, t) && t.terrain !== 'fill' && t.terrain !== 'water') {
        ctx.actions.push({ type: 'disembark', carrier: idxOf(g, u), hex: key(t) });
        disembarkUnit(g, u, t);
        return;
      }
    }
  }
  if (!u.acted) { ctx.actions.push({ type: 'confirm', unit: idxOf(g, u) }); confirmUnit(g, u); }
}

function nearestCaptureObjective(ctx: Ctx, from: Cube): Objective | null {
  let best: Objective | null = null;
  let bestDist = Infinity;
  for (const o of ctx.objectives) {
    if (o.kind !== 'capture') continue;
    // 距離だけでなく経済価値も見る(小さな town ばかり拾って大都市を放置しないため)
    const d = distance(from, o.at) - Math.min(10, o.value / 20) - (o.capital ? 6 : 0);
    if (d < bestDist) { bestDist = d; best = o; }
  }
  return best;
}

/** 歩兵が今の移動力で輸送ユニットに搭乗できるか(輸送側のヘックスは reachable から除外されるため隣接経由で判定) */
function boardCost(ctx: Ctx, inf: Unit, carrier: Unit): number | null {
  return boardCostOf(ctx.g, inf, carrier);
}

/** 輸送連携が必要な歩兵(占領目標が徒歩3ターン以内に無い歩兵) */
function needyInfantry(ctx: Ctx, inf: Unit): Objective | null {
  const obj = ctx.occTargets.get(inf) ?? nearestCaptureObjective(ctx, inf);
  if (!obj) return null;
  const def = ctx.g.defs[inf.kind];
  return distance(inf, obj.at) > def.move * 3 ? obj : null;
}

/** ヘリの例外連携の対象: トラックが近くにおらず、このヘリが拾いに行ける歩兵 */
function heliRescueTarget(ctx: Ctx, heli: Unit): Unit | null {
  const { g, side } = ctx;
  const trucks = liveUnits(g, side).filter((u) => (g.defs[u.kind].transport ?? 0) > 0 && g.defs[u.kind].weapons.length === 0);
  for (const inf of liveUnits(g, side)) {
    if (!g.defs[inf.kind].canCapture || inf.carriedBy || inf.acted) continue;
    if (ctx.scopeUnits && !ctx.scopeUnits.has(inf)) continue;
    if (!needyInfantry(ctx, inf)) continue;
    if (trucks.some((t) => t.hp > 0 && distance(t, inf) <= 12)) continue; // トラックが対応できる
    // 最も近い航空輸送がこのヘリのときだけ動く
    const airCarriers = liveUnits(g, side).filter((u) => (g.defs[u.kind].transport ?? 0) > 0 && g.defs[u.kind].domain === 'air' && u.hp > 0);
    const nearest = airCarriers.sort((a, b) => distance(a, inf) - distance(b, inf))[0];
    if (nearest === heli) return inf;
  }
  return null;
}

/** 占領専門部隊(歩兵・トラック)の行動 */
function actOccupation(ctx: Ctx): void {
  const { g, side } = ctx;
  const inScope = (u: Unit): boolean => !ctx.scopeUnits || ctx.scopeUnits.has(u);
  const infantries = liveUnits(g, side).filter((u) => g.defs[u.kind].canCapture && !u.carriedBy && !u.acted && inScope(u));
  const trucks = liveUnits(g, side).filter((u) => (g.defs[u.kind].transport ?? 0) > 0 && g.defs[u.kind].weapons.length === 0 && !u.acted && inScope(u));

  // 目標の割り当て: 「各自が最寄り」を選ぶと全歩兵が同じ方向の town の列に固まり、
  // 別方向の拠点(例: 首都の東の白老町)が何十ターンも手つかずになる。
  // スコア(距離−価値ボーナス)が小さいペアから貪欲に、目標が重ならないよう配る
  ctx.occTargets.clear();
  {
    const objs = ctx.objectives.filter((o) => o.kind === 'capture');
    // 搭載中の歩兵にも目標を持たせる(輸送側が降車先を判断するため。位置は輸送側と同期している)
    const carried = liveUnits(g, side).filter((u) => g.defs[u.kind].canCapture && u.carriedBy && inScope(u));
    const pairs: Array<{ inf: Unit; o: Objective; s: number }> = [];
    for (const inf of [...infantries, ...carried]) {
      for (const o of objs) {
        pairs.push({ inf, o, s: distance(inf, o.at) - Math.min(10, o.value / 20) - (o.capital ? 6 : 0) });
      }
    }
    pairs.sort((a, b) => a.s - b.s);
    const taken = new Set<Objective>();
    for (const p of pairs) {
      if (ctx.occTargets.has(p.inf)) continue;
      if (taken.has(p.o) && !p.o.capital) continue; // 敵首都だけは複数で向かってよい
      ctx.occTargets.set(p.inf, p.o);
      taken.add(p.o);
    }
  }

  for (const inf of infantries) {
    if (inf.acted || inf.hp <= 0) continue;
    let obj = ctx.occTargets.get(inf) ?? nearestCaptureObjective(ctx, inf);
    if (!obj) { ctx.actions.push({ type: 'confirm', unit: idxOf(g, inf) }); confirmUnit(g, inf); continue; }
    const reach = reachable(g, inf);
    let objTile = tileAt(g, obj.at);
    // 担当目標が届かなくても、移動範囲内に別の占領目標があればそちらを取る(機会損失の防止)
    if (!(objTile && reach.has(key(objTile)))) {
      for (const o of ctx.objectives) {
        if (o.kind !== 'capture') continue;
        const t = tileAt(g, o.at);
        if (t && reach.has(key(t))) { obj = o; objTile = t; break; }
      }
    }
    // 目標 town に入れるなら占領する
    if (objTile && reach.has(key(objTile))) {
      ctx.actions.push({ type: 'move', unit: idxOf(g, inf), hex: key(objTile) });
      moveUnit(g, inf, objTile, reach.get(key(objTile)) ?? 0);
      ctx.actions.push({ type: 'confirm', unit: idxOf(g, inf) });
      confirmUnit(g, inf);
      ctx.summary.push(`${obj.name}を占領`);
      continue;
    }
    if (!needyInfantry(ctx, inf)) {
      // 徒歩3ターン以内: そのまま前進
      if (!moveTowardPoint(ctx, inf, obj.at, ctx.commander)) moveTowardAnyObjective(ctx, inf, ctx.commander);
      if (!inf.acted) { ctx.actions.push({ type: 'confirm', unit: idxOf(g, inf) }); confirmUnit(g, inf); }
      continue;
    }
    // 輸送連携を強制する: 最寄りのトラック(いなければヘリ)に搭乗を試みる
    const carriers = liveUnits(g, side).filter((u) => (g.defs[u.kind].transport ?? 0) > 0 && u.hp > 0 && inScope(u) && cargoList(g, u).length < (g.defs[u.kind].transport ?? 0));
    const sorted = carriers.sort((a, b) => distance(inf, a) - distance(inf, b));
    let boarded = false;
    for (const c of sorted) {
      const cost = boardCost(ctx, inf, c);
      if (cost !== null) {
        ctx.actions.push({ type: 'board', unit: idxOf(g, inf), carrier: idxOf(g, c) });
        boardUnit(g, inf, c, cost);
        boarded = true;
        break;
      }
    }
    if (boarded) continue;
    // 今ターン搭乗できない場合は、輸送側を追いかけず占領目標へ徒歩で進む。
    // 輸送側(トラック/ヘリ)の方が高速なので、迎えは輸送側から来させる。
    // 輸送側を追うと、搭載条件を満たさない(損傷したヘリ等)場合に歩兵が永遠に足止めされる
    if (!moveTowardPoint(ctx, inf, obj.at, ctx.commander)) moveTowardAnyObjective(ctx, inf, ctx.commander);
    if (!inf.acted) { ctx.actions.push({ type: 'confirm', unit: idxOf(g, inf) }); confirmUnit(g, inf); }
  }

  for (const truck of trucks) {
    if (truck.acted || truck.hp <= 0) continue;
    if (cargoList(g, truck).length > 0) { actLoadedCarrier(ctx, truck); continue; }
    // 空のトラックは、輸送が必要な歩兵を拾いに行く
    const target = liveUnits(g, side).filter((u) => g.defs[u.kind].canCapture && !u.carriedBy && u.hp > 0 && inScope(u) && needyInfantry(ctx, u))
      .sort((a, b) => distance(truck, a) - distance(truck, b))[0];
    if (target) moveTowardPoint(ctx, truck, target, ctx.commander);
    else {
      const obj = nearestCaptureObjective(ctx, truck);
      if (obj) moveTowardPoint(ctx, truck, obj.at, ctx.commander);
    }
    if (!truck.acted) { ctx.actions.push({ type: 'confirm', unit: idxOf(g, truck) }); confirmUnit(g, truck); }
  }
}

/** 補給車: 師団目標の後方に付き、脅威を避ける */
function actSupplyUnit(ctx: Ctx, u: Unit, div: Division | null): void {
  const { g, side } = ctx;
  if (u.acted || u.hp <= 0) return;
  const obj = div?.objective;
  if (obj) {
    const reach = reachable(g, u);
    let best: Tile | null = null;
    let bestScore = -Infinity;
    for (const [k, cost] of reach) {
      const t = g.tiles.get(k);
      if (!t || equals(t, u)) continue;
      if (!fuelSafeAfter(ctx, u, t, cost)) continue;
      if (blocksCapture(g, side, t)) continue;
      const score = -Math.abs(distance(t, obj.at) - 3) * 2 - threatAt(g, side, t, u.kind) * 0.5;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    if (best && bestScore > -Math.abs(distance(u, obj.at) - 3) * 2) {
      ctx.actions.push({ type: 'move', unit: idxOf(g, u), hex: key(best) });
      moveUnit(g, u, best, reach.get(key(best)) ?? 0);
    }
  }
  if (!u.acted) { ctx.actions.push({ type: 'confirm', unit: idxOf(g, u) }); confirmUnit(g, u); }
}

// ---------- 生産 ----------
function planProduction(ctx: Ctx, divisions: Division[]): void {
  const { g, side } = ctx;
  if (ctx.delegated) return; // 生産は委任できない
  if (!g.settings.production) return;
  const capTile = capitalOf(g, side);
  const combatKinds = Object.keys(g.defs).filter((k) => !g.defs[k].canCapture && (g.defs[k].transport ?? 0) === 0 && !g.defs[k].isSupply && g.defs[k].weapons.length > 0);
  const countOf = (kind: string): number => liveUnits(g, side).filter((u) => u.kind === kind).length;
  for (let iter = 0; iter < 12; iter++) {
    if (liveUnits(g, side).length >= g.settings.maxUnits) return;
    // 欲しい種の優先順位: 歩兵の維持(占領の停滞防止) → トラック → 師団の不足(不足の多い師団から)
    // → 対空カウンター(敵航空の半数まで) → 汎用(現在数が少ない種から)
    const capturers = liveUnits(g, side).filter((u) => g.defs[u.kind].canCapture);
    const infantryKind = Object.keys(g.defs).find((k) => g.defs[k].canCapture);
    const prefs: Array<{ kind: string; div: Division | null }> = [];
    // 歩兵の維持を最優先にする: 前線で歩兵が撃破されたまま補充されないと占領が止まる。
    // 維持数は「まだ占領していない拠点の数」から決める(序盤は多め、終盤は少なめ)
    const unownedCount = ctx.objectives.filter((o) => o.kind === 'capture').length;
    const desiredInfantry = Math.max(2, Math.min(5, 2 + Math.ceil(unownedCount / 10)));
    if (infantryKind && capturers.length < desiredInfantry) prefs.push({ kind: infantryKind, div: null });
    // 占領部隊の相方: 歩兵がいるのに輸送(トラック)が1台も無いと、遠方の占領が進まない
    const truckKind = Object.keys(g.defs).find((k) => (g.defs[k].transport ?? 0) > 0 && g.defs[k].weapons.length === 0);
    if (truckKind && capturers.length > 0 && countOf(truckKind) < 2) prefs.push({ kind: truckKind, div: null });
    const divs = [...divisions].sort((a, b) => b.deficits.length - a.deficits.length);
    for (const d of divs) for (const k of d.deficits) prefs.push({ kind: k, div: d });
    const foeAir = liveUnits(g, ctx.foe).filter((u) => g.defs[u.kind].domain === 'air');
    if (foeAir.length > 0) {
      const ck = counterKindFor(g, g.defs[foeAir[0].kind].category);
      // 需要上限つき: 対空カウンターは敵航空の半数ぶんまでしか作らない
      if (ck && countOf(ck) < Math.ceil(foeAir.length / 2)) prefs.push({ kind: ck, div: null });
    }
    for (const k of [...combatKinds].sort((a, b) => countOf(a) - countOf(b) || g.defs[a].cost - g.defs[b].cost)) {
      prefs.push({ kind: k, div: null });
    }
    if (prefs.length === 0) return;
    // 編成バランス: 戦闘ユニットの1種が全体の4割を超えないよう、上限に達した種は後回しにする
    const combatTotal = combatKinds.reduce((s, k) => s + countOf(k), 0);
    const kindCap = Math.max(2, Math.ceil(Math.max(1, combatTotal) * 0.4));
    const belowCap = (p: { kind: string }): boolean => g.defs[p.kind].canCapture || countOf(p.kind) < kindCap;
    const pick = prefs.find((p) => belowCap(p) && g.defs[p.kind].cost <= g.gold[side])
      ?? prefs.find((p) => g.defs[p.kind].cost <= g.gold[side]);
    if (!pick) return; // 買える候補が無い
    const kind = pick.kind;
    const forDiv = pick.div;
    // 生産ヘックス: 対象師団の目標(なければ首都)に最も近い生産可能ヘックス
    const target: Cube = forDiv?.objective.at ?? capTile ?? { x: 0, y: 0, z: 0 };
    const hexKeys = new Set<string>(producibleHexKeys(g, side));
    for (const a of g.airports) if (a.owner === side) {
      const t = g.tiles.get(key(a.at));
      if (t) hexKeys.add(key(t));
    }
    let bestTile: Tile | null = null;
    let bestDist = Infinity;
    for (const k of hexKeys) {
      const t = g.tiles.get(k);
      if (!t || !canProduce(g, side, kind, t)) continue;
      const d = distance(t, target);
      if (d < bestDist) { bestDist = d; bestTile = t; }
    }
    if (!bestTile) return;
    ctx.actions.push({ type: 'produce', kind, hex: key(bestTile) });
    if (!produce(g, side, kind, bestTile)) return;
    ctx.summary.push(`${g.defs[kind].name}を生産`);
    // 生産した分、その師団の不足から該当種を解消したものとする
    if (forDiv) forDiv.deficits = forDiv.deficits.filter((k) => k !== kind);
  }
}



// ---------- プランの試行と実行 ----------
type OrderMode = 'priority' | 'division' | 'division-rev';

function runAttempt(g: Game, side: Side, opts: PlanOptions, commander: Personality, mode: OrderMode): { actions: AiAction[]; summary: string[] } {
  const scopeUnits = opts.scopeIndices
    ? new Set(opts.scopeIndices.map((i) => g.units[i]).filter((u): u is Unit => !!u && u.hp > 0))
    : null;
  const objectives: Objective[] = opts.fixedObjective
    ? [{
        kind: 'capture', at: opts.fixedObjective.at, name: opts.fixedObjective.name,
        town: townAt(g, opts.fixedObjective.at) ?? null,
        airport: airportAt(g, opts.fixedObjective.at) ?? null, capital: false,
        value: 40, guard: 0, enemyCost: Infinity,
      }]
    : buildObjectives(g, side);
  const divisions = buildDivisions(g, side, objectives, commander, g.turn, scopeUnits ?? undefined);
  const divOf = new Map<Unit, Division>();
  for (const d of divisions) for (const u of d.units) divOf.set(u, d);
  let seed = (opts.seed ?? 1) >>> 0;
  const rng = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const ctx: Ctx = {
    g, side, foe: foeOf(side), commander, divisions, divOf, objectives,
    actions: [], summary: [], rng, delegated: !!opts.delegated, occTargets: new Map(), scopeUnits, costCache: new Map(),
  };

  // 生産は自ターンの最終フェーズで行う(移動・攻撃で損害が確定してから、
  // 実際に必要になった種別を選ぶため)。行動順の組み立てと実行はその後ろに回す

  // 行動順を組み立てる
  type Item = { u: Unit; div: Division | null } | { occupation: true };
  const items: Item[] = [];
  const divUnits: Array<{ u: Unit; div: Division }> = [];
  for (const d of divisions) for (const u of d.units) divUnits.push({ u, div: d });
  if (mode === 'priority') {
    const longRange = divUnits.filter(({ u }) => hasLongRangeWeapon(g, u) && liveUnits(g, ctx.foe).some((f) => !f.carriedBy && canAttackTarget(g, u, f)));
    const rest = divUnits.filter(({ u }) => !longRange.some((x) => x.u === u));
    const supply = rest.filter(({ u }) => g.defs[u.kind].isSupply);
    const combat = rest.filter(({ u }) => !g.defs[u.kind].isSupply);
    items.push(...longRange, ...combat, ...supply, { occupation: true });
  } else {
    const foeCap = capitalOf(g, ctx.foe);
    const sorted = [...divisions].sort((a, b) => {
      if (a.objective.kind !== b.objective.kind) return a.objective.kind === 'defend' ? -1 : 1;
      const da = foeCap ? distance(a.objective.at, foeCap) : 0;
      const db = foeCap ? distance(b.objective.at, foeCap) : 0;
      return da - db;
    });
    if (mode === 'division-rev') sorted.reverse();
    for (const d of sorted) for (const u of d.units) items.push({ u, div: d });
    items.push({ occupation: true });
  }

  // 逐次実行モード: ユニット1体分の行動が確定するたびに、未送信分を送る
  let flushed = 0;
  const flush = () => {
    if (!opts.onAction) return;
    for (; flushed < ctx.actions.length; flushed++) opts.onAction(ctx.actions[flushed]);
  };

  for (const item of items) {
    if (g.over) break;
    // 逐次実行モードでは、打ち切り(停止ボタン・期限)をユニット単位で確認する
    if (opts.stream && (opts.shouldStop?.() || (opts.deadlineMs !== undefined && Date.now() > opts.deadlineMs))) break;
    if ('occupation' in item) { actOccupation(ctx); flush(); continue; }
    const { u, div } = item;
    if (u.hp <= 0 || u.acted || u.carriedBy) continue;
    if (g.defs[u.kind].isSupply) actSupplyUnit(ctx, u, div);
    else actCombatUnit(ctx, u, div);
    flush();
  }

  // 最終フェーズ: 生産。戦闘結果(損害・撃破)が確定した盤面で、不足種別を選び直す
  if (!g.over) {
    const freshObjectives = opts.fixedObjective ? objectives : buildObjectives(g, side);
    const freshDivisions = buildDivisions(g, side, freshObjectives, commander, g.turn, scopeUnits ?? undefined);
    planProduction(ctx, freshDivisions);
  }
  flush();
  return { actions: ctx.actions, summary: ctx.summary };
}

/** 最終プランを実エンジンで1手ずつ再検証しながら実行する。検証に失敗した手は飛ばす */
export function executePlan(g: Game, side: Side, actions: AiAction[]): AiAction[] {
  const applied: AiAction[] = [];
  for (const a of actions) {
    if (g.over) break;
    if (a.type === 'produce') {
      const t = g.tiles.get(a.hex);
      if (t && canProduce(g, side, a.kind, t, true) && produce(g, side, a.kind, t, true)) applied.push(a);
    } else if (a.type === 'move') {
      const u = g.units[a.unit];
      const t = g.tiles.get(a.hex);
      if (!u || !t || u.hp <= 0 || u.acted || u.carriedBy) continue;
      const reach = reachable(g, u);
      const cost = reach.get(a.hex);
      if (cost === undefined) continue;
      moveUnit(g, u, t, cost);
      applied.push(a);
    } else if (a.type === 'attack') {
      const u = g.units[a.unit];
      const d = g.units[a.target];
      if (!u || !d || u.hp <= 0 || d.hp <= 0 || u.acted || u.carriedBy || d.carriedBy) continue;
      if (!canAttackTarget(g, u, d)) continue;
      attack(g, u, d);
      applied.push(a);
    } else if (a.type === 'board') {
      const inf = g.units[a.unit];
      const carrier = g.units[a.carrier];
      if (!inf || !carrier || inf.hp <= 0 || carrier.hp <= 0) continue;
      const cost = boardCostOf(g, inf, carrier);
      if (cost === null) continue;
      boardUnit(g, inf, carrier, cost);
      applied.push(a);
    } else if (a.type === 'disembark') {
      const carrier = g.units[a.carrier];
      const t = g.tiles.get(a.hex);
      if (!carrier || !t || carrier.hp <= 0) continue;
      if (disembarkUnit(g, carrier, t)) applied.push(a);
    } else if (a.type === 'confirm') {
      const u = g.units[a.unit];
      if (!u || u.hp <= 0 || u.acted || u.carriedBy) continue;
      confirmUnit(g, u);
      applied.push(a);
    }
  }
  return applied;
}

/** 搭乗コストの判定(executePlan 用に ctx から独立させたもの) */
function boardCostOf(g: Game, inf: Unit, carrier: Unit): number | null {
  if (!canBoard(g, inf, carrier)) return null;
  if (equals(inf, carrier)) return 0;
  const ct = tileAt(g, carrier);
  if (!ct) return null;
  const def = g.defs[inf.kind];
  const budget = g.settings.supply ? Math.min(def.move, inf.fuel) : def.move;
  const reach = reachable(g, inf);
  let best: number | null = null;
  for (const n of neighbors(carrier)) {
    const c = reach.get(key(n));
    if (c === undefined) continue;
    const total = c + moveCostOf(g, inf, ct);
    if (total <= budget && (best === null || total < best)) best = total;
  }
  return best;
}

/**
 * 1ターン分の思考と実行。複数の行動順を試し、最良のプランを実エンジンで再検証してから実行する。
 * 思考時間の上限を超えたら、それまでに得た最良プランで打つ(anytime性)
 */
export function playTurn(g: Game, side: Side, opts: PlanOptions = {}): PlanResult {
  const budgetMs = opts.budgetMs ?? 10_000;
  const commander = opts.personality ?? PERSONALITIES.balanced;
  const t0 = Date.now();
  const snap = snapshot(g);
  // 言語化: 作戦の概要を、計算に入る前に伝える
  const narrate = opts.onNarration;
  if (narrate) {
    const objectives = opts.fixedObjective
      ? [{ name: opts.fixedObjective.name }]
      : buildObjectives(g, side).filter((o) => o.kind === 'capture').slice(0, 3);
    const names = objectives.map((o) => o.name).join('、');
    narrate(`目標は ${names || '現状維持'} だ。`);
    const divisions = buildDivisions(g, side, opts.fixedObjective
      ? [{ kind: 'capture', at: opts.fixedObjective.at, name: opts.fixedObjective.name, town: null, airport: null, capital: false, value: 40, guard: 0, enemyCost: Infinity }]
      : buildObjectives(g, side), commander, g.turn);
    divisions.slice(0, 4).forEach((d, i) => {
      narrate(`第${i + 1}師団、${d.objective.name}方面。${d.units.length}部隊。`);
    });
  }
  const modes: OrderMode[] = ['priority', 'division', 'division-rev'];
  let best: { score: number; actions: AiAction[]; summary: string[] } | null = null;
  for (const mode of modes) {
    if (best && (Date.now() - t0 > budgetMs || opts.shouldStop?.())) break;
    restore(g, snap);
    const res = runAttempt(g, side, opts, commander, mode);
    const score = evaluateState(g, side);
    if (!best || score > best.score) best = { score, actions: res.actions, summary: res.summary };
    if (g.over) break;
  }
  restore(g, snap);
  const applied = executePlan(g, side, best?.actions ?? []);
  if (opts.onNarration && best) {
    const lines = [...new Set(best.summary)].slice(0, 5);
    for (const line of lines) opts.onNarration(`${line}。`);
  }
  return { actions: applied, summary: best?.summary ?? [] };
}
