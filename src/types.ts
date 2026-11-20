/** 陣営: p = プレイヤー, e = 敵(CPU) */
export type Side = 'p' | 'e';

export type TerrainKind = 'plain' | 'forest' | 'water';

export interface Coord {
  q: number;
  r: number;
}

/** units.json の1種類分の定義 */
export interface UnitDef {
  name: string;
  hp: number;
  move: number;
  attack: number;
  minRange: number;
  range: number;
  cost: number;
}
export type UnitDefs = Record<string, UnitDef>;

/** map.json の中身 */
export interface MapData {
  name?: string;
  terrain: string[];
  cities: Array<{ col: number; row: number; owner: Side | null; capital?: boolean }>;
  gold: Record<Side, number>;
  units: Array<{ side: Side; type: string; col: number; row: number }>;
}

export interface City {
  owner: Side | null;
  /** 首都ならその陣営、そうでなければ null */
  capital: Side | null;
}

export interface Tile extends Coord {
  terrain: TerrainKind;
  city: City | null;
}

export interface Unit extends Coord {
  side: Side;
  kind: string;
  hp: number;
  moved: boolean;
  acted: boolean;
  /** 移動の取り消し用。移動前の位置と、移動先の城や村の元の持ち主 */
  from: { q: number; r: number; cityOwner: Side | null } | null;
}

export interface Game {
  defs: UnitDefs;
  width: number;
  height: number;
  tiles: Map<string, Tile>;
  units: Unit[];
  gold: Record<Side, number>;
  turn: number;
  over: boolean;
  /** 敵のターン中など、プレイヤーが操作できない間 true */
  busy: boolean;
  message: string;
  selected: Unit | null;
  /** 選択中の駒が移動できるマス(キーは "q,r"、値は移動コスト) */
  reach: Map<string, number> | null;
}
