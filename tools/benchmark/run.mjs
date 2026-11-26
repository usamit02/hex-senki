#!/usr/bin/env node
/**
 * ヘックス戦記 AIベンチマーク: 2つのAIコントローラをヘッドレスで対戦させ、スコアを計る。
 *
 * 使い方:
 *   node tools/benchmark/run.mjs [--hex path] [--map path] [--units path]
 *                                [--ai-p legacy] [--ai-e new] [--turns N]
 *                                [--games N] [--seed N] [--theme modern] [--log]
 *
 * - 打ち切りターン数の標準は、fill を除く実マップの (短辺+長辺)/2。
 * - スコアは占領town数(人口は無関係)。首都占領・全滅+生産不能はその時点で勝敗確定。
 * - コントローラ: legacy(現行の簡易AI) / new(新AI) / none(何もしない)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const hexPath = path.resolve(arg('hex', path.join(root, 'public', 'hex.json')));
const mapPath = path.resolve(arg('map', path.join(root, 'public', 'map.json')));
const unitsPath = path.resolve(arg('units', path.join(root, 'public', 'units.json')));
const theme = arg('theme', 'modern');
const aiP = arg('ai-p', 'legacy');
const aiE = arg('ai-e', 'legacy');
const games = parseInt(arg('games', '1'), 10);
const baseSeed = parseInt(arg('seed', '1'), 10);
const verbose = process.argv.includes('--log');

// --- ゲームロジックを CommonJS にコンパイルする(data.ts などブラウザ専用は除く) ---
const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hexsenki-bench-'));
const srcFiles = [
  'src/game/types.ts', 'src/game/hex.ts', 'src/game/terrain.ts', 'src/game/state.ts',
  'src/game/rules.ts', 'src/game/ai/ai.ts', 'src/game/ai/planner.ts',
].filter((f) => fs.existsSync(path.join(root, f)));
execFileSync(
  path.join(root, 'node_modules', '.bin', 'tsc'),
  [...srcFiles.map((f) => path.join(root, f)), '--module', 'commonjs', '--target', 'es2022',
   '--esModuleInterop', '--skipLibCheck', '--ignoreConfig', '--outDir', buildDir],
  { stdio: 'inherit' },
);
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const state = require(path.join(buildDir, 'state.js'));
const rules = require(path.join(buildDir, 'rules.js'));
const legacy = require(path.join(buildDir, 'ai', 'ai.js'));
let planner = null;
try { planner = require(path.join(buildDir, 'ai', 'planner.js')); } catch { /* 新AI未実装時 */ }

// --- データ読み込み ---
const hexData = JSON.parse(fs.readFileSync(hexPath, 'utf8'));
const mapCfg = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const allDefs = JSON.parse(fs.readFileSync(unitsPath, 'utf8'));
const defs = allDefs[theme] ?? allDefs;

// fill を除く実マップの大きさから、標準の打ち切りターン数を出す
function defaultTurnCap() {
  let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const h of hexData.hexes) {
    if (h.terrain === 'fill') continue;
    minC = Math.min(minC, h.col); maxC = Math.max(maxC, h.col);
    minR = Math.min(minR, h.row); maxR = Math.max(maxR, h.row);
  }
  const w = maxC - minC + 1, hgt = maxR - minR + 1;
  return Math.round((Math.min(w, hgt) + Math.max(w, hgt)) / 2);
}
const turnCap = parseInt(arg('turns', String(defaultTurnCap())), 10);

// --- 再現可能な乱数(Math.random を差し替える) ---
function seedRandom(seed) {
  let a = seed >>> 0;
  Math.random = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- コントローラ ---
function legacyController(g, side) {
  legacy.enemyProduce(g, side);
  for (const u of state.liveUnits(g, side)) {
    if (g.over) break;
    if (u.hp > 0 && !u.acted) legacy.enemyAct(g, u);
  }
}
function newController(g, side, budgetMs) {
  if (!planner) throw new Error('新AI(planner)が未実装です');
  planner.playTurn(g, side, { budgetMs });
}
const budgetMs = parseInt(arg('budget-ms', '3000'), 10);
const controllers = {
  legacy: (g, side) => legacyController(g, side),
  new: (g, side) => newController(g, side, budgetMs),
  none: () => {},
};

// --- 勝敗判定(checkGameOver と同じ条件を陣営視点で) ---
function winnerOf(g) {
  const broke = (s) => state.liveUnits(g, s).length === 0 && g.gold[s] < state.cheapestCost(g);
  const annihilated = (s) => state.liveUnits(g, s).length === 0 && state.capitalOf(g, s) === null;
  const pCap = state.capitalOf(g, 'p');
  const eCap = state.capitalOf(g, 'e');
  if ((pCap && pCap.city?.owner === 'e') || broke('p') || annihilated('p')) return 'e';
  if ((eCap && eCap.city?.owner === 'p') || broke('e') || annihilated('e')) return 'p';
  return null;
}

function playOneGame(seed) {
  seedRandom(seed);
  const map = {
    ...mapCfg,
    hexes: hexData.hexes, roads: hexData.roads || [], rivers: hexData.rivers || [],
    towns: hexData.towns || [], airports: hexData.airports || [],
  };
  const settings = {
    theme, gold: null, incomeMul: 1, maxUnits: 199,
    zoc: false, supply: true, supplyTiered: false, production: true, counter: true,
  };
  const g = state.createGame(defs, map, settings);
  const firstTurn = { p: true, e: true };
  const playSide = (side, ctrl) => {
    if (!firstTurn[side]) g.gold[side] += state.income(g, side);
    firstTurn[side] = false;
    for (const u of g.units) if (u.side === side) u.moved = u.acted = false;
    state.resupplyOnOwnedTowns(g, side);
    ctrl(g, side);
    rules.settleCaptures(g, side);
  };
  let winner = null;
  for (let turn = 1; turn <= turnCap; turn++) {
    g.turn = turn;
    playSide('p', controllers[aiP]);
    winner = winnerOf(g);
    if (!winner) { playSide('e', controllers[aiE]); winner = winnerOf(g); }
    if (verbose) {
      const tp = g.towns.filter((t) => t.owner === 'p').length;
      const te = g.towns.filter((t) => t.owner === 'e').length;
      console.log(`  turn ${turn}: towns p=${tp} e=${te}, units p=${state.liveUnits(g, 'p').length} e=${state.liveUnits(g, 'e').length}, gold p=${g.gold.p} e=${g.gold.e}`);
    }
    if (winner) return { winner, turns: turn, decided: true };
  }
  const tp = g.towns.filter((t) => t.owner === 'p').length;
  const te = g.towns.filter((t) => t.owner === 'e').length;
  return { winner: tp > te ? 'p' : te > tp ? 'e' : 'draw', turns: turnCap, decided: false, townsP: tp, townsE: te };
}

console.log(`benchmark: p=${aiP} vs e=${aiE}, turns<=${turnCap}, games=${games}, hex=${path.basename(hexPath)}`);
const tally = { p: 0, e: 0, draw: 0 };
for (let i = 0; i < games; i++) {
  const t0 = Date.now();
  const r = playOneGame(baseSeed + i);
  tally[r.winner === 'draw' ? 'draw' : r.winner]++;
  console.log(`game ${i + 1}: winner=${r.winner}${r.decided ? ` (決着 turn ${r.turns})` : ` (打ち切り towns p=${r.townsP} e=${r.townsE})`} [${Date.now() - t0}ms]`);
}
console.log(`result: p ${tally.p}勝 / e ${tally.e}勝 / draw ${tally.draw}`);
