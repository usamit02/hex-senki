import { expose } from 'comlink';
import { createGame } from '../state';
import { applySave } from '../save';
import { PERSONALITIES, playTurn } from './planner';
import type { AiThinkRequest, AiThinkResult, AiWorkerApi } from './protocol';

/**
 * AI思考用 Web Worker。セーブデータ形式のスナップショットからゲームを再構築し、
 * planner で1ターン分を思考して、行動リスト(JSON)だけを返す。
 * 実行はメインスレッド側が実エンジンで再検証しながら行う。
 */

let stopRequested = false;

const api: AiWorkerApi = {
  async ping(): Promise<string> {
    return 'ok';
  },

  async requestStop(): Promise<void> {
    stopRequested = true;
  },

  async think(req: AiThinkRequest, onNarration?: (line: string) => void): Promise<AiThinkResult> {
    stopRequested = false;
    const g = createGame(req.defs, req.map, req.save.settings);
    applySave(g, req.save);
    const result = playTurn(g, req.side, {
      budgetMs: req.budgetMs,
      personality: PERSONALITIES[req.personality] ?? PERSONALITIES.balanced,
      delegated: req.delegated,
      scopeIndices: req.scopeIndices,
      fixedObjective: req.fixedObjective,
      onNarration,
      shouldStop: () => stopRequested,
    });
    return { actions: result.actions, summary: result.summary };
  },
};

expose(api);
