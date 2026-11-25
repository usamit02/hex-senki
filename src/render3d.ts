import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getUnitViews, loadedModelKeys, setModelsActive, type UnitView } from './render';
import type { Game, Side, Unit, UnitDefs } from './types';

/**
 * ユニットの3Dモデル表示層。
 * Phaser の canvas の上に透明な Three.js の canvas を重ね、各ユニットの画面位置に
 * シザー(切り抜き)描画で GLB モデルを表示する。
 * - 未行動のユニットはゆっくり Y 回転する
 * - 行動済みのユニットは静止する
 * - 読み込みに失敗した場合は何もせず、Phaser 側の2D駒表示のままになる
 */

const base = import.meta.env.BASE_URL;
const ROTATE_SPEED = 0.9;
/** 行動済みユニットの固定の向き(右斜め前) */
const ACTED_YAW = -Math.PI / 6; // rad/s
const VIEWPORT_FACTOR = 2.6; // ヘックス半径に対するモデル表示枠の倍率

interface Instance {
  scene: THREE.Scene;
  model: THREE.Group;
  side: Side;
  kind: string;
}

export class UnitModelLayer {
  onAvailable: ((ok: boolean) => void) | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private camera: THREE.PerspectiveCamera;
  private templates = new Map<string, THREE.Object3D>();
  private instances = new Map<Unit, Instance>();
  private loader = new GLTFLoader();
  private lastTime = performance.now();
  private running = false;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this.camera.position.set(0, 1.55, 3.2);
    this.camera.lookAt(0, 0.45, 0);
  }

  /** 全ユニット種×陣営のモデルを読み込む。1つでも成功したら onAvailable(true) */
  async loadModels(defs: UnitDefs): Promise<void> {
    const jobs: Array<Promise<void>> = [];
    const kinds = new Set(Object.values(defs).map((d) => d.model).filter((m) => m !== ''));
    for (const model of kinds) {
      for (const side of ['p', 'e'] as Side[]) {
        const color = side === 'p' ? 'blue' : 'red';
        const url = `${base}models/${model}_${color}.glb`;
        jobs.push(
          this.loader.loadAsync(url).then((gltf) => {
            this.templates.set(`${model}:${side}`, normalize(gltf.scene));
            loadedModelKeys.add(`${model}:${side}`);
          }).catch(() => {
            // そのモデルは2D表示のまま
          }),
        );
      }
    }
    await Promise.all(jobs);
    if (this.templates.size > 0) {
      this.ensureRenderer();
      setModelsActive(this.renderer !== null);
      this.onAvailable?.(this.renderer !== null);
    }
  }

  private ensureRenderer(): void {
    if (this.renderer) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.id = 'models-layer';
      document.body.append(canvas);
      this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      this.renderer.setPixelRatio(window.devicePixelRatio || 1);
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.autoClear = false;
      window.addEventListener('resize', () => {
        this.renderer?.setSize(window.innerWidth, window.innerHeight, false);
      });
    } catch {
      this.renderer = null;
    }
  }

  /** 毎フレーム同期ループを開始する */
  start(getGame: () => Game | null): void {
    if (this.running) return;
    this.running = true;
    const loop = (): void => {
      requestAnimationFrame(loop);
      const g = getGame();
      const r = this.renderer;
      if (!g || !r) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.lastTime) / 1000);
      this.lastTime = now;
      this.sync(g, dt);
    };
    requestAnimationFrame(loop);
  }

  private sync(g: Game, dt: number): void {
    const r = this.renderer!;
    const views = getUnitViews(g);
    const seen = new Set<Unit>();
    r.clear();
    r.setScissorTest(true);
    for (const v of views) {
      if (v.unit.carriedBy) continue; // 搭乗中の歩兵は単独では描かない(輸送側に小さく重ねる)
      seen.add(v.unit);
      const inst = this.instanceFor(g, v);
      if (!inst) continue;
      // 未行動はゆっくり回転、行動済みは右斜め前を向いて静止する
      if (v.unit.acted) {
        inst.model.rotation.y = ACTED_YAW;
      } else {
        inst.model.rotation.y += ROTATE_SPEED * dt;
      }
      this.drawOne(r, v, inst);
      // 搭乗中の歩兵は 1/4 サイズで左上に重ねて表示する
      const cargo = g.units.find((u) => u.carriedBy === v.unit && u.hp > 0);
      if (cargo) {
        seen.add(cargo);
        const cinst = this.instanceFor(g, { unit: cargo, x: v.x, y: v.y, size: v.size });
        if (cinst) {
          cinst.model.rotation.y = inst.model.rotation.y;
          this.drawCargo(r, v, cinst);
        }
      }
    }
    r.setScissorTest(false);
    // 消えたユニットの後片付け
    for (const u of [...this.instances.keys()]) {
      if (!seen.has(u)) this.instances.delete(u);
    }
  }

  private instanceFor(g: Game, v: UnitView): Instance | null {
    let inst = this.instances.get(v.unit);
    if (inst) return inst;
    const def = g.defs[v.unit.kind];
    const template = this.templates.get(`${def.model}:${v.unit.side}`);
    if (!template) return null;
    const scene = new THREE.Scene();
    const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 1.6);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 2.2);
    dir.position.set(2, 4, 3);
    scene.add(dir);
    const model = new THREE.Group();
    const inner = template.clone(true);
    model.add(inner);
    if (def.domain === 'air') model.position.y = 0.35; // 航空ユニットは少し浮かせる
    scene.add(model);
    inst = { scene, model, side: v.unit.side, kind: v.unit.kind };
    this.instances.set(v.unit, inst);
    return inst;
  }

  /** 搭乗中の歩兵を輸送ユニットの表示枠の左上に 1/4 サイズで描く */
  private drawCargo(r: THREE.WebGLRenderer, v: UnitView, inst: Instance): void {
    const box = Math.max(8, v.size * VIEWPORT_FACTOR);
    const mini = box * 0.42;
    // 左上に寄せつつ、隣のヘックスへはみ出さないよう少し中央寄りに置く
    const x = v.x - box / 2 + box * 0.08;
    const yTop = v.y - box / 2 + box * 0.08;
    const height = window.innerHeight;
    const y = height - (yTop + mini);
    if (x + mini < 0 || yTop + mini < 0 || x > window.innerWidth || yTop > height) return;
    r.setViewport(x, y, mini, mini);
    r.setScissor(x, y, mini, mini);
    r.clearDepth();
    r.render(inst.scene, this.camera);
  }

  private drawOne(r: THREE.WebGLRenderer, v: UnitView, inst: Instance): void {
    const box = Math.max(8, v.size * VIEWPORT_FACTOR);
    const x = v.x - box / 2;
    const yTop = v.y - box / 2;
    const height = window.innerHeight;
    const y = height - (yTop + box); // WebGL の viewport は左下原点
    if (x + box < 0 || yTop + box < 0 || x > window.innerWidth || yTop > height) return;
    r.setViewport(x, y, box, box);
    r.setScissor(x, y, box, box);
    r.clearDepth();
    r.render(inst.scene, this.camera);
  }
}

/** モデルを「長辺が約1.7・地面がy=0・中心が原点」に正規化する */
function normalize(src: THREE.Object3D): THREE.Group {
  const group = new THREE.Group();
  const obj = src;
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = 1.7 / maxDim;
  obj.scale.setScalar(scale);
  obj.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  group.add(obj);
  return group;
}
