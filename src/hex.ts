import type { Cube } from './types';

/**
 * キューブ座標 (x, y, z) の計算。常に x + y + z = 0。
 * 画面の見た目は「尖った角が上のヘックス」で、奇数行が半マス右にずれる配置。
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

/** JSON 上の (列, 行) をキューブ座標に変換する(奇数行が半マス右にずれる配置) */
export function fromOffset(col: number, row: number): Cube {
  const x = col - (row >> 1);
  return { x, y: -x - row, z: row };
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
  x: size * SQRT3 * (c.x + c.z / 2 + 0.5),
  y: size * (1.5 * c.z + 1),
});

/** ピクセル座標から、そこにあるマスのキューブ座標を求める */
export function fromPixel(px: number, py: number, size: number): Cube {
  const X = px - (size * SQRT3) / 2;
  const Y = py - size;
  const fx = ((SQRT3 / 3) * X - Y / 3) / size;
  const fz = ((2 / 3) * Y) / size;
  return cubeRound(fx, -fx - fz, fz);
}
