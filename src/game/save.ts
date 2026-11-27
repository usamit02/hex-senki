import { fromOffset, key } from './hex';
import type { Game, GameSettings, Side, Unit } from './types';

/**
 * 進行セーブ。localStorage に最大16件まで保存する。
 * 保存するのは設定・ターン・資金・ユニット配置(HP/残弾/燃料)・town所有だけで、
 * マップ自体(hex.json)は保存しない(再開時は現在のマップデータに状態を重ねる)。
 */

export const MAX_SAVES = 16;
const STORAGE_KEY = 'hexsenki.saves.v1';

export interface SaveData {
  version: 1;
  settings: GameSettings;
  turn: number;
  gold: Record<Side, number>;
  units: Array<{
    side: Side;
    kind: string;
    col: number;
    row: number;
    hp: number;
    ammo: Record<string, number>;
    fuel: number;
    moved: boolean;
    acted: boolean;
    carriedBy?: number | null;
  }>;
  towns: Array<{ hexId: number; owner: Side | null }>;
  airports?: Array<{ hexId: number; owner: Side | null }>;
  /** プレイヤー側の師団指定。unit は保存時の units 配列(生存ユニットのみ)のインデックス。-1 は師団長未指定 */
  delegations?: Array<{ unit: number; objectiveKey: string }>;
  /** 師団長の声(師団パネルで選択)。未保存なら設定画面の値を使う */
  allySpeaker?: number;
}

export interface SaveEntry {
  savedAt: number;
  label: string;
  data: SaveData;
}

export function listSaves(): SaveEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SaveEntry[];
    return Array.isArray(parsed) ? parsed.filter((e) => e && e.data && e.data.version === 1) : [];
  } catch {
    return [];
  }
}

function writeSaves(entries: SaveEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

/** 現在のゲームからセーブデータを作る */
export function makeSaveData(g: Game): SaveData {
  const tileByCube = new Map<string, { col: number; row: number }>();
  for (const t of g.tiles.values()) tileByCube.set(key(t), t);
  const aliveUnits = g.units.filter((u) => u.hp > 0);
  const indexOf = new Map(aliveUnits.map((u, i) => [u, i] as const));
  return {
    version: 1,
    settings: { ...g.settings },
    turn: g.turn,
    gold: { ...g.gold },
    units: aliveUnits
      .map((u) => {
        const t = tileByCube.get(key(u));
        return {
          side: u.side,
          kind: u.kind,
          col: t?.col ?? 0,
          row: t?.row ?? 0,
          hp: u.hp,
          ammo: { ...u.ammo },
          fuel: u.fuel,
          moved: u.moved,
          acted: u.acted,
          carriedBy: u.carriedBy ? (indexOf.get(u.carriedBy) ?? null) : null,
        };
      }),
    towns: g.towns.map((t) => ({ hexId: t.hexId, owner: t.owner })),
    airports: g.airports.map((a) => ({ hexId: a.hexId, owner: a.owner })),
    delegations: (g.delegations ?? []).map((d) => {
      const u = d.unit >= 0 ? g.units[d.unit] : undefined;
      return { unit: u && u.hp > 0 ? (indexOf.get(u) ?? -1) : -1, objectiveKey: d.objectiveKey };
    }),
    allySpeaker: g.allySpeaker,
  };
}

/** セーブを追加する。16件を超える場合は false */
export function addSave(g: Game, label: string): boolean {
  const entries = listSaves();
  if (entries.length >= MAX_SAVES) return false;
  entries.push({ savedAt: Date.now(), label, data: makeSaveData(g) });
  writeSaves(entries);
  return true;
}

export function deleteSave(index: number): void {
  const entries = listSaves();
  entries.splice(index, 1);
  writeSaves(entries);
}

/** セーブデータをゲームへ反映する(createGame 直後のゲームに呼ぶ) */
export function applySave(g: Game, data: SaveData): void {
  g.turn = data.turn;
  g.gold = { ...data.gold };
  const units: Unit[] = [];
  for (const su of data.units) {
    const def = g.defs[su.kind];
    if (!def) continue;
    const c = fromOffset(su.col, su.row);
    const t = g.tiles.get(key(c));
    if (!t || t.terrain === 'fill') continue;
    units.push({
      x: c.x, y: c.y, z: c.z,
      side: su.side, kind: su.kind, hp: Math.min(su.hp, def.hp),
      ammo: { ...su.ammo }, fuel: Math.min(su.fuel, def.fuel),
      moved: su.moved, acted: su.acted, carriedBy: null, from: null,
    });
  }
  g.units = units;
  // 搭乗関係を復元する(保存時のユニット配列のインデックスで結ぶ)
  units.forEach((u, i) => {
    const ci = data.units[i]?.carriedBy;
    if (ci !== null && ci !== undefined && units[ci]) u.carriedBy = units[ci];
  });
  for (const st of data.towns) {
    const town = g.towns.find((t) => t.hexId === st.hexId);
    if (town) {
      town.owner = st.owner;
      const tile = g.tilesById.get(st.hexId);
      if (tile?.city) tile.city.owner = st.owner;
    }
  }
  for (const sa of data.airports ?? []) {
    const airport = g.airports.find((a) => a.hexId === sa.hexId);
    if (airport) airport.owner = sa.owner;
  }
  // 師団指定を復元する(保存時の units は生存ユニットのみで、復元後も同じ並びになる)
  g.delegations = (data.delegations ?? []).map((d) => ({
    unit: d.unit >= 0 && units[d.unit] ? d.unit : -1,
    objectiveKey: d.objectiveKey,
  }));
  g.allySpeaker = data.allySpeaker;
  g.selected = null;
  g.selectedHex = null;
  g.reach = null;
  g.message = `セーブデータを読み込みました(ターン ${g.turn})。`;
}
