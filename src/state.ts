import { equals, fromOffset, key } from './hex';
import type { Cube, Game, MapData, Side, Tile, TerrainKind, Unit, UnitDefs } from './types';

export const BASE_INCOME = 3;
export const CITY_INCOME = 3;

const TERRAIN_CHARS: Record<string, TerrainKind> = { '.': 'plain', F: 'forest', W: 'water' };

export const tileAt = (g: Game, c: Cube): Tile | undefined => g.tiles.get(key(c));

export const unitAt = (g: Game, c: Cube): Unit | undefined =>
  g.units.find((u) => u.hp > 0 && equals(u, c));

export const liveUnits = (g: Game, side: Side): Unit[] =>
  g.units.filter((u) => u.hp > 0 && u.side === side);

export function capitalOf(g: Game, side: Side): Tile {
  for (const t of g.tiles.values()) if (t.city?.capital === side) return t;
  throw new Error(`map.json に ${side === 'p' ? 'プレイヤー' : '敵'}の首都がありません`);
}

export const citiesOf = (g: Game, side: Side): Tile[] =>
  [...g.tiles.values()].filter((t) => t.city?.owner === side);

export const income = (g: Game, side: Side): number =>
  BASE_INCOME + CITY_INCOME * citiesOf(g, side).length;

export const cheapestCost = (g: Game): number =>
  Math.min(...Object.values(g.defs).map((d) => d.cost));

/** 雇った直後の駒は、そのターンは動けない */
export function spawn(g: Game, side: Side, kind: string, at: Cube): void {
  g.units.push({
    x: at.x, y: at.y, z: at.z, side, kind, hp: g.defs[kind].hp, moved: true, acted: true, from: null,
  });
}

/** units.json と map.json から、新しいゲームを作る */
export function createGame(defs: UnitDefs, map: MapData): Game {
  const height = map.terrain.length;
  const width = map.terrain[0]?.length ?? 0;
  if (height === 0 || width === 0) throw new Error('map.json: terrain が空です');

  const tiles = new Map<string, Tile>();
  map.terrain.forEach((row, r) => {
    if (row.length !== width) throw new Error(`map.json: terrain の${r + 1}行目の長さが違います`);
    for (let i = 0; i < width; i++) {
      const c = fromOffset(i, r);
      tiles.set(key(c), { x: c.x, y: c.y, z: c.z, terrain: TERRAIN_CHARS[row[i]] ?? 'plain', city: null });
    }
  });

  const tileAtOffset = (col: number, row: number): Tile => {
    const t = tiles.get(key(fromOffset(col, row)));
    if (!t) throw new Error(`map.json: 座標が範囲外です (col=${col}, row=${row})`);
    return t;
  };

  for (const c of map.cities) {
    const t = tileAtOffset(c.col, c.row);
    t.terrain = 'plain';
    t.city = { owner: c.owner, capital: c.capital ? c.owner : null };
  }

  const units: Unit[] = map.units.map((u) => {
    const def = defs[u.type];
    if (!def) throw new Error(`units.json に "${u.type}" がありません`);
    const t = tileAtOffset(u.col, u.row);
    return { x: t.x, y: t.y, z: t.z, side: u.side, kind: u.type, hp: def.hp, moved: false, acted: false, from: null };
  });

  const game: Game = {
    defs, width, height, tiles, units,
    gold: { p: map.gold.p, e: map.gold.e },
    turn: 1,
    over: false,
    busy: false,
    message: 'あなたのターンです。自分の駒をタップしてください。',
    selected: null,
    reach: null,
  };
  capitalOf(game, 'p');
  capitalOf(game, 'e');
  return game;
}
