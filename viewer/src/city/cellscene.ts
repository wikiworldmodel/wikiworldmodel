// A site on the GPU, drawn in cells: it keeps each cell's mesh at the detail its distance calls for,
// nearest first, asking a worker to make them. What the cells hold is the subclass's: a city's
// buildings, or a living scene's animals and plants.
import type { CityStructure } from '../../../core/city.ts';
import type { Scenario } from '../../../core/scenario.ts';
import { CELL } from '../../../world/generators/city/cells.ts';
import type { GroundSampler } from '../../../world/generators/city/ground.ts';
import { CityRenderer, type CellGPU, type CityFrame } from '../gl/city.ts';
import type { GL } from '../gl/context.ts';
import type { V3 } from '../mat.ts';
import { Skyline } from './skyline.ts';
import type { LocalView } from './view.ts';

/** Within this distance of the eye a cell is drawn finely. */
const FINE_DISTANCE = 620;
/** Finely drawn cells kept, once out of range, before the oldest is let go. */
const FINE_BUDGET_BYTES = 900e6;
const CONCURRENT = 3;

export interface Cell {
  key: number;
  box: [number, number, number, number];
  coarse?: CellGPU;
  fine?: CellGPU;
  /** a request is out for this detail */
  asked: [boolean, boolean];
  usedAt: number;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface CellMessage {
  type: 'cell';
  key: number;
  detail: number;
  serial: number;
  vertices: ArrayBuffer;
  indices: Uint32Array;
  ms: number;
}

export abstract class CellScene {
  readonly renderer: CityRenderer;
  ground!: GroundSampler;
  ready = false;
  /** the plan's hash here and in the build, which must agree */
  plan = { expected: '', actual: null as string | null };
  /** what stands in the way of an eye */
  skyline = new Skyline();
  /** how high each named thing stands, above sea level */
  tops: Float32Array = new Float32Array(0);
  protected cells = new Map<number, Cell>();
  protected worker: Worker | null = null;
  protected inflight = 0;
  protected frame = 0;
  protected serial = 0;
  protected fineBytes = 0;
  protected queue: { key: number; detail: number }[] = [];
  onChange: () => void = () => {};
  /** every cell has its coarse mesh, and every near one its fine mesh (in the fast way, none) */
  get settled(): boolean {
    return this.ready && this.inflight === 0 && this.queue.length === 0;
  }

  /** the lighter way to draw: coarse meshes only, and the renderer's cheap passes */
  protected fast: boolean;

  constructor(gl: GL, opts: { fast?: boolean } = {}) {
    this.fast = !!opts.fast;
    this.renderer = new CityRenderer(gl, { fast: this.fast });
    this.renderer.shadowCells = (focus, radius) => this.near(focus, radius);
  }

  /** What the labels name. */
  abstract get named(): CityStructure[];
  abstract load(): Promise<void>;
  abstract setScenario(s: Scenario): void;
  abstract select(id: string | null): void;

  /** The time as the shader holds it. */
  protected shaderTime(t: number): number {
    return t;
  }

  /** A cell's mesh has come back from the worker. */
  protected received(m: CellMessage): void {
    this.inflight--;
    const c = this.cells.get(m.key);
    if (c) {
      const gpu = this.renderer.upload(m.vertices, m.indices);
      if (m.detail === 1) {
        if (c.fine) this.renderer.remove(c.fine);
        c.fine = gpu;
        this.fineBytes += gpu.bytes;
      } else c.coarse = gpu;
    }
    this.pump();
    this.onChange();
  }

  protected pump(): void {
    while (this.inflight < CONCURRENT && this.queue.length) {
      const q = this.queue.shift()!;
      this.inflight++;
      this.worker!.postMessage({ type: 'cell', key: q.key, detail: q.detail, serial: ++this.serial });
    }
  }

  /** Which cells a view wants, at what detail: the nearest are asked for first. */
  update(v: LocalView): void {
    if (!this.ready) return;
    this.frame++;
    const want: { key: number; detail: number; d: number }[] = [];
    for (const c of this.cells.values()) {
      const cx = (c.box[0] + c.box[2]) / 2;
      const cy = (c.box[1] + c.box[3]) / 2;
      const d = Math.hypot(cx - v.eye[0], cy - v.eye[1], Math.max(v.clearance, 0));
      if (!c.coarse && !c.asked[0]) want.push({ key: c.key, detail: 0, d });
      if (!this.fast && d < FINE_DISTANCE + CELL * 0.71 && !c.fine && !c.asked[1]) want.push({ key: c.key, detail: 1, d: d - 1e5 });
    }
    want.sort((a, b) => a.d - b.d);
    for (const w of want) {
      this.cells.get(w.key)!.asked[w.detail as 0 | 1] = true;
      this.queue.push({ key: w.key, detail: w.detail });
    }
    if (want.length) this.queue.sort((a, b) => Number(b.detail) - Number(a.detail));
    this.pump();
    this.evict();
  }

  private evict(): void {
    if (this.fineBytes < FINE_BUDGET_BYTES) return;
    const fine = [...this.cells.values()].filter((c) => c.fine).sort((a, b) => a.usedAt - b.usedAt);
    for (const c of fine) {
      if (this.fineBytes < FINE_BUDGET_BYTES * 0.8) break;
      if (c.usedAt === this.frame) continue;
      this.fineBytes -= c.fine!.bytes;
      this.renderer.remove(c.fine!);
      c.fine = undefined;
      c.asked[1] = false;
    }
  }

  /** The meshes within a radius of a point, for a shadow cascade: fine where it is ready. */
  private near(focus: V3, radius: number): CellGPU[] {
    const out: CellGPU[] = [];
    const r = radius + CELL;
    for (const c of this.cells.values()) {
      const cx = (c.box[0] + c.box[2]) / 2;
      const cy = (c.box[1] + c.box[3]) / 2;
      if (Math.abs(cx - focus[0]) > r || Math.abs(cy - focus[1]) > r) continue;
      const g = radius < 1200 ? (c.fine ?? c.coarse) : c.coarse ?? c.fine;
      if (g) out.push(g);
    }
    return out;
  }

  /** The meshes in view: fine near the eye, coarse beyond. */
  visible(v: LocalView): CellGPU[] {
    const out: CellGPU[] = [];
    const t = Math.tan(v.fov / 2);
    const side = t * v.aspect;
    for (const c of this.cells.values()) {
      const cx = (c.box[0] + c.box[2]) / 2;
      const cy = (c.box[1] + c.box[3]) / 2;
      const zc = this.ground.at(cx, cy) + 30;
      const dx = cx - v.eye[0];
      const dy = cy - v.eye[1];
      const dz = zc - v.eye[2];
      const fw = dx * v.forward[0] + dy * v.forward[1] + dz * v.forward[2];
      const r = CELL * 0.75 + 70;
      if (fw < -r) continue;
      const rt = dx * v.right[0] + dy * v.right[1] + dz * v.right[2];
      const up = dx * v.up[0] + dy * v.up[1] + dz * v.up[2];
      if (Math.abs(rt) > fw * side + r * Math.sqrt(1 + side * side)) continue;
      if (Math.abs(up) > fw * t + r * Math.sqrt(1 + t * t)) continue;
      const d = Math.hypot(dx, dy, Math.max(0, v.clearance));
      const g = d < FINE_DISTANCE + CELL * 0.71 ? (c.fine ?? c.coarse) : (c.coarse ?? c.fine);
      if (g) {
        c.usedAt = this.frame;
        out.push(g);
      }
    }
    return out;
  }

  /** Draw a frame. */
  render(v: LocalView, sun: V3, time: number, evidence: boolean, alpha: number, solid: boolean, outW: number, outH: number): void {
    if (!this.ready) return;
    this.update(v);
    const f: CityFrame = {
      eye: v.gpuEye,
      focus: v.clearance > 3000 ? [v.target[0], v.target[1], v.target[2]] : [v.eye[0] + v.forward[0] * Math.min(v.range, 700), v.eye[1] + v.forward[1] * Math.min(v.range, 700), Math.min(v.target[2], v.eye[2])],
      view: v.view,
      proj: v.proj,
      farProj: v.farProj,
      fov: v.fov,
      aspect: v.aspect,
      near: v.near,
      far: v.far,
      sun,
      time: this.shaderTime(time),
      evidence,
      alpha,
      solid,
      clearance: v.clearance,
      width: outW,
      height: outH,
    };
    this.renderer.render(f, this.visible(v), outW, outH);
  }

  /** How much of the city is on the GPU, and at what detail. */
  stats(): { cells: number; coarse: number; fine: number; megabytes: number } {
    let coarse = 0;
    let fine = 0;
    let bytes = 0;
    for (const c of this.cells.values()) {
      if (c.coarse) {
        coarse++;
        bytes += c.coarse.bytes;
      }
      if (c.fine) {
        fine++;
        bytes += c.fine.bytes;
      }
    }
    return { cells: this.cells.size, coarse, fine, megabytes: Math.round(bytes / 1e6) };
  }

}
