import { distance, equals, key, neighbors } from '../hex';
import {
  attack, boardUnit, canAttackTarget, canBoard, canProduce, cargoList, confirmUnit,
  disembarkUnit, hasLongRangeWeapon, moveCostOf, moveUnit, pickWeapon, calcDamage,
  produce, reachable,
} from '../rules';
import {
  airportAt, capitalOf, liveUnits, producibleHexKeys, tileAt, townAt, unitAt,
} from '../state';
import { TERRAINS } from '../terrain';
import type { Airport, Cube, Game, Side, Tile, Town, Unit } from '../types';

/**
 * 新CPU AI(師団方式)。
 * - 戦略層: 占領/防御目標を決め、ユニットを位置関係で師団に振り分け、カウンター編成で不足を判断して生産する
 * - 戦術層: 順序付き行動リストを実エンジンに適用しながら1体ずつ決める(撃破で開いたマスは次のユニットの経路探索に反映される)
 * - 複数の行動順を試し、最も評価の高いプランを残す。最後に実エンジンで再検証しながら実行する
 * - 歩兵・トラックは師団と別行動の占領専門。補給車は師団に混ぜる
 */

export type AiAction =
  | { type: 'produce'; kind: string; hex: string }
  | { type: 'move'; unit: number; hex: string }
  | { type: 'attack'; unit: number; target: number }
  | { type: 'board'; unit: number; carrier: number }
  | { type: 'disembark'; carrier: number; hex: string }
  | { type: 'confirm'; unit: number };

/** 司令官の性格。評価関数の重みとして効く(ルールは変えない) */
export interface Personality {
  name: string;
  /** 攻撃性: 与ダメージ・撃破の評価を上げる */
  aggression: number;
  /** 防御性: 被弾リスクと地形防御の評価を上げる */
  defense: number;
  /** 補給意識: 修理後退と補給の評価を上げる */
  supply: number;
  /** リスク許容: 脅威下への前進を許す */
  risk: number;
  /** 修理優先度: 修理対象とするHPラインを上げる */
  repair: number;
}

export const PERSONALITIES: Record<string, Personality> = {
  balanced: { name: 'バランス型', aggression: 1, defense: 1, supply: 1, risk: 1, repair: 1 },
  aggressive: { name: '好戦的', aggression: 1.5, defense: 0.7, supply: 0.8, risk: 1.3, repair: 0.7 },
  supply: { name: '補給重視', aggression: 0.8, defense: 1, supply: 1.6, risk: 0.8, repair: 1.6 },
  defensive: { name: '守り重視', aggression: 0.6, defense: 1.6, supply: 1.1, risk: 0.6, repair: 1.2 },
  tricky: { name: '奇策好き', aggression: 1.1, defense: 0.9, supply: 0.9, risk: 1.5, repair: 0.9 },
  careless: { name: 'そそっかしい', aggression: 1, defense: 1, supply: 0.7, risk: 1.2, repair: 0.6 },
};
const DIVISION_COMMANDERS = ['balanced', 'aggressive', 'defensive', 'supply', 'tricky', 'careless'];

export interface PlanOptions {
  /** 思考時間の上限(ms)。打ち切りラインは事前に決めておき、プレイヤーは介入できない */
  budgetMs?: number;
  /** 総司令の性格 */
  personality?: Personality;
  /** プレイヤー側委任かどうか(委任は生産しない) */
  delegated?: boolean;
  seed?: number;
  /** 委任時: 行動できるユニットの制限(g.units のインデックス)。師団長とその近くの未行動ユニットだけが動く */
  scopeIndices?: number[];
  /** 委任時: プレイヤーが決めた目標 */
  fixedObjective?: { at: Cube; name: string };
  /** 思考の言語化(字幕ログ・VOICEVOX 用)。作戦の節目で呼ばれる */
  onNarration?: (line: string) => void;
  /** プレイヤー側委任の「もう打ってよい」。true を返したら最良プランで打ち切る */
  shouldStop?: () => boolean;
}

export interface PlanResult {
  actions: AiAction[];
  /** 言語化用の要約(どの街を狙い、何を撃破したか) */
  summary: string[];
}

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

function buildObjectives(g: Game, side: Side): Objective[] {
  const foe = foeOf(side);
  const out: Objective[] = [];
  // 防御目標: 敵が近づいている自軍の town・空港(首都を含む)。脅威が無い拠点は防御目標にしない
  for (const t of g.towns) {
    if (t.owner !== side) continue;
    const threatened = liveUnits(g, foe).some((e) => !e.carriedBy && distance(e, t.at) <= 8);
    if (threatened) {
      out.push({ kind: 'defend', at: t.at, name: t.name, town: t, airport: null, capital: t.capital === side });
    }
  }
  for (const a of g.airports) {
    if (a.owner !== side) continue;
    if (liveUnits(g, foe).some((e) => !e.carriedBy && distance(e, a.at) <= 8)) {
      out.push({ kind: 'defend', at: a.at, name: a.name, town: null, airport: a, capital: false });
    }
  }
  // 占領目標: 未占領・敵の town と空港
  for (const t of g.towns) {
    if (t.owner === side) continue;
    out.push({ kind: 'capture', at: t.at, name: t.name, town: t, airport: null, capital: t.capital === foe });
  }
  for (const a of g.airports) {
    if (a.owner === side) continue;
    out.push({ kind: 'capture', at: a.at, name: a.name, town: null, airport: a, capital: false });
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
    let bestObj: Objective | null = null;
    let bestDist = Infinity;
    for (const o of objectives) {
      const d = distance(u, o.at) - (o.kind === 'defend' ? 2 : 0); // 防御目標は少し優先
      if (d < bestDist) { bestDist = d; bestObj = o; }
    }
    if (bestObj) getDiv(bestObj).units.push(u);
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
      const haveCount = d.units.filter((u) => u.kind === kind).length;
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
  let threat = 0;
  for (const e of liveUnits(g, foe)) {
    if (e.carriedBy) continue;
    const ed = g.defs[e.kind];
    if (ed.weapons.length === 0) continue;
    const maxRange = Math.max(...ed.weapons.map((w) => w.range));
    if (distance(e, at) > ed.move + maxRange) continue;
    let best = 0;
    for (const w of ed.weapons) best = Math.max(best, w.power * (w.vs?.[myDef.category] ?? 1));
    threat += Math.max(0, Math.round(best) - (myDef.defense + terrainDef));
  }
  return threat;
}

/** 盤面全体の自軍視点スコア(プラン同士の比較用) */
function evaluateState(g: Game, side: Side): number {
  const foe = foeOf(side);
  let score = 0;
  for (const u of liveUnits(g, side)) score += g.defs[u.kind].cost * (u.hp / g.defs[u.kind].hp);
  for (const u of liveUnits(g, foe)) score -= g.defs[u.kind].cost * (u.hp / g.defs[u.kind].hp);
  score += g.towns.filter((t) => t.owner === side).length * 60;
  score -= g.towns.filter((t) => t.owner === foe).length * 60;
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

  // 攻撃候補(現在位置から/移動後から)。長射程兵器は移動前しか撃てない
  const evalAttack = (dest: Tile, cost: number, target: Unit): number => {
    const w = pickWeapon(g, u, target);
    if (!w) return -Infinity;
    // 移動後の攻撃可否とダメージは位置で変わらない(ダメージは防御側の地形のみ依存)ため、現在位置基準で計算する
    const dmg = calcDamage(g, u, target, w);
    const tDef = g.defs[target.kind];
    let score = dmg * (tDef.cost / tDef.hp) * personality.aggression;
    if (target.hp - dmg <= 0) score += tDef.cost * 0.6 * personality.aggression; // 撃破ボーナス
    if (target.hp - dmg > 0) {
      const counter = approxCounter(g, target, u, dest);
      score -= counter * (def.cost / def.hp) * personality.defense;
    }
    score -= threatAt(g, side, dest, u.kind) * (def.cost / def.hp) * 0.4 * personality.defense / personality.risk;
    if (!fuelSafeAfter(ctx, u, dest, cost)) return -Infinity;
    return score;
  };
  for (const f of foes) {
    if (canAttackTarget(g, u, f)) {
      const s = evalAttack(myTile, 0, f);
      if (s > -Infinity) cands.push({ score: s + 0.01, dest: null, cost: 0, target: f });
    }
  }
  if (!hasLongRangeWeapon(g, u)) {
    for (const [k, cost] of reach) {
      const t = g.tiles.get(k);
      if (!t || equals(t, u)) continue;
      if (blocksCapture(g, side, t)) continue; // 占領用ヘックスは歩兵のために空ける
      for (const f of foes) {
        const d = distance(t, f);
        const inBand = def.weapons.some((w) => d >= w.minRange && d <= w.range && (!g.settings.supply || w.ammo < 0 || (u.ammo[w.name] ?? 0) > 0));
        if (!inBand) continue;
        const s = evalAttack(t, cost, f);
        if (s > -Infinity) cands.push({ score: s, dest: t, cost, target: f });
      }
    }
  }

  const canKill = cands.some((c) => c.target && c.target.hp - (pickWeapon(g, u, c.target) ? calcDamage(g, u, c.target, pickWeapon(g, u, c.target)!) : 0) <= 0);

  // 修理後退: HPラインを割り、撃破できる相手もいなければ補給地点へ下がる
  const hpFrac = u.hp / def.hp;
  if (!canKill && hpFrac < repairThreshold(ctx, u, div) && !isResupplyHex(g, side, u, myTile)) {
    if (moveTowardResupply(ctx, u)) {
      if (!u.acted) { ctx.actions.push({ type: 'confirm', unit: idxOf(g, u) }); confirmUnit(g, u); }
      return;
    }
  }

  // 前進候補(師団目標へ。実移動コストの減少で評価する)
  if (objective) {
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
      score -= threatAt(g, side, t, u.kind) * (def.cost / def.hp) * 0.4 * personality.defense / personality.risk;
      if (g.settings.supply && def.domain !== 'air' && u.fuel - cost <= 0 && !isResupplyHex(g, side, u, t)) score -= 5;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    if (best) cands.push({ score: bestScore, dest: best, cost: reach.get(key(best)) ?? 0, target: null });
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
    if (before > 0 && chosen.target.hp <= 0) ctx.summary.push(`${g.defs[chosen.target.kind].name}を撃破`);
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

/** 搭載中の輸送ユニット(トラック・ヘリ共通): 占領目標の town へ運び、隣接したら降車させる */
function actLoadedCarrier(ctx: Ctx, u: Unit): void {
  const { g } = ctx;
  const cargo = cargoList(g, u)[0];
  if (!cargo) return;
  const obj = nearestCaptureObjective(ctx, cargo);
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
  moveTowardPoint(ctx, u, obj.at, ctx.commander);
  if (!u.acted) { ctx.actions.push({ type: 'confirm', unit: idxOf(g, u) }); confirmUnit(g, u); }
}

function nearestCaptureObjective(ctx: Ctx, from: Cube): Objective | null {
  let best: Objective | null = null;
  let bestDist = Infinity;
  for (const o of ctx.objectives) {
    if (o.kind !== 'capture') continue;
    const d = distance(from, o.at) - (o.capital ? 3 : 0);
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
  const obj = nearestCaptureObjective(ctx, inf);
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

  for (const inf of infantries) {
    if (inf.acted || inf.hp <= 0) continue;
    const obj = nearestCaptureObjective(ctx, inf);
    if (!obj) { ctx.actions.push({ type: 'confirm', unit: idxOf(g, inf) }); confirmUnit(g, inf); continue; }
    const reach = reachable(g, inf);
    const objTile = tileAt(g, obj.at);
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
      moveTowardPoint(ctx, inf, obj.at, ctx.commander);
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
    // 搭乗できない場合は輸送ユニットへ近づく
    if (sorted.length > 0) moveTowardPoint(ctx, inf, sorted[0], ctx.commander);
    else moveTowardPoint(ctx, inf, obj.at, ctx.commander);
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
function planProduction(ctx: Ctx): void {
  const { g, side } = ctx;
  if (ctx.delegated) return; // 生産は委任できない
  if (!g.settings.production) return;
  const cap = capitalOf(g, side);
  for (let iter = 0; iter < 12; iter++) {
    if (liveUnits(g, side).length >= g.settings.maxUnits) return;
    // 欲しい種を決める: 占領役が不在なら歩兵 → 師団の不足(カウンター編成) → 汎用
    let kind: string | null = null;
    let forDiv: Division | null = null;
    const capturers = liveUnits(g, side).filter((u) => g.defs[u.kind].canCapture);
    const infantryKind = Object.keys(g.defs).find((k) => g.defs[k].canCapture);
    if (capturers.length === 0 && infantryKind) kind = infantryKind;
    if (!kind) {
      const divs = [...ctx.divisions].sort((a, b) => a.deficits.length - b.deficits.length);
      for (const d of divs) {
        if (d.deficits.length > 0) { kind = d.deficits[0]; forDiv = d; break; }
      }
    }
    if (!kind) {
      // 敵に航空がいて対空が薄い場合はカウンターを、なければ歩兵で占領を広げる
      const foeHasAir = liveUnits(g, ctx.foe).some((u) => g.defs[u.kind].domain === 'air');
      const airCat = liveUnits(g, ctx.foe).find((u) => g.defs[u.kind].domain === 'air');
      if (foeHasAir && airCat) kind = counterKindFor(g, g.defs[airCat.kind].category);
      if (!kind && infantryKind && capturers.length < 3) kind = infantryKind;
      if (!kind) {
        const combat = Object.keys(g.defs).filter((k) => !g.defs[k].canCapture && (g.defs[k].transport ?? 0) === 0 && !g.defs[k].isSupply && g.defs[k].weapons.length > 0);
        kind = combat.sort((a, b) => g.defs[a].cost - g.defs[b].cost)[0] ?? null;
      }
    }
    if (!kind || g.defs[kind].cost > g.gold[side]) return;
    // 生産ヘックス: 対象師団の目標(なければ首都)に最も近い生産可能ヘックス
    const target: Cube = forDiv?.objective.at ?? cap ?? { x: 0, y: 0, z: 0 };
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
    // 生産した分、師団の不足を1つ解消したものとする
    if (forDiv) forDiv.deficits.shift();
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
    actions: [], summary: [], rng, delegated: !!opts.delegated, scopeUnits, costCache: new Map(),
  };

  planProduction(ctx);

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

  for (const item of items) {
    if (g.over) break;
    if ('occupation' in item) { actOccupation(ctx); continue; }
    const { u, div } = item;
    if (u.hp <= 0 || u.acted || u.carriedBy) continue;
    if (g.defs[u.kind].isSupply) actSupplyUnit(ctx, u, div);
    else actCombatUnit(ctx, u, div);
  }
  return { actions: ctx.actions, summary: ctx.summary };
}

/** 最終プランを実エンジンで1手ずつ再検証しながら実行する。検証に失敗した手は飛ばす */
export function executePlan(g: Game, side: Side, actions: AiAction[]): AiAction[] {
  const applied: AiAction[] = [];
  for (const a of actions) {
    if (g.over) break;
    if (a.type === 'produce') {
      const t = g.tiles.get(a.hex);
      if (t && canProduce(g, side, a.kind, t) && produce(g, side, a.kind, t)) applied.push(a);
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
    narrate(`第${g.turn}ターン作戦会議(${commander.name}): 目標は ${names || '現状維持'} だ。`);
    const divisions = buildDivisions(g, side, opts.fixedObjective
      ? [{ kind: 'capture', at: opts.fixedObjective.at, name: opts.fixedObjective.name, town: null, airport: null, capital: false }]
      : buildObjectives(g, side), commander, g.turn);
    divisions.slice(0, 4).forEach((d, i) => {
      narrate(`第${i + 1}師団(${d.personality.name}): ${d.objective.name}方面を担当、${d.units.length}部隊。`);
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
    const lines = [...new Set(best.summary)].slice(0, 4);
    for (const line of lines) opts.onNarration(`戦況: ${line}。`);
  }
  return { actions: applied, summary: best?.summary ?? [] };
}
