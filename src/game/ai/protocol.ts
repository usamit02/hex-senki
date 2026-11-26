import type { Cube, MapData, Side, UnitDefs } from '../types';
import type { SaveData } from '../save';
import type { AiAction } from './planner';

/**
 * AI Worker との通信プロトコル。
 * ゲームとAIの受け渡しは JSON 化可能なデータだけにする(将来のサーバー化に備える)。
 * 盤面の状態はセーブデータ形式(SaveData)で渡し、Worker 内でゲームを再構築して思考する。
 * 行動リストのユニット番号は、セーブデータの units 配列(生存ユニットのみ)のインデックス。
 */

export interface AiThinkRequest {
  /** 盤面スナップショット(セーブデータ形式) */
  save: SaveData;
  defs: UnitDefs;
  map: MapData;
  side: Side;
  /** 思考時間の上限(ms)。CPU側の打ち切りラインは事前に決めておく */
  budgetMs: number;
  /** 総司令の性格(PERSONALITIES のキー) */
  personality: string;
  /** プレイヤー側委任かどうか(委任は生産しない) */
  delegated?: boolean;
  /** 委任時: 行動できるユニット(save の units インデックス) */
  scopeIndices?: number[];
  /** 委任時: プレイヤーが決めた目標 */
  fixedObjective?: { at: Cube; name: string };
}

export interface AiThinkResult {
  actions: AiAction[];
  summary: string[];
}

/** Worker 側が Comlink で公開する API */
export interface AiWorkerApi {
  ping(): Promise<string>;
  think(req: AiThinkRequest, onNarration?: (line: string) => void): Promise<AiThinkResult>;
  /** プレイヤー側委任の「もう打ってよい」。進行中の思考を最良プランで打ち切る */
  requestStop(): Promise<void>;
}
