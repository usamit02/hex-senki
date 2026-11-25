import { distance, equals, fromOffset, key, neighbors, pos } from './hex';
import { isTerrainKind } from './terrain';
import {
  MAX_MAP_COLS,
  MAX_MAP_ROWS,
  MAX_UNITS_PER_SIDE,
  DEFAULT_SETTINGS,
  type Cube,
  type Game,
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
  g.units.find((u) => u.hp > 0 && equals(u, c));

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

/** ユニットの残弾を全回復する(補給ルールOFFなら何もしない) */
export function refillAmmo(g: Game, u: Unit): void {
  if (!g.settings?.supply) return;
  u.ammo = fullAmmo(g, u.kind);
}

/** 占領済み town 上にいる自軍ユニットは、HPと残弾が全回復する */
export function resupplyOnOwnedTowns(g: Game, side: Side): void {
  for (const u of liveUnits(g, side)) {
    const town = townAt(g, u);
    if (town && town.owner === side) {
      u.hp = g.defs[u.kind].hp;
      refillAmmo(g, u);
    }
  }
}

export const cheapestCost = (g: Game): number =>
  Math.min(...Object.values(g.defs).map((d) => d.cost));

/** 生産した直後の駒は、そのターンは動けない。各陣営100部隊が上限 */
export function spawn(g: Game, side: Side, kind: string, at: Cube): boolean {
  if (liveUnits(g, side).length >= (g.settings?.maxUnits ?? MAX_UNITS_PER_SIDE)) return false;
  g.units.push({
    x: at.x, y: at.y, z: at.z, side, kind, hp: g.defs[kind].hp, ammo: fullAmmo(g, kind), moved: true, acted: true, from: null,
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
        `hex.json: hex id=${h.id} (col=${h.col}, row=${h.row}) の地形 "${h.terrain}" は未対応です(plain / forest / mountain / water / marsh)`,
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
    return { x: t.x, y: t.y, z: t.z, side: u.side, kind: u.type, hp: def.hp, ammo: fullAmmo({ defs }, u.type), moved: false, acted: false, from: null };
  });

  const game: Game = {
    defs, settings, width, height, tiles, tilesById,
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
