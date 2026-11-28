/**
 * 利用できる AI の一覧。AI は src/game/ai/<id>/ にフォルダで置き、
 * 共通インターフェース(ai/types.ts の playTurn + PERSONALITIES)を実装する。
 * 両陣営に別々の AI を割り当てて対決させることができる(設定画面で選択)。
 * 新しい AI を追加したら、ここに1行足すこと(worker.ts の実装マップにも追加が必要)
 */
export interface AiEntry {
  id: string;
  /** 設定画面に出す名前 */
  name: string;
  /** 逐次実行(確定したユニットから動く)に対応するか */
  supportsStream: boolean;
}

export const AI_LIST: AiEntry[] = [
  { id: 'v32', name: 'v32(歩兵基準・護衛)', supportsStream: true },
  { id: 'v29', name: 'v29(逐次実行・単一案)', supportsStream: true },
  { id: 'v28', name: 'v28(複数案・最良選択)', supportsStream: false },
];

/** 既定の AI(GameSettings の初期値と同じにすること) */
export const DEFAULT_AI_ID = 'v29';

export function aiEntry(id: string | undefined): AiEntry {
  return AI_LIST.find((a) => a.id === id) ?? AI_LIST[0];
}
