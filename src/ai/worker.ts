import { expose } from 'comlink';
import type { AiThinkRequest, AiThinkResult, AiWorkerApi } from './protocol';

/**
 * 要件7: AI思考エンジン用 Web Worker の入口(現在は入れ物のみ)。
 * 将来ここに探索・評価エンジンを実装し、メインスレッド(render/Phaser)から
 * 完全に分離する。現段階の think() は何も行動を返さないスタブで、
 * ゲーム本体は src/ai.ts の簡易AIを使い続けている。
 */
const api: AiWorkerApi = {
  async ping(): Promise<string> {
    return 'ok';
  },

  async think(req: AiThinkRequest): Promise<AiThinkResult> {
    // TODO(将来): req.timeBudgetMs の範囲で探索し、actions を組み立てる。
    // 複数 Worker で候補手を分担する場合は、Pool 側でリクエストを分割する。
    return { requestId: req.requestId, actions: [], note: 'scaffold: no engine yet' };
  },
};

expose(api);
