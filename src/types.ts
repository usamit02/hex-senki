/** 陣営: p = プレイヤー, e = 敵(CPU) */
export type Side = 'p' | 'e';

export type TerrainKind = 'plain' | 'forest' | 'mountain' | 'water' | 'marsh';

/** 要件1: マップ上限と部隊上限 */
export const MAX_MAP_COLS = 100;
export const MAX_MAP_ROWS = 100;
export const MAX_UNITS_PER_SIDE = 100;

/** ユニットの移動区分: 地上は地形の影響を受け、航空は受けない */
export type Domain = 'ground' | 'air';

/** 相性(3すくみ等)の区分。vs のキーになる */
export type Category = 'tank' | 'sam' | 'jet' | 'heli' | 'infantry';
export const CATEGORIES: readonly Category[] = ['tank', 'sam', 'jet', 'heli', 'infantry'];

/** キューブ座標。常に x + y + z = 0 が成り立つ */
export interface Cube {
  x: number;
  y: number;
  z: number;
}

/** units.json の1種類分の定義 */
export interface UnitDef {
  name: string;
  /** 盤面の駒に表示する短い文字 */
  short: string;
  hp: number;
  move: number;
  attack: number;
  /** 防御力(受けるダメージから差し引く) */
  defense: number;
  minRange: number;
  range: number;
  cost: number;
  domain: Domain;
  category: Category;
  /** 対応する3Dモデル(unit_models のファイル名の元: tank / sam / jet / heli / infantry) */
  model: string;
  /** towns を占領できるか(歩兵のみ true) */
  canCapture: boolean;
  /** 相手カテゴリごとの攻撃倍率(3すくみ: 戦車>対空ミサイル>飛行機>戦車) */
  vs: Record<Category, number>;
}
export type UnitDefs = Record<string, UnitDef>;

/** hex.json の1マス分 */
export interface HexData {
  id: number;
  col: number;
  row: number;
  center_x: number;
  center_y: number;
  terrain: string;
  road_score: number;
  river_score: number;
}

/** hex.json の道路・河川1件分。path は hex id の並び */
export interface LineData {
  name: string;
  path: number[];
}

/** hex.json の towns 1件分(編集アプリの保存形式) */
export interface TownData {
  jiscode: string;
  name: string;
  population: number;
  hex_id: number;
  members?: string[];
}

/** hex.json の中身 */
export interface HexMapData {
  settings?: {
    hex_diameter_km?: number;
    road_min_hex_count?: number;
    river_min_hex_count?: number;
  };
  hexes: HexData[];
  roads?: LineData[];
  rivers?: LineData[];
  towns?: TownData[];
}

/** map.json の中身(初期配置)。citys は首都にする towns の名前 */
export interface MapConfig {
  name?: string;
  terrain?: Record<string, string>;
  /** 首都: 陣営ごとに towns の名前で指定する(例: { "p": "滝川市", "e": "伊達市" }) */
  citys?: Partial<Record<Side, string>>;
  /** 旧形式の城/村配置(互換用) */
  cities?: Array<{ col: number; row: number; owner: Side | null; capital?: boolean }>;
  gold: Record<Side, number>;
  units: Array<{ side: Side; type: string; col: number; row: number }>;
}

/** 読み込み後のマップデータ(map.json + hex.json を結合) */
export interface MapData extends MapConfig {
  hexes: HexData[];
  roads: LineData[];
  rivers: LineData[];
  towns: TownData[];
}

export interface City {
  owner: Side | null;
  capital: Side | null;
}

export interface Tile extends Cube {
  terrain: TerrainKind;
  city: City | null;
  id: number;
  col: number;
  row: number;
  geo: { x: number; y: number };
  roadScore: number;
  riverScore: number;
}

/** ゲーム内に取り込んだ都市(hex.json towns 由来)。占領で owner が変わる */
export interface Town {
  jiscode: string;
  name: string;
  population: number;
  hexId: number;
  at: Cube;
  col: number;
  row: number;
  owner: Side | null;
  /** 首都ならその陣営(開始時の指定)。占領されても「どちらの首都か」は変わらない */
  capital: Side | null;
}

/** ゲーム内に取り込んだ道路・河川 */
export interface LineFeature {
  kind: 'road' | 'river';
  name: string;
  path: number[];
  tiles: Cube[];
}

export interface Unit extends Cube {
  side: Side;
  kind: string;
  hp: number;
  moved: boolean;
  acted: boolean;
  /** 移動取り消し用: 移動前の位置と、移動先の拠点・towns の元の持ち主 */
  from: { pos: Cube; cityOwner: Side | null; townHexId: number | null; townOwner: Side | null } | null;
}

export interface Game {
  defs: UnitDefs;
  width: number;
  height: number;
  tiles: Map<string, Tile>;
  tilesById: Map<number, Tile>;
  roads: LineFeature[];
  rivers: LineFeature[];
  towns: Town[];
  units: Unit[];
  gold: Record<Side, number>;
  turn: number;
  over: boolean;
  busy: boolean;
  message: string;
  selected: Unit | null;
  /** 左クリックで選択中のヘックス(ユニットの有無によらず保持する) */
  selectedHex: Tile | null;
  reach: Map<string, number> | null;
}
