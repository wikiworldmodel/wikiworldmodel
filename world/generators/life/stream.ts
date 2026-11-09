// A scene as it is looked at: the ground, then whichever cells a view needs, then which individuals to draw
// and at what detail. The same code runs in a browser's worker, in the build and in the tests. A frame's cost
// depends on what is on the screen and is bounded by a budget, not on how much lives in the scene.
import type { Form } from '../../../core/form.ts';
import type { LivingTaxon, SceneSpec } from '../../../core/scene.ts';
import { GroundSampler, type GroundGridData } from '../city/ground.ts';
import { fingerprint, type Fingerprint, type Part } from '../../../core/fingerprint.ts';
import { Mesh, meshParts } from '../city/kit.ts';
import { hashString } from '../city/math.ts';
import { drawAnimal, drawPlant, POSE, type Detail, type Stance } from './forms.ts';
import { CELL, CELLS, cellParts, cellKey, coverMask, EXTENT, groundGrids, LandCover, makePlan, placeLook, waterLevels, waterRibbons, waterSheet, watersFor, type CellRows, type LivingParams, type LivingPlan, type PlaceLook } from './scene/v5.ts';
import type { Waters } from './land.ts';
import { drawDwelling, houseSize, type HouseDetail } from '../people/dwellings.ts';
import { LandUseMap, landUseMask, makeSettlement, type SettlementPlan } from '../people/settlement/v1.ts';

/** Where houses start among a scene's kinds of mesh: a taxon's number is below it, a house's dwelling above. */
export const HOUSE = 0x4000;

export const INSTANCE_STRIDE = 28;

/** A view: where the eye is, which way it looks, and how big things come out on the screen. */
export interface LifeView {
  eye: [number, number, number];
  forward: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  fov: number;
  aspect: number;
  /** the frame's height in pixels */
  height: number;
  clearance: number;
}

export interface Budget {
  /** the most individuals a frame draws */
  instances: number;
  /** the most triangles, as the meshes say */
  triangles: number;
  /** on the slowest machines, only coarse meshes */
  fast: boolean;
}

export const FULL_BUDGET: Budget = { instances: 220000, triangles: 9000000, fast: false };
export const FAST_BUDGET: Budget = { instances: 16000, triangles: 400000, fast: true };

/** One kind of mesh and everyone drawn with it this frame. */
export interface Batch {
  proto: number;
  count: number;
  /** INSTANCE_STRIDE bytes each: x, y, z, scale, fx, fy as floats, then entity and tint as shorts */
  data: ArrayBuffer;
}

export interface ProtoMesh {
  proto: number;
  vertices: ArrayBuffer;
  indices: Uint32Array;
}

export interface Selection {
  batches: Batch[];
  /** meshes the batches use that have not been handed out before */
  protos: ProtoMesh[];
  instances: number;
  triangles: number;
  /** whether more cells are still to be made for this view */
  pending: number;
  /** the nearest groups, to name */
  groups: { taxon: number; at: [number, number]; base: number; top: number }[];
}

export const protoOf = (taxon: number, variant: number, detail: Detail) => (taxon << 8) | (variant << 2) | detail;
export const protoParts = (p: number): { taxon: number; variant: number; detail: Detail } => ({ taxon: p >> 8, variant: (p >> 2) & 63, detail: (p & 3) as Detail });

const WALKING = new Set<number>([POSE.walk, POSE.fly]);

export class SceneStream {
  readonly look: PlaceLook;
  private waters: Waters;
  readonly levels: GroundGridData[];
  readonly ground: GroundSampler;
  readonly plan: LivingPlan;
  readonly params: LivingParams;
  readonly cover: LandCover;
  /** every cell made so far, at the most it was made */
  private cells = new Map<number, CellRows>();
  private meshes = new Map<number, { tris: number }>();
  private tones: number[];
  private keep = 1;
  private fullReach: number;
  private nearReach: number;
  /** the people's houses, settlements and fields, where the scene has people */
  readonly people?: SettlementPlan;
  private landUse?: LandUseMap;
  /** each cell's houses, by their place in the plan */
  private houseCells = new Map<number, number[]>();
  private houseTops: number[] = [];

  constructor(readonly spec: SceneSpec, private budget: Budget = FULL_BUDGET) {
    this.params = spec.generator.params as unknown as LivingParams;
    this.look = placeLook(spec);
    const waters = watersFor(spec, this.look);
    this.waters = waters;
    this.levels = groundGrids(spec, this.look, waters);
    this.ground = new GroundSampler(this.levels);
    // Where the world gives the rivers, the water's level varies over the scene; otherwise it is the place's one level.
    const levelAt = waters.paths ? waterLevels(waters) : undefined;
    // The people, where the scene has any: their houses and fields, on this ground and away from this water. Where they
    // cleared the land no tree stands. A scene of the sea has them too, on whatever ground stands above its water: a place
    // a few metres above the sea, a delta or a lower plain, is a scene of the sea (scene/v5.ts, sea_below), and among the
    // most crowded land there was.
    let clearing: ((x: number, y: number) => number) | undefined;
    if (spec.people) {
      const water = levelAt ?? (() => this.look.water);
      this.people = makeSettlement(spec, this.ground, water, EXTENT);
      const use = new LandUseMap(this.people, this.ground, water, this.look.seed);
      this.landUse = use;
      clearing = (x, y) => {
        const u = use.at(x, y);
        return Math.max(u.crop, u.pasture * 0.85, u.yard);
      };
      this.houseTops = this.people.forms.map((f) => houseSize(f.spec).top);
      this.people.houses.forEach((h, i) => {
        const k = cellKey(Math.floor(h.x / CELL), Math.floor(h.y / CELL));
        let list = this.houseCells.get(k);
        if (!list) this.houseCells.set(k, (list = []));
        list.push(i);
      });
    }
    this.plan = makePlan(spec, this.ground, this.look, waters, levelAt, clearing);
    this.cover = new LandCover(spec, this.ground, this.look.water, this.plan.focus, levelAt, clearing);
    this.tones = spec.taxa.map((t) => hashString(t.id) & 255);
    this.fullReach = this.params.reach.full;
    this.nearReach = this.params.reach.near;
  }

  /** What the ground is, as an image: as fine as asked for. */
  mask(size: number): { data: Uint8Array; box: [number, number, number, number] } {
    return { data: coverMask(this.cover, size, EXTENT), box: [-EXTENT, -EXTENT, EXTENT, EXTENT] };
  }

  /** What people made of the ground, as an image: R crops, G pasture, B yards, A paddies. Undefined where there are no people. */
  fields(size: number): { data: Uint8Array; box: [number, number, number, number] } | undefined {
    return this.landUse ? { data: landUseMask(this.landUse, size, EXTENT), box: [-EXTENT, -EXTENT, EXTENT, EXTENT] } : undefined;
  }

  /** The water: ribbons along the world's rivers, or the place's one sheet; with each vertex's flow and depth. */
  water(): { vertices: Float32Array; indices: Uint32Array; flow: Float32Array } {
    if (this.waters.paths) return waterRibbons(this.waters);
    const sheet = waterSheet(this.spec, this.look);
    return { ...sheet, flow: new Float32Array((sheet.vertices.length / 3) * 3) };
  }

  /** A cell's rows, made at least to this tier. */
  cell(i: number, j: number, tier: number): CellRows {
    const k = cellKey(i, j);
    const have = this.cells.get(k);
    if (have && have.tier >= tier) return have;
    const c = this.plan.cell(i, j, tier);
    this.cells.set(k, c);
    return c;
  }

  /** A mesh of one kind of body or plant, or of a house: the same everywhere, within the tolerance. */
  mesh(proto: number): ProtoMesh {
    const { taxon, variant, detail } = protoParts(proto);
    if (taxon >= HOUSE) {
      const f = this.people!.forms[taxon - HOUSE];
      const m = new Mesh(detail >= 2 ? 2048 : 256);
      m.entity = this.spec.taxa.length + 1 + (taxon - HOUSE);
      // Detail 2 is the finest, as for bodies; a house's own scale runs the other way.
      drawDwelling(m, f.spec, (2 - detail) as HouseDetail, 112 + (variant & 31));
      const { vertices, indices } = m.arrays();
      this.meshes.set(proto, { tris: indices.length / 3 });
      return { proto, vertices, indices };
    }
    const t = this.spec.taxa[taxon];
    const form = this.spec.forms[t.form];
    const m = new Mesh(detail >= 2 ? 4096 : 512);
    m.entity = taxon + 1;
    if (form.kind === 'plant') drawPlant(m, form, t.height ?? 1, (variant + 1) * 0x9e37, detail, this.tones[taxon]);
    else drawAnimal(m, form, this.stance(t, form, variant, detail, this.tones[taxon]));
    const { vertices, indices } = m.arrays();
    this.meshes.set(proto, { tris: indices.length / 3 });
    return { proto, vertices, indices };
  }

  private stance(t: LivingTaxon, form: Form, variant: number, detail: Detail, tint: number): Stance {
    const pose = variant >> 3;
    const stride = (variant >> 1) & 3;
    return { L: t.length ?? 1, H: t.hip ?? (t.length ?? 1) * (form.hip ?? 0.3), pose, phase: (stride + 0.5) / 4, sway: (stride - 1.5) * 0.07, detail, tint, biped: (variant & 1) === 1 };
  }

  /** Which mesh an individual is drawn with. */
  private variantOf(t: LivingTaxon, form: Form, pose: number, phase: number, shade: number, detail: Detail): number {
    if (form.kind === 'plant') return shade & 3;
    const biped = t.biped || (t.posture === 'facultative-quadruped' && pose !== POSE.graze && pose !== POSE.drink && (shade & 1) === 1);
    // From afar only how it stands shows; the far shape has only one.
    if (detail === 0) return (POSE.stand << 3) | (biped ? 1 : 0);
    const stride = WALKING.has(pose) ? phase >> 6 : 0;
    return (pose << 3) | (stride << 1) | (biped ? 1 : 0);
  }

  /** What to draw for a view: this is what a frame costs, and it stays within the budget. */
  select(v: LifeView, sent: Set<number>, spendMs: () => boolean = () => true): Selection {
    const taxa = this.spec.taxa;
    const K = v.height / (2 * Math.tan(v.fov / 2));
    const t = Math.tan(v.fov / 2);
    const side = t * v.aspect;
    const [ex, ey, ez] = v.eye;
    const [fx, fy, fz] = v.forward;
    const groundZ = this.ground.at(ex, ey);
    const heights = taxa.map((x) => (x.height ?? x.length ?? 1));
    const buckets = new Map<number, { f: Float32Array; s: Uint16Array; n: number }>();
    let pending = 0;
    let instances = 0;
    const cap = this.budget.instances;
    const keepR = 1400 * this.keep;
    const R0 = keepR * keepR;
    const reachOut = Math.min(EXTENT * 1.4, Math.max(5000, v.clearance * 8 + 6000));
    const span = Math.ceil(reachOut / CELL);
    const ci = Math.floor(ex / CELL);
    const cj = Math.floor(ey / CELL);
    // Nearest first, so that a budget spent falls on what is far.
    const order: { i: number; j: number; d: number }[] = [];
    for (let j = cj - span; j <= cj + span; j++) {
      if (j < -CELLS / 2 || j >= CELLS / 2) continue;
      for (let i = ci - span; i <= ci + span; i++) {
        if (i < -CELLS / 2 || i >= CELLS / 2) continue;
        const cx = (i + 0.5) * CELL;
        const cy = (j + 0.5) * CELL;
        const dx = cx - ex;
        const dy = cy - ey;
        const dz = groundZ - ez;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > reachOut) continue;
        const r = CELL * 0.75 + 90;
        const fw = dx * fx + dy * fy + dz * fz;
        // Behind the eye, it casts no shadow worth keeping unless it is close.
        if (fw < -r && d > this.nearReach * 2) continue;
        const rt = dx * v.right[0] + dy * v.right[1] + dz * v.right[2];
        const up = dx * v.up[0] + dy * v.up[1] + dz * v.up[2];
        if (d > this.nearReach * 2) {
          if (Math.abs(rt) > fw * side + r * Math.sqrt(1 + side * side)) continue;
          if (Math.abs(up) > fw * t + r * Math.sqrt(1 + t * t)) continue;
        }
        order.push({ i, j, d });
      }
    }
    order.sort((a, b) => a.d - b.d);
    const groups: Selection['groups'] = [];
    for (const { i, j, d } of order) {
      const want = this.budget.fast ? (d < this.fullReach * 0.6 ? 1 : 0) : d < this.nearReach ? 2 : d < this.fullReach ? 1 : 0;
      const have = this.cells.get(cellKey(i, j));
      let c = have;
      if (!have || have.tier < want) {
        if (spendMs()) c = this.cell(i, j, want);
        else pending++;
      }
      if (!c) continue;
      const { place, taxon, pose, shade, phase, rank, count } = c;
      for (let q = 0; q < count; q++) {
        if (instances >= cap) break;
        const a = q * 6;
        const px = place[a];
        const py = place[a + 1];
        const pz = place[a + 2];
        const size = place[a + 3];
        const k = taxon[q];
        const dx = px - ex;
        const dy = py - ey;
        const dz = pz - ez;
        const dd = dx * dx + dy * dy + dz * dz;
        const tall = heights[k] * size;
        const pxs2 = (tall * tall * K * K) / dd;
        // Under about a pixel and a half it is left to the eye, and the ground's colour.
        if (pxs2 < 2.25) continue;
        // The same individuals at every distance: further off, only the lowest ranks.
        if (dd > R0 && rank[q] * dd > 256 * R0) continue;
        const pxs = Math.sqrt(pxs2);
        const detail: Detail = this.budget.fast ? (pxs >= 26 ? 1 : 0) : pxs >= 70 ? 2 : pxs >= 9 ? 1 : 0;
        const t0 = taxa[k];
        const form = this.spec.forms[t0.form];
        // A low plant is a mesh only close by.
        if (form.kind === 'plant' && form.behave?.layer === 'under' && detail < 2) continue;
        const proto = protoOf(k, this.variantOf(t0, form, pose[q], phase[q], shade[q], detail), detail);
        let b = buckets.get(proto);
        if (!b) {
          const buf = new ArrayBuffer(INSTANCE_STRIDE * 64);
          b = { f: new Float32Array(buf), s: new Uint16Array(buf), n: 0 };
          buckets.set(proto, b);
        }
        if ((b.n + 1) * INSTANCE_STRIDE > b.f.byteLength) {
          const buf = new ArrayBuffer(b.f.byteLength * 2);
          new Uint8Array(buf).set(new Uint8Array(b.f.buffer));
          b.f = new Float32Array(buf);
          b.s = new Uint16Array(buf);
        }
        const o = b.n * 7;
        b.f[o] = px;
        b.f[o + 1] = py;
        b.f[o + 2] = pz;
        b.f[o + 3] = size;
        b.f[o + 4] = place[a + 4];
        b.f[o + 5] = place[a + 5];
        b.s[b.n * 14 + 12] = k + 1;
        b.s[b.n * 14 + 13] = form.kind === 'plant' ? shade[q] >> 2 : shade[q] >> 3;
        b.n++;
        instances++;
      }
      // The houses of the cell: the same at every distance, as the bodies are, further off only the lowest ranks.
      const hs = this.houseCells.get(cellKey(i, j));
      if (hs && this.people) {
        for (const hi of hs) {
          if (instances >= cap) break;
          const h = this.people.houses[hi];
          const dx = h.x - ex;
          const dy = h.y - ey;
          const dz = h.z - ez;
          const dd = dx * dx + dy * dy + dz * dz;
          const tall = this.houseTops[h.form] * h.size;
          const pxs2 = (tall * tall * K * K) / dd;
          if (pxs2 < 1) continue;
          if (dd > R0 * 4 && h.rank * dd > 1024 * R0) continue;
          const pxs = Math.sqrt(pxs2);
          const detail: Detail = this.budget.fast ? (pxs >= 30 ? 1 : 0) : pxs >= 80 ? 2 : pxs >= 10 ? 1 : 0;
          const proto = protoOf(HOUSE + h.form, h.rank & 3, detail);
          let b = buckets.get(proto);
          if (!b) {
            const buf = new ArrayBuffer(INSTANCE_STRIDE * 64);
            b = { f: new Float32Array(buf), s: new Uint16Array(buf), n: 0 };
            buckets.set(proto, b);
          }
          if ((b.n + 1) * INSTANCE_STRIDE > b.f.byteLength) {
            const buf = new ArrayBuffer(b.f.byteLength * 2);
            new Uint8Array(buf).set(new Uint8Array(b.f.buffer));
            b.f = new Float32Array(buf);
            b.s = new Uint16Array(buf);
          }
          const o = b.n * 7;
          b.f[o] = h.x;
          b.f[o + 1] = h.y;
          b.f[o + 2] = h.z;
          b.f[o + 3] = h.size;
          b.f[o + 4] = Math.sin(h.face);
          b.f[o + 5] = Math.cos(h.face);
          b.s[b.n * 14 + 12] = this.spec.taxa.length + 1 + h.form;
          b.s[b.n * 14 + 13] = h.rank >> 3;
          b.n++;
          instances++;
        }
      }
      // Names for what is close: the first of each group.
      if (d < this.fullReach * 0.6) {
        for (let g = 0; g + 3 < c.groups.length; g += 4) {
          const k = c.groups[g + 3];
          const hip = taxa[k].hip ?? (taxa[k].length ?? 1) * 0.3;
          groups.push({ taxon: k, at: [c.groups[g], c.groups[g + 1]], base: c.groups[g + 2], top: c.groups[g + 2] + hip * 1.5 });
        }
      }
    }
    // Pay for meshes, and keep within the budget of triangles: the far share thins next time if it did not.
    const batches: Batch[] = [];
    const protos: ProtoMesh[] = [];
    let triangles = 0;
    for (const proto of [...buckets.keys()].sort((a, b) => a - b)) {
      const b = buckets.get(proto)!;
      if (!sent.has(proto)) {
        protos.push(this.mesh(proto));
        sent.add(proto);
      } else if (!this.meshes.has(proto)) this.mesh(proto);
      triangles += b.n * this.meshes.get(proto)!.tris;
      batches.push({ proto, count: b.n, data: b.f.buffer.slice(0, b.n * INSTANCE_STRIDE) as ArrayBuffer });
    }
    if (instances >= cap || triangles > this.budget.triangles) this.keep = Math.max(0.2, this.keep * 0.8);
    else if (instances < cap * 0.6 && triangles < this.budget.triangles * 0.6) this.keep = Math.min(1, this.keep * 1.1);
    groups.sort((a, b) => Math.hypot(a.at[0] - ex, a.at[1] - ey) - Math.hypot(b.at[0] - ex, b.at[1] - ey));
    return { batches, protos, instances, triangles, pending, groups: groups.slice(0, 64) };
  }

  /**
   * What proves a scene is the same scene: its ground, who stands in the cell it is arrived at, and a mesh of its
   * first taxon. Who and which are matched exactly; where, how high and how big within the tolerance.
   */
  print(): Fingerprint {
    const parts: Part[] = this.levels.map((l, i) => ({ name: `ground.${i}`, values: l.z }));
    const [fx, fy] = this.plan.focus;
    parts.push(...cellParts(this.cell(Math.floor(fx / CELL), Math.floor(fy / CELL), 2)));
    if (this.spec.taxa.length) {
      const t = this.spec.forms[this.spec.taxa[0].form];
      const m = this.mesh(protoOf(0, t.kind === 'plant' ? 0 : POSE.stand << 3, 2));
      parts.push(...meshParts(m.vertices, m.indices));
    }
    return fingerprint(parts);
  }
}

