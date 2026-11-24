import { equals, fromOffset, key, pos } from './hex';
import { isTerrainKind } from './terrain';
import {
  MAX_MAP_COLS,
  MAX_MAP_ROWS,
  MAX_UNITS_PER_SIDE,
  type Cube,
  type Game,
  type LineData,
  type LineFeature,
  type MapData,
  type Side,
  type Tile,
  type Town,
  type Unit,
  type UnitDefs,
} from './types';

export const BASE_INCOME = 3;
export const CITY_INCOME = 3;

export const tileAt = (g: Game, c: Cube): Tile | undefined => g.tiles.get(key(c));

export const unitAt = (g: Game, c: Cube): Unit | undefined =>
  g.units.find((u) => u.hp > 0 && equals(u, c));

export const liveUnits = (g: Game, side: Side): Unit[] =>
  g.units.filter((u) => u.hp > 0 && u.side === side);

/** 首都のあるタイル。cities の無いマップ(map.json に都市配置が無い場合)は null */
export function capitalOf(g: Game, side: Side): Tile | null {
  for (const t of g.tiles.values()) if (t.city?.capital === side) return t;
  return null;
}

export const hasCapital = (g: Game, side: Side): boolean => capitalOf(g, side) !== null;

export const citiesOf = (g: Game, side: Side): Tile[] =>
  [...g.tiles.values()].filter((t) => t.city?.owner === side);

export const income = (g: Game, side: Side): number =>
  BASE_INCOME + CITY_INCOME * citiesOf(g, side).length;

export const cheapestCost = (g: Game): number =>
  Math.min(...Object.values(g.defs).map((d) => d.cost));

/** 雇った直後の駒は、そのターンは動けない。要件1: 各陣営100部隊が上限 */
export function spawn(g: Game, side: Side, kind: string, at: Cube): boolean {
  if (liveUnits(g, side).length >= MAX_UNITS_PER_SIDE) return false;
  g.units.push({
    x: at.x, y: at.y, z: at.z, side, kind, hp: g.defs[kind].hp, moved: true, acted: true, from: null,
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
export function createGame(defs: UnitDefs, map: MapData): Game {
  if (!Array.isArray(map.hexes) || map.hexes.length === 0) throw new Error('hex.json: hexes が空です');

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

  for (const c of map.cities ?? []) {
    const t = tileAtOffset(c.col, c.row);
    t.terrain = 'plain';
    t.city = { owner: c.owner, capital: c.capital ? c.owner : null };
  }

  // 要件5: 都市は hex.json の towns から取り込む(ヘックス中央にアイコン表示)
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
    });
  }

  // 要件1: 初期配置も各陣営100部隊まで
  const counts: Record<Side, number> = { p: 0, e: 0 };
  const units: Unit[] = map.units.map((u) => {
    const def = defs[u.type];
    if (!def) throw new Error(`units.json に "${u.type}" がありません`);
    counts[u.side] += 1;
    if (counts[u.side] > MAX_UNITS_PER_SIDE) {
      throw new Error(`map.json: ${u.side === 'p' ? 'プレイヤー' : '敵'}の部隊数が上限 ${MAX_UNITS_PER_SIDE} を超えています`);
    }
    const t = tileAtOffset(u.col, u.row);
    return { x: t.x, y: t.y, z: t.z, side: u.side, kind: u.type, hp: def.hp, moved: false, acted: false, from: null };
  });

  const game: Game = {
    defs, width, height, tiles, tilesById,
    roads: resolveLines('road', map.roads, tilesById),
    rivers: resolveLines('river', map.rivers, tilesById),
    towns,
    units,
    gold: { p: map.gold.p, e: map.gold.e },
    turn: 1,
    over: false,
    busy: false,
    message: 'あなたのターンです。自分の駒をクリックしてください。',
    selected: null,
    reach: null,
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
