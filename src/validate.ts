import type { UnitDefs } from './types';

/**
 * 駒のIDの命名規則: 「系統_名前」を、小文字の英数字とアンダースコアで書く。
 */
export const UNIT_ID_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;

const NUMBER_FIELDS = ['hp', 'move', 'defense', 'cost'] as const;

/** ユニット定義の書き間違いを、どの駒のどの項目か分かる形で知らせる */
export function validateUnitDefs(defs: UnitDefs): void {
  for (const [id, def] of Object.entries(defs)) {
    if (!UNIT_ID_PATTERN.test(id)) {
      throw new Error(`ユニット定義: 駒のID "${id}" が命名規則に合っていません(例: ground_tank)`);
    }
    if (typeof def.name !== 'string' || def.name === '') {
      throw new Error(`ユニット定義: "${id}" に name がありません`);
    }
    if (typeof def.short !== 'string' || def.short === '') {
      throw new Error(`ユニット定義: "${id}" に short(盤面表示の短い文字) がありません`);
    }
    for (const f of NUMBER_FIELDS) {
      if (!Number.isFinite(def[f])) throw new Error(`ユニット定義: "${id}" の ${f} が数値ではありません`);
    }
    if (def.domain !== 'ground' && def.domain !== 'air') {
      throw new Error(`ユニット定義: "${id}" の domain は "ground" か "air" にしてください`);
    }
    if (typeof def.category !== 'string' || def.category === '') {
      throw new Error(`ユニット定義: "${id}" に category がありません`);
    }
    if (typeof def.canCapture !== 'boolean') {
      throw new Error(`ユニット定義: "${id}" の canCapture(true/false) がありません`);
    }
    if (!Array.isArray(def.weapons)) {
      throw new Error(`ユニット定義: "${id}" に weapons(武装の配列) がありません`);
    }
    for (const w of def.weapons) {
      if (!Number.isFinite(w.power) || !Number.isFinite(w.ammo)) {
        throw new Error(`ユニット定義: "${id}" の武装 "${w.name}" の power/ammo が数値ではありません`);
      }
      if (w.minRange > w.range) {
        throw new Error(`ユニット定義: "${id}" の武装 "${w.name}" の minRange が range より大きくなっています`);
      }
    }
    if (typeof def.moveSfx !== 'string' || def.moveSfx === '') {
      throw new Error(`ユニット定義: "${id}" に moveSfx(移動効果音) がありません`);
    }
  }
}
