import { distance, key } from '../game/hex';
import { attack, boardUnit, canBoard, cargoList, cargoOf, confirmUnit, disembarkUnit, inRange, moveCostOf, moveUnit, reachable, resupplyFromAdjacentSupply, undoMove } from '../game/rules';
import { INCOME_POPULATION_UNIT, linesAt, producibleHexKeys, tileAt, townAt, unitAt } from '../game/state';
import { TERRAINS } from '../game/terrain';
import { getTheme } from '../game/themes';
import type { Cube, Game, Tile, Unit } from '../game/types';

export interface InputDeps {
  getGame(): Game;
  refresh(): void;
}

/** 左クリックのゲーム操作(Phaser 側から呼ぶ) */
export function handleHexClick({ getGame, refresh }: InputDeps, h: Cube): void {
  const g = getGame();
  if (g.over || g.busy) return;
  const t = tileAt(g, h);
  if (!t) {
    g.selected = null;
    g.selectedHex = null;
    g.reach = null;
    refresh();
    return;
  }
  if (t.terrain === 'fill') {
    // fill(埋め草)はマップ外と同じ扱い: 選択しない
    g.selected = null;
    g.selectedHex = null;
    g.reach = null;
    refresh();
    return;
  }
  // ユニットの有無によらず、クリックしたヘックスを選択状態にする
  g.selectedHex = t;

  const u = unitAt(g, t);
  const sel = g.selected;
  if (sel) {
    if (u === sel && !sel.acted) {
      confirmUnit(g, sel);
      g.selected = null;
      g.reach = null;
      refresh();
      return;
    }
    if (u && u.side === 'e' && !sel.acted && inRange(g, sel, u)) {
      attack(g, sel, u);
      g.selected = null;
      g.reach = null;
      refresh();
      return;
    }
    if (!u && g.reach?.has(key(t)) && !sel.moved) {
      moveUnit(g, sel, t, g.reach?.get(key(t)) ?? 0);
      g.reach = null;
      refresh();
      return;
    }
    // 搭乗: 歩兵を選択中に味方の輸送ユニット(トラック・ヘリ)をクリックしたら搭乗する。
    // 輸送側の行動前後は問わないが、歩兵の移動範囲内であることが条件
    if (u && u.side === 'p' && canBoard(g, sel, u)) {
      // 輸送ユニットを一時的に盤面から外して到達コストを測る
      const idx = g.units.indexOf(u);
      g.units.splice(idx, 1);
      const reach = reachable(g, sel);
      g.units.splice(idx, 0, u);
      const cost = reach.get(key(t));
      if (cost !== undefined) {
        boardUnit(g, sel, u, cost);
        g.selected = null;
        g.reach = null;
        refresh();
        return;
      }
    }
    // 降車: 輸送ユニットを選択中に、隣の空きヘックスをクリックしたら歩兵を降ろす(輸送側の行動前後は問わない)
    if (!u) {
      const cargo = cargoOf(g, sel);
      if (cargo && distance(sel, t) === 1 && moveCostOf(g, cargo, t) < Infinity) {
        if (disembarkUnit(g, sel, t)) {
          g.selected = null;
          g.reach = null;
          refresh();
          return;
        }
      }
    }
  }

  if (u && u.side === 'p' && !(u.moved && u.acted)) {
    resupplyFromAdjacentSupply(g, u); // 移動前: 補給ユニットに隣接していれば残弾回復
    g.selected = u;
    g.reach = u.moved ? null : reachable(g, u);
    g.message = `${g.defs[u.kind].name}を選択。移動先か攻撃対象をクリック。もう一度クリックすると行動を確定。`;
  } else {
    g.selected = null;
    g.reach = null;
  }
  refresh();
}

export function undoSelectedMove({ getGame, refresh }: InputDeps): boolean {
  const g = getGame();
  const s = g.selected;
  if (!s || !s.moved || s.acted || !s.from) return false;
  undoMove(g, s);
  g.reach = reachable(g, s);
  refresh();
  return true;
}

export function confirmSelected({ getGame, refresh }: InputDeps): boolean {
  const g = getGame();
  const s = g.selected;
  if (!s || s.acted) return false;
  confirmUnit(g, s);
  g.selected = null;
  g.reach = null;
  refresh();
  return true;
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const ownerName = (o: 'p' | 'e' | null): string => (o === 'p' ? 'あなた' : o === 'e' ? '敵' : '未占領');

/** 右クリックで表示するヘックス情報(都市・部隊・地形・道路河川・生産可否) */
export function describeHex(g: Game, t: Tile): string {
  const lines: string[] = [];
  const town = townAt(g, t);
  if (town) {
    lines.push(`<strong>🏙 ${esc(town.name)}${town.capital ? '(首都)' : ''}</strong>`);
    lines.push(`人口: ${town.population.toLocaleString('ja-JP')}人 / 占領: ${ownerName(town.owner)}`);
    lines.push(`収入: +${Math.max(1, Math.floor(town.population / INCOME_POPULATION_UNIT))}/ターン(占領時)`);
    lines.push('占領できるのは占領可能なユニットのみ');
  }
  const u = unitAt(g, t);
  if (u) {
    const def = g.defs[u.kind];
    lines.push(`<strong>${u.side === 'p' ? '味方' : '敵'}: ${esc(def.name)}(${def.domain === 'air' ? '航空' : '地上'})</strong>`);
    lines.push(`HP ${u.hp}/${def.hp} / 移動 ${def.move} / 防御 ${def.defense} / 武装 ${def.weapons.map((w) => w.name).join('・') || 'なし'}`);
    if (u.side === 'p') lines.push(u.acted ? '行動済み' : u.moved ? '移動済み(攻撃・確定が可能)' : '未行動');
  }
  const terrain = TERRAINS[t.terrain];
  lines.push(`地形: ${terrain.label}(地上の移動コスト ${terrain.moveCost === Infinity ? '通行不可' : terrain.moveCost} / 地上の防御 +${terrain.defense}、航空は地形無視)`);
  const airport = g.airports.find((a) => a.hexId === t.id);
  if (airport) lines.push(`空港「${airport.name}」: 所有 ${airport.owner === 'p' ? '味方' : airport.owner === 'e' ? '敵' : 'なし'}。戦闘機の生産・補充・補給が可能(ヘリも可)${town ? '(townと同一ヘックスのため空港としては扱わない)' : ''}`);
  if (t.hasRoad && t.hasRiver) lines.push('橋: 道路と河川が重なるため移動コスト1');
  else if (t.hasRoad) lines.push('道路あり: 移動コスト1');
  else if (t.hasRiver) lines.push('河川あり: 地上は移動不可(コスト255)');
  lines.push(`座標: col ${t.col} / row ${t.row} / ヘックス #${t.id}`);
  if (!town && t.city) {
    lines.push(`拠点: ${t.city.capital ? '城(首都)' : '村'} / 所有: ${ownerName(t.city.owner)}`);
  }
  for (const l of linesAt(g, t)) {
    lines.push(`${l.kind === 'road' ? '道路' : '河川'}: ${esc(l.name)}`);
  }
  if (!u && producibleHexKeys(g, 'p').has(key(t))) {
    lines.push('<strong>生産可能ヘックス</strong>(下のメニューから生産)');
  }
  return lines.join('<br>');
}

/** ユニット情報(左ペイン表示用)。武装と残弾も出す */
export function describeUnit(g: Game, u: Unit): string {
  const cargos = cargoList(g, u);
  const extra: string[] = [];
  if (u.carriedBy) extra.push(`${g.defs[u.carriedBy.kind].name}に搭乗中`);
  if (cargos.length > 0) extra.push(`${cargos.map((c) => g.defs[c.kind].name).join('・')}が搭乗中(隣の空きマスをクリックで降車)`);
  else if (g.defs[u.kind].transport) extra.push(`歩兵を${g.defs[u.kind].transport}体まで搭乗させられる(歩兵がクリック)`);
  const def = g.defs[u.kind];
  const t = tileAt(g, u);
  const theme = getTheme(g.settings.theme);
  const lines = [
    `<b>${def.name}</b>(${u.side === 'p' ? '味方' : '敵'})`,
    `HP ${u.hp}/${def.hp} / 移動 ${def.move} / 防御 ${def.defense} / 燃料 ${u.fuel}/${def.fuel} / ${def.domain === 'air' ? '航空' : '地上'}`,
    `位置: col ${t?.col ?? '?'} / row ${t?.row ?? '?'}(${t ? theme.terrainLabels[t.terrain] : '?'})`,
    `状態: ${u.acted ? '行動済み' : u.moved ? '移動済み(攻撃・確定が可能)' : '未行動'}`,
  ];
  for (const e of extra) lines.push(e);
  if (def.canCapture) lines.push('このユニットは town を占領できます。');
  if (def.isSupply) lines.push('補給ユニット: 隣接する味方の残弾・燃料を回復します。');
  if (def.weapons.length === 0) {
    lines.push('武装なし(攻撃できません)');
  } else {
    for (const w of def.weapons) {
      const ammo = !g.settings.supply || w.ammo < 0 ? '∞' : `${u.ammo[w.name] ?? 0}/${w.ammo}`;
      lines.push(`武装: ${w.name}(威力${w.power} 射程${w.minRange}〜${w.range} 残弾${ammo})`);
    }
  }
  return lines.join('<br>');
}
