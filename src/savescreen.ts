import type { SaveEntry } from './save';
import { getTheme } from './themes';

/** セーブ選択画面(起動時・ロード時)。一覧から選んで読み込む */

export interface SaveScreenHandlers {
  onLoad: (index: number) => boolean;
  onDelete: (index: number) => void;
  onNewGame: () => void;
  /** 起動時以外(ゲーム中)だけ閉じられるようにする */
  onClose?: () => void;
}

export function showSaveScreen(entries: SaveEntry[], handlers: SaveScreenHandlers): void {
  const screen = document.getElementById('save-screen');
  const list = document.getElementById('save-list');
  const newBtn = document.getElementById('save-new') as HTMLButtonElement | null;
  const closeBtn = document.getElementById('save-close') as HTMLButtonElement | null;
  if (!screen || !list || !newBtn) return;
  screen.hidden = false;

  const render = (items: SaveEntry[]): void => {
    list.innerHTML = '';
    items.forEach((e, i) => {
      const row = document.createElement('div');
      row.className = 'save-row';
      const info = document.createElement('span');
      const d = new Date(e.savedAt);
      const themeLabel = getTheme(e.data.settings.theme).label;
      info.textContent = `${e.label} / ${themeLabel} / ターン ${e.data.turn} / ${d.toLocaleString('ja-JP')}`;
      const load = document.createElement('button');
      load.type = 'button';
      load.textContent = '読み込む';
      load.onclick = () => {
        if (handlers.onLoad(i)) screen.hidden = true;
      };
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '削除';
      del.onclick = () => {
        handlers.onDelete(i);
        render(items.filter((_, j) => j !== i));
        if (list.childElementCount === 0 && !handlers.onClose) handlers.onNewGame();
      };
      row.append(info, load, del);
      list.appendChild(row);
    });
  };
  render(entries);

  newBtn.onclick = () => {
    screen.hidden = true;
    handlers.onNewGame();
  };
  if (closeBtn) {
    closeBtn.hidden = !handlers.onClose;
    closeBtn.onclick = () => {
      screen.hidden = true;
      handlers.onClose?.();
    };
  }
}

export function hideSaveScreen(): void {
  const screen = document.getElementById('save-screen');
  if (screen) screen.hidden = true;
}
