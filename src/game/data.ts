import type { HexMapData, MapConfig, MapData, Side, ThemeId, UnitDefs } from './types';
import { validateUnitDefs } from './validate';

const base = import.meta.env.BASE_URL;

/** 読み込むファイル名(public/ に置く)。地形は hex.json、初期配置・首都は map.json */
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

/**
 * テーマ別ユニット定義を public/units.json から読む(エンドユーザーが別ツールで編集する想定)。
 * 形式: { "modern": {…}, "fantasy": {…}, "sengoku": {…}, "robot": {…} }
 * 旧形式(テーマキーの無い単一の定義集)は modern の定義として扱う。
 * ファイルが無い/壊れている場合は空を返し、呼び出し側が themes.ts の組み込み定義にフォールバックする。
 */
export async function loadThemeUnitDefs(): Promise<Partial<Record<ThemeId, UnitDefs>>> {
  try {
    const raw = await fetchJson<Record<string, unknown>>('units.json');
    const out: Partial<Record<ThemeId, UnitDefs>> = {};
    const themeIds: ThemeId[] = ['modern', 'fantasy', 'sengoku', 'robot'];
    const hasThemeKeys = themeIds.some((id) => raw[id] && typeof raw[id] === 'object');
    if (hasThemeKeys) {
      for (const id of themeIds) {
        const defs = raw[id] as UnitDefs | undefined;
        if (defs) {
          validateUnitDefs(defs);
          out[id] = defs;
        }
      }
    } else {
      const defs = raw as unknown as UnitDefs;
      validateUnitDefs(defs);
      out.modern = defs;
    }
    return out;
  } catch {
    return {};
  }
}

export async function loadMap(): Promise<MapData> {
  const [map, hexMap] = await Promise.all([
    fetchJson<MapConfig>(MAP_FILE),
    fetchJson<HexMapData>(HEX_FILE),
  ]);
  // 首都指定は citys が正式形だが、cities に { p, e } の形で書かれたファイルも受け付ける
  const rawCities: unknown = (map as { cities?: unknown }).cities;
  const citys = map.citys
    ?? (rawCities && typeof rawCities === 'object' && !Array.isArray(rawCities)
      ? (rawCities as Partial<Record<Side, string>>)
      : undefined);
  return {
    ...map,
    citys,
    cities: Array.isArray(rawCities) ? rawCities : [],
    hexes: hexMap.hexes,
    roads: hexMap.roads ?? [],
    rivers: hexMap.rivers ?? [],
    towns: hexMap.towns ?? [],
    airports: hexMap.airports ?? [],
  };
}
