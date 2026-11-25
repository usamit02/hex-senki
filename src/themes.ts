import type { TerrainKind, ThemeId, UnitDefs } from './types';

/**
 * 舞台設定(テーマ)ごとのデータ。
 * ユニット一式・地形の呼び名・タイル画像の色使いをテーマごとに用意し、
 * ゲーム設定画面で選んだテーマのものをそのまま使う。
 */

export interface ThemePalette {
  fill: string;
  plain: string;
  forest: string;
  mountain: string;
  water: string;
  marsh: string;
  /** タイル模様の線・点の色 */
  pattern: string;
  patternAlt: string;
  /** マップ外周・背景 */
  bg: string;
}

export interface Theme {
  id: ThemeId;
  label: string;
  description: string;
  defs: UnitDefs;
  terrainLabels: Record<TerrainKind, string>;
  palette: ThemePalette;
  /** 首都・都市の呼び名 */
  townLabel: string;
  capitalLabel: string;
}

const MODERN: Theme = {
  id: 'modern',
  label: '現代戦争',
  description: '戦車・対空ミサイル・戦闘機・ヘリ・歩兵・補給車',
  townLabel: '都市',
  capitalLabel: '首都',
  terrainLabels: { plain: '平地', forest: '森', mountain: '山', water: '水', marsh: '沼', fill: 'データなし' },
  palette: {
    fill: '#20303c',
    plain: '#a8bf7a', forest: '#5d8a4e', mountain: '#9a8d7c', water: '#4d7ec2', marsh: '#7d9b76',
    pattern: 'rgba(60,80,40,0.35)', patternAlt: 'rgba(255,255,255,0.25)', bg: '#20303c',
  },
  defs: {
    ground_tank: {
      name: '戦車', short: '戦', hp: 20, move: 4, defense: 4, cost: 30, fuel: 12, domain: 'ground', category: 'tank', model: 'tank', canCapture: false, moveSfx: 'track',
      weapons: [
        { name: '主砲', power: 8, minRange: 1, range: 1, ammo: 6, sfx: 'cannon', vs: { sam: 1.5, tank: 1, jet: 0.4, heli: 0.6, infantry: 1.2, supply: 1.2 } },
        { name: '機銃', power: 3, minRange: 1, range: 1, ammo: -1, sfx: 'gun', vs: { infantry: 1.5, supply: 1, tank: 0.4, sam: 0.5, jet: 0.3, heli: 0.5 } },
      ],
    },
    ground_sam: {
      name: '対空ミサイル', short: '空', hp: 12, move: 3, defense: 1, cost: 25, fuel: 9, domain: 'ground', category: 'sam', model: 'sam', canCapture: false, moveSfx: 'wheel',
      weapons: [
        { name: '対空ミサイル', power: 7, minRange: 2, range: 3, ammo: 4, sfx: 'missile', vs: { jet: 1.8, heli: 1.8, tank: 0.5, sam: 0.6, infantry: 0.5, supply: 0.6 } },
        { name: '自衛機銃', power: 2, minRange: 1, range: 1, ammo: -1, sfx: 'gun', vs: { infantry: 1, heli: 0.6 } },
      ],
    },
    air_jet: {
      name: '戦闘機', short: '機', hp: 14, move: 8, defense: 2, cost: 35, fuel: 16, domain: 'air', category: 'jet', model: 'jet', canCapture: false, fighter: true, moveSfx: 'jet',
      weapons: [
        { name: 'ミサイル', power: 8, minRange: 1, range: 1, ammo: 4, sfx: 'missile', vs: { tank: 1.5, sam: 1.2, heli: 1.2, jet: 1, infantry: 0.8, supply: 1 } },
        { name: '機関砲', power: 5, minRange: 1, range: 1, ammo: -1, sfx: 'gun', vs: { heli: 1.2, infantry: 1.3, tank: 0.7, sam: 0.8, supply: 1 } },
      ],
    },
    air_heli: {
      name: 'ヘリコプター', short: 'ヘ', hp: 16, move: 6, defense: 2, cost: 30, fuel: 12, domain: 'air', category: 'heli', model: 'heli', canCapture: false, transport: true, moveSfx: 'rotor',
      weapons: [
        { name: '対戦車ミサイル', power: 7, minRange: 1, range: 1, ammo: 4, sfx: 'missile', vs: { tank: 1.3, infantry: 1.5, sam: 1, heli: 0.8, jet: 0.5, supply: 1.2 } },
        { name: 'ロケット弾', power: 5, minRange: 1, range: 1, ammo: 8, sfx: 'rocket', vs: { infantry: 1.3, tank: 0.9, sam: 0.9, supply: 1 } },
      ],
    },
    ground_infantry: {
      name: '歩兵', short: '歩', hp: 10, move: 3, defense: 1, cost: 10, fuel: 9, domain: 'ground', category: 'infantry', model: 'infantry', canCapture: true, moveSfx: 'march',
      weapons: [
        { name: '対戦車ロケット', power: 3, minRange: 1, range: 1, ammo: 3, sfx: 'rocket', vs: { tank: 0.5, heli: 0.5, jet: 0.3, sam: 0.7, infantry: 1, supply: 0.8 } },
        { name: '小銃', power: 3, minRange: 1, range: 1, ammo: -1, sfx: 'gun', vs: { infantry: 1, supply: 0.8, tank: 0.3, sam: 0.4, heli: 0.4, jet: 0.2 } },
      ],
    },
    ground_spg: {
      name: '自走砲', short: '砲', hp: 12, move: 3, defense: 1, cost: 30, fuel: 9, domain: 'ground', category: 'spg', model: 'spg', canCapture: false, moveSfx: 'track',
      weapons: [
        { name: '榴弾砲', power: 9, minRange: 2, range: 4, ammo: 6, sfx: 'cannon', vs: { tank: 1.1, sam: 1.2, infantry: 1.4, spg: 1, supply: 1.3, jet: 0.2, heli: 0.3 } },
      ],
    },
    ground_truck: {
      name: 'トラック', short: 'ト', hp: 12, move: 6, defense: 0, cost: 15, fuel: 18, domain: 'ground', category: 'truck', model: 'truck', canCapture: false, transport: true, moveSfx: 'engine',
      weapons: [],
    },
    ground_supply: {
      name: '補給車', short: '補', hp: 12, move: 4, defense: 1, cost: 15, fuel: 12, domain: 'ground', category: 'supply', model: 'supply', canCapture: false, isSupply: true, moveSfx: 'wheel',
      weapons: [],
    },
  },
};

const FANTASY: Theme = {
  id: 'fantasy',
  label: 'ファンタジー世界',
  description: '勇者・剣士・魔法使い・僧侶・弓兵・ドラゴン',
  townLabel: '街',
  capitalLabel: '王都',
  terrainLabels: { plain: '草原', forest: '森', mountain: '山脈', water: '湖', marsh: '沼地', fill: 'データなし' },
  palette: {
    fill: '#1d2b22',
    plain: '#9ccb62', forest: '#3f7d44', mountain: '#8d7fa8', water: '#4db2d9', marsh: '#6fa287',
    pattern: 'rgba(30,90,30,0.4)', patternAlt: 'rgba(255,255,240,0.3)', bg: '#1d2b22',
  },
  defs: {
    fantasy_hero: {
      name: '勇者', short: '勇', hp: 22, move: 4, defense: 4, cost: 40, fuel: 12, domain: 'ground', category: 'hero', model: '', canCapture: false, moveSfx: 'march',
      weapons: [
        { name: '聖剣', power: 9, minRange: 1, range: 1, ammo: -1, sfx: 'sword', vs: { dragon: 1.5, swordsman: 1.1, mage: 1.2, priest: 1.1, archer: 1.2, hero: 1, supply: 1.2 } },
      ],
    },
    fantasy_swordsman: {
      name: '剣士', short: '剣', hp: 14, move: 4, defense: 2, cost: 15, fuel: 12, domain: 'ground', category: 'swordsman', model: '', canCapture: true, moveSfx: 'march',
      weapons: [
        { name: '剣', power: 6, minRange: 1, range: 1, ammo: -1, sfx: 'sword', vs: { mage: 1.3, archer: 1.3, priest: 1.2, swordsman: 1, hero: 0.7, dragon: 0.5, supply: 1.2 } },
      ],
    },
    fantasy_mage: {
      name: '魔法使い', short: '魔', hp: 10, move: 3, defense: 1, cost: 30, fuel: 9, domain: 'ground', category: 'mage', model: '', canCapture: false, moveSfx: 'march',
      terrainCosts: { forest: 1 },
      weapons: [
        { name: '火炎魔法', power: 8, minRange: 2, range: 3, ammo: 5, sfx: 'magic', vs: { swordsman: 1.4, hero: 1.2, dragon: 1.2, archer: 1.2, mage: 1, priest: 1, supply: 1.2 } },
        { name: '杖', power: 2, minRange: 1, range: 1, ammo: -1, sfx: 'sword', vs: { swordsman: 0.6, archer: 0.8 } },
      ],
    },
    fantasy_priest: {
      name: '僧侶', short: '僧', hp: 10, move: 3, defense: 1, cost: 20, fuel: 9, domain: 'ground', category: 'priest', model: '', canCapture: false, isSupply: true, moveSfx: 'march',
      weapons: [
        { name: '聖なる杖', power: 3, minRange: 1, range: 1, ammo: -1, sfx: 'holy', vs: { dragon: 1.2, mage: 0.8, swordsman: 0.6 } },
      ],
    },
    fantasy_archer: {
      name: '弓兵', short: '弓', hp: 11, move: 3, defense: 1, cost: 18, fuel: 9, domain: 'ground', category: 'archer', model: '', canCapture: false, moveSfx: 'march',
      weapons: [
        { name: '弓', power: 6, minRange: 2, range: 2, ammo: 8, sfx: 'bow', vs: { dragon: 1.5, mage: 1.3, priest: 1.2, swordsman: 0.9, hero: 0.8, archer: 1, supply: 1.1 } },
        { name: '短剣', power: 3, minRange: 1, range: 1, ammo: -1, sfx: 'sword', vs: { mage: 1, archer: 1, swordsman: 0.7 } },
      ],
    },
    fantasy_catapult: {
      name: '投石機', short: '投', hp: 11, move: 2, defense: 1, cost: 28, fuel: 6, domain: 'ground', category: 'catapult', model: '', canCapture: false, moveSfx: 'wheel',
      weapons: [
        { name: '投石', power: 9, minRange: 2, range: 4, ammo: 6, sfx: 'rocket', vs: { swordsman: 1.3, hero: 1.1, mage: 1.2, priest: 1.2, archer: 1.2, dragon: 0.4, catapult: 1, supply: 1.3 } },
      ],
    },
    fantasy_cart: {
      name: '荷馬車', short: '馬', hp: 12, move: 5, defense: 0, cost: 12, fuel: 15, domain: 'ground', category: 'cart', model: '', canCapture: false, transport: true, moveSfx: 'hoof',
      weapons: [],
    },
    fantasy_dragon: {
      name: 'ドラゴン', short: '竜', hp: 20, move: 7, defense: 3, cost: 45, fuel: 14, domain: 'air', category: 'dragon', model: '', canCapture: false, fighter: true, moveSfx: 'wing',
      weapons: [
        { name: '炎のブレス', power: 9, minRange: 1, range: 1, ammo: 4, sfx: 'fire', vs: { swordsman: 1.4, archer: 1.3, mage: 1.2, priest: 1.2, hero: 0.9, dragon: 1, supply: 1.3 } },
        { name: '爪', power: 6, minRange: 1, range: 1, ammo: -1, sfx: 'sword', vs: { archer: 1.2, mage: 1.2, swordsman: 1, hero: 0.7, dragon: 0.8 } },
      ],
    },
  },
};

const SENGOKU: Theme = {
  id: 'sengoku',
  label: '戦国時代',
  description: '足軽・騎兵・弓兵・鉄砲隊・武将・輜重隊',
  townLabel: '城下町',
  capitalLabel: '本城',
  terrainLabels: { plain: '平野', forest: '森', mountain: '山', water: '川・湖', marsh: '湿地', fill: 'データなし' },
  palette: {
    fill: '#2e2a20',
    plain: '#b5bd7f', forest: '#5f7a45', mountain: '#97826b', water: '#5b84a8', marsh: '#86936b',
    pattern: 'rgba(90,80,40,0.35)', patternAlt: 'rgba(255,250,230,0.28)', bg: '#2e2a20',
  },
  defs: {
    sengoku_ashigaru: {
      name: '足軽', short: '足', hp: 11, move: 3, defense: 1, cost: 10, fuel: 9, domain: 'ground', category: 'ashigaru', model: '', canCapture: true, moveSfx: 'march',
      weapons: [
        { name: '槍', power: 4, minRange: 1, range: 1, ammo: -1, sfx: 'spear', vs: { cavalry: 1.4, ashigaru: 1, archer: 1.1, gunner: 1.1, warlord: 0.6, supply: 1.2 } },
      ],
    },
    sengoku_cavalry: {
      name: '騎兵', short: '騎', hp: 16, move: 6, defense: 2, cost: 28, fuel: 18, domain: 'ground', category: 'cavalry', model: '', canCapture: false, moveSfx: 'hoof',
      terrainCosts: { forest: 3, mountain: 4 },
      weapons: [
        { name: '太刀', power: 7, minRange: 1, range: 1, ammo: -1, sfx: 'sword', vs: { archer: 1.5, gunner: 1.5, ashigaru: 1.2, cavalry: 1, warlord: 0.8, supply: 1.3 } },
      ],
    },
    sengoku_archer: {
      name: '弓兵', short: '弓', hp: 11, move: 3, defense: 1, cost: 16, fuel: 9, domain: 'ground', category: 'archer', model: '', canCapture: false, moveSfx: 'march',
      weapons: [
        { name: '弓', power: 6, minRange: 2, range: 2, ammo: 10, sfx: 'bow', vs: { gunner: 1.1, ashigaru: 1.1, cavalry: 0.9, archer: 1, warlord: 0.8, supply: 1.1 } },
        { name: '脇差', power: 3, minRange: 1, range: 1, ammo: -1, sfx: 'sword', vs: { ashigaru: 0.9, archer: 1 } },
      ],
    },
    sengoku_gunner: {
      name: '鉄砲隊', short: '砲', hp: 11, move: 3, defense: 1, cost: 24, fuel: 9, domain: 'ground', category: 'gunner', model: '', canCapture: false, moveSfx: 'march',
      weapons: [
        { name: '鉄砲', power: 8, minRange: 1, range: 2, ammo: 6, sfx: 'gunshot', vs: { cavalry: 1.4, warlord: 1.2, ashigaru: 1.3, archer: 1.1, gunner: 1, supply: 1.2 } },
        { name: '槍', power: 3, minRange: 1, range: 1, ammo: -1, sfx: 'spear', vs: { cavalry: 1.2, ashigaru: 0.9 } },
      ],
    },
    sengoku_warlord: {
      name: '武将', short: '将', hp: 20, move: 5, defense: 3, cost: 40, fuel: 15, domain: 'ground', category: 'warlord', model: '', canCapture: false, moveSfx: 'hoof',
      weapons: [
        { name: '名刀', power: 9, minRange: 1, range: 1, ammo: -1, sfx: 'sword', vs: { ashigaru: 1.3, archer: 1.3, gunner: 1.2, cavalry: 1.1, warlord: 1, supply: 1.3 } },
      ],
    },
    sengoku_cart: {
      name: '荷車', short: '車', hp: 12, move: 5, defense: 0, cost: 12, fuel: 15, domain: 'ground', category: 'cart', model: '', canCapture: false, transport: true, moveSfx: 'wheel',
      weapons: [],
    },
    sengoku_cannon: {
      name: '大筒隊', short: '筒', hp: 11, move: 2, defense: 1, cost: 30, fuel: 6, domain: 'ground', category: 'cannon', model: '', canCapture: false, moveSfx: 'wheel',
      weapons: [
        { name: '大筒', power: 10, minRange: 2, range: 4, ammo: 5, sfx: 'cannon', vs: { cavalry: 1.2, warlord: 1.2, ashigaru: 1.4, archer: 1.2, gunner: 1.1, cannon: 1, supply: 1.3 } },
      ],
    },
    sengoku_supply: {
      name: '輜重隊', short: '輜', hp: 12, move: 4, defense: 1, cost: 15, fuel: 12, domain: 'ground', category: 'supply', model: '', canCapture: false, isSupply: true, moveSfx: 'wheel',
      weapons: [],
    },
  },
};

const ROBOT: Theme = {
  id: 'robot',
  label: 'ロボット（宇宙世紀）',
  description: 'モビルスーツ・重MS・対空MA・宇宙戦艦・戦闘ポッド・補給艦',
  townLabel: 'コロニー',
  capitalLabel: '母港',
  terrainLabels: { plain: '平地', forest: '岩場', mountain: '山岳', water: '水域', marsh: '浅瀬', fill: 'データなし' },
  palette: {
    fill: '#0d1420',
    plain: '#6d7f92', forest: '#54687c', mountain: '#7c7468', water: '#2c4a72', marsh: '#5d7268',
    pattern: 'rgba(140,220,255,0.3)', patternAlt: 'rgba(255,255,255,0.18)', bg: '#0d1420',
  },
  defs: {
    robot_ms: {
      name: 'モビルスーツ', short: 'MS', hp: 20, move: 5, defense: 3, cost: 35, fuel: 15, domain: 'ground', category: 'ms', model: '', canCapture: true, moveSfx: 'mech',
      weapons: [
        { name: 'ビームライフル', power: 8, minRange: 1, range: 2, ammo: 6, sfx: 'beam', vs: { heavy: 1.2, ms: 1, pod: 1.2, battleship: 0.8, aa: 1.1, supply: 1.2 } },
        { name: 'ビームサーベル', power: 9, minRange: 1, range: 1, ammo: -1, sfx: 'beam', vs: { heavy: 1.1, ms: 1.1, aa: 1.2, pod: 0.8, battleship: 0.6, supply: 1.2 } },
      ],
    },
    robot_heavy: {
      name: '重モビルスーツ', short: '重', hp: 26, move: 3, defense: 5, cost: 45, fuel: 9, domain: 'ground', category: 'heavy', model: '', canCapture: false, moveSfx: 'mech',
      weapons: [
        { name: '大型キャノン', power: 10, minRange: 1, range: 1, ammo: 5, sfx: 'cannon', vs: { ms: 1.3, aa: 1.3, heavy: 1, battleship: 0.7, pod: 0.5, supply: 1.3 } },
        { name: 'バルカン', power: 4, minRange: 1, range: 1, ammo: -1, sfx: 'gun', vs: { pod: 1.3, ms: 0.7, supply: 1 } },
      ],
    },
    robot_aa: {
      name: '対空モビルアーマー', short: '空', hp: 14, move: 4, defense: 2, cost: 30, fuel: 12, domain: 'ground', category: 'aa', model: '', canCapture: false, moveSfx: 'mech',
      weapons: [
        { name: '対空ビーム', power: 8, minRange: 2, range: 3, ammo: 6, sfx: 'beam', vs: { pod: 1.8, battleship: 1.4, ms: 0.6, heavy: 0.5, aa: 0.8, supply: 0.8 } },
      ],
    },
    robot_battleship: {
      name: '宇宙戦艦', short: '艦', hp: 40, move: 5, defense: 4, cost: 80, fuel: 15, domain: 'air', category: 'battleship', model: '', canCapture: false, fighter: true, moveSfx: 'engine',
      weapons: [
        { name: '主砲', power: 11, minRange: 2, range: 3, ammo: 8, sfx: 'beam', vs: { heavy: 1.3, ms: 1.2, aa: 1.3, battleship: 1, pod: 0.7, supply: 1.3 } },
        { name: '副砲', power: 7, minRange: 1, range: 2, ammo: -1, sfx: 'cannon', vs: { ms: 1, pod: 1.1, heavy: 0.9, supply: 1.1 } },
      ],
    },
    robot_pod: {
      name: '戦闘ポッド', short: 'ポ', hp: 12, move: 8, defense: 2, cost: 25, fuel: 16, domain: 'air', category: 'pod', model: '', canCapture: false, moveSfx: 'jet',
      weapons: [
        { name: 'ビーム砲', power: 6, minRange: 1, range: 1, ammo: 6, sfx: 'beam', vs: { ms: 1.2, heavy: 1.1, battleship: 1, pod: 1, aa: 0.8, supply: 1.1 } },
      ],
    },
    robot_transport: {
      name: '輸送車両', short: '輸', hp: 14, move: 6, defense: 1, cost: 16, fuel: 18, domain: 'ground', category: 'transport', model: '', canCapture: false, transport: true, moveSfx: 'engine',
      weapons: [],
    },
    robot_sniper: {
      name: '狙撃モビルスーツ', short: '狙', hp: 14, move: 4, defense: 2, cost: 38, fuel: 12, domain: 'ground', category: 'sniper', model: '', canCapture: false, moveSfx: 'mech',
      weapons: [
        { name: '長距離ビームライフル', power: 10, minRange: 2, range: 4, ammo: 6, sfx: 'beam', vs: { heavy: 1.3, ms: 1.2, aa: 1.2, sniper: 1, battleship: 0.7, pod: 0.5, supply: 1.2 } },
      ],
    },
    robot_supply: {
      name: '補給艦', short: '補', hp: 16, move: 5, defense: 2, cost: 20, fuel: 15, domain: 'air', category: 'supply', model: '', canCapture: false, isSupply: true, moveSfx: 'engine',
      weapons: [],
    },
  },
};

export const THEMES: Record<ThemeId, Theme> = {
  modern: MODERN,
  fantasy: FANTASY,
  sengoku: SENGOKU,
  robot: ROBOT,
};

export function getTheme(id: ThemeId): Theme {
  return THEMES[id] ?? MODERN;
}
