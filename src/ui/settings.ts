import { THEMES } from '../game/themes';
import { DEFAULT_SETTINGS, normalizeZoc, type GameSettings, type ThemeId } from '../game/types';
import { FALLBACK_SPEAKERS, fetchSpeakers } from '../audio/voicevox';
import { AI_LIST, aiEntry } from '../game/ai/registry';

function fillSpeakerSelect(sel: HTMLSelectElement, list: Array<{ name: string; styleId: number }>, current: number): void {
  const value = sel.value || String(current);
  sel.replaceChildren();
  for (const sp of list) {
    const o = document.createElement('option');
    o.value = String(sp.styleId);
    o.textContent = sp.name;
    sel.append(o);
  }
  sel.value = [...sel.options].some((o) => o.value === value) ? value : String(current);
}

/**
 * ゲーム設定画面を表示し、「ゲーム開始」で選ばれた設定を返す。
 * onCancel が true を返す間は、カードの外側をクリックすると設定を破棄して画面を閉じられる
 * (ゲーム進行中に開いた場合のみ。ゲームが無いときは閉じられない)
 */
export function showSettingsScreen(initial: GameSettings, onStart: (s: GameSettings) => boolean, onCancel?: () => boolean): void {
  const screen = document.getElementById('settings-screen');
  if (!screen) throw new Error('#settings-screen が見つかりません');
  screen.onclick = (e) => {
    if (e.target === screen && onCancel?.()) screen.hidden = true;
  };
  const themesBox = document.getElementById('set-themes');
  const goldInput = document.getElementById('set-gold') as HTMLInputElement;
  const incomeSel = document.getElementById('set-income') as HTMLSelectElement;
  const maxSel = document.getElementById('set-maxunits') as HTMLSelectElement;
  const zoc = document.getElementById('set-zoc') as HTMLSelectElement;
  const supply = document.getElementById('set-supply') as HTMLSelectElement;
  const counter = document.getElementById('set-counter') as HTMLInputElement;
  const aiThink = document.getElementById('set-aithink') as HTMLSelectElement;
  const aiPersonality = document.getElementById('set-aipersonality') as HTMLSelectElement;
  const aiP = document.getElementById('set-ai-p') as HTMLSelectElement;
  const aiE = document.getElementById('set-ai-e') as HTMLSelectElement;
  // AI の版の選択肢はレジストリから作る(版が増えたら自動で並ぶ)
  for (const sel of [aiP, aiE]) {
    sel.innerHTML = '';
    for (const entry of AI_LIST) {
      const o = document.createElement('option');
      o.value = entry.id;
      o.textContent = entry.name;
      sel.append(o);
    }
  }
  const voice = document.getElementById('set-voice') as HTMLInputElement;
  const voiceSpeaker = document.getElementById('set-voice-speaker') as HTMLSelectElement;
  const voiceSpeakerAlly = document.getElementById('set-voice-speaker-ally') as HTMLSelectElement;
  const subtitles = document.getElementById('set-subtitles') as HTMLInputElement;
  const startBtn = document.getElementById('set-start') as HTMLButtonElement;
  if (!themesBox) throw new Error('#set-themes が見つかりません');

  let theme: ThemeId = initial.theme;
  themesBox.replaceChildren();
  for (const t of Object.values(THEMES)) {
    const b = document.createElement('button');
    b.className = 'theme-pick' + (t.id === theme ? ' selected' : '');
    b.innerHTML = `<span><b>${t.label}</b><br><small>${t.description}</small></span>`;
    b.onclick = () => {
      theme = t.id;
      for (const el of themesBox.querySelectorAll('.theme-pick')) el.classList.remove('selected');
      b.classList.add('selected');
    };
    themesBox.append(b);
  }
  goldInput.value = initial.gold === null ? '' : String(initial.gold);
  incomeSel.value = String(initial.incomeMul);
  maxSel.value = String(initial.maxUnits);
  zoc.value = normalizeZoc(initial.zoc);
  supply.value = !initial.supply ? 'off' : initial.supplyTiered ? 'tiered' : 'on';
  counter.checked = initial.counter;
  aiThink.value = String(initial.aiThinkMs);
  aiPersonality.value = initial.aiPersonality;
  aiP.value = aiEntry(initial.aiP).id;
  aiE.value = aiEntry(initial.aiE).id;
  voice.checked = initial.voice;
  subtitles.checked = initial.subtitles;
  fillSpeakerSelect(voiceSpeaker, FALLBACK_SPEAKERS, initial.voiceSpeaker);
  fillSpeakerSelect(voiceSpeakerAlly, FALLBACK_SPEAKERS, initial.voiceSpeakerAlly);
  // VOICEVOX が起動していれば、実際の話者一覧(全キャラクター)に差し替える
  void fetchSpeakers().then((list) => {
    if (!list) return;
    fillSpeakerSelect(voiceSpeaker, list, initial.voiceSpeaker);
    fillSpeakerSelect(voiceSpeakerAlly, list, initial.voiceSpeakerAlly);
  });

  screen.hidden = false;
  startBtn.onclick = () => {
    const goldRaw = goldInput.value.trim();
    const settings: GameSettings = {
      ...DEFAULT_SETTINGS,
      theme,
      gold: goldRaw === '' ? null : Math.max(0, Math.floor(Number(goldRaw) || 0)),
      incomeMul: Number(incomeSel.value) || 1,
      maxUnits: Number(maxSel.value) || DEFAULT_SETTINGS.maxUnits,
      zoc: normalizeZoc(zoc.value),
      supply: supply.value !== 'off',
      supplyTiered: supply.value === 'tiered',
      production: true, // 生産は常時有効(オフではゲームとして成立しないため設定項目から削除した)
      counter: counter.checked,
      aiThinkMs: Number(aiThink.value) || DEFAULT_SETTINGS.aiThinkMs,
      aiPersonality: aiPersonality.value || 'balanced',
      aiP: aiP.value || DEFAULT_SETTINGS.aiP,
      aiE: aiE.value || DEFAULT_SETTINGS.aiE,
      voice: voice.checked,
      voiceSpeaker: Number(voiceSpeaker.value) || DEFAULT_SETTINGS.voiceSpeaker,
      voiceSpeakerAlly: Number(voiceSpeakerAlly.value) || DEFAULT_SETTINGS.voiceSpeakerAlly,
      subtitles: subtitles.checked,
    };
    // ゲーム開始に成功したときだけ設定画面を閉じる(失敗時はエラーを読めるよう残す)
    if (onStart(settings)) screen.hidden = true;
  };
}
