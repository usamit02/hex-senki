/**
 * 効果音。音声ファイルを使わず、WebAudio でその場で合成する。
 * ユニット定義の moveSfx / 武装の sfx の文字列がキーの名前になる。
 */

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

interface NoiseOpts {
  dur: number;
  delay?: number;
  type?: BiquadFilterType;
  from?: number;
  to?: number;
  gain?: number;
  pulses?: number; // 振幅を刻む回数(プロペラ・キャタピラ用)
}

function noise({ dur, type = 'lowpass', from = 800, to, gain = 0.2, pulses, delay = 0 }: NoiseOpts): void {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur);
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(from, t);
  if (to !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(30, to), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  if (pulses) {
    const steps = Math.floor(dur * pulses);
    for (let i = 1; i < steps; i++) {
      g.gain.setValueAtTime(i % 2 === 0 ? gain : gain * 0.25, t + (dur / steps) * i);
    }
  }
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
  src.stop(t + dur);
}

interface ToneOpts {
  dur: number;
  type?: OscillatorType;
  from: number;
  to?: number;
  gain?: number;
  delay?: number;
}

function tone({ dur, type = 'sine', from, to, gain = 0.15, delay = 0 }: ToneOpts): void {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  if (to !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur);
}

function thumps(count: number, interval: number, freq: number, gain = 0.2): void {
  for (let i = 0; i < count; i++) {
    tone({ dur: 0.09, type: 'sine', from: freq, to: freq * 0.6, gain, delay: i * interval });
  }
}

/** 移動効果音 */
export function playMoveSfx(kind: string): void {
  switch (kind) {
    case 'track': // 戦車のキャタピラ
      noise({ dur: 0.8, from: 300, gain: 0.25, pulses: 10 });
      tone({ dur: 0.8, type: 'sawtooth', from: 55, gain: 0.06 });
      break;
    case 'rotor': // ヘリのプロペラ
      noise({ dur: 0.9, type: 'bandpass', from: 500, gain: 0.22, pulses: 14 });
      break;
    case 'jet': // ジェット
      noise({ dur: 0.8, type: 'bandpass', from: 600, to: 2400, gain: 0.16 });
      break;
    case 'hoof': // 馬の蹄
      for (let i = 0; i < 4; i++) {
        noise({ dur: 0.05, type: 'highpass', from: 1200, gain: 0.12 });
        tone({ dur: 0.05, type: 'square', from: 300, gain: 0.05, delay: i * 0.18 + 0.07 });
      }
      thumps(4, 0.18, 160, 0.1);
      break;
    case 'wing': // 羽ばたき
      noise({ dur: 0.8, from: 500, to: 200, gain: 0.18, pulses: 4 });
      break;
    case 'mech': // ロボットの歩行
      thumps(3, 0.22, 90, 0.22);
      tone({ dur: 0.5, type: 'sawtooth', from: 220, to: 180, gain: 0.04 });
      break;
    case 'engine': // エンジン音
      tone({ dur: 0.8, type: 'sawtooth', from: 70, to: 95, gain: 0.1 });
      noise({ dur: 0.8, from: 200, gain: 0.05 });
      break;
    case 'march': // 行軍
      thumps(4, 0.16, 110, 0.16);
      break;
    case 'wheel':
    default: // 車輪
      noise({ dur: 0.45, from: 500, to: 250, gain: 0.12 });
      break;
  }
}

/** 攻撃効果音 */
export function playAttackSfx(kind: string): void {
  switch (kind) {
    case 'cannon': // 砲撃
      noise({ dur: 0.5, from: 900, to: 120, gain: 0.4 });
      tone({ dur: 0.45, type: 'sine', from: 160, to: 40, gain: 0.35 });
      break;
    case 'missile': // ミサイル
      noise({ dur: 0.7, type: 'bandpass', from: 500, to: 3200, gain: 0.25 });
      tone({ dur: 0.3, type: 'sine', from: 200, to: 60, gain: 0.2, delay: 0.55 });
      noise({ dur: 0.3, from: 700, to: 150, gain: 0.3 });
      break;
    case 'rocket':
      noise({ dur: 0.45, type: 'bandpass', from: 700, to: 2600, gain: 0.22 });
      tone({ dur: 0.25, type: 'sine', from: 180, to: 60, gain: 0.18, delay: 0.35 });
      break;
    case 'gunshot': // 鉄砲
      noise({ dur: 0.18, type: 'highpass', from: 900, gain: 0.35 });
      tone({ dur: 0.2, type: 'square', from: 220, to: 60, gain: 0.12 });
      break;
    case 'gun': // 機銃・小銃
      for (let i = 0; i < 3; i++) {
        setTimeout(() => noise({ dur: 0.07, type: 'highpass', from: 1100, gain: 0.22 }), i * 90);
      }
      break;
    case 'sword': // 剣の斬撃
      noise({ dur: 0.25, type: 'highpass', from: 3000, to: 900, gain: 0.2 });
      tone({ dur: 0.15, type: 'triangle', from: 1400, to: 700, gain: 0.06, delay: 0.05 });
      break;
    case 'spear':
      noise({ dur: 0.2, type: 'bandpass', from: 900, to: 300, gain: 0.2 });
      break;
    case 'bow': // 弓
      tone({ dur: 0.12, type: 'triangle', from: 320, to: 180, gain: 0.15 });
      noise({ dur: 0.25, type: 'bandpass', from: 1000, to: 500, gain: 0.1, delay: 0 });
      break;
    case 'magic': // 魔法
      tone({ dur: 0.4, type: 'sine', from: 300, to: 1200, gain: 0.14 });
      noise({ dur: 0.4, from: 2000, to: 300, gain: 0.18, delay: 0 });
      tone({ dur: 0.3, type: 'sine', from: 150, to: 50, gain: 0.2, delay: 0.3 });
      break;
    case 'holy':
      tone({ dur: 0.5, type: 'sine', from: 660, gain: 0.1 });
      tone({ dur: 0.5, type: 'sine', from: 880, gain: 0.1, delay: 0.06 });
      tone({ dur: 0.6, type: 'sine', from: 1320, gain: 0.08, delay: 0.12 });
      break;
    case 'fire': // 炎
      noise({ dur: 0.6, from: 1200, to: 200, gain: 0.3 });
      break;
    case 'beam': // ビーム
      tone({ dur: 0.4, type: 'sawtooth', from: 1400, to: 120, gain: 0.16 });
      tone({ dur: 0.25, type: 'sine', from: 200, to: 60, gain: 0.18, delay: 0.3 });
      break;
    default:
      tone({ dur: 0.2, type: 'square', from: 300, to: 150, gain: 0.12 });
      break;
  }
}
