/**
 * VOICEVOX 連携。敵司令官の作戦ナレーションを音声で読み上げる。
 * 接続先はローカルの VOICEVOX エンジン(標準ポート 50021)。
 * 接続できない・再生できない場合は、理由をエラーハンドラ経由で画面に伝える(無言で失敗しない)。
 */

const BASE = 'http://127.0.0.1:50021';
/** 既定の話者ID(春日部つむぎ) */
const FALLBACK_SPEAKER = 8;

/** 読み上げの系統: 敵司令官 / プレイヤー側師団長 */
export type SpeechChannel = 'enemy' | 'ally';

/** VOICEVOX に届かない場合の話者リスト(主要キャラクターのノーマルスタイルID) */
export const FALLBACK_SPEAKERS: Array<{ name: string; styleId: number }> = [
  { name: '四国めたん', styleId: 2 },
  { name: 'ずんだもん', styleId: 3 },
  { name: '春日部つむぎ', styleId: 8 },
  { name: '波音リツ', styleId: 9 },
  { name: '雨晴はう', styleId: 10 },
  { name: '玄野武宏', styleId: 11 },
  { name: '白上虎太郎', styleId: 12 },
  { name: '青山龍星', styleId: 13 },
  { name: '冥鳴ひまり', styleId: 14 },
  { name: '九州そら', styleId: 16 },
  { name: 'もち子さん', styleId: 20 },
  { name: '剣崎雌雄', styleId: 21 },
  { name: 'WhiteCUL', styleId: 23 },
  { name: '後鬼', styleId: 27 },
  { name: 'No.7', styleId: 29 },
  { name: 'ちび式じい', styleId: 42 },
  { name: '櫻歌ミコ', styleId: 43 },
  { name: '小夜/SAYO', styleId: 46 },
  { name: 'ナースロボ＿タイプＴ', styleId: 47 },
  { name: '†聖騎士 紅桜†', styleId: 51 },
  { name: '雀松朱司', styleId: 52 },
  { name: '麒ヶ島宗麟', styleId: 53 },
];

/** VOICEVOX の話者一覧を取得する(設定画面の声主選択用)。届かなければ null */
export async function fetchSpeakers(): Promise<Array<{ name: string; styleId: number }> | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2500);
    const res = await fetch(`${BASE}/speakers`, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const list = (await res.json()) as Array<{ name: string; styles: Array<{ id: number; name: string }> }>;
    const out: Array<{ name: string; styleId: number }> = [];
    for (const sp of list) {
      const style = sp.styles.find((s) => s.name === 'ノーマル' || s.name === 'ふつう') ?? sp.styles[0];
      if (style) out.push({ name: sp.name, styleId: style.id });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

let queue: SpeechItem[] = [];
let playing = false;
/** 再生用の Audio 要素は使い回す(ゲーム開始のクリックで再生許可を得ておく) */
let audioEl: HTMLAudioElement | null = null;
let errorHandler: ((message: string) => void) | null = null;
let errorReported = false;

/** 音声エラーの通知先を設定する(ゲーム開始ごとに呼ぶ) */
export function setVoiceErrorHandler(fn: (message: string) => void): void {
  errorHandler = fn;
  errorReported = false;
}

function reportError(message: string): void {
  if (errorReported) return;
  errorReported = true;
  errorHandler?.(message);
}

/**
 * ゲーム開始時(ユーザーのクリックの流れ)に呼ぶ。
 * 無音の音声を一度再生して、この要素での再生がブラウザに許可されるようにする。
 * 敵ターン中のナレーションは開始クリックから時間が経つため、この準備が無いと
 * ブラウザの自動再生ポリシーで play() が拒否され、声が出ないことがある
 */
export function unlockAudio(): void {
  if (!audioEl) audioEl = new Audio();
  audioEl.src = 'data:audio/wav;base64,UklGRjIAAABXQVZFZm10IBIAAAABAAEAQB8AAEAfAAABAAgAAABmYWN0BAAAAAAAAABkYXRhAAAAAA==';
  void audioEl.play().catch(() => undefined);
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * VOICEVOX を実際に使えるか、接続→音声クエリ→合成まで通しで確認する。
 * 問題なければ null、あれば「どの段階で失敗したか」の理由を返す。
 * 合成まで試すのは、初回は話者モデルの読み込みで時間がかかる問題を
 * ゲーム開始時点で切り分けるため(合成結果は再生せず捨てる)
 */
export async function checkVoicevox(speaker: number = FALLBACK_SPEAKER): Promise<string | null> {
  let ver: Response;
  try {
    ver = await fetchWithTimeout(`${BASE}/version`, { method: 'GET' }, 3000);
  } catch {
    return '接続できません(VOICEVOXが起動していない、またはポート50021に届きません)';
  }
  if (!ver.ok) return `接続はできましたが HTTP ${ver.status} が返りました`;
  let q: Response;
  try {
    q = await fetchWithTimeout(
      `${BASE}/audio_query?text=${encodeURIComponent('接続テスト')}&speaker=${speaker}`,
      { method: 'POST' },
      5000,
    );
  } catch {
    return '音声クエリの作成に失敗しました';
  }
  if (!q.ok) return `音声クエリで HTTP ${q.status} が返りました(話者${speaker}が使えない可能性があります)`;
  const query = await q.json();
  let res: Response;
  try {
    res = await fetchWithTimeout(`${BASE}/synthesis?speaker=${speaker}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    }, 30000);
  } catch {
    return '音声合成に失敗しました(タイムアウトまたは通信エラー)';
  }
  if (!res.ok) return `音声合成で HTTP ${res.status} が返りました`;
  return null;
}

/**
 * 音声合成だけを行う(再生はしない)。失敗したら理由つきの Error を投げる。
 * speak() の時点で合成を開始しておくことで、前の行を再生している間に
 * 次の行の合成が進み、行間の無音時間が短くなる(パイプライン化)
 */
async function synthesize(text: string, speaker: number): Promise<Blob> {
  let q: Response;
  try {
    q = await fetchWithTimeout(
      `${BASE}/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`,
      { method: 'POST' },
      5000,
    );
  } catch {
    throw new Error('VOICEVOXに接続できません。VOICEVOXを起動していない場合、音声は出ません(字幕ログは動作します)。');
  }
  if (!q.ok) throw new Error(`VOICEVOXがエラーを返しました(HTTP ${q.status})。音声は出ません(字幕ログは動作します)。`);
  const query = await q.json();
  let res: Response;
  try {
    res = await fetchWithTimeout(`${BASE}/synthesis?speaker=${speaker}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    }, 30000);
  } catch {
    throw new Error('VOICEVOXでの音声合成に失敗しました。音声は出ません(字幕ログは動作します)。');
  }
  if (!res.ok) throw new Error(`VOICEVOXがエラーを返しました(HTTP ${res.status})。音声は出ません(字幕ログは動作します)。`);
  return res.blob();
}

interface SpeechItem {
  text: string;
  speaker: number;
  channel: SpeechChannel;
  blob: Promise<Blob>;
  /** 用途タグ(状況読み上げは 'situation')。戦略目標などの本命の行が来たら待ち行列から外せる */
  tag?: string;
  /** 待ち行列から外された行は再生しない */
  dropped?: boolean;
}

/** 読み上げの開始/終了の通知先(司令官の立ち絵表示など) */
export interface SpeechListener {
  /** 1行の再生が始まった */
  onLineStart(text: string, channel: SpeechChannel): void;
  /** 1行の再生が終わった */
  onLineEnd(text: string, channel: SpeechChannel): void;
  /** キューが空になり、再生が終わった */
  onIdle(): void;
}
let speechListener: SpeechListener | null = null;
export function setSpeechListener(l: SpeechListener | null): void {
  speechListener = l;
}

/** 再生中の行を中断するためのフック(stopSpeaking から呼ぶ) */
let playInterrupt: (() => void) | null = null;

async function playBlob(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    if (!audioEl) audioEl = new Audio();
    const a = audioEl;
    a.src = url;
    await new Promise<void>((done) => {
      let finished = false;
      // 終了イベントが来ないまま固まる事故を防ぐ見張り(再生時間+余裕、最大30秒)
      let watchdog: number | null = window.setTimeout(() => finish(), 30000);
      const finish = (): void => {
        if (finished) return;
        finished = true;
        if (watchdog !== null) clearTimeout(watchdog);
        if (playInterrupt === interrupt) playInterrupt = null;
        done();
      };
      const interrupt = (): void => finish();
      playInterrupt = interrupt;
      a.onended = () => finish();
      a.onerror = () => finish();
      a.onloadedmetadata = () => {
        if (watchdog !== null) clearTimeout(watchdog);
        const ms = Number.isFinite(a.duration) ? a.duration * 1000 + 4000 : 30000;
        watchdog = window.setTimeout(() => finish(), Math.min(30000, Math.max(5000, ms)));
      };
      a.play().catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
          reportError('ブラウザに音声の再生をブロックされました。画面を一度クリックしてから遊んでください(字幕ログは動作します)。');
        }
        finish();
      });
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function pump(): Promise<void> {
  if (playing) return;
  playing = true;
  try {
    while (queue.length > 0) {
      const item = queue[0];
      let blob: Blob;
      try {
        blob = await item.blob; // 合成は speak() 時点で開始済み。到着を待つだけ
      } catch (e) {
        // 1行の合成失敗で全体を止めない。その行だけ飛ばして次へ進む
        // (以前はここでキューを全消去していたため、ターンが替わっても喋らなくなることがあった)
        reportError(e instanceof Error ? e.message : 'VOICEVOXの音声合成に失敗しました。音声は出ません(字幕ログは動作します)。');
        const ix = queue.indexOf(item);
        if (ix >= 0) queue.splice(ix, 1);
        continue;
      }
      const ix = queue.indexOf(item);
      if (ix >= 0) queue.splice(ix, 1);
      if (item.dropped) continue; // 待ちの間に優先度の高い行へ差し替えられた
      errorReported = false; // 合成が成功したら、次回の失敗は再び知らせる
      speechListener?.onLineStart(item.text, item.channel);
      try {
        await playBlob(blob);
      } catch {
        reportError('VOICEVOXの音声再生で問題が発生しました。音声は出ません(字幕ログは動作します)。');
      }
      speechListener?.onLineEnd(item.text, item.channel);
    }
  } finally {
    playing = false;
    if (queue.length === 0) speechListener?.onIdle();
  }
}

/** 読み上げキューに追加する。合成はこの時点で開始し、再生と並行して進む */
export function speak(text: string, speaker: number = FALLBACK_SPEAKER, channel: SpeechChannel = 'enemy', tag?: string): void {
  const blob = synthesize(text, speaker);
  blob.catch(() => undefined); // 実際のエラー処理は pump 側で行う(未処理拒否の警告回避)
  queue.push({ text, speaker, channel, blob, tag });
  // 溜まりすぎた場合の間引き: まず状況読み上げ(tagつき)から、それでも多ければ古い待ち行から。
  // 以前は上限10件で古い順に消していたため、作戦会議などの戦略目標の行が真っ先に消えていた
  while (queue.length > 30) {
    const sitIx = queue.findIndex((q, i) => i > 0 && q.tag === 'situation');
    if (sitIx >= 0) { queue[sitIx].dropped = true; queue.splice(sitIx, 1); continue; }
    queue[1].dropped = true;
    queue.splice(1, 1);
  }
  void pump();
}

/** 指定タグの待ち行列(再生中を除く)を外す。戦略目標の行が来たら状況読み上げを譲らせるために使う */
export function dropQueued(tag: string): void {
  for (let i = queue.length - 1; i >= 1; i--) {
    if (queue[i].tag === tag) {
      queue[i].dropped = true;
      queue.splice(i, 1);
    }
  }
  // 先頭が合成待ちの間に外された場合も再生しない
  if (queue[0]?.tag === tag && !playing) queue[0].dropped = true;
}

/** キューと再生を止める */
export function stopSpeaking(): void {
  for (const q of queue) q.dropped = true;
  queue = [];
  if (audioEl) {
    audioEl.pause();
    audioEl.removeAttribute('src');
  }
  // 再生中の行の待ちも解く(これが無いと pump が固まって以後ずっと喋らなくなる)
  playInterrupt?.();
  speechListener?.onIdle();
}
