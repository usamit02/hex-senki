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
export async function checkVoicevox(speaker: number = FALLBACK_SPEAKER, allySpeaker?: number): Promise<string | null> {
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
  // 味方側の話者も先に1回合成しておく(話者モデルの読み込みは初回が重く、
  // 師団長の最初のセリフが移動フェイズまで遅れる原因になるため)
  if (allySpeaker !== undefined && allySpeaker !== speaker) {
    void (async () => {
      try {
        const aq = await fetchWithTimeout(
          `${BASE}/audio_query?text=${encodeURIComponent('接続テスト')}&speaker=${allySpeaker}`,
          { method: 'POST' },
          5000,
        );
        if (!aq.ok) return;
        const qy: unknown = await aq.json();
        await fetchWithTimeout(`${BASE}/synthesis?speaker=${allySpeaker}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(qy),
        }, 60000);
      } catch {
        // ウォームアップの失敗は無視する(本編の合成で改めてエラーになる)
      }
    })();
  }
  return null;
}

/**
 * 音声合成だけを行う(再生はしない)。失敗したら理由つきの Error を投げる。
 * 合成は同時に2件までしか走らせない(ensureSynthesis 側で制御する)。
 * 行を一斉に合成しにいくと接続が集中して、エンジン側が捌ききれず
 * 「接続できません」エラーが多発したため
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
    // 一時的な接続失敗は1回だけ再試行する
    await new Promise((r) => setTimeout(r, 600));
    try {
      q = await fetchWithTimeout(
        `${BASE}/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`,
        { method: 'POST' },
        5000,
      );
    } catch {
      throw new Error('VOICEVOXに接続できません。VOICEVOXを起動していない場合、音声は出ません(字幕ログは動作します)。');
    }
  }
  if (!q.ok) throw new Error(`VOICEVOXがエラーを返しました(HTTP ${q.status})。音声は出ません(字幕ログは動作します)。`);
  const query = await q.json();
  let res: Response;
  try {
    res = await fetchWithTimeout(`${BASE}/synthesis?speaker=${speaker}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    }, 60000); // 初回の話者モデル読み込みなどで時間がかかることがあるため長めに取る
  } catch {
    throw new Error('VOICEVOXでの音声合成に失敗しました。音声は出ません(字幕ログは動作します)。');
  }
  if (!res.ok) throw new Error(`VOICEVOXがエラーを返しました(HTTP ${res.status})。音声は出ません(字幕ログは動作します)。`);
  return res.blob();
}

/**
 * 読み上げの優先順位(本人の指定): 作戦目標 > 戦闘結果 > 生産 > 状況表読み上げ。
 * 待ち行列はこの順で再生され、溜まりすぎた場合は下位から間引かれる
 */
export type SpeechPriority = 'objective' | 'combat' | 'production' | 'situation';
const PRIO_NUM: Record<SpeechPriority, number> = { objective: 0, combat: 1, production: 2, situation: 3 };

interface SpeechItem {
  text: string;
  speaker: number;
  channel: SpeechChannel;
  /** 優先度(小さいほど先に喋る) */
  prio: number;
  /** 投入順(同優先度では先に入ったものから喋る。分割した行の順序保持にも使う) */
  seq: number;
  /** 合成結果。合成の開始は ensureSynthesis が順番に制御する */
  blob?: Promise<Blob>;
  /** 待ち行列から外された行は再生しない */
  dropped?: boolean;
}
let nextSeq = 0;

/** 同時に走らせる合成の上限(接続集中による失敗を防ぐ) */
const MAX_SYNTH_IN_FLIGHT = 2;
let synthInFlight = 0;
/** 再生中の行(待ち行列クリアの対象から外すため) */
let playingItem: SpeechItem | null = null;

/** 再生候補の中で最も優先な行(優先度→投入順)。再生中・合成待ちの行は pump が管理する */
function pickNext(exclude?: SpeechItem): SpeechItem | null {
  let best: SpeechItem | null = null;
  for (const item of queue) {
    if (item.dropped || item === exclude) continue;
    if (!best || item.prio < best.prio || (item.prio === best.prio && item.seq < best.seq)) best = item;
  }
  return best;
}

/** 優先順に、同時上限まで合成を開始する */
function ensureSynthesis(): void {
  const ordered = [...queue].filter((i) => !i.dropped).sort((a, b) => a.prio - b.prio || a.seq - b.seq);
  for (const item of ordered) {
    if (synthInFlight >= MAX_SYNTH_IN_FLIGHT) break;
    if (item.blob) continue;
    synthInFlight++;
    const p = synthesize(item.text, item.speaker);
    p.catch(() => undefined); // 実際のエラー処理は pump 側で行う(未処理拒否の警告回避)
    item.blob = p.then(
      (b) => { synthInFlight--; markProgress(); ensureSynthesis(); return b; },
      (e: unknown) => { synthInFlight--; markProgress(); ensureSynthesis(); throw e; },
    );
  }
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

/** pump が合成の完了を待っている行(監視側が誤って切り捨てないため) */
let awaitingItem: SpeechItem | null = null;

/**
 * 合成の完了を待つ。途中で行が破棄されたら待つのをやめる。
 * 破棄された行の合成(最大60秒)を待ち続けると、その間ずっと無音になり、
 * ターン切り替えのたびにキュー掃除が入る観戦では一生喋らなくなる事故があった
 */
async function awaitBlob(item: SpeechItem): Promise<Blob | null> {
  const p = item.blob ?? synthesize(item.text, item.speaker);
  return Promise.race([
    p,
    (async (): Promise<null> => {
      while (!item.dropped) await new Promise((r) => setTimeout(r, 150));
      return null;
    })(),
  ]);
}

async function pump(): Promise<void> {
  if (playing) return;
  playing = true;
  try {
    for (;;) {
      ensureSynthesis();
      const item = pickNext();
      if (!item) break;
      awaitingItem = item;
      let blob: Blob | null;
      try {
        blob = await awaitBlob(item);
      } catch (e) {
        // 1行の合成失敗で全体を止めない。その行だけ飛ばして次へ進む
        reportError(e instanceof Error ? e.message : 'VOICEVOXの音声合成に失敗しました。音声は出ません(字幕ログは動作します)。');
        item.dropped = true;
        const ix = queue.indexOf(item);
        if (ix >= 0) queue.splice(ix, 1);
        awaitingItem = null;
        continue;
      }
      awaitingItem = null;
      const ix = queue.indexOf(item);
      if (ix >= 0) queue.splice(ix, 1);
      if (item.dropped || blob === null) continue; // 待ちの間に破棄された行は喋らない
      errorReported = false; // 合成が成功したら、次回の失敗は再び知らせる
      playingItem = item;
      markProgress();
      speechListener?.onLineStart(item.text, item.channel);
      try {
        await playBlob(blob);
      } catch {
        reportError('VOICEVOXの音声再生で問題が発生しました。音声は出ません(字幕ログは動作します)。');
      }
      playingItem = null;
      markProgress();
      speechListener?.onLineEnd(item.text, item.channel);
    }
  } finally {
    playing = false;
    if (queue.length === 0) speechListener?.onIdle();
  }
}

/** 1行の目安の長さ(文字数)。これより長い行は句読点で区切って合成に小分けに投げる */
const CHUNK_CHARS = 36;
/** 待ち行列に溜めてよい読み上げ時間の上限(秒)。超えたら低優先度から間引く */
const MAX_BACKLOG_SEC = 75;
/** 読み上げ速度の見積もり(秒/文字) */
const SEC_PER_CHAR = 0.16;

/** 長いセリフを句読点(。)、次に読点(、)で区切り、CHUNK_CHARS 以内の塊に分ける */
function splitLine(text: string): string[] {
  const rough = text.split(/(?<=。)/).map((s) => s.trim()).filter((s) => s.length > 0);
  const out: string[] = [];
  for (const part of rough) {
    if (part.length <= CHUNK_CHARS) { out.push(part); continue; }
    let cur = '';
    for (const seg of part.split(/(?<=、)/)) {
      if (cur.length + seg.length > CHUNK_CHARS && cur.length > 0) { out.push(cur); cur = seg; }
      else cur += seg;
    }
    if (cur.length > 0) out.push(cur);
  }
  return out.length > 0 ? out : [text];
}

/**
 * 読み上げキューに追加する。合成は同時2件まで優先順に開始し、再生と並行して進む。
 * 行は分割して小分けに合成するため、最初の音が早く出る。
 * 待ち行列の滞留が MAX_BACKLOG_SEC を超えたら、低優先度(状況→生産→戦闘)の
 * 古い行から間引く(作戦目標は間引かない)
 */
export function speak(text: string, speaker: number = FALLBACK_SPEAKER, channel: SpeechChannel = 'enemy', prio: SpeechPriority = 'combat'): void {
  startWatchdog();
  markProgress();
  const prioNum = PRIO_NUM[prio];
  for (const chunk of splitLine(text)) {
    queue.push({ text: chunk, speaker, channel, prio: prioNum, seq: nextSeq++ });
  }
  ensureSynthesis();
  // 間引き: 滞留時間の見積もりが上限を超える間、最下位の待ち行を古い順に外す
  const waitingSecs = (): number => queue
    .filter((q) => q !== playingItem && q !== awaitingItem)
    .reduce((s, q) => s + q.text.length * SEC_PER_CHAR, 0);
  while (waitingSecs() > MAX_BACKLOG_SEC) {
    let worst: SpeechItem | null = null;
    for (const q of queue) {
      if (q === playingItem || q === awaitingItem || q.prio === 0) continue;
      if (!worst || q.prio > worst.prio || (q.prio === worst.prio && q.seq < worst.seq)) worst = q;
    }
    if (!worst) break;
    worst.dropped = true;
    queue.splice(queue.indexOf(worst), 1);
  }
  void pump();
}

/** 指定した優先度の待ち行列(再生中・合成待ちを除く)を外す。新しい状況行が来たら古い状況行を譲らせるために使う */
export function dropQueuedPrio(prio: SpeechPriority): void {
  const n = PRIO_NUM[prio];
  for (let i = queue.length - 1; i >= 0; i--) {
    const q = queue[i];
    if (q.prio === n && q !== playingItem && q !== awaitingItem) {
      q.dropped = true;
      queue.splice(i, 1);
    }
  }
}


// ---------- 無音の監視(詰まり検知) ----------
// 合成リクエストが返ってこない等でキューが止まると、その後ずっと無音になる。
// 定期的に「待ち行列があるのに再生も合成も進んでいない」状態を検知し、
// 待ち行列の最下位の行を切り捨てて再開する。
// 再生中・合成待ちの行は切り捨てない(それをやると pump が待ちぼうけになり、
// かえって無音が続く事故があった)
let lastProgressAt = Date.now();
let watchdogStarted = false;
function markProgress(): void {
  lastProgressAt = Date.now();
}
function startWatchdog(): void {
  if (watchdogStarted) return;
  watchdogStarted = true;
  setInterval(() => {
    if (queue.length === 0 || playingItem || awaitingItem) return;
    if (Date.now() - lastProgressAt < 15000) return;
    let worst: SpeechItem | null = null;
    for (const q of queue) {
      if (!worst || q.prio > worst.prio || (q.prio === worst.prio && q.seq < worst.seq)) worst = q;
    }
    if (!worst) return;
    worst.dropped = true;
    queue.splice(queue.indexOf(worst), 1);
    markProgress();
    ensureSynthesis();
    void pump();
  }, 4000);
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
