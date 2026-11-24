import Phaser from 'phaser';
import { boardSize, fromPixel, key, toPixel } from './hex';
import { inRange } from './rules';
import { townAt, unitAt } from './state';
import { TERRAINS } from './terrain';
import type { Cube, Game, Tile } from './types';

/**
 * 要件2: 描画は Phaser(メインスレッド)にアップグレード。
 * - マップ全面表示、ホイールでマウス位置中心の拡大/縮小、ドラッグでスクロール
 * - 要件4: 道路・河川は編集アプリと同じ接続パターン(中心→辺の中点→中心の折れ線)
 * - 要件5: 都市は hex.json towns をヘックス中央にアイコン表示
 */

export const HEX_SIZE = 30;

export interface BoardCallbacks {
  onHexClick(c: Cube): void;
  onHexRightClick(c: Cube | null, screen: { x: number; y: number }): void;
}

/** 3Dモデル表示用: ユニットの画面(CSSピクセル)位置と大きさ */
export interface UnitView {
  unit: import('./types').Unit;
  x: number;
  y: number;
  /** ヘックス半径の画面ピクセル */
  size: number;
}

let modelsActive = false;
/** 3Dモデル層(render3d.ts)が使えるようになったら true にする。false の間は2Dの駒を描く */
export function setModelsActive(v: boolean): void {
  modelsActive = v;
}
export function getModelsActive(): boolean {
  return modelsActive;
}

/** 現在のカメラで全ユニットの画面位置を返す(3Dモデル層が毎フレーム使う) */
export function getUnitViews(g: Game): UnitView[] {
  return boardBridge.scene?.unitViews(g) ?? [];
}

export interface Renderer {
  start(g: Game, cb: BoardCallbacks): void;
  draw(g: Game): void;
  fitView(): void;
}

const ROAD_NATIONAL = 0xd94f30;
const ROAD_OTHER = 0xe0aa3e;
const RIVER_COLOR = 0x5b8fd6;
const NEUTRAL = 0x8a8a8a;

const hexToInt = (css: string): number => parseInt(css.slice(1), 16);

function hexCorners(x: number, y: number, size: number, k = 1): Phaser.Types.Math.Vector2Like[] {
  const pts: Phaser.Types.Math.Vector2Like[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i);
    pts.push({ x: x + size * k * Math.cos(a), y: y + size * k * Math.sin(a) });
  }
  return pts;
}

/**
 * 編集アプリ path_render_points と同じ点列:
 * 中心 → 隣ヘックスとの辺の中点(=中心同士の中点) → 中心 → …
 */
export function pathRenderPoints(tiles: Cube[], size = HEX_SIZE): Array<{ x: number; y: number }> {
  const centers = tiles.map((t) => toPixel(t, size));
  if (centers.length < 2) return centers;
  const pts = [centers[0]];
  for (let i = 1; i < centers.length; i++) {
    pts.push({ x: (centers[i - 1].x + centers[i].x) / 2, y: (centers[i - 1].y + centers[i].y) / 2 });
    pts.push(centers[i]);
  }
  return pts;
}

/** main.ts と Scene の受け渡し用(Scene の生成タイミングに依存しないよう共有する) */
export const boardBridge: {
  game: Game | null;
  cb: BoardCallbacks | null;
  scene: BoardScene | null;
} = { game: null, cb: null, scene: null };

class BoardScene extends Phaser.Scene {
  private gameRef: Game | null = null;
  private cb: BoardCallbacks | null = null;
  private gTerrain!: Phaser.GameObjects.Graphics;
  private gLines!: Phaser.GameObjects.Graphics;
  private gHighlight!: Phaser.GameObjects.Graphics;
  private gTowns!: Phaser.GameObjects.Graphics;
  private townLabels: Phaser.GameObjects.Text[] = [];
  private unitLayer!: Phaser.GameObjects.Container;
  private glyphLayer!: Phaser.GameObjects.Container;
  private builtFor: Game | null = null;
  private downPos: { x: number; y: number } | null = null;
  private downButton = -1;
  private dragged = false;
  private labelsVisible = true;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
  private wasd: Record<string, Phaser.Input.Keyboard.Key> | null = null;

  constructor() {
    super('board');
  }

  setGame(g: Game): void {
    this.gameRef = g;
  }

  /** 3Dモデル層用: ユニットの画面座標(CSSピクセル)をカメラの worldView から換算する */
  unitViews(g: Game): UnitView[] {
    const cam = this.cameras.main;
    const wv = cam.worldView;
    const out: UnitView[] = [];
    for (const u of g.units) {
      if (u.hp <= 0) continue;
      const p = toPixel(u, HEX_SIZE);
      out.push({ unit: u, x: (p.x - wv.x) * cam.zoom, y: (p.y - wv.y) * cam.zoom, size: HEX_SIZE * cam.zoom });
    }
    return out;
  }

  /** 新規ゲーム用: Scene は作り直さず、静的レイヤーだけ再構築して全体表示に戻す */
  reset(g: Game): void {
    this.gameRef = g;
    this.builtFor = null;
    this.fitView();
    this.refresh();
  }

  create(): void {
    this.gameRef = boardBridge.game;
    this.cb = boardBridge.cb;
    boardBridge.scene = this;
    this.input.mouse?.disableContextMenu();
    this.gTerrain = this.add.graphics().setDepth(0);
    this.gLines = this.add.graphics().setDepth(1);
    this.glyphLayer = this.add.container(0, 0).setDepth(2);
    this.gTowns = this.add.graphics().setDepth(3);
    this.gHighlight = this.add.graphics().setDepth(4);
    this.unitLayer = this.add.container(0, 0).setDepth(5);

    const cam = this.cameras.main;
    cam.setBackgroundColor('#20262e');
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys('W,A,S,D') as Record<string, Phaser.Input.Keyboard.Key>;
    }

    // ホイール: ポインタ位置を中心に拡大/縮小
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _objs: unknown, _dx: number, dy: number) => {
      const before = pointer.positionToCamera(cam) as { x: number; y: number };
      const zoom = Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.88 : 1.14), 0.05, 3.5);
      cam.setZoom(zoom);
      const after = pointer.positionToCamera(cam) as { x: number; y: number };
      cam.scrollX += before.x - after.x;
      cam.scrollY += before.y - after.y;
    });

    // ドラッグでスクロール / 動かなければクリックとして扱う
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.downPos = { x: p.x, y: p.y };
      this.downButton = p.button;
      this.dragged = false;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.isDown || !this.downPos) return;
      const dx = p.x - (p.prevPosition?.x ?? p.x);
      const dy = p.y - (p.prevPosition?.y ?? p.y);
      if (Math.abs(p.x - this.downPos.x) + Math.abs(p.y - this.downPos.y) > 6) this.dragged = true;
      if (this.dragged) {
        cam.scrollX -= dx / cam.zoom;
        cam.scrollY -= dy / cam.zoom;
      }
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const wasDrag = this.dragged;
      const button = this.downButton;
      this.downPos = null;
      this.dragged = false;
      if (wasDrag || !this.cb || !this.gameRef) return;
      const world = p.positionToCamera(cam) as { x: number; y: number };
      const cube = fromPixel(world.x, world.y, HEX_SIZE);
      const exists = this.gameRef.tiles.has(key(cube));
      if (button === 2 || p.rightButtonReleased()) {
        const ev = p.event as MouseEvent;
        this.cb.onHexRightClick(exists ? cube : null, { x: ev.clientX ?? p.x, y: ev.clientY ?? p.y });
      } else if (button === 0) {
        if (exists) this.cb.onHexClick(cube);
      }
    });

    this.fitView();
    this.refresh();
  }

  fitView(): void {
    const g = this.gameRef;
    if (!g) return;
    const { w, h } = boardSize(g.width, g.height, HEX_SIZE);
    const cam = this.cameras.main;
    const zoom = Math.min(cam.width / (w + 40), cam.height / (h + 40));
    cam.setZoom(Phaser.Math.Clamp(zoom, 0.05, 3.5));
    cam.centerOn(w / 2, h / 2);
  }

  update(): void {
    const cam = this.cameras.main;
    const speed = 14 / cam.zoom;
    if (this.cursors && this.wasd) {
      if (this.cursors.left.isDown || this.wasd.A.isDown) cam.scrollX -= speed;
      if (this.cursors.right.isDown || this.wasd.D.isDown) cam.scrollX += speed;
      if (this.cursors.up.isDown || this.wasd.W.isDown) cam.scrollY -= speed;
      if (this.cursors.down.isDown || this.wasd.S.isDown) cam.scrollY += speed;
    }
    // 都市名ラベルは拡大時のみ表示(縮小時はアイコンのみで見やすく)
    const showLabels = cam.zoom >= 0.55;
    if (this.labelsVisible !== showLabels) {
      this.labelsVisible = showLabels;
      for (const t of this.townLabels) t.setVisible(showLabels);
    }
  }

  refresh(): void {
    const g = this.gameRef;
    if (!g) return;
    if (this.builtFor !== g) {
      this.builtFor = g;
      this.buildStatic(g);
    }
    this.drawTowns(g);
    this.drawHighlight(g);
    this.drawUnits(g);
  }

  private buildStatic(g: Game): void {
    const size = HEX_SIZE;
    // --- 地形 ---
    const gt = this.gTerrain;
    gt.clear();
    for (const t of g.tiles.values()) {
      const { x, y } = toPixel(t, size);
      const pts = hexCorners(x, y, size, 0.97);
      gt.fillStyle(hexToInt(TERRAINS[t.terrain].color), 1);
      gt.fillPoints(pts, true);
      gt.lineStyle(1, 0x283c32, 0.45);
      gt.strokePoints(pts, true);
      if (t.city) {
        const color = t.city.owner === 'p' ? 0x1f6fb5 : t.city.owner === 'e' ? 0xc2392f : NEUTRAL;
        gt.lineStyle(3, color, 1);
        gt.strokePoints(hexCorners(x, y, size, 0.8), true);
      }
    }
    // 地形文字(ヘックス数が多い場合は省略して軽量化)
    this.glyphLayer.removeAll(true);
    if (g.tiles.size <= 4000) {
      for (const t of g.tiles.values()) {
        const glyph = TERRAINS[t.terrain].glyph;
        if (!glyph) continue;
        const { x, y } = toPixel(t, size);
        const txt = this.add.text(x, y + size * 0.52, glyph, {
          fontSize: '12px', color: 'rgba(30,50,30,0.65)',
        }).setOrigin(0.5);
        this.glyphLayer.add(txt);
        if (t.city) {
          const cTxt = this.add.text(x, y - size * 0.55, t.city.capital ? '城' : '村', {
            fontSize: '12px', color: '#1c2530', fontStyle: 'bold',
          }).setOrigin(0.5);
          this.glyphLayer.add(cTxt);
        }
      }
    }

    // --- 道路・河川(編集アプリと同じ接続パターン) ---
    const gl = this.gLines;
    gl.clear();
    const townHexIds = new Set(g.towns.map((t) => t.hexId));
    const tileByKey = (c: Cube): Tile | undefined => g.tiles.get(key(c));
    const drawLine = (tiles: Cube[], color: number, width: number, kind: 'road' | 'river') => {
      const centers = tiles.map((t) => toPixel(t, size));
      for (let i = 0; i < tiles.length; i++) {
        const tile = tileByKey(tiles[i]);
        if (!tile) continue;
        // 編集アプリのルール: 河川は水・沼ヘックス内に描かない。道路・河川とも都市ヘックス内に描かない(隣接は辺の中点まで)
        const suppressed =
          townHexIds.has(tile.id) ||
          (kind === 'river' && (tile.terrain === 'water' || tile.terrain === 'marsh'));
        if (suppressed) continue;
        gl.lineStyle(width, color, 0.9);
        if (i > 0) {
          const mid = { x: (centers[i - 1].x + centers[i].x) / 2, y: (centers[i - 1].y + centers[i].y) / 2 };
          gl.beginPath(); gl.moveTo(mid.x, mid.y); gl.lineTo(centers[i].x, centers[i].y); gl.strokePath();
        }
        if (i < tiles.length - 1) {
          const mid = { x: (centers[i].x + centers[i + 1].x) / 2, y: (centers[i].y + centers[i + 1].y) / 2 };
          gl.beginPath(); gl.moveTo(centers[i].x, centers[i].y); gl.lineTo(mid.x, mid.y); gl.strokePath();
        }
      }
    };
    for (const r of g.rivers) drawLine(r.tiles, RIVER_COLOR, size * 0.2, 'river');
    for (const r of g.roads) {
      const national = r.name.includes('国道');
      drawLine(r.tiles, national ? ROAD_NATIONAL : ROAD_OTHER, size * (national ? 0.26 : 0.2), 'road');
    }

    // --- 都市名ラベル(静的)。アイコンと所有リングは占領で変わるため drawTowns で毎回描く ---
    for (const t of this.townLabels) t.destroy();
    this.townLabels = [];
    for (const town of g.towns) {
      const { x, y } = toPixel(town.at, size);
      const label = this.add.text(x, y + size * 0.48, town.capital ? `★${town.name}` : town.name, {
        fontSize: '11px', color: '#ffffff',
        backgroundColor: 'rgba(20,26,34,0.55)', padding: { x: 3, y: 1 },
      }).setOrigin(0.5, 0).setDepth(3);
      this.townLabels.push(label);
    }
    this.labelsVisible = this.cameras.main.zoom >= 0.55;
    for (const t of this.townLabels) t.setVisible(this.labelsVisible);
  }

  /** 都市アイコン+所有リング(占領状態で変わるため refresh のたびに描き直す) */
  private drawTowns(g: Game): void {
    const size = HEX_SIZE;
    const gtw = this.gTowns;
    gtw.clear();
    const cs = getComputedStyle(document.documentElement);
    const player = hexToInt(cs.getPropertyValue('--pl').trim() || '#1f6fb5');
    const enemy = hexToInt(cs.getPropertyValue('--en').trim() || '#c2392f');
    for (const town of g.towns) {
      const { x, y } = toPixel(town.at, size);
      const ring = town.owner === 'p' ? player : town.owner === 'e' ? enemy : NEUTRAL;
      gtw.lineStyle(town.capital ? 4 : 2, ring, 1);
      gtw.strokeCircle(x, y, size * 0.44);
      // ビル群アイコン
      gtw.fillStyle(0x2f3b4c, 1);
      gtw.fillRect(x - size * 0.34, y - size * 0.05, size * 0.2, size * 0.34);
      gtw.fillRect(x - size * 0.1, y - size * 0.3, size * 0.26, size * 0.59);
      gtw.fillRect(x + size * 0.2, y - size * 0.12, size * 0.18, size * 0.41);
      gtw.fillStyle(0xf5d76e, 1);
      gtw.fillRect(x - size * 0.04, y - size * 0.2, size * 0.05, size * 0.07);
      gtw.fillRect(x + size * 0.05, y - size * 0.08, size * 0.05, size * 0.07);
      gtw.fillRect(x - size * 0.28, y + size * 0.05, size * 0.05, size * 0.07);
    }
  }

  private drawHighlight(g: Game): void {
    const size = HEX_SIZE;
    const gh = this.gHighlight;
    gh.clear();
    // 選択中ヘックス(ユニットの有無によらず左クリックで選択される)
    if (g.selectedHex) {
      const { x, y } = toPixel(g.selectedHex, size);
      gh.lineStyle(3, 0x22d3ee, 1);
      gh.strokePoints(hexCorners(x, y, size, 0.97), true);
      gh.fillStyle(0x22d3ee, 0.12);
      gh.fillPoints(hexCorners(x, y, size, 0.97), true);
    }
    if (g.reach) {
      for (const k of g.reach.keys()) {
        const t = g.tiles.get(k);
        if (!t || unitAt(g, t)) continue;
        const { x, y } = toPixel(t, size);
        gh.fillStyle(0xffe650, 0.5);
        gh.fillPoints(hexCorners(x, y, size, 0.9), true);
      }
    }
    const sel = g.selected;
    if (sel) {
      const { x, y } = toPixel(sel, size);
      gh.lineStyle(3, 0xffffff, 1);
      gh.strokePoints(hexCorners(x, y, size, 0.95), true);
      if (!sel.acted) {
        for (const d of g.units) {
          if (d.hp > 0 && d.side === 'e' && inRange(g, sel, d)) {
            const p = toPixel(d, size);
            gh.lineStyle(3, 0xff2d2d, 1);
            gh.strokePoints(hexCorners(p.x, p.y, size, 0.95), true);
          }
        }
      }
    }
    // townAt 参照を型チェックに使う(将来のホバー表示用)
    void townAt;
  }

  private drawUnits(g: Game): void {
    const size = HEX_SIZE;
    this.unitLayer.removeAll(true);
    const cs = getComputedStyle(document.documentElement);
    const player = hexToInt(cs.getPropertyValue('--pl').trim() || '#1f6fb5');
    const enemy = hexToInt(cs.getPropertyValue('--en').trim() || '#c2392f');
    for (const u of g.units) {
      if (u.hp <= 0) continue;
      const { x, y } = toPixel(u, size);
      const c = this.add.container(x, y);
      const circle = this.add.graphics();
      // 影(3Dモデル表示時も共通)
      circle.fillStyle(0x000000, 0.28);
      circle.fillEllipse(0, size * 0.42, size * 0.82, size * 0.3);
      if (!modelsActive) {
        circle.fillStyle(u.side === 'p' ? player : enemy, 1);
        circle.fillCircle(0, 0, size * 0.5);
      }
      if (g.selected === u) {
        circle.lineStyle(3, 0xffffff, 1);
        circle.strokeCircle(0, 0, size * 0.52);
      }
      const hp = this.add.text(size * 0.55, size * 0.5, String(u.hp), {
        fontSize: `${Math.round(size * 0.32)}px`, color: '#ffffff', fontStyle: 'bold',
        backgroundColor: 'rgba(20,26,34,0.55)', padding: { x: 2, y: 0 },
      }).setOrigin(0.5);
      if (modelsActive) {
        c.add([circle, hp]);
      } else {
        const name = this.add.text(0, -1, g.defs[u.kind].short, {
          fontSize: `${Math.round(size * 0.5)}px`, color: '#ffffff', fontStyle: 'bold',
        }).setOrigin(0.5);
        c.add([circle, name, hp]);
      }
      if (u.side === 'p' && u.moved && u.acted) c.setAlpha(0.45);
      this.unitLayer.add(c);
    }
  }
}

export function createRenderer(parent: HTMLElement): Renderer {
  let phaserGame: Phaser.Game | null = null;

  return {
    start(g, cb) {
      boardBridge.game = g;
      boardBridge.cb = cb;
      if (phaserGame) {
        boardBridge.scene?.reset(g);
        return;
      }
      phaserGame = new Phaser.Game({
        type: Phaser.AUTO,
        parent,
        backgroundColor: '#20262e',
        scale: {
          mode: Phaser.Scale.RESIZE,
          width: '100%',
          height: '100%',
        },
        render: { antialias: true },
        scene: BoardScene,
      });
    },
    draw(g) {
      boardBridge.game = g;
      boardBridge.scene?.setGame(g);
      boardBridge.scene?.refresh();
    },
    fitView() {
      boardBridge.scene?.fitView();
    },
  };
}
