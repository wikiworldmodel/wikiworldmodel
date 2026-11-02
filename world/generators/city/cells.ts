// A city cut into cells, so that what is near can be drawn finely and what is far coarsely, and
// the generators can run a cell at a time. Everything a viewer draws comes from here: the
// structures of the build's city file, and the generated fabric between them.
import type { CityFile, CityStructure } from '../../../core/city.ts';
import { fabricPlan, lotPoly, raiseLot, type FabricPlan } from '../rome/fabric/v1.ts';
import { raise, tree, LINE_FORMS, type FormContext } from './forms.ts';
import { GroundSampler, type GroundGridData } from './ground.ts';
import { MAT, Mesh, outsetRing, person } from './kit.ts';
import { ccw, centroid, hashString, inPoly, Rng, triangulate, type Poly } from './math.ts';

export const CELL = 400;
export const CELLS = 34;
const HALF = (CELL * CELLS) / 2;

export const cellOf = (x: number, y: number) => {
  const i = Math.floor((x + HALF) / CELL);
  const j = Math.floor((y + HALF) / CELL);
  return i < 0 || j < 0 || i >= CELLS || j >= CELLS ? -1 : j * CELLS + i;
};

export const cellBox = (key: number): [number, number, number, number] => {
  const i = key % CELLS;
  const j = Math.floor(key / CELLS);
  return [-HALF + i * CELL, -HALF + j * CELL, -HALF + (i + 1) * CELL, -HALF + (j + 1) * CELL];
};

/** Where an entity's when and what live: 1.. the structures in file order, then the lots, then the trees. */
export const structureEntity = (i: number) => i + 1;

const BASIS: Record<string, number> = { evidence: 0, reconstruction: 1, projection: 2, procedural: 3 };
const TIMELESS = 1e5;

export interface WaterMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

export class CityBuilder {
  readonly ground: GroundSampler;
  readonly plan: FabricPlan;
  private cellStructures = new Map<number, number[]>();
  private cellLines = new Map<number, number[]>();
  private cellLots = new Map<number, number[]>();
  private cellTrees = new Map<number, number[]>();
  private ctx: FormContext;
  readonly lotEntity: number;
  readonly treeEntity: number;
  readonly crowdEntity: number;

  constructor(readonly city: CityFile, grounds: GroundGridData[], plan?: FabricPlan) {
    this.ground = new GroundSampler(grounds);
    this.plan = plan ?? fabricPlan(city, this.ground);
    this.lotEntity = city.structures.length + 1;
    this.treeEntity = this.lotEntity + this.plan.lots;
    this.crowdEntity = this.treeEntity + 1;
    const push = (m: Map<number, number[]>, k: number, v: number) => {
      if (k < 0) return;
      const l = m.get(k);
      if (l) {
        if (l[l.length - 1] !== v) l.push(v);
      } else m.set(k, [v]);
    };
    // Streets and walls, to find which way a temple faces and how a gate is set.
    const roads: number[][] = [];
    const walls: number[][] = [];
    city.structures.forEach((s, i) => {
      if (s.kind === 'works/road' || LINE_FORMS.has(s.form.type)) {
        for (const l of [...(s.lines ?? []), ...s.rings]) {
          for (let k = 0; k + 3 < l.length; k += 2) {
            const steps = Math.max(1, Math.ceil(Math.hypot(l[k + 2] - l[k], l[k + 3] - l[k + 1]) / 60));
            for (let t = 0; t <= steps; t++) push(this.cellLines, cellOf(l[k] + ((l[k + 2] - l[k]) * t) / steps, l[k + 1] + ((l[k + 3] - l[k + 1]) * t) / steps), i);
          }
        }
        if (s.kind === 'works/road') roads.push(...(s.lines ?? []));
        if (s.form.type === 'wall') walls.push(...(s.lines ?? []));
      } else push(this.cellStructures, cellOf(s.at[0], s.at[1]), i);
    });
    const nearest = (lines: number[][], x: number, y: number): { d: number; dx: number; dy: number } | undefined => {
      let best: { d: number; dx: number; dy: number } | undefined;
      for (const l of lines) {
        for (let k = 0; k + 3 < l.length; k += 2) {
          const ex = l[k + 2] - l[k];
          const ey = l[k + 3] - l[k + 1];
          const q = ex * ex + ey * ey;
          const t = q > 0 ? Math.max(0, Math.min(1, ((x - l[k]) * ex + (y - l[k + 1]) * ey) / q)) : 0;
          const ax = l[k] + ex * t - x;
          const ay = l[k + 1] + ey * t - y;
          const d = ax * ax + ay * ay;
          if (!best || d < best.d) best = { d, dx: ex, dy: ey };
        }
      }
      return best;
    };
    this.ctx = {
      ground: this.ground,
      detail: 0,
      water: city.site.water_level,
      streetDistance: (x, y) => Math.sqrt(nearest(roads, x, y)?.d ?? 1e12),
      wallDirection: (x, y) => {
        const n = nearest(walls, x, y);
        if (!n) return undefined;
        const l = Math.hypot(n.dx, n.dy) || 1;
        return [n.dx / l, n.dy / l];
      },
    };
    const p = this.plan;
    for (let i = 0; i < p.lots; i++) {
      const [x, y] = centroid(lotPoly(p, i));
      push(this.cellLots, cellOf(x, y), i);
    }
    for (let i = 0; i < p.treeCount; i++) push(this.cellTrees, cellOf(p.trees[i * 4], p.trees[i * 4 + 1]), i);
  }

  /** Every cell with anything in it. */
  cells(): number[] {
    return [...new Set([...this.cellStructures.keys(), ...this.cellLines.keys(), ...this.cellLots.keys(), ...this.cellTrees.keys()])].sort((a, b) => a - b);
  }

  /** When each entity stood and what it rests on, for the renderer: [start, end, basis, ground]. */
  entities(): Float32Array {
    const c = this.city;
    const n = this.crowdEntity + 1;
    const out = new Float32Array(n * 4);
    const clamp = (x: number | null, d: number) => (x === null || !Number.isFinite(x) ? d : Math.max(-TIMELESS, Math.min(TIMELESS, x)));
    c.structures.forEach((s, i) => {
      const k = structureEntity(i) * 4;
      out[k] = clamp(s.time.start.best, -TIMELESS);
      out[k + 1] = clamp(s.time.end.best, TIMELESS);
      out[k + 2] = BASIS[s.basis] ?? 1;
      out[k + 3] = s.base;
    });
    const p = this.plan;
    const fabric = (c.fabric.params as { valid?: [number, number] }).valid ?? [-TIMELESS, TIMELESS];
    for (let i = 0; i < p.lots; i++) {
      const k = (this.lotEntity + i) * 4;
      out[k] = fabric[0];
      out[k + 1] = fabric[1];
      out[k + 2] = 3;
      out[k + 3] = p.base[i];
    }
    const t = this.treeEntity * 4;
    out[t] = -TIMELESS;
    out[t + 1] = TIMELESS;
    out[t + 2] = 3;
    out[t + 3] = 0;
    const q = this.crowdEntity * 4;
    out[q] = -1000;
    out[q + 1] = 1000;
    out[q + 2] = 3;
    out[q + 3] = 0;
    return out;
  }

  /** The mesh of one cell, at a level of detail: 0 from afar, 1 close by. */
  /** How high each structure stands as raised, above sea level: 0 for one drawn along a line. */
  tops(): Float32Array {
    const c = this.city;
    const out = new Float32Array(c.structures.length);
    c.structures.forEach((s, i) => {
      if (s.kind === 'works/road' || LINE_FORMS.has(s.form.type)) return;
      const m = new Mesh(2048);
      raise(m, s, { ...this.ctx, detail: 0, clip: undefined });
      if (m.verts) out[i] = m.top();
    });
    return out;
  }

  build(key: number, detail: number): Mesh {
    const m = new Mesh(detail ? 65536 : 16384);
    const c = this.city;
    const ctx: FormContext = { ...this.ctx, detail };
    for (const i of this.cellStructures.get(key) ?? []) {
      const s = c.structures[i];
      m.entity = structureEntity(i);
      raise(m, s, { ...ctx, clip: undefined });
    }
    const clip = cellBox(key);
    for (const i of this.cellLines.get(key) ?? []) {
      const s = c.structures[i];
      m.entity = structureEntity(i);
      raise(m, s, { ...ctx, clip });
    }
    for (const i of this.cellLots.get(key) ?? []) {
      m.entity = this.lotEntity + i;
      raiseLot(m, this.plan, i, detail);
    }
    m.place(0, 0, 0);
    m.entity = this.treeEntity;
    m.light = 1;
    for (const i of this.cellTrees.get(key) ?? []) {
      const p = this.plan.trees;
      tree(m, p[i * 4], p[i * 4 + 1], p[i * 4 + 2], this.plan.treeType[i], p[i * 4 + 3], detail, 40 + ((i * 53) & 191));
    }
    if (detail) this.crowd(m, key, clip);
    return m;
  }

  /** People, for scale: along the streets of a cell and across its paved squares. All generated. */
  private crowd(m: Mesh, key: number, clip: [number, number, number, number]): void {
    const c = this.city;
    const rng = new Rng(hashString(c.fabric.seed) ^ Math.imul(key + 1, 0x9e3779b1));
    m.place(0, 0, 0);
    m.entity = this.crowdEntity;
    const put = (x: number, y: number) => person(m, x, y, this.ground.at(x, y) + 0.12, rng.range(1.5, 1.78), rng.int(0, 255), rng.int(0, 255));
    for (const i of this.cellLines.get(key) ?? []) {
      const s = c.structures[i];
      if (s.kind !== 'works/road') continue;
      for (const l of s.lines ?? []) {
        for (let k = 0; k + 3 < l.length; k += 2) {
          const ex = l[k + 2] - l[k];
          const ey = l[k + 3] - l[k + 1];
          const len = Math.sqrt(ex * ex + ey * ey);
          const n = Math.floor(len / 16);
          for (let q = 0; q < n; q++) {
            const t = rng.next();
            const side = rng.range(-2.6, 2.6) / (len || 1);
            const x = l[k] + ex * t - ey * side;
            const y = l[k + 1] + ey * t + ex * side;
            if (x >= clip[0] && x < clip[2] && y >= clip[1] && y < clip[3] && rng.next() < 0.7) put(x, y);
          }
        }
      }
    }
    for (const i of this.cellStructures.get(key) ?? []) {
      const s = c.structures[i];
      if (s.kind !== 'open/forum' && s.kind !== 'open/square') continue;
      for (const r of s.rings) {
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (let k = 0; k < r.length; k += 2) {
          x0 = Math.min(x0, r[k]);
          x1 = Math.max(x1, r[k]);
          y0 = Math.min(y0, r[k + 1]);
          y1 = Math.max(y1, r[k + 1]);
        }
        const n = Math.min(160, Math.floor(((x1 - x0) * (y1 - y0)) / 45));
        for (let q = 0; q < n; q++) {
          const x = rng.range(x0, x1);
          const y = rng.range(y0, y1);
          if (inPoly(r, x, y)) put(x, y);
        }
      }
    }
  }

  /** What the plan says the ground is, as an image: R built-up, G garden, B paved, A river. */
  mask(size: number): { data: Uint8Array; box: [number, number, number, number] } {
    const data = new Uint8Array(size * size * 4);
    const box: [number, number, number, number] = [-HALF, -HALF, HALF, HALF];
    const scale = (HALF * 2) / size;
    const fill = (r: Poly, c: number, v: number) => {
      let y0 = Infinity;
      let y1 = -Infinity;
      for (let i = 1; i < r.length; i += 2) {
        y0 = Math.min(y0, r[i]);
        y1 = Math.max(y1, r[i]);
      }
      const j0 = Math.max(0, Math.floor((y0 + HALF) / scale));
      const j1 = Math.min(size - 1, Math.ceil((y1 + HALF) / scale));
      const n = r.length / 2;
      for (let j = j0; j <= j1; j++) {
        const y = -HALF + (j + 0.5) * scale;
        const xs: number[] = [];
        for (let i = 0, k = n - 1; i < n; k = i++) {
          const a = r[i * 2 + 1];
          const b = r[k * 2 + 1];
          if (a > y !== b > y) xs.push(r[i * 2] + ((y - a) / (b - a)) * (r[k * 2] - r[i * 2]));
        }
        xs.sort((a, b) => a - b);
        for (let q = 0; q + 1 < xs.length; q += 2) {
          const i0 = Math.max(0, Math.ceil((xs[q] + HALF) / scale - 0.5));
          const i1 = Math.min(size - 1, Math.floor((xs[q + 1] + HALF) / scale - 0.5));
          for (let i = i0; i <= i1; i++) data[(j * size + i) * 4 + c] = v;
        }
      }
    };
    if (this.plan.domain.length) fill(this.plan.domain, 0, 255);
    for (let i = 0; i < this.plan.lots; i++) fill(lotPoly(this.plan, i), 0, 255);
    const slice = this.city.site.slice;
    const standing = (s: CityStructure) => (s.time.start.best ?? -Infinity) <= slice && slice <= (s.time.end.best ?? Infinity);
    // The ground a monument stands in is paved, some way around it.
    for (const s of this.city.structures) {
      if (!standing(s) || !/^(building|monument)|^open\/(forum|square)/.test(s.kind)) continue;
      for (const r of s.rings) {
        if (r.length < 6) continue;
        const reach = s.curated ? 14 : 7;
        fill(outsetRing(ccw(r), reach), 2, 255);
      }
    }
    for (const s of this.city.structures) {
      if (s.kind !== 'open/garden') continue;
      for (const r of s.rings) {
        if (r.length >= 6) {
          fill(r, 1, 255);
          fill(r, 0, 0);
          fill(r, 2, 0);
        }
      }
    }
    // The river, for the terrain to paint from afar, where its cells are wider than the bed.
    for (const r of this.city.water) fill(r, 3, 255);
    for (const r of this.city.islands) fill(r, 3, 0);
    return { data, box };
  }

  /** The river, as a sheet at its level. */
  water(): WaterMesh {
    const c = this.city;
    const verts: number[] = [];
    const idx: number[] = [];
    for (const r of c.water) {
      const holes = c.islands.filter((h) => inPoly(r, h[0], h[1]));
      const { points, tris } = triangulate(r, holes);
      const base = verts.length / 3;
      for (let i = 0; i < points.length; i += 2) verts.push(points[i], points[i + 1], c.site.water_level);
      for (const t of tris) idx.push(base + t);
    }
    return { vertices: Float32Array.from(verts), indices: Uint32Array.from(idx) };
  }
}

export { MAT };
export type { CityStructure };
