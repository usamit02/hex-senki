import type { TerrainKind } from './types';

export interface TerrainDef {
  /** 画面や説明に出す名前 */
  label: string;
  /** 1マス入るのに必要な移動力(通れないマスは Infinity) */
  moveCost: number;
  /** 守る側が受けるダメージの軽減量 */
  defense: number;
  /** 盤面の塗りつぶしの色 */
  color: string;
  /** マスに小さく添える文字(なければ空) */
  glyph: string;
}

/** 地形ごとのルール。map1.json の terrain にはこのキーを書く */
export const TERRAINS: Record<TerrainKind, TerrainDef> = {
  plain: { label: '平地', moveCost: 1, defense: 0, color: '#c5d9a8', glyph: '' },
  forest: { label: '森', moveCost: 2, defense: 1, color: '#79a36a', glyph: '林' },
  mountain: { label: '山', moveCost: 3, defense: 2, color: '#a79d8e', glyph: '山' },
  water: { label: '水', moveCost: Infinity, defense: 0, color: '#7fb3d5', glyph: '' },
};

export const isTerrainKind = (s: string): s is TerrainKind => Object.hasOwn(TERRAINS, s);
