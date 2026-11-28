import { expose } from 'comlink';
import { createGame } from '../state';
import { applySave } from '../save';
import { playTurn as playTurnV28, PERSONALITIES as PERSONALITIES_V28 } from './v28/planner';
import { playTurn as playTurnV29, PERSONALITIES as PERSONALITIES_V29 } from './v29/planner';
import { playTurn as playTurnV32, PERSONALITIES as PERSONALITIES_V32 } from './v32/planner';
import { aiEntry } from './registry';
import type { AiAction, Personality, PlanOptions, PlanResult } from './types';
import type { Game, Side } from '../types';
import type { AiThinkRequest, AiThinkResult, AiWorkerApi } from './protocol';

/**
 * AI思考用 Web Worker。セーブデータ形式のスナップショットからゲームを再構築し、
 * 指定された版の AI(planner)で1ターン分を思考して、行動リスト(JSON)を返す。
 * 実行はメインスレッド側が実エンジンで再検証しながら行う。
 * AI の版はリクエストごとに選べるため、両陣営に別々の AI を割り当てられる
 */

interface AiModule {
  playTurn: (g: Game, side: Side, opts?: PlanOptions) => PlanResult;
  PERSONALITIES: Record<string, Personality>;
}

/** AI の実装マップ。新しい AI を追加したら、ここにも登録する */
const AI_MODULES: Record<string, AiModule> = {
  v28: { playTurn: playTurnV28, PERSONALITIES: PERSONALITIES_V28 },
  v29: { playTurn: playTurnV29, PERSONALITIES: PERSONALITIES_V29 },
  v32: { playTurn: playTurnV32, PERSONALITIES: PERSONALITIES_V32 },
};

let stopRequested = false;

const api: AiWorkerApi = {
  async ping(): Promise<string> {
    return 'ok';
  },

  async requestStop(): Promise<void> {
    stopRequested = true;
  },

  async think(req: AiThinkRequest, onNarration?: (line: string) => void, onAction?: (a: AiAction) => void): Promise<AiThinkResult> {
    stopRequested = false;
    const entry = aiEntry(req.ai);
    const mod = AI_MODULES[entry.id] ?? AI_MODULES.v29;
    const g = createGame(req.defs, req.map, req.save.settings);
    applySave(g, req.save);
    // 逐次実行は、対応する AI のときにだけ有効にする。非対応の AI は
    // 計画を全て決めてから一括で返す(メイン側が順に実行する)
    const stream = !!req.stream && entry.supportsStream;
    const result = mod.playTurn(g, req.side, {
      budgetMs: req.budgetMs,
      personality: mod.PERSONALITIES[req.personality] ?? mod.PERSONALITIES.balanced,
      delegated: req.delegated,
      scopeIndices: req.scopeIndices,
      fixedObjective: req.fixedObjective,
      onNarration,
      shouldStop: () => stopRequested,
      stream,
      onAction: stream ? onAction : undefined,
    });
    return { actions: result.actions, summary: result.summary };
  },
};

expose(api);
