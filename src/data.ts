import type { MapData, UnitDefs } from './types';

const base = import.meta.env.BASE_URL;

async function fetchJson<T>(file: string): Promise<T> {
  const res = await fetch(`${base}${file}`);
  if (!res.ok) throw new Error(`${file} を読み込めません (${res.status})`);
  return (await res.json()) as T;
}

export const loadUnitDefs = (): Promise<UnitDefs> => fetchJson<UnitDefs>('units.json');
export const loadMap = (): Promise<MapData> => fetchJson<MapData>('map.json');
