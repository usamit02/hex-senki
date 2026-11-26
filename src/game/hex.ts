import type { Cube } from './types';

/**
 * キューブ座標 (x, y, z) の計算。常に x + y + z = 0。
 * 画面の見た目は「平らな辺が上のヘックス(フラットトップ)」で、奇数列が半マス下にずれる配置。
 */

export const SQRT3 = Math.sqrt(3);

/** 隣接する6方向 */
export const CUBE_DIRS: ReadonlyArray<Readonly<Cube>> = [
  { x: 1, y: -1, z: 0 },
  { x: 1, y: 0, z: -1 },
  { x: 0, y: 1, z: -1 },
  { x: -1, y: 1, z: 0 },
  { x: -1, y: 0, z: 1 },
  { x: 0, y: -1, z: 1 },
];

export const key = (c: Cube): string => `${c.x},${c.y},${c.z}`;

export const equals = (a: Cube, b: Cube): boolean => a.x === b.x && a.y === b.y && a.z === b.z;

export const add = (a: Cube, b: Cube): Cube => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

export const neighbors = (c: Cube): Cube[] => CUBE_DIRS.map((d) => add(c, d));

export const distance = (a: Cube, b: Cube): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));

/** 座標をコピーする(Tile や Unit の余計な項目を含めずに、位置だけ取り出す) */
export const pos = (c: Cube): Cube => ({ x: c.x, y: c.y, z: c.z });

/** 対象の位置を、別の座標へ書き換える */
export function setPos(target: Cube, to: Cube): void {
  target.x = to.x;
  target.y = to.y;
  target.z = to.z;
}

/** JSON 上の (列, 行) をキューブ座標に変換する(奇数列が半マス下にずれる配置) */
export function fromOffset(col: number, row: number): Cube {
  const z = row - (col >> 1);
  return { x: col, y: -col - z, z };
}

/** 小数のキューブ座標を、最も近いマスに丸める */
export function cubeRound(fx: number, fy: number, fz: number): Cube {
  let x = Math.round(fx);
  let y = Math.round(fy);
  let z = Math.round(fz);
  const dx = Math.abs(x - fx);
  const dy = Math.abs(y - fy);
  const dz = Math.abs(z - fz);
  if (dx > dy && dx > dz) x = -y - z;
  else if (dy > dz) y = -x - z;
  else z = -x - y;
  return { x, y, z };
}

/** キューブ座標から、描画用のピクセル座標(マス中心)を求める */
export const toPixel = (c: Cube, size: number): { x: number; y: number } => ({
  x: size * (1.5 * c.x + 1),
  y: size * SQRT3 * (c.z + c.x / 2 + 0.5),
});

/** 盤面全体を描くのに必要な幅と高さ */
export const boardSize = (cols: number, rows: number, size: number): { w: number; h: number } => ({
  w: size * (1.5 * (cols - 1) + 2),
  h: size * SQRT3 * (rows + 0.5),
});

/** ピクセル座標から、そこにあるマスのキューブ座標を求める */
export function fromPixel(px: number, py: number, size: number): Cube {
  const X = px - size;
  const Y = py - (size * SQRT3) / 2;
  const fx = ((2 / 3) * X) / size;
  const fz = ((-1 / 3) * X + (SQRT3 / 3) * Y) / size;
  return cubeRound(fx, -fx - fz, fz);
}
