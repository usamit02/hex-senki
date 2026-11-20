import type { MapData, UnitDefs } from './types';
import { validateUnitDefs } from './validate';

const base = import.meta.env.BASE_URL;

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

export const loadMap = (): Promise<MapData> => fetchJson<MapData>('map.json');
