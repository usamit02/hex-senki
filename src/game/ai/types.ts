import type { Cube } from '../types';

/**
 * AI 実装が共通で使う型。src/game/ai/<版>/ の各 AI は、この形の
 * playTurn(g, side, opts) と PERSONALITIES を export すること。
 * AI同士の対決や新旧比較は、このインターフェース越しに行う
 */

/** AIが決めた1手。ユニット番号はセーブデータの units 配列(生存ユニットのみ)のインデックス */
export type AiAction =
  | { type: 'produce'; kind: string; hex: string }
  | { type: 'move'; unit: number; hex: string }
  | { type: 'attack'; unit: number; target: number }
  | { type: 'board'; unit: number; carrier: number }
  | { type: 'disembark'; carrier: number; hex: string }
  | { type: 'confirm'; unit: number };

/** 司令官の性格。評価関数の重みとして効く(ルールは変えない) */
export interface Personality {
  name: string;
  /** 攻撃性: 与ダメージ・撃破の評価を上げる */
  aggression: number;
  /** 防御性: 被弾リスクと地形防御の評価を上げる */
  defense: number;
  /** 補給意識: 修理後退と補給の評価を上げる */
  supply: number;
  /** リスク許容: 脅威下への前進を許す */
  risk: number;
  /** 修理優先度: 修理対象とするHPラインを上げる */
  repair: number;
}

export interface PlanOptions {
  /** 思考時間の上限(ms)。打ち切りラインは事前に決めておき、プレイヤーは介入できない */
  budgetMs?: number;
  /** 総司令の性格 */
  personality?: Personality;
  /** プレイヤー側委任かどうか(委任は生産しない) */
  delegated?: boolean;
  seed?: number;
  /** 委任時: 行動できるユニットの制限(g.units のインデックス)。師団長とその近くの未行動ユニットだけが動く */
  scopeIndices?: number[];
  /** 委任時: プレイヤーが決めた目標 */
  fixedObjective?: { at: Cube; name: string };
  /** 思考の言語化(字幕ログ・VOICEVOX 用)。作戦の節目で呼ばれる */
  onNarration?: (line: string) => void;
  /** プレイヤー側委任の「もう打ってよい」。true を返したら最良プランで打ち切る */
  shouldStop?: () => boolean;
  /**
   * 逐次実行モード: 確定した行動をユニット単位で即座に onAction へ渡す。
   * 対応する AI のみ有効(レジストリの supportsStream を参照)
   */
  stream?: boolean;
  /** 逐次実行モードで、確定した行動を受け取るコールバック */
  onAction?: (a: AiAction) => void;
  /** 逐次実行モードの打ち切り時刻(playTurn が設定する) */
  deadlineMs?: number;
}

export interface PlanResult {
  actions: AiAction[];
  /** 言語化用の要約(どの街を狙い、何を撃破したか) */
  summary: string[];
}
