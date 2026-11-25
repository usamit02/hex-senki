/** 陣営: p = プレイヤー, e = 敵(CPU) */
export type Side = 'p' | 'e';

export type TerrainKind = 'plain' | 'forest' | 'mountain' | 'water' | 'marsh' | 'fill';

/** 要件1: マップ上限と部隊上限 */
export const MAX_MAP_COLS = 128;
export const MAX_MAP_ROWS = 128;
export const MAX_UNITS_PER_SIDE = 100;

/** ユニットの移動区分: 地上は地形の影響を受け、航空は受けない */
export type Domain = 'ground' | 'air';

/** 相性(3すくみ等)の区分。テーマごとに異なる文字列で、vs のキーになる */
export type Category = string;

/** キューブ座標。常に x + y + z = 0 が成り立つ */
export interface Cube {
  x: number;
  y: number;
  z: number;
}

/** 武装1種分。残弾はユニットごとに管理し、0になるとその武装は使えない(ammo: -1 は無制限) */
export interface WeaponDef {
  name: string;
  /** 攻撃力 */
  power: number;
  minRange: number;
  range: number;
  /** 最大残弾。-1 は無制限 */
  ammo: number;
  /** 相手カテゴリごとの攻撃倍率(省略時は 1) */
  vs?: Record<string, number>;
  /** 攻撃効果音の種類(sfx.ts のキー) */
  sfx: string;
}

/** ユニット1種類分の定義(テーマごとに themes.ts で定義) */
export interface UnitDef {
  name: string;
  /** 盤面の駒に表示する短い文字 */
  short: string;
  hp: number;
  move: number;
  /** 防御力(受けるダメージから差し引く) */
  defense: number;
  cost: number;
  domain: Domain;
  category: Category;
  /** 対応する3Dモデル(現代テーマのみ: tank / sam / jet / heli / infantry / supply) */
  model: string;
  /** towns を占領できるか */
  canCapture: boolean;
  /** 補給ユニットか(隣接した味方の残弾・燃料を回復する) */
  isSupply?: boolean;
  /** 最大燃料。移動コストの合計がこの範囲まで動ける */
  fuel: number;
  /** 戦闘機タイプ: 生産・補充・補給は空港でのみ可能(航空ユニット用) */
  fighter?: boolean;
  /** 輸送ユニット: 歩兵を1体搭乗させられる(トラック・ヘリなど) */
  transport?: boolean;
  /** 武装(複数可)。空なら攻撃できない */
  weapons: WeaponDef[];
  /** 移動効果音の種類(sfx.ts のキー) */
  moveSfx: string;
  /** 地形ごとの移動コスト上書き(テーマ・兵種固有の移動パターン) */
  terrainCosts?: Partial<Record<TerrainKind, number>>;
}
export type UnitDefs = Record<string, UnitDef>;

/** テーマ(舞台設定)のID */
export type ThemeId = 'modern' | 'fantasy' | 'sengoku' | 'robot';

/** ゲーム設定画面で決める条件 */
export interface GameSettings {
  theme: ThemeId;
  /** 初期資金(null なら map.json の値) */
  gold: number | null;
  /** 収入倍率 */
  incomeMul: number;
  /** 部隊上限 */
  maxUnits: number;
  /** ZOC(敵に隣接したら移動終了)を使う */
  zoc: boolean;
  /** 補給(残弾の消費と回復)を使う。false なら残弾無制限 */
  supply: boolean;
  /** 生産できる */
  production: boolean;
  /** 反撃する */
  counter: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  theme: 'modern',
  gold: null,
  incomeMul: 1,
  maxUnits: MAX_UNITS_PER_SIDE,
  zoc: false,
  supply: true,
  production: true,
  counter: true,
};

/** 交戦アニメーション・効果音用に rules が積むイベント */
export interface BattleFx {
  a: Cube;
  d: Cube;
  sfx: string;
  id: number;
  /** ポップアップ表示用 */
  aName: string;
  dName: string;
  weapon: string;
  damage: number;
  destroyed: boolean;
  counterDamage: number;
  counterDestroyed: boolean;
}

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
export interface AirportData {
  name: string;
  hex_id: number;
}

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
  airports?: AirportData[];
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
  airports: AirportData[];
}

/** ゲーム内に取り込んだ空港(hex.json airports 由来)。占領で owner が変わる */
export interface Airport {
  name: string;
  hexId: number;
  at: Cube;
  col: number;
  row: number;
  owner: Side | null;
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
  /** 空港のあるヘックスか(hex.json の airports 由来) */
  airport: boolean;
  /** towns / 空港 のヘックスか(河川・水でも移動コスト1になる) */
  facility: boolean;
  /** 道路が描かれているか(移動コスト1になる) */
  hasRoad: boolean;
  /** 河川が描かれているか(移動不可。道路と両方あれば橋でコスト1) */
  hasRiver: boolean;
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
  /** 空港のある town か */
  airport: boolean;
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
  /** 武装ごとの残弾(武装名 -> 残り)。無制限の武装は -1 */
  ammo: Record<string, number>;
  /** 残り燃料。移動コスト分だけ減る。航空ユニットは 0 になると墜落する */
  fuel: number;
  /** 搭乗中の輸送ユニット(搭乗していなければ null)。搭乗中は盤面に表示されず、輸送側と運命を共にする */
  carriedBy: Unit | null;
  moved: boolean;
  acted: boolean;
  /** 移動取り消し用: 移動前の位置と、移動先の拠点・towns の元の持ち主 */
  from: { pos: Cube; cityOwner: Side | null; townHexId: number | null; townOwner: Side | null } | null;
}

export interface Game {
  defs: UnitDefs;
  settings: GameSettings;
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
  airports: Airport[];
  /** 占領演出待ち(tryCapture が積み、画面側が消費する) */
  pendingCapture: { at: Cube; side: Side } | null;
  /** 右クリック時に左ペインへ固定表示する情報(左クリックで解除) */
  pinnedInfo: string | null;
  /** 表示待ちの交戦演出(attack が積み、画面側が消費する) */
  pendingFx: BattleFx | null;
  /** 表示待ちの移動効果音(moveUnit が積む) */
  pendingMoveSfx: string | null;
  fxSeq: number;
}
