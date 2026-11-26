import { distance, equals, fromOffset, key, neighbors, pos } from './hex';
import { isTerrainKind } from './terrain';
import {
  MAX_MAP_COLS,
  MAX_MAP_ROWS,
  MAX_UNITS_PER_SIDE,
  DEFAULT_SETTINGS,
  type Cube,
  type Game,
  type Airport,
  type GameSettings,
  type LineData,
  type LineFeature,
  type MapData,
  type Side,
  type Tile,
  type Town,
  type Unit,
  type UnitDefs,
} from './types';

/** 収入: 占領済み towns(首都含む)の人口 INCOME_POPULATION_UNIT 人につき 1 gold(最低1/都市) */
export const INCOME_POPULATION_UNIT = 1000;
/** 生産対象になる占領 towns の範囲: 首都からこの距離(ヘックス数)以内にある towns */
export const PRODUCE_TOWN_RADIUS = 5;

/** towns の無い旧マップ用収入 */
export const BASE_INCOME = 3;
export const CITY_INCOME = 3;

export const tileAt = (g: Game, c: Cube): Tile | undefined => g.tiles.get(key(c));

export const unitAt = (g: Game, c: Cube): Unit | undefined =>
  g.units.find((u) => u.hp > 0 && !u.carriedBy && equals(u, c));

export const liveUnits = (g: Game, side: Side): Unit[] =>
  g.units.filter((u) => u.hp > 0 && u.side === side);

/** 首都のあるタイル(その陣営の首都として指定された towns のヘックス) */
export function capitalOf(g: Game, side: Side): Tile | null {
  for (const t of g.tiles.values()) if (t.city?.capital === side) return t;
  return null;
}

export const citiesOf = (g: Game, side: Side): Tile[] =>
  [...g.tiles.values()].filter((t) => t.city?.owner === side);

export const ownedTowns = (g: Game, side: Side): Town[] => g.towns.filter((t) => t.owner === side);

/** 1ターンの収入: 占領済み towns の人口に応じて増える */
export function income(g: Game, side: Side): number {
  let base: number;
  if (g.towns.length > 0) {
    base = ownedTowns(g, side).reduce(
      (sum, t) => sum + Math.max(1, Math.floor(t.population / INCOME_POPULATION_UNIT)),
      0,
    );
  } else {
    base = BASE_INCOME + CITY_INCOME * citiesOf(g, side).length;
  }
  return Math.round(base * (g.settings?.incomeMul ?? 1));
}

/** 武装の残弾を満タンにした状態を作る */
export function fullAmmo(g: { defs: UnitDefs }, kind: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const w of g.defs[kind].weapons) out[w.name] = w.ammo;
  return out;
}

/** ユニットの残弾と燃料を全回復する(補給ルールOFFなら何もしない) */
export function refillAmmo(g: Game, u: Unit): void {
  if (!g.settings?.supply) return;
  u.ammo = fullAmmo(g, u.kind);
  u.fuel = g.defs[u.kind].fuel;
}

/**
 * HP回復: 回復率(回復量/最大HP)に応じた生産コスト分の gold を消費する。
 * 燃料・弾薬の補給は無料。資金が足りなければ、買える分だけ部分回復する
 */
function healWithGold(g: Game, u: Unit, capHp: number): void {
  const def = g.defs[u.kind];
  const need = Math.min(def.hp, capHp) - u.hp;
  if (need <= 0) return;
  const affordable = Math.floor((g.gold[u.side] * def.hp) / def.cost); // 現在の資金で買えるHP量
  const heal = Math.min(need, Math.max(0, affordable));
  if (heal <= 0) return;
  const charge = Math.min(g.gold[u.side], Math.max(1, Math.round((heal * def.cost) / def.hp)));
  g.gold[u.side] -= charge;
  u.hp += heal;
}

/** 占領済み town 上にいる自軍ユニットは、残弾・燃料が全回復し、HPは gold を払って回復する */
export function resupplyOnOwnedTowns(g: Game, side: Side): void {
  // 補給可否と段階(tier)をユニットごとに判定する
  const plan = new Map<Unit, number>();
  for (const u of liveUnits(g, side)) {
    const def = g.defs[u.kind];
    const town = townAt(g, u);
    const airport = airportAt(g, u);
    const onOwnedTown = !!town && town.owner === side;
    // town と同一ヘックスの空港は空港として扱わない(town優先)
    const onOwnedAirport = !!airport && !town && airport.owner === side;
    // 戦闘機は空港でのみ補充。その他の航空(ヘリ等)は town でも空港でも可。地上は town のみ(空港では何も起きない)
    const canRefill = def.fighter
      ? onOwnedAirport
      : def.domain === 'air' ? (onOwnedTown || onOwnedAirport) : onOwnedTown;
    if (!canRefill) continue;
    // 補給の段階制(最難関ルール): village は燃料のみ、town は+弾薬、city と空港は+HP回復まで。
    // 段階制でない場合は従来どおり全て補充する
    let tier = 3;
    if (g.settings.supplyTiered && onOwnedTown && town) {
      tier = town.population >= 100000 ? 3 : town.population >= 10000 ? 2 : 1;
    }
    plan.set(u, tier);
  }
  // 燃料・弾薬は無料なので順不同で補充する
  for (const [u, tier] of plan) {
    const def = g.defs[u.kind];
    if (tier >= 1 && g.settings.supply) u.fuel = def.fuel;
    if (tier >= 2) refillAmmo(g, u); // refillAmmo は弾薬+燃料を満たす(補給OFF時は無効)
  }
  // HP回復は有料。資金不足で全回復できない場合は、搭載歩兵の回復を輸送側より優先する
  // (ただし歩兵のHPは輸送側の現在HPを越えられない)
  const healed = new Set<Unit>();
  const healCargoOf = (carrier: Unit): void => {
    for (const c of g.units) {
      if (c.carriedBy === carrier && c.hp > 0 && plan.get(c) === 3) healWithGold(g, c, carrier.hp);
    }
  };
  const healOne = (u: Unit): void => {
    if (healed.has(u) || plan.get(u) !== 3) return;
    healed.add(u);
    if (u.carriedBy) {
      healWithGold(g, u, u.carriedBy.hp);
    } else {
      healCargoOf(u); // 歩兵を先に回復する
      healWithGold(g, u, g.defs[u.kind].hp);
      healCargoOf(u); // 輸送側が回復して上限が上がったら、歩兵を追加で回復する
    }
  };
  for (const u of plan.keys()) healOne(u);
}

export const cheapestCost = (g: Game): number =>
  Math.min(...Object.values(g.defs).map((d) => d.cost));

/** 生産した直後の駒は、そのターンは動けない。各陣営100部隊が上限 */
export function spawn(g: Game, side: Side, kind: string, at: Cube): boolean {
  if (liveUnits(g, side).length >= (g.settings?.maxUnits ?? MAX_UNITS_PER_SIDE)) return false;
  g.units.push({
    x: at.x, y: at.y, z: at.z, side, kind, hp: g.defs[kind].hp, ammo: fullAmmo(g, kind), fuel: g.defs[kind].fuel, carriedBy: null, moved: true, acted: true, from: null,
  });
  return true;
}

function resolveLines(kind: LineFeature['kind'], lines: LineData[], tilesById: Map<number, Tile>): LineFeature[] {
  const out: LineFeature[] = [];
  for (const l of lines) {
    if (!Array.isArray(l.path)) continue;
    const tiles: Cube[] = [];
    for (const id of l.path) {
      const t = tilesById.get(id);
      if (t) tiles.push(pos(t));
    }
    if (tiles.length >= 2) out.push({ kind, name: l.name ?? '', path: [...l.path], tiles });
  }
  return out;
}

/** units.json と map.json / hex.json から、新しいゲームを作る */
export function createGame(defs: UnitDefs, map: MapData, settings: GameSettings = DEFAULT_SETTINGS): Game {
  if (!Array.isArray(map.hexes) || map.hexes.length === 0) throw new Error('hex.json: hexes が空です');
  // マップサイズは 128x128 に固定(AI演算の最適化のため)。データが不足する場合はエラーで終了する
  {
    let mc = 0;
    let mr = 0;
    const seen = new Set<string>();
    for (const h of map.hexes) {
      if (Number.isInteger(h.col) && Number.isInteger(h.row)) {
        mc = Math.max(mc, h.col + 1);
        mr = Math.max(mr, h.row + 1);
        seen.add(`${h.col},${h.row}`);
      }
    }
    const need = MAX_MAP_COLS * MAX_MAP_ROWS;
    if (mc !== MAX_MAP_COLS || mr !== MAX_MAP_ROWS || seen.size !== need) {
      throw new Error(
        `hex.json: マップサイズは ${MAX_MAP_COLS}x${MAX_MAP_ROWS} 固定です。データが不足しています(現在の範囲 ${mc}x${mr}、ヘックス ${seen.size}/${need} 件)。128x128 の hex.json を用意してください`,
      );
    }
  }

  const tiles = new Map<string, Tile>();
  const tilesById = new Map<number, Tile>();
  let maxCol = 0;
  let maxRow = 0;
  for (const h of map.hexes) {
    if (!Number.isInteger(h.col) || !Number.isInteger(h.row) || h.col < 0 || h.row < 0) {
      throw new Error(`hex.json: hex id=${h.id} の col / row が正しくありません`);
    }
    if (h.col >= MAX_MAP_COLS || h.row >= MAX_MAP_ROWS) {
      throw new Error(`hex.json: hex id=${h.id} (col=${h.col}, row=${h.row}) が上限 ${MAX_MAP_COLS}×${MAX_MAP_ROWS} を超えています`);
    }
    if (!isTerrainKind(h.terrain)) {
      throw new Error(
        `hex.json: hex id=${h.id} (col=${h.col}, row=${h.row}) の地形 "${h.terrain}" は未対応です(plain / forest / mountain / water / marsh / fill)`,
      );
    }
    const c = fromOffset(h.col, h.row);
    if (tiles.has(key(c))) throw new Error(`hex.json: col=${h.col}, row=${h.row} のマスが重複しています`);
    const tile: Tile = {
      x: c.x, y: c.y, z: c.z,
      terrain: h.terrain,
      city: null,
      id: h.id,
      col: h.col,
      row: h.row,
      geo: { x: h.center_x, y: h.center_y },
      roadScore: h.road_score,
      riverScore: h.river_score,
      airport: false,
      facility: false,
      hasRoad: false,
      hasRiver: false,
    };
    tiles.set(key(c), tile);
    tilesById.set(h.id, tile);
    maxCol = Math.max(maxCol, h.col);
    maxRow = Math.max(maxRow, h.row);
  }
  const width = maxCol + 1;
  const height = maxRow + 1;

  const tileAtOffset = (col: number, row: number): Tile => {
    const t = tiles.get(key(fromOffset(col, row)));
    if (!t) throw new Error(`map.json: 座標が範囲外です (col=${col}, row=${row})`);
    return t;
  };

  // towns を取り込む(初期状態は未占領)
  const towns: Town[] = [];
  for (const t of map.towns) {
    const tile = tilesById.get(t.hex_id);
    if (!tile) continue;
    tile.facility = true;
    towns.push({
      jiscode: t.jiscode,
      name: t.name,
      population: t.population,
      hexId: t.hex_id,
      at: pos(tile),
      col: tile.col,
      row: tile.row,
      owner: null,
      capital: null,
      airport: false,
    });
  }

  // 首都: map.json の citys で towns 名を指定する。その towns は開始時点で所有済みになる
  for (const side of ['p', 'e'] as Side[]) {
    const name = map.citys?.[side];
    if (!name) continue;
    const town = towns.find((t) => t.name === name);
    if (!town) {
      throw new Error(`map.json: citys の "${name}" が hex.json の towns に見つかりません`);
    }
    town.owner = side;
    town.capital = side;
    const tile = tilesById.get(town.hexId);
    if (tile) tile.city = { owner: side, capital: side };
  }

  // 空港: hex.json の airports(編集アプリが書き出す)から構築する
  const airports: Airport[] = [];
  for (const a of map.airports ?? []) {
    const tile = tilesById.get(a.hex_id);
    if (!tile) throw new Error(`hex.json: airports の "${a.name}" の hex_id=${a.hex_id} が hexes に見つかりません`);
    tile.airport = true;
    tile.facility = true;
    airports.push({ name: a.name, hexId: a.hex_id, at: { x: tile.x, y: tile.y, z: tile.z }, col: tile.col, row: tile.row, owner: null });
  }

  // 旧形式 cities(互換): citys が無い場合のみ使う
  if (!map.citys) {
    for (const c of map.cities ?? []) {
      const t = tileAtOffset(c.col, c.row);
      t.terrain = 'plain';
      t.city = { owner: c.owner, capital: c.capital ? c.owner : null };
    }
  }

  const counts: Record<Side, number> = { p: 0, e: 0 };
  const units: Unit[] = map.units.map((u) => {
    const def = defs[u.type];
    if (!def) throw new Error(`units.json に "${u.type}" がありません`);
    counts[u.side] += 1;
    if (counts[u.side] > MAX_UNITS_PER_SIDE) {
      throw new Error(`map.json: ${u.side === 'p' ? 'プレイヤー' : '敵'}の部隊数が上限 ${MAX_UNITS_PER_SIDE} を超えています`);
    }
    const t = tileAtOffset(u.col, u.row);
    return { x: t.x, y: t.y, z: t.z, side: u.side, kind: u.type, hp: def.hp, ammo: fullAmmo({ defs }, u.type), fuel: def.fuel, carriedBy: null, moved: false, acted: false, from: null };
  });

  // 道路・河川が描かれるヘックスのフラグ(移動コストの上書きと橋の判定に使う)
  for (const l of map.roads) for (const id of l.path) { const t = tilesById.get(id); if (t) t.hasRoad = true; }
  for (const l of map.rivers) for (const id of l.path) { const t = tilesById.get(id); if (t) t.hasRiver = true; }

  const game: Game = {
    defs, settings, delegations: [], width, height, tiles, tilesById, airports,
    roads: resolveLines('road', map.roads, tilesById),
    rivers: resolveLines('river', map.rivers, tilesById),
    towns,
    units,
    gold: { p: settings.gold ?? map.gold.p, e: settings.gold ?? map.gold.e },
    turn: 1,
    over: false,
    busy: false,
    message: 'あなたのターンです。右クリックで生産、自分の駒をクリックして移動・攻撃。',
    selected: null,
    selectedHex: null,
    reach: null,
    pendingCapture: null,
    pinnedInfo: null,
    pendingFx: null,
    pendingMoveSfx: null,
    fxSeq: 0,
  };
  return game;
}

/** そのヘックスを通る道路・河川(右クリック情報表示用) */
export function linesAt(g: Game, tile: Tile): LineFeature[] {
  const out: LineFeature[] = [];
  for (const l of [...g.roads, ...g.rivers]) {
    if (l.path.includes(tile.id)) out.push(l);
  }
  return out;
}

export function airportAt(g: Game, c: Cube): Airport | undefined {
  const t = tileAt(g, c);
  if (!t) return undefined;
  return g.airports.find((a) => a.hexId === t.id);
}

export function townAt(g: Game, c: Cube): Town | undefined {
  return g.towns.find((t) => equals(t.at, c));
}

/**
 * 生産できるヘックスの一覧(キー文字列の集合)。
 * - 首都(自陣営が所有中)のヘックスと、その隣接ヘックス
 * - 首都から PRODUCE_TOWN_RADIUS(5)ヘックス以内にある占領済み towns のヘックスそのもの
 *   (首都以外の占領 towns の隣接ヘックスは対象外。首都から遠い占領 towns も対象外)
 */
export function producibleHexKeys(g: Game, side: Side): Set<string> {
  const out = new Set<string>();
  const cap = capitalOf(g, side);
  if (cap && cap.city?.owner === side) {
    out.add(key(cap));
    for (const n of neighbors(cap)) {
      const t = tileAt(g, n);
      if (t) out.add(key(t));
    }
    for (const town of ownedTowns(g, side)) {
      if (distance(cap, town.at) <= PRODUCE_TOWN_RADIUS) out.add(key(town.at));
    }
  } else if (!cap) {
    // 首都の無い旧マップ用: 占領済み towns のヘックスのみ
    for (const town of ownedTowns(g, side)) out.add(key(town.at));
  }
  return out;
}
