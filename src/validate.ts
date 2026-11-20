import type { UnitDefs } from './types';

/**
 * 駒のIDの命名規則: 「系統_名前」を、小文字の英数字とアンダースコアで書く。
 * 例: infantry_swordsman, ranged_archer, cavalry_knight, siege_catapult
 * 先頭の「系統」は、歩兵(infantry)・弓や魔法などの遠距離(ranged)・騎兵(cavalry)・攻城(siege)など。
 */
export const UNIT_ID_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;

const NUMBER_FIELDS = ['hp', 'move', 'attack', 'minRange', 'range', 'cost'] as const;

/** units.json の書き間違いを、どの駒のどの項目か分かる形で知らせる */
export function validateUnitDefs(defs: UnitDefs): void {
  for (const [id, def] of Object.entries(defs)) {
    if (!UNIT_ID_PATTERN.test(id)) {
      throw new Error(
        `units.json: 駒のID "${id}" が命名規則に合っていません(例: infantry_swordsman。「系統_名前」を小文字の英数字とアンダースコアで書く)`,
      );
    }
    if (typeof def.name !== 'string' || def.name === '') {
      throw new Error(`units.json: "${id}" に name がありません`);
    }
    for (const f of NUMBER_FIELDS) {
      if (!Number.isFinite(def[f])) throw new Error(`units.json: "${id}" の ${f} が数値ではありません`);
    }
    if (def.minRange > def.range) {
      throw new Error(`units.json: "${id}" の minRange が range より大きくなっています`);
    }
  }
}
