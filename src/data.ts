import type { HexMapData, MapConfig, MapData, UnitDefs } from './types';
import { validateUnitDefs } from './validate';

const base = import.meta.env.BASE_URL;

/** 読み込むマップのファイル名(public/ に置く) */
export const MAP_FILE = 'map.json';
export const HEX_FILE = 'hex.json';

async function fetchJson<T>(file: string): Promise<T> {
  const res = await fetch(`${base}${file}`);
  if (!res.ok) throw new Error(`${file} を読み込めません (${res.status})`);
  return (await res.json()) as T;
}

export async function loadUnitDefs(): Promise<UnitDefs> {
  const defs = await fetchJson<UnitDefs>('units.json');
  validateUnitDefs(defs);
  return defs;
}

export async function loadMap(): Promise<MapData> {
  const [map, hexMap] = await Promise.all([
    fetchJson<MapConfig>(MAP_FILE),
    fetchJson<HexMapData>(HEX_FILE),
  ]);
  return { ...map, hexes: hexMap.hexes };
}
