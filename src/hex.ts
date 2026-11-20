import type { Coord } from './types';

export const SQRT3 = Math.sqrt(3);

/** 隣接する6方向(軸座標) */
export const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

export const key = (q: number, r: number): string => `${q},${r}`;

export const distance = (a: Coord, b: Coord): number =>
  (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;

/** JSON 上の (列, 行) を軸座標に変換する(奇数行が半マス右にずれる配置) */
export const fromOffset = (col: number, row: number): Coord => ({ q: col - (row >> 1), r: row });

/** 軸座標から、描画用のピクセル座標(マス中心)を求める */
export const toPixel = (c: Coord, size: number): { x: number; y: number } => ({
  x: size * SQRT3 * (c.q + c.r / 2 + 0.5),
  y: size * (1.5 * c.r + 1),
});

/** ピクセル座標から、そこにあるマスの軸座標を求める */
export function fromPixel(x: number, y: number, size: number): Coord {
  const X = x - (size * SQRT3) / 2;
  const Y = y - size;
  const qf = ((SQRT3 / 3) * X - Y / 3) / size;
  const rf = ((2 / 3) * Y) / size;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(-qf - rf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s + qf + rf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}
