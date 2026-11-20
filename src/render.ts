import { SQRT3, fromPixel, key, toPixel } from './hex';
import { inRange } from './rules';
import { unitAt } from './state';
import type { Coord, Game } from './types';

export interface Renderer {
  resize(g: Game): void;
  draw(g: Game): void;
  /** 画面上の座標から、そこにあるマスを求める */
  pick(clientX: number, clientY: number): Coord;
}

const TERRAIN_COLORS = { plain: '#c5d9a8', forest: '#79a36a', water: '#7fb3d5' } as const;
const NEUTRAL_COLOR = '#8a8a8a';

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('このブラウザでは canvas が使えません');
  let size = 30;
  let dpr = 1;

  function hexPath(x: number, y: number, k: number): void {
    ctx!.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 30);
      ctx!.lineTo(x + size * k * Math.cos(a), y + size * k * Math.sin(a));
    }
    ctx!.closePath();
  }

  function draw(g: Game): void {
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    const cs = getComputedStyle(document.documentElement);
    const playerColor = cs.getPropertyValue('--pl').trim();
    const enemyColor = cs.getPropertyValue('--en').trim();
    const textColor = cs.getPropertyValue('--fg').trim();
    ctx!.textAlign = 'center';
    ctx!.textBaseline = 'middle';

    for (const t of g.tiles.values()) {
      const { x, y } = toPixel(t, size);
      hexPath(x, y, 0.97);
      ctx!.fillStyle = TERRAIN_COLORS[t.terrain];
      ctx!.fill();
      ctx!.strokeStyle = 'rgba(40,60,50,.45)';
      ctx!.lineWidth = 1;
      ctx!.stroke();
      if (t.terrain === 'forest') {
        ctx!.fillStyle = 'rgba(30,70,30,.7)';
        ctx!.font = `${size * 0.4}px sans-serif`;
        ctx!.fillText('林', x, y + size * 0.45);
      }
      if (t.city) {
        const color = t.city.owner === 'p' ? playerColor : t.city.owner === 'e' ? enemyColor : NEUTRAL_COLOR;
        ctx!.lineWidth = 3;
        ctx!.strokeStyle = color;
        hexPath(x, y, 0.8);
        ctx!.stroke();
        ctx!.fillStyle = color;
        ctx!.font = `bold ${size * 0.38}px sans-serif`;
        ctx!.fillText(t.city.capital ? '城' : '村', x, y - size * 0.55);
      }
      if (g.reach?.has(key(t.q, t.r)) && !unitAt(g, t.q, t.r)) {
        hexPath(x, y, 0.9);
        ctx!.fillStyle = 'rgba(255,230,80,.55)';
        ctx!.fill();
      }
    }

    const sel = g.selected;
    if (sel && !sel.acted) {
      for (const d of g.units) {
        if (d.hp > 0 && d.side === 'e' && inRange(g, sel, d)) {
          const { x, y } = toPixel(d, size);
          hexPath(x, y, 0.95);
          ctx!.lineWidth = 3;
          ctx!.strokeStyle = '#ff2d2d';
          ctx!.stroke();
        }
      }
    }

    for (const u of g.units) {
      if (u.hp <= 0) continue;
      const { x, y } = toPixel(u, size);
      ctx!.globalAlpha = u.side === 'p' && u.moved && u.acted ? 0.45 : 1;
      ctx!.beginPath();
      ctx!.arc(x, y, size * 0.5, 0, Math.PI * 2);
      ctx!.fillStyle = u.side === 'p' ? playerColor : enemyColor;
      ctx!.fill();
      if (sel === u) {
        ctx!.lineWidth = 3;
        ctx!.strokeStyle = '#fff';
        ctx!.stroke();
      }
      ctx!.fillStyle = '#fff';
      ctx!.font = `bold ${size * 0.5}px sans-serif`;
      ctx!.fillText(g.defs[u.kind].name, x, y - 1);
      ctx!.font = `bold ${size * 0.3}px sans-serif`;
      ctx!.fillStyle = textColor;
      ctx!.fillText(String(u.hp), x + size * 0.55, y + size * 0.5);
      ctx!.globalAlpha = 1;
    }
  }

  function resize(g: Game): void {
    dpr = window.devicePixelRatio || 1;
    const cw = (canvas.parentElement?.clientWidth ?? 600) - 24;
    size = cw / (SQRT3 * (g.width + 0.5));
    const ch = size * (1.5 * (g.height - 1) + 2);
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.height = `${ch}px`;
    draw(g);
  }

  function pick(clientX: number, clientY: number): Coord {
    const rc = canvas.getBoundingClientRect();
    return fromPixel(clientX - rc.left, clientY - rc.top, size);
  }

  return { resize, draw, pick };
}
