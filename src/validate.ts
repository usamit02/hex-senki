import { CATEGORIES, type UnitDefs } from './types';

/**
 * 駒のIDの命名規則: 「系統_名前」を、小文字の英数字とアンダースコアで書く。
 * 系統は移動区分+役割が分かる名前にする(例: ground_tank, ground_sam, air_jet, air_heli, ground_infantry)。
 */
export const UNIT_ID_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;

const NUMBER_FIELDS = ['hp', 'move', 'attack', 'defense', 'minRange', 'range', 'cost'] as const;

/** units.json の書き間違いを、どの駒のどの項目か分かる形で知らせる */
export function validateUnitDefs(defs: UnitDefs): void {
  for (const [id, def] of Object.entries(defs)) {
    if (!UNIT_ID_PATTERN.test(id)) {
      throw new Error(
        `units.json: 駒のID "${id}" が命名規則に合っていません(例: ground_tank。「系統_名前」を小文字の英数字とアンダースコアで書く)`,
      );
    }
    if (typeof def.name !== 'string' || def.name === '') {
      throw new Error(`units.json: "${id}" に name がありません`);
    }
    if (typeof def.short !== 'string' || def.short === '') {
      throw new Error(`units.json: "${id}" に short(盤面表示の短い文字) がありません`);
    }
    for (const f of NUMBER_FIELDS) {
      if (!Number.isFinite(def[f])) throw new Error(`units.json: "${id}" の ${f} が数値ではありません`);
    }
    if (def.minRange > def.range) {
      throw new Error(`units.json: "${id}" の minRange が range より大きくなっています`);
    }
    if (def.domain !== 'ground' && def.domain !== 'air') {
      throw new Error(`units.json: "${id}" の domain は "ground" か "air" にしてください`);
    }
    if (!CATEGORIES.includes(def.category)) {
      throw new Error(`units.json: "${id}" の category は ${CATEGORIES.join(' / ')} のいずれかにしてください`);
    }
    if (typeof def.model !== 'string' || def.model === '') {
      throw new Error(`units.json: "${id}" に model(3Dモデルの名前) がありません`);
    }
    if (typeof def.canCapture !== 'boolean') {
      throw new Error(`units.json: "${id}" の canCapture(true/false) がありません`);
    }
    if (!def.vs || typeof def.vs !== 'object') {
      throw new Error(`units.json: "${id}" に vs(カテゴリごとの攻撃倍率) がありません`);
    }
    for (const c of CATEGORIES) {
      if (!Number.isFinite(def.vs[c])) {
        throw new Error(`units.json: "${id}" の vs.${c} が数値ではありません`);
      }
    }
  }
}
