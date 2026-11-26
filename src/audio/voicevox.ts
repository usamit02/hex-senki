/**
 * VOICEVOX 連携。敵司令官の作戦ナレーションを音声で読み上げる。
 * 接続先はローカルの VOICEVOX エンジン(標準ポート 50021)。
 * 接続できない・再生できない場合は、理由をエラーハンドラ経由で画面に伝える(無言で失敗しない)。
 */

const BASE = 'http://127.0.0.1:50021';
/** 話者ID(春日部つむぎ) */
const SPEAKER = 8;

let queue: string[] = [];
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

/** VOICEVOX へ接続できるか確認する。問題なければ null、あれば理由を返す */
export async function checkVoicevox(): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`${BASE}/version`, { method: 'GET' }, 3000);
    if (!res.ok) return `HTTP ${res.status} が返りました`;
    return null;
  } catch {
    return '接続できません(VOICEVOXが起動していない、またはポート50021に届きません)';
  }
}

async function playOne(text: string): Promise<void> {
  let q: Response;
  try {
    q = await fetchWithTimeout(
      `${BASE}/audio_query?text=${encodeURIComponent(text)}&speaker=${SPEAKER}`,
      { method: 'POST' },
      3000,
    );
  } catch {
    reportError('VOICEVOXに接続できません。VOICEVOXを起動していない場合、音声は出ません(字幕ログは動作します)。');
    queue = [];
    return;
  }
  if (!q.ok) {
    reportError(`VOICEVOXがエラーを返しました(HTTP ${q.status})。音声は出ません(字幕ログは動作します)。`);
    queue = [];
    return;
  }
  const query = await q.json();
  let res: Response;
  try {
    res = await fetchWithTimeout(`${BASE}/synthesis?speaker=${SPEAKER}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    }, 10000);
  } catch {
    reportError('VOICEVOXでの音声合成に失敗しました。音声は出ません(字幕ログは動作します)。');
    queue = [];
    return;
  }
  if (!res.ok) {
    reportError(`VOICEVOXがエラーを返しました(HTTP ${res.status})。音声は出ません(字幕ログは動作します)。`);
    queue = [];
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    if (!audioEl) audioEl = new Audio();
    const a = audioEl;
    a.src = url;
    await new Promise<void>((done) => {
      a.onended = () => done();
      a.onerror = () => done();
      a.play().catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
          reportError('ブラウザに音声の再生をブロックされました。画面を一度クリックしてから遊んでください(字幕ログは動作します)。');
          queue = [];
        }
        done();
      });
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function pump(): Promise<void> {
  if (playing) return;
  playing = true;
  while (queue.length > 0) {
    const text = queue.shift()!;
    try {
      await playOne(text);
    } catch {
      reportError('VOICEVOXの音声再生で問題が発生しました。音声は出ません(字幕ログは動作します)。');
      queue = [];
    }
  }
  playing = false;
}

/** 読み上げキューに追加する(順番に再生される) */
export function speak(text: string): void {
  queue.push(text);
  void pump();
}

/** キューと再生を止める */
export function stopSpeaking(): void {
  queue = [];
  if (audioEl) {
    audioEl.pause();
    audioEl.removeAttribute('src');
  }
}
