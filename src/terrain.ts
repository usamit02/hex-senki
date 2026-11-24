import type { TerrainKind } from './types';

export interface TerrainDef {
  label: string;
  moveCost: number;
  defense: number;
  color: string;
  glyph: string;
}

/** 地形ごとのルール。色は編集アプリ(hexmap_editor.py)の TERRAINS に合わせた */
export const TERRAINS: Record<TerrainKind, TerrainDef> = {
  plain: { label: '平地', moveCost: 1, defense: 0, color: '#dcebb3', glyph: '' },
  forest: { label: '森', moveCost: 2, defense: 1, color: '#79a86b', glyph: '森' },
  mountain: { label: '山', moveCost: 3, defense: 2, color: '#afa08e', glyph: '山' },
  water: { label: '水', moveCost: Infinity, defense: 0, color: '#82b4dc', glyph: '' },
  marsh: { label: '沼', moveCost: 3, defense: 0, color: '#93c2b2', glyph: '沼' },
};

export const isTerrainKind = (s: string): s is TerrainKind => Object.hasOwn(TERRAINS, s);
