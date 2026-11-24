import type { Side, TerrainKind, UnitDefs } from '../types';

/**
 * 要件7: AI思考エンジン(将来の Web Worker 版)との通信プロトコル。
 * Worker へは Game そのもの(Map や関数を含む)は渡せないため、
 * structured clone 可能なプレーンなスナップショットだけを定義する。
 * 現在は「入れ物」の段階で、実際の思考は src/ai.ts の簡易版が担当する。
 */

export interface AiTileSnapshot {
  id: number;
  col: number;
  row: number;
  terrain: TerrainKind;
  cityOwner: Side | null;
  isCapital: boolean;
}

export interface AiUnitSnapshot {
  /** units 配列内での通し番号(結果の action はこの番号で対象を指定する) */
  index: number;
  side: Side;
  kind: string;
  col: number;
  row: number;
  hp: number;
}

export interface AiThinkRequest {
  requestId: number;
  side: Side;
  turn: number;
  width: number;
  height: number;
  tiles: AiTileSnapshot[];
  units: AiUnitSnapshot[];
  defs: UnitDefs;
  gold: Record<Side, number>;
  /** 思考時間の上限(ms)。将来の探索エンジン用 */
  timeBudgetMs: number;
}

export type AiAction =
  | { type: 'move'; unitIndex: number; toCol: number; toRow: number }
  | { type: 'attack'; unitIndex: number; targetIndex: number }
  | { type: 'recruit'; kind: string }
  | { type: 'wait'; unitIndex: number };

export interface AiThinkResult {
  requestId: number;
  actions: AiAction[];
  /** デバッグ用メモ(探索ノード数など)。現段階では未使用 */
  note?: string;
}

/** Worker 側が Comlink で公開する API */
export interface AiWorkerApi {
  ping(): Promise<string>;
  think(req: AiThinkRequest): Promise<AiThinkResult>;
}
