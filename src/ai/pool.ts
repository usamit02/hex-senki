import { wrap, type Remote } from 'comlink';
import type { AiThinkRequest, AiThinkResult, AiWorkerApi } from './protocol';

/**
 * 要件7: AI Worker Pool の入れ物。
 * ユーザーのPCのコア数(navigator.hardwareConcurrency、通常4〜16)に合わせて
 * 複数の Worker を同時に立ち上げ、思考リクエストをラウンドロビンで振り分ける。
 * メインスレッド(描画)用に1コア空けるため、既定サイズは「コア数 - 1」。
 *
 * 現在は未使用(ゲーム本体は src/ai.ts の簡易AIで動作)。
 * 将来の接続方法:
 *   const pool = new AiWorkerPool();
 *   const result = await pool.think(snapshot);
 *   // result.actions を rules.ts の moveUnit / attack に適用する
 *   pool.terminate(); // ゲーム終了時
 */
export class AiWorkerPool {
  readonly size: number;
  private workers: Array<Remote<AiWorkerApi>> = [];
  private rawWorkers: Worker[] = [];
  private nextWorker = 0;
  private nextRequestId = 1;
  private started = false;

  constructor(size?: number) {
    this.size = size ?? AiWorkerPool.defaultSize();
  }

  /** コア数から既定の Worker 数を決める(最小1、最大16) */
  static defaultSize(): number {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    return Math.min(16, Math.max(1, cores - 1));
  }

  /** Worker 群を起動する(初回の think 時に自動でも起動する) */
  start(): void {
    if (this.started) return;
    this.started = true;
    for (let i = 0; i < this.size; i++) {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.rawWorkers.push(worker);
      this.workers.push(wrap<AiWorkerApi>(worker));
    }
  }

  /** 空いている順に Worker へ思考を依頼する(現段階ではスタブ応答) */
  async think(req: Omit<AiThinkRequest, 'requestId'>): Promise<AiThinkResult> {
    this.start();
    const worker = this.workers[this.nextWorker];
    this.nextWorker = (this.nextWorker + 1) % this.workers.length;
    const requestId = this.nextRequestId++;
    return worker.think({ ...req, requestId });
  }

  async pingAll(): Promise<string[]> {
    this.start();
    return Promise.all(this.workers.map((w) => w.ping()));
  }

  terminate(): void {
    for (const w of this.rawWorkers) w.terminate();
    this.rawWorkers = [];
    this.workers = [];
    this.started = false;
  }
}
