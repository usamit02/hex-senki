/** 陣営: p = プレイヤー, e = 敵(CPU) */
export type Side = 'p' | 'e';

export type TerrainKind = 'plain' | 'forest' | 'mountain' | 'water';

/** キューブ座標。常に x + y + z = 0 が成り立つ(距離・隣接・回転の計算が簡単になる) */
export interface Cube {
  x: number;
  y: number;
  z: number;
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

/** マップJSONの1マス分 */
export interface HexData {
  id: number;
  col: number;
  row: number;
  /** 実際の地図上の位置(メートル) */
  center_x: number;
  center_y: number;
  terrain: string;
  road_score: number;
  river_score: number;
}

/** マップJSON(map1.json)の中身 */
export interface MapData {
  name?: string;
  hexes: HexData[];
  cities: Array<{ col: number; row: number; owner: Side | null; capital?: boolean }>;
  gold: Record<Side, number>;
  units: Array<{ side: Side; type: string; col: number; row: number }>;
}

export interface City {
  owner: Side | null;
  /** 首都ならその陣営、そうでなければ null */
  capital: Side | null;
}

export interface Tile extends Cube {
  terrain: TerrainKind;
  city: City | null;
  /** 以下はマップJSONの値。今後のCPU戦略で使えるよう保持する */
  id: number;
  geo: { x: number; y: number };
  roadScore: number;
  riverScore: number;
}

export interface Unit extends Cube {
  side: Side;
  kind: string;
  hp: number;
  moved: boolean;
  acted: boolean;
  /** 移動の取り消し用。移動前の位置と、移動先の城や村の元の持ち主 */
  from: { pos: Cube; cityOwner: Side | null } | null;
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
  /** 選択中の駒が移動できるマス(キーは座標のキー文字列、値は移動コスト) */
  reach: Map<string, number> | null;
}
