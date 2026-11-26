import { proxy, wrap, type Remote } from 'comlink';
import type { AiThinkRequest, AiThinkResult, AiWorkerApi } from './protocol';

/**
 * AI Worker の管理。思考はメインスレッド(描画)を止めないよう Worker で行う。
 * 「もう打ってよい」(requestStop)を正しい Worker へ届けるため、思考は1つずつ直列に扱う。
 */
export class AiWorkerPool {
  readonly size: number;
  private workers: Array<Remote<AiWorkerApi>> = [];
  private rawWorkers: Worker[] = [];
  private started = false;
  private active = 0;

  constructor(size = 1) {
    this.size = size;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (let i = 0; i < this.size; i++) {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.rawWorkers.push(worker);
      this.workers.push(wrap<AiWorkerApi>(worker));
    }
  }

  /** 思考を依頼する。onNarration は字幕ログ・音声用の逐次コールバック */
  async think(req: AiThinkRequest, onNarration?: (line: string) => void): Promise<AiThinkResult> {
    this.start();
    this.active = 0;
    const worker = this.workers[this.active];
    return worker.think(req, onNarration ? proxy(onNarration) : undefined);
  }

  /** 進行中の思考(プレイヤー側委任)を最良プランで打ち切る */
  async requestStop(): Promise<void> {
    if (!this.started) return;
    await this.workers[this.active]?.requestStop();
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
