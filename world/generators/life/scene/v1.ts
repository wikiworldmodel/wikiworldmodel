// A living scene, version 1: a river's floodplain and what lives on it. The records say which taxa
// were here at this moment and how big they grew; this says where each stands, how many there are,
// what it is doing and what colour it is, all of it invented and marked so. It is seeded by the
// site, and the plan it makes is hashed in the build and again in the browser: only + − × ÷, square
// roots and integer operations, so that they agree to the byte.
import { isPlant, type SceneCover, type SceneFile, type SceneTaxon } from '../../../../core/scene.ts';
import type { GroundSampler } from '../../city/ground.ts';
import { dcos, dsin, hash2, hashString, Rng, TAU } from '../../city/math.ts';
import { HIP_SHARE, POSE } from '../organisms.ts';

export const GENERATOR = 'gen:life/scene';
export const VERSION = 1;

export interface AnimalParams {
  /** how many animals each row of the snapshot stands for: commoner fossils, more animals, and no census */
  per_row: number;
  /** the fewest and most in a group */
  group: [number, number];
  /** where it is looked for: open ground, any ground, the water's edge, or under the trees */
  habitat: 'open' | 'any' | 'edge' | 'forest';
  /** which poses it may be in */
  poses: (keyof typeof POSE)[];
}

export interface PlantParams {
  /** how much of the canopy's weight it takes */
  weight: number;
  /** and how much more of it where the ground is wet */
  wet: number;
}

export interface SceneParams {
  site: {
    id: string;
    label: string;
    /** the record the scene belongs to, and the rows it rests on */
    ecosystem: string;
    snapshot: string;
    slice: string;
    /** the time window to show on arrival */
    window: [string, string];
  };
  ground: {
    /** the bearing the river runs towards, how wide and deep it is, the length of a bend and how far it swings, in radians */
    flow: number;
    width: number;
    depth: number;
    wavelength: number;
    swing: number;
    /** how far a bank runs from the water to the plain, least and most */
    bank: [number, number];
    /** how high the plain stands over the water, how much it varies, and over what distance */
    rise: number;
    roughness: number;
    size: number;
    /** a raised bank along the river: its height and its width */
    levee: [number, number];
    /** the old bends cut off from it, and their radius and width */
    oxbows: number;
    oxbow_radius: [number, number];
    oxbow_width: number;
    /** ponds in the back swamps, and their radius */
    ponds: number;
    pond_radius: [number, number];
    /** where the invented plain gives way to the reconstructed land, from the origin */
    blend: [number, number];
    /** the water's level is never lower than this, in metres above the sea */
    lowest_water: number;
  };
  cover: {
    /** the size of the patches of forest and glade, and what share of the plain is glade */
    patch: number;
    glade: number;
    /** how much forest each climate class bears, 0–1 */
    forest_by_climate: Record<string, number>;
    /** the glade kept open at the place a visitor arrives, its radius */
    clearing: number;
    /** how far above the water the ground is bare sediment */
    bare: number;
  };
  plants: {
    /** trees to the hectare under full canopy near the arrival, and out at the scene's edge, and how far that takes */
    trees: [number, number];
    falloff: [number, number];
    /** ferns to the hectare, near the arrival, and how far they go */
    ferns: number;
    ferns_reach: number;
    /** floating mats: their radius, and how many a hectare of still water holds */
    mat_radius: number;
    mats: number;
    plans: Record<string, PlantParams>;
  };
  animals: {
    /** the share of each taxon gathered near the arrival, and how far around it they are looked for */
    near_share: number;
    near_radius: number;
    /** a group of each animal at least this long stands in the clearing itself */
    front_length: number;
    /** what a body of a plan weighs for its length, in kilograms per cubic metre of it, for a taxon with a claimed mass and no length */
    mass_length?: Record<string, number>;
    plans: Record<string, AnimalParams>;
  };
  /** where a visitor arrives: how high the camera stands, its turn from the river and its tilt */
  view: { range: number; turn: number; tilt: number };
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Smooth noise, 0–1, its features about a unit across. */
export function noise(x: number, y: number, seed: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const u = x - i;
  const v = y - j;
  const a = hash2(i, j, seed);
  const b = hash2(i + 1, j, seed);
  const c = hash2(i, j + 1, seed);
  const d = hash2(i + 1, j + 1, seed);
  const su = u * u * (3 - 2 * u);
  const sv = v * v * (3 - 2 * v);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

/** Noise in three octaves, 0–1. */
export function fbm(x: number, y: number, seed: number): number {
  return (noise(x, y, seed) * 4 + noise(x * 2.03, y * 2.03, seed + 1) * 2 + noise(x * 4.1, y * 4.1, seed + 2)) / 7;
}

// ——— The river and its plain ———

/** The river: a curve whose direction swings like a sine, through the origin. Flat [x, y, …]. */
export function riverPath(g: SceneParams['ground'], seed: number, reach: number): number[] {
  const ds = 20;
  const heading = (s: number, psi: number) => g.flow + (g.swing * (0.72 + 0.56 * noise(s / 5200, 3.5, seed + 11))) * (dsin(psi) + 0.17 * dsin(3 * psi)) + 0.6 * (noise(s / 9000, 7.5, seed + 12) - 0.5);
  const lengthAt = (s: number) => g.wavelength * (0.74 + 0.52 * noise(s / 3800, 1.5, seed + 13));
  const walk = (dir: number): number[] => {
    const out: number[] = [];
    let x = 0;
    let y = 0;
    let s = 0;
    let psi = 0;
    while (Math.abs(x) < reach && Math.abs(y) < reach && out.length < 40000) {
      const h = heading(s, psi);
      x += dir * dsin(h) * ds;
      y += dir * dcos(h) * ds;
      out.push(x, y);
      psi += (dir * ds * TAU) / lengthAt(s);
      s += dir * ds;
    }
    return out;
  };
  const back = walk(-1);
  const out: number[] = [];
  for (let i = back.length - 2; i >= 0; i -= 2) out.push(back[i], back[i + 1]);
  out.push(0, 0);
  out.push(...walk(1));
  return out;
}

/** The distance from each node of a grid to a set of lines: exact near them, stepped further off. */
export function distanceField(nx: number, ny: number, x0: number, y0: number, cell: number, lines: number[][], reach: number): Float32Array {
  const d = new Float32Array(nx * ny).fill(1e9);
  const k = Math.ceil(reach / cell);
  for (const l of lines) {
    for (let s = 0; s + 3 < l.length; s += 2) {
      const ax = l[s];
      const ay = l[s + 1];
      const ex = l[s + 2] - ax;
      const ey = l[s + 3] - ay;
      const q = ex * ex + ey * ey || 1;
      const i0 = Math.max(0, Math.floor((Math.min(ax, ax + ex) - x0) / cell) - k);
      const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, ax + ex) - x0) / cell) + k);
      const j0 = Math.max(0, Math.floor((Math.min(ay, ay + ey) - y0) / cell) - k);
      const j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, ay + ey) - y0) / cell) + k);
      for (let j = j0; j <= j1; j++) {
        const py = y0 + j * cell - ay;
        for (let i = i0; i <= i1; i++) {
          const px = x0 + i * cell - ax;
          const t0 = (px * ex + py * ey) / q;
          const t = t0 < 0 ? 0 : t0 > 1 ? 1 : t0;
          const fx = px - ex * t;
          const fy = py - ey * t;
          const v = fx * fx + fy * fy;
          const at = j * nx + i;
          if (v < d[at] * d[at]) d[at] = Math.sqrt(v);
        }
      }
    }
  }
  const diag = cell * Math.SQRT2;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const at = j * nx + i;
      let v = d[at];
      if (i > 0 && d[at - 1] + cell < v) v = d[at - 1] + cell;
      if (j > 0) {
        if (d[at - nx] + cell < v) v = d[at - nx] + cell;
        if (i > 0 && d[at - nx - 1] + diag < v) v = d[at - nx - 1] + diag;
        if (i < nx - 1 && d[at - nx + 1] + diag < v) v = d[at - nx + 1] + diag;
      }
      d[at] = v;
    }
  }
  for (let j = ny - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const at = j * nx + i;
      let v = d[at];
      if (i < nx - 1 && d[at + 1] + cell < v) v = d[at + 1] + cell;
      if (j < ny - 1) {
        if (d[at + nx] + cell < v) v = d[at + nx] + cell;
        if (i < nx - 1 && d[at + nx + 1] + diag < v) v = d[at + nx + 1] + diag;
        if (i > 0 && d[at + nx - 1] + diag < v) v = d[at + nx - 1] + diag;
      }
      d[at] = v;
    }
  }
  return d;
}

export interface Waters {
  river: number[];
  /** the old bends, as arcs */
  oxbows: number[][];
  /** ponds: x, y, radius across, radius along, in fours */
  ponds: number[];
}

/** Everywhere there is water on the plain, away from the river. */
export function watersOf(g: SceneParams['ground'], seed: number, reach: number): Waters {
  const river = riverPath(g, seed, 44000);
  const rng = new Rng(seed ^ 0x51ed27);
  const near = (x: number, y: number, far: number) => {
    let best = 1e18;
    for (let s = 0; s < river.length; s += 8) {
      const dx = river[s] - x;
      const dy = river[s + 1] - y;
      const v = dx * dx + dy * dy;
      if (v < best) best = v;
    }
    return Math.sqrt(best) < far;
  };
  const oxbows: number[][] = [];
  for (let k = 0, tries = 0; k < g.oxbows && tries < 400; tries++) {
    const x = rng.range(-reach, reach);
    const y = rng.range(-reach, reach);
    const r = rng.range(g.oxbow_radius[0], g.oxbow_radius[1]);
    if (near(x, y, r + g.width * 1.6) || !near(x, y, r + 2600)) continue;
    const a0 = rng.next() * TAU;
    const sweep = rng.range(3.4, 4.8);
    const arc: number[] = [];
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (sweep * i) / steps;
      const wob = r * (1 + 0.12 * dsin(a * 3 + a0));
      arc.push(x + dcos(a) * wob, y + dsin(a) * wob * 0.8);
    }
    oxbows.push(arc);
    k++;
  }
  const ponds: number[] = [];
  for (let k = 0, tries = 0; k < g.ponds && tries < 400; tries++) {
    const x = rng.range(-reach, reach);
    const y = rng.range(-reach, reach);
    const a = rng.range(g.pond_radius[0], g.pond_radius[1]);
    if (near(x, y, a * 2 + g.width)) continue;
    ponds.push(x, y, a, a * rng.range(0.55, 1));
    k++;
  }
  return { river, oxbows, ponds };
}

export interface GridSpec {
  nx: number;
  ny: number;
  x0: number;
  y0: number;
  cell: number;
}

/** The height of the plain over one grid, in metres, with its waters cut in. */
export function plainGrid(spec: GridSpec, g: SceneParams['ground'], water: number, seed: number, w: Waters): Float32Array {
  const { nx, ny, x0, y0, cell } = spec;
  const toRiver = distanceField(nx, ny, x0, y0, cell, [w.river], 320);
  const toOxbow = w.oxbows.length ? distanceField(nx, ny, x0, y0, cell, w.oxbows, 200) : null;
  const z = new Float32Array(nx * ny);
  const half0 = Math.max(g.width / 2, cell * 1.1);
  const oxHalf = Math.max(g.oxbow_width / 2, cell * 0.8);
  for (let j = 0; j < ny; j++) {
    const y = y0 + j * cell;
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * cell;
      const at = j * nx + i;
      const d = toRiver[at];
      // The plain: low swells, and back swamps where it sags.
      const swell = fbm(x / g.size, y / g.size, seed + 21);
      const sag = smooth(0.58, 0.74, noise(x / (g.size * 3.1), y / (g.size * 3.1), seed + 22));
      let plain = water + g.rise + (swell - 0.5) * 2 * g.roughness - sag * g.rise * 0.72;
      const half = half0 * (0.84 + 0.32 * noise(x / 1400, y / 1400, seed + 23));
      const off = d - half;
      // A raised bank along the river, and old channels' ridges fading across the bends.
      const lk = off / g.levee[1];
      plain += g.levee[0] / (1 + lk * lk);
      if (off < 900) {
        const fade = smooth(900, 120, off);
        plain += 0.28 * fade * dsin(off / 11);
      }
      let h: number;
      if (off < 0) {
        const f = d / half;
        h = water - g.depth * (1 - f * f);
      } else {
        const bank = g.bank[0] + (g.bank[1] - g.bank[0]) * smooth(0.36, 0.72, noise(x / 620, y / 620, seed + 24));
        const t = clamp01(off / bank);
        h = water + (plain - water) * (t * t * (3 - 2 * t));
      }
      if (toOxbow) {
        const dx = toOxbow[at];
        if (dx < oxHalf + 90) {
          const off2 = dx - oxHalf;
          if (off2 < 0) {
            const f = dx / oxHalf;
            h = Math.min(h, water - 2.2 * (1 - f * f));
          } else {
            const t = clamp01(off2 / 60);
            h = Math.min(h, water + (h - water) * (t * t * (3 - 2 * t)));
          }
        }
      }
      for (let k = 0; k < w.ponds.length; k += 4) {
        const dx = (x - w.ponds[k]) / w.ponds[k + 2];
        const dy = (y - w.ponds[k + 1]) / w.ponds[k + 3];
        const e = dx * dx + dy * dy;
        if (e < 2.4) {
          if (e < 1) h = Math.min(h, water - 1.3 * (1 - e));
          else {
            const t = clamp01((Math.sqrt(e) - 1) / 0.5);
            h = Math.min(h, water + (h - water) * (t * t * (3 - 2 * t)));
          }
        }
      }
      z[at] = h;
    }
  }
  return z;
}

/**
 * Where a visitor arrives: the inside of the first good bend from the origin, a little back from
 * the water; and the direction from there to the river.
 */
export function arrival(w: Waters, reach: number, inset: number): { at: [number, number]; toRiver: [number, number] } {
  const r = w.river;
  const n = r.length >> 1;
  let best = -1;
  let bestK = 0;
  const span = 14;
  for (let i = span; i < n - span; i++) {
    const x = r[i * 2];
    const y = r[i * 2 + 1];
    if (x * x + y * y > reach * reach) continue;
    const ax = r[(i - span) * 2];
    const ay = r[(i - span) * 2 + 1];
    const bx = r[(i + span) * 2];
    const by = r[(i + span) * 2 + 1];
    // How far the bend stands off its chord.
    const mx = (ax + bx) / 2 - x;
    const my = (ay + by) / 2 - y;
    const k = mx * mx + my * my;
    if (k > best) {
      best = k;
      bestK = i;
    }
  }
  const i = bestK;
  const x = r[i * 2];
  const y = r[i * 2 + 1];
  const mx = (r[(i - span) * 2] + r[(i + span) * 2]) / 2 - x;
  const my = (r[(i - span) * 2 + 1] + r[(i + span) * 2 + 1]) / 2 - y;
  const l = Math.sqrt(mx * mx + my * my) || 1;
  return { at: [x + (mx / l) * inset, y + (my / l) * inset], toRiver: [-mx / l, -my / l] };
}

// ——— What covers the ground ———

/** What a point of the plain is: water, bare sediment, canopy. Reused, to save making an object per point. */
export class Land {
  water = 0;
  bare = 0;
  canopy = 0;
  above = 0;
  private forest: number;
  private level: number;
  private seed: number;
  private c: SceneParams['cover'];
  private fx: number;
  private fy: number;

  constructor(file: SceneFile, params: SceneParams, private ground: GroundSampler) {
    this.level = file.site.water_level;
    this.seed = hashString(file.generator.seed);
    this.c = params.cover;
    this.forest = forestShare(file.biome.cover, params.cover.forest_by_climate[file.biome.climate] ?? 0);
    this.fx = file.site.focus[0];
    this.fy = file.site.focus[1];
  }

  at(x: number, y: number): this {
    const above = this.ground.at(x, y) - this.level;
    this.above = above;
    if (above < 0) {
      this.water = 1;
      this.bare = 0;
      this.canopy = 0;
      return this;
    }
    this.water = 0;
    const c = this.c;
    const wob = noise(x / 34, y / 34, this.seed + 31);
    this.bare = smooth(c.bare * 1.5, c.bare * 0.5, above + (wob - 0.5) * c.bare * 0.9);
    const n = fbm(x / c.patch, y / c.patch, this.seed + 32);
    let canopy = smooth(c.glade - 0.05, c.glade + 0.07, n);
    const dx = x - this.fx;
    const dy = y - this.fy;
    const r = Math.sqrt(dx * dx + dy * dy);
    canopy *= smooth(c.clearing, c.clearing * 1.5, r + (wob - 0.5) * c.clearing * 0.7);
    this.canopy = canopy * this.forest * (1 - this.bare);
    return this;
  }
}

/** How much of the land may be forest: what the transitions allow, as far as the climate bears it. */
export function forestShare(cover: SceneCover, byClimate: number): number {
  return Math.min(cover.forests, byClimate);
}

// ——— The plan ———

export interface ScenePlan {
  count: number;
  /** x, y, z, the direction it faces (two numbers), and its size as a share of a grown one */
  place: Float32Array;
  taxon: Uint16Array;
  pose: Uint8Array;
  /** a colour, and where it is in its stride */
  shade: Uint8Array;
  phase: Uint8Array;
  /** where names go: x, y, z of each animal group */
  groupAt: Float32Array;
  groupTaxon: Uint16Array;
}

export function planBytes(p: ScenePlan): Uint8Array {
  const parts: Uint8Array[] = [p.place, p.taxon, p.pose, p.shade, p.phase, p.groupAt, p.groupTaxon].map((a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of parts) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}

/** A growing list of organisms. */
class Placed {
  place: number[] = [];
  taxon: number[] = [];
  pose: number[] = [];
  shade: number[] = [];
  phase: number[] = [];
  add(x: number, y: number, z: number, fx: number, fy: number, size: number, taxon: number, pose: number, shade: number, phase: number): void {
    this.place.push(x, y, z, fx, fy, size);
    this.taxon.push(taxon);
    this.pose.push(pose);
    this.shade.push(shade);
    this.phase.push(phase);
  }
}

/** Trunks and bodies, in buckets, so that nothing is placed standing in anything else. */
class Occupied {
  private b = new Map<number, number[]>();
  private key = (i: number, j: number) => Math.imul(i, 73856093) ^ Math.imul(j, 19349663);
  add(x: number, y: number, r: number): void {
    const i = Math.floor(x / 16);
    const j = Math.floor(y / 16);
    const k = this.key(i, j);
    const l = this.b.get(k);
    if (l) l.push(x, y, r);
    else this.b.set(k, [x, y, r]);
  }
  free(x: number, y: number, r: number): boolean {
    const i = Math.floor(x / 16);
    const j = Math.floor(y / 16);
    const span = Math.ceil(r / 16) + 1;
    for (let v = -span; v <= span; v++) {
      for (let u = -span; u <= span; u++) {
        const l = this.b.get(this.key(i + u, j + v));
        if (!l) continue;
        for (let q = 0; q < l.length; q += 3) {
          const dx = l[q] - x;
          const dy = l[q + 1] - y;
          const s = l[q + 2] + r;
          if (dx * dx + dy * dy < s * s) return false;
        }
      }
    }
    return true;
  }
}

/** The half-width of the square the scene's life is laid out in. */
export const EXTENT = 6700;

export function scenePlan(file: SceneFile, ground: GroundSampler): ScenePlan {
  const params = file.generator.params as unknown as SceneParams;
  const seed = hashString(file.generator.seed);
  const rng = new Rng(seed);
  const land = new Land(file, params, ground);
  const [fx, fy] = file.site.focus;
  const water = file.site.water_level;
  const list = new Placed();
  const used = new Occupied();
  const taxa = file.taxa;
  const byPlan = (test: (t: SceneTaxon) => boolean) => taxa.map((t, i) => ({ t, i })).filter(({ t }) => test(t));
  const canopyTaxa = byPlan((t) => isPlant(t.plan) && t.plan !== 'fern' && t.posture !== 'floating' && t.height !== undefined);
  const ferns = byPlan((t) => t.plan === 'fern' && t.posture !== 'floating' && t.height !== undefined);
  const mats = byPlan((t) => t.posture === 'floating');
  const plantP = params.plants;

  const choose = (of: { t: SceneTaxon; i: number }[], wet: number): { t: SceneTaxon; i: number } => {
    let sum = 0;
    const weight = (e: { t: SceneTaxon }) => {
      const q = plantP.plans[e.t.plan];
      return e.t.rows * ((q?.weight ?? 1) + (q?.wet ?? 0) * wet);
    };
    for (const e of of) sum += weight(e);
    let u = rng.next() * sum;
    for (const e of of) {
      u -= weight(e);
      if (u <= 0) return e;
    }
    return of[of.length - 1];
  };

  // Trees: tight near the arrival and thinning out, with the canopy painted on the ground beyond.
  const treesAt = (r: number) => plantP.trees[0] + (plantP.trees[1] - plantP.trees[0]) * smooth(plantP.falloff[0], plantP.falloff[1], r);
  const sow = (step: number, keep: (x: number, y: number) => boolean) => {
    const n = Math.ceil((EXTENT * 2) / step);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -EXTENT + (i + hash2(i, j, seed + 41)) * step;
        const y = -EXTENT + (j + hash2(i, j, seed + 42)) * step;
        if (!keep(x, y)) continue;
        const dx = x - fx;
        const dy = y - fy;
        const r = Math.sqrt(dx * dx + dy * dy);
        land.at(x, y);
        if (land.water || land.canopy <= 0) continue;
        const chance = (treesAt(r) * land.canopy * step * step) / 10000;
        if (hash2(i, j, seed + 43) >= chance) continue;
        const wet = smooth(2.4, 0.5, land.above);
        const e = choose(canopyTaxa, wet);
        // A claim gives what a grown plant reaches: most of these have not, and none is past it.
        const grown = rng.next();
        const size = 0.42 + 0.58 * grown * grown;
        const a = rng.next() * TAU;
        list.add(x, y, ground.at(x, y), dcos(a), dsin(a), size, e.i, POSE.stand, rng.int(0, 255), 0);
        used.add(x, y, (e.t.height ?? 10) * size * 0.022 + 0.6);
      }
    }
  };
  const inner = 1600;
  if (canopyTaxa.length) {
    sow(8, (x, y) => Math.abs(x - fx) < inner && Math.abs(y - fy) < inner);
    sow(20, (x, y) => !(Math.abs(x - fx) < inner && Math.abs(y - fy) < inner));
  }
  // Ferns, under the trees and across the glades, as far as anyone will see them singly.
  if (ferns.length) {
    const step = 3;
    const reach = plantP.ferns_reach;
    const n = Math.ceil((reach * 2) / step);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = fx - reach + (i + hash2(i, j, seed + 51)) * step;
        const y = fy - reach + (j + hash2(i, j, seed + 52)) * step;
        const clump = noise(x / 22, y / 22, seed + 53);
        const chance = (plantP.ferns * clump * clump * 4 * step * step) / 10000;
        if (hash2(i, j, seed + 54) >= chance) continue;
        land.at(x, y);
        if (land.water || land.bare > 0.5) continue;
        const e = choose(ferns, smooth(2.4, 0.5, land.above));
        const a = rng.next() * TAU;
        list.add(x, y, ground.at(x, y), dcos(a), dsin(a), 0.5 + 0.5 * rng.next(), e.i, POSE.stand, rng.int(0, 255), 0);
      }
    }
  }
  // What floats, on the still water.
  if (mats.length) {
    const step = 14;
    const reach = 3600;
    const n = Math.ceil((reach * 2) / step);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = fx - reach + (i + hash2(i, j, seed + 61)) * step;
        const y = fy - reach + (j + hash2(i, j, seed + 62)) * step;
        const z = ground.at(x, y);
        // Shallow: a pond, an old bend or the river's margin.
        if (z >= water || z < water - 1.6) continue;
        const chance = (plantP.mats * step * step) / 10000;
        if (hash2(i, j, seed + 63) >= chance) continue;
        const e = choose(mats, 1);
        list.add(x, y, water, 1, 0, 0.6 + 0.8 * rng.next(), e.i, POSE.stand, rng.int(0, 255), 0);
      }
    }
  }

  // Animals, in groups: as many as their rows say, most of them near the arrival.
  const groups: number[] = [];
  const groupTaxa: number[] = [];
  const A = params.animals;
  const accept = (habitat: AnimalParams['habitat'], x: number, y: number, relaxed: boolean): boolean => {
    land.at(x, y);
    if (habitat === 'edge') return land.above > -1.8 && land.above < 1.1;
    if (land.water) return false;
    if (relaxed) return true;
    if (habitat === 'open') return land.canopy < 0.3 && land.bare < 0.7;
    if (habitat === 'forest') return land.canopy > 0.3;
    return true;
  };
  const animals = byPlan((t) => !isPlant(t.plan) && t.length !== undefined);
  // The biggest first, so that the small fit around them.
  animals.sort((a, b) => b.t.length! - a.t.length! || (a.t.id < b.t.id ? -1 : 1));
  for (const { t, i } of animals) {
    const a = A.plans[t.plan];
    if (!a) throw new Error(`${GENERATOR}: no parameters for body plan "${t.plan}"`);
    const total = Math.max(1, Math.round(t.rows * a.per_row));
    const nearCount = Math.max(1, Math.round(total * A.near_share));
    const L = t.length!;
    let left = total;
    let placedNear = 0;
    let first = true;
    while (left > 0) {
      const size = a.group[0] + Math.floor(rng.next() * (a.group[1] - a.group[0] + 1));
      const k = Math.min(size, left);
      const near = placedNear < nearCount;
      let cx = 0;
      let cy = 0;
      let found = false;
      for (let tries = 0; tries < 80 && !found; tries++) {
        const relaxed = tries > 60;
        if (first && L >= A.front_length && a.habitat !== 'edge') {
          // A group of each of the large ones in the clearing itself, in front of the eye: this is
          // a layout for a visitor, and no one's idea of how they mixed.
          const q = params.cover.clearing * (0.12 + 0.72 * Math.sqrt(rng.next()));
          const b = rng.next() * TAU;
          cx = fx + file.site.to_river[0] * params.cover.clearing * 0.1 + dcos(b) * q;
          cy = fy + file.site.to_river[1] * params.cover.clearing * 0.1 + dsin(b) * q;
        } else if (near) {
          // Around the arrival, thickest some way out from the middle of its clearing.
          const q = A.near_radius * (0.2 + 0.8 * Math.sqrt(rng.next()));
          const b = rng.next() * TAU;
          cx = fx + dcos(b) * q;
          cy = fy + dsin(b) * q;
        } else {
          cx = rng.range(-EXTENT, EXTENT);
          cy = rng.range(-EXTENT, EXTENT);
        }
        found = accept(a.habitat, cx, cy, relaxed);
      }
      const turn = rng.next() * TAU;
      const spread = L * (0.9 + 0.5 * Math.sqrt(k));
      let drawn = 0;
      for (let q = 0; q < k * 6 && drawn < k; q++) {
        const b = rng.next() * TAU;
        const r = drawn === 0 ? 0 : spread * Math.sqrt(rng.next());
        const x = cx + dcos(b) * r;
        const y = cy + dsin(b) * r;
        const relaxed = q > k * 4;
        if (!accept(a.habitat, x, y, relaxed)) continue;
        const scale = drawn === 0 ? 1 : 0.68 + 0.32 * rng.next();
        const R = L * scale * (t.plan === 'small-mammal' || t.plan === 'turtle' ? 0.5 : 0.34);
        if (!used.free(x, y, R) && !relaxed) continue;
        used.add(x, y, R);
        const h = turn + (rng.next() - 0.5) * 1.1;
        let pose: number = POSE[a.poses[Math.floor(rng.next() * a.poses.length)]];
        const gz = ground.at(x, y);
        let z = gz;
        if (a.habitat === 'edge') {
          const H = (t.hip ?? L * (HIP_SHARE[t.plan] ?? 0.2)) * scale;
          // Afloat where it is deep enough: with the water at the middle of its body.
          if (gz < water) z = Math.max(gz, water - H * 0.9);
        }
        // Whatever is at the water's edge is drinking, if it can.
        if (land.above < 1.2 && land.above > -0.2 && (pose === POSE.graze || pose === POSE.stand)) pose = POSE.drink;
        list.add(x, y, z, dsin(h), dcos(h), scale, i, pose, rng.int(0, 255), rng.int(0, 255));
        if (drawn === 0) {
          groups.push(x, y, z);
          groupTaxa.push(i);
        }
        drawn++;
      }
      if (near) placedNear += drawn || k;
      first = false;
      left -= k;
    }
  }

  const count = list.taxon.length;
  return {
    count,
    place: Float32Array.from(list.place),
    taxon: Uint16Array.from(list.taxon),
    pose: Uint8Array.from(list.pose),
    shade: Uint8Array.from(list.shade),
    phase: Uint8Array.from(list.phase),
    groupAt: Float32Array.from(groups),
    groupTaxon: Uint16Array.from(groupTaxa),
  };
}

