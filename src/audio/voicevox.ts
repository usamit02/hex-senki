/**
 * VOICEVOX 連携。敵司令官の作戦ナレーションを音声で読み上げる。
 * VOICEVOX が起動していない環境では、音声は出ないまま字幕ログだけで進行する(例外は握りつぶす)。
 * 接続先はローカルの VOICEVOX エンジン(標準ポート 50021)。
 */

const BASE = 'http://127.0.0.1:50021';
/** 話者ID(春日部つむぎ) */
const SPEAKER = 8;

let queue: string[] = [];
let playing = false;
let currentAudio: HTMLAudioElement | null = null;

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function playOne(text: string): Promise<void> {
  const q = await fetchWithTimeout(
    `${BASE}/audio_query?text=${encodeURIComponent(text)}&speaker=${SPEAKER}`,
    { method: 'POST' },
    3000,
  );
  if (!q.ok) return;
  const query = await q.json();
  const res = await fetchWithTimeout(`${BASE}/synthesis?speaker=${SPEAKER}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  }, 10000);
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    await new Promise<void>((done) => {
      const a = new Audio(url);
      currentAudio = a;
      a.onended = () => done();
      a.onerror = () => done();
      void a.play().catch(() => done());
    });
  } finally {
    URL.revokeObjectURL(url);
    currentAudio = null;
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
      // VOICEVOX 未接続など。音声なしで続行する
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
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}
