import { THEMES } from '../game/themes';
import { DEFAULT_SETTINGS, type GameSettings, type ThemeId } from '../game/types';

/** ゲーム設定画面を表示し、「ゲーム開始」で選ばれた設定を返す */
export function showSettingsScreen(initial: GameSettings, onStart: (s: GameSettings) => boolean): void {
  const screen = document.getElementById('settings-screen');
  if (!screen) throw new Error('#settings-screen が見つかりません');
  const themesBox = document.getElementById('set-themes');
  const goldInput = document.getElementById('set-gold') as HTMLInputElement;
  const incomeSel = document.getElementById('set-income') as HTMLSelectElement;
  const maxSel = document.getElementById('set-maxunits') as HTMLSelectElement;
  const zoc = document.getElementById('set-zoc') as HTMLInputElement;
  const supply = document.getElementById('set-supply') as HTMLSelectElement;
  const production = document.getElementById('set-production') as HTMLInputElement;
  const counter = document.getElementById('set-counter') as HTMLInputElement;
  const aiThink = document.getElementById('set-aithink') as HTMLSelectElement;
  const aiPersonality = document.getElementById('set-aipersonality') as HTMLSelectElement;
  const voice = document.getElementById('set-voice') as HTMLInputElement;
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
  zoc.checked = initial.zoc;
  supply.value = !initial.supply ? 'off' : initial.supplyTiered ? 'tiered' : 'on';
  production.checked = initial.production;
  counter.checked = initial.counter;
  aiThink.value = String(initial.aiThinkMs);
  aiPersonality.value = initial.aiPersonality;
  voice.checked = initial.voice;
  subtitles.checked = initial.subtitles;

  screen.hidden = false;
  startBtn.onclick = () => {
    const goldRaw = goldInput.value.trim();
    const settings: GameSettings = {
      ...DEFAULT_SETTINGS,
      theme,
      gold: goldRaw === '' ? null : Math.max(0, Math.floor(Number(goldRaw) || 0)),
      incomeMul: Number(incomeSel.value) || 1,
      maxUnits: Number(maxSel.value) || DEFAULT_SETTINGS.maxUnits,
      zoc: zoc.checked,
      supply: supply.value !== 'off',
      supplyTiered: supply.value === 'tiered',
      production: production.checked,
      counter: counter.checked,
      aiThinkMs: Number(aiThink.value) || DEFAULT_SETTINGS.aiThinkMs,
      aiPersonality: aiPersonality.value || 'balanced',
      voice: voice.checked,
      subtitles: subtitles.checked,
    };
    // ゲーム開始に成功したときだけ設定画面を閉じる(失敗時はエラーを読めるよう残す)
    if (onStart(settings)) screen.hidden = true;
  };
}
