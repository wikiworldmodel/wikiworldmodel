// Rome's ordinary fabric, version 1 of gen:rome/fabric: blocks and lots between the mapped
// structures, the housing on them, and the trees of its gardens. None of it is evidence: it is
// there so that the monuments stand in a city, in the density the Regionary Catalogues describe.
//
// The streets are the gaps of a Voronoi diagram of scattered points, which gives the irregular
// warren of the real city without pretending to know its alleys. Each block is cut back from
// whatever real thing it meets (a mapped street, a monument, a garden, the river, the wall),
// then split into lots. Everything is seeded by place, not by order, and uses only exact
// arithmetic, so editing one temple changes only the blocks that touch it.
import type { CityFile, CityStructure } from '../../../../core/city.ts';
import type { GroundSampler } from '../../city/ground.ts';
import { MAT, Mesh, hip, ridged } from '../../city/kit.ts';
import { area, centroid, ccw, clamp, clipHalf, convexHull, hash2, hashString, inPoly, minBox, Rng, smoothstep, type Poly } from '../../city/math.ts';

export const GENERATOR = 'gen:rome/fabric';
export const VERSION = 1;

export interface FabricParams {
  site: { id: string; label: string; origin: { lat: number; lon: number }; span: [number, number]; slice: number; water_level: number };
  block: number;
  street: number;
  insula_area: number;
  domus_area: number;
  domus_weight: number;
  storeys: [number, number];
  storey_height: number;
  tree_spacing: number;
}

export const LOT_INSULA = 0;
export const LOT_DOMUS = 1;
export const LOT_VILLA = 2;

export interface FabricPlan {
  lots: number;
  /** where each lot's points begin in `points`; one more than there are lots */
  offset: Int32Array;
  points: Float32Array;
  /** ground under its lowest corner, and the top of its walls */
  base: Float32Array;
  top: Float32Array;
  type: Uint8Array;
  region: Uint8Array;
  style: Uint8Array;
  treeCount: number;
  /** x, y, ground, height for each tree */
  trees: Float32Array;
  treeType: Uint8Array;
  /** how many lots each region received */
  regionLots: number[];
  /** the circuit of the wall, if the city has one */
  domain: Poly;
}

/** The plan as bytes: what the build and the browser must agree on. */
export function planBytes(p: FabricPlan): Uint8Array {
  const parts: Uint8Array[] = [p.offset, p.points, p.base, p.top, p.type, p.region, p.style, p.trees, p.treeType].map((a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of parts) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}

const alive = (s: CityStructure, y: number) => (s.time.start.best ?? -Infinity) <= y && y <= (s.time.end.best ?? Infinity);

interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** how far the blocks stay from it */
  keep: number;
}

interface Hull {
  poly: Poly;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  margin: number;
}

/** A coarse grid of what is near a place, so a block looks only at its neighbours. */
class Buckets<T> {
  private cells = new Map<number, T[]>();
  constructor(private size: number) {}
  add(x0: number, y0: number, x1: number, y1: number, item: T): void {
    const s = this.size;
    for (let j = Math.floor(y0 / s); j <= Math.floor(y1 / s); j++) {
      for (let i = Math.floor(x0 / s); i <= Math.floor(x1 / s); i++) {
        const k = (j + 4096) * 8192 + (i + 4096);
        const c = this.cells.get(k);
        if (c) c.push(item);
        else this.cells.set(k, [item]);
      }
    }
  }
  near(x0: number, y0: number, x1: number, y1: number): T[] {
    const s = this.size;
    const seen = new Set<T>();
    for (let j = Math.floor(y0 / s); j <= Math.floor(y1 / s); j++) {
      for (let i = Math.floor(x0 / s); i <= Math.floor(x1 / s); i++) {
        const c = this.cells.get((j + 4096) * 8192 + (i + 4096));
        if (c) for (const t of c) seen.add(t);
      }
    }
    return [...seen];
  }
}

const segDist2 = (px: number, py: number, s: Seg) => {
  const ex = s.bx - s.ax;
  const ey = s.by - s.ay;
  const l2 = ex * ex + ey * ey;
  const t = l2 > 0 ? clamp(((px - s.ax) * ex + (py - s.ay) * ey) / l2, 0, 1) : 0;
  const dx = s.ax + ex * t - px;
  const dy = s.ay + ey * t - py;
  return dx * dx + dy * dy;
};

/** Keep the side of a line a point is on, and stay `keep` metres from the line. */
function clipFromLine(p: Poly, x: number, y: number, s: Seg): Poly {
  const ex = s.bx - s.ax;
  const ey = s.by - s.ay;
  const l = Math.sqrt(ex * ex + ey * ey);
  if (l < 1e-6) return p;
  let nx = ey / l;
  let ny = -ex / l;
  let d = nx * (x - s.ax) + ny * (y - s.ay);
  if (d < 0) {
    nx = -nx;
    ny = -ny;
    d = -d;
  }
  // Keep where n·(q − a) ≥ keep: (−n)·q ≤ −n·a − keep
  return clipHalf(p, -nx, -ny, -(nx * s.ax + ny * s.ay) - s.keep);
}

/** Keep the part of a block outside a convex hull: across the hull's edge that faces the seed. */
function clipFromHull(p: Poly, x: number, y: number, h: Hull): Poly {
  const q = h.poly;
  const n = q.length / 2;
  let best = -Infinity;
  let bx = 0;
  let by = 0;
  let bc = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = q[j * 2] - q[i * 2];
    const ey = q[j * 2 + 1] - q[i * 2 + 1];
    const l = Math.sqrt(ex * ex + ey * ey);
    if (l < 1e-6) continue;
    const nx = ey / l;
    const ny = -ex / l;
    const c = nx * q[i * 2] + ny * q[i * 2 + 1];
    const d = nx * x + ny * y - c;
    if (d > best) {
      best = d;
      bx = nx;
      by = ny;
      bc = c;
    }
  }
  return clipHalf(p, -bx, -by, -bc - h.margin);
}

/** Cut a convex block into lots of about `target` square metres, with narrow gaps between. */
function subdivide(p: Poly, target: number, rng: Rng, out: Poly[], depth = 0): void {
  const a = area(p);
  if (a < 30) return;
  if (a <= target * 1.4 || depth > 8) {
    out.push(p);
    return;
  }
  const b = minBox(p);
  const t = rng.range(0.38, 0.62) * 2 - 1;
  const mid = b.cx * b.ux + b.cy * b.uy + t * b.hl;
  const gap = rng.next() < 0.14 ? 1.6 : rng.range(0.1, 0.5);
  const lo = clipHalf(p, b.ux, b.uy, mid - gap);
  const hi = clipHalf(p, -b.ux, -b.uy, -mid - gap);
  if (lo.length >= 6) subdivide(lo, target, rng, out, depth + 1);
  if (hi.length >= 6) subdivide(hi, target, rng, out, depth + 1);
}

export function fabricPlan(city: CityFile, ground: GroundSampler): FabricPlan {
  const params = city.fabric.params as unknown as FabricParams;
  const seed = hashString(city.fabric.seed);
  const slice = city.site.slice;
  const block = params.block;
  const street = params.street;

  // What the blocks must keep clear of.
  const hulls = new Buckets<Hull>(240);
  const segs = new Buckets<Seg>(240);
  const addSeg = (s: Seg) => segs.add(Math.min(s.ax, s.bx) - s.keep, Math.min(s.ay, s.by) - s.keep, Math.max(s.ax, s.bx) + s.keep, Math.max(s.ay, s.by) + s.keep, s);
  const addLine = (line: number[], keep: number, closed = false) => {
    const n = line.length / 2;
    for (let i = 0; i < n - (closed ? 0 : 1); i++) {
      const j = (i + 1) % n;
      addSeg({ ax: line[i * 2], ay: line[i * 2 + 1], bx: line[j * 2], by: line[j * 2 + 1], keep });
    }
  };
  let domain: Poly = [];
  const solid: Poly[] = [];
  const gardens: Poly[] = [];
  for (const s of city.structures) {
    if (!alive(s, slice)) continue;
    if (s.kind === 'open/district' || s.kind === 'open/water' || s.kind === 'open/island') continue;
    if (s.kind === 'works/wall' && s.id === 'rome/aurelian-walls') {
      domain = (s.lines ?? []).reduce((a, b) => (b.length > a.length ? b : a), [] as number[]);
      addLine(domain, 7, true);
      continue;
    }
    if (s.kind === 'works/road') {
      const major = s.look?.highway === 'primary' || s.curated;
      for (const l of s.lines ?? []) addLine(l, (major ? 3.75 : 2.5) + street * 0.5);
      continue;
    }
    if (s.kind === 'works/aqueduct') {
      if (s.look?.bridge === 'aqueduct' || s.curated) for (const l of s.lines ?? []) addLine(l, 3.5);
      continue;
    }
    if (s.kind === 'works/wall') continue;
    for (const r of s.rings) {
      if (r.length < 6) continue;
      const hull = convexHull(r);
      if (s.kind === 'open/garden') gardens.push(r);
      else solid.push(r);
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < hull.length; i += 2) {
        x0 = Math.min(x0, hull[i]);
        x1 = Math.max(x1, hull[i]);
        y0 = Math.min(y0, hull[i + 1]);
        y1 = Math.max(y1, hull[i + 1]);
      }
      const h: Hull = { poly: hull, x0, y0, x1, y1, margin: street };
      hulls.add(x0, y0, x1, y1, h);
    }
  }
  for (const w of city.water) addLine(w, 8, true);

  const solidBuckets = new Buckets<Poly>(240);
  const addPoly = (b: Buckets<Poly>, r: Poly) => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < r.length; i += 2) {
      x0 = Math.min(x0, r[i]);
      x1 = Math.max(x1, r[i]);
      y0 = Math.min(y0, r[i + 1]);
      y1 = Math.max(y1, r[i + 1]);
    }
    b.add(x0, y0, x1, y1, r);
  };
  for (const r of solid) addPoly(solidBuckets, r);
  for (const r of gardens) addPoly(solidBuckets, r);
  const waterBuckets = new Buckets<Poly>(480);
  for (const r of city.water) addPoly(waterBuckets, r);

  const inDomain = (x: number, y: number) => (domain.length ? inPoly(domain, x, y) : x * x + y * y < 3500 * 3500);
  const inWater = (x: number, y: number) => waterBuckets.near(x, y, x, y).some((r) => inPoly(r, x, y)) && !city.islands.some((r) => inPoly(r, x, y));

  // Points to grow blocks from: a jittered grid, inside the walls; along the roads outside.
  const seeds: number[] = [];
  const reach = 5200;
  const nCells = Math.ceil((reach * 2) / block);
  const seedAt = new Map<number, [number, number]>();
  for (let j = 0; j < nCells; j++) {
    for (let i = 0; i < nCells; i++) {
      const x = -reach + (i + 0.5) * block + (hash2(i, j, seed) - 0.5) * block * 0.72;
      const y = -reach + (j + 0.5) * block + (hash2(i, j, seed ^ 0x55555555) - 0.5) * block * 0.72;
      if (Math.abs(x) > 6300 || Math.abs(y) > 6100) continue;
      seedAt.set(j * 65536 + i, [x, y]);
    }
  }
  const seedOK = (x: number, y: number, i: number, j: number): boolean => {
    if (inWater(x, y)) return false;
    if (hulls.near(x, y, x, y).some((h) => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1 && inPoly(h.poly, x, y))) return false;
    if (inDomain(x, y)) return true;
    // Outside the walls: houses thin out along the roads.
    const near = segs.near(x - 100, y - 100, x + 100, y + 100).some((s) => s.keep < 7 && segDist2(x, y, s) < 90 * 90);
    if (!near) return false;
    return hash2(i, j, seed ^ 0x1234567) < 0.5 * (1 - smoothstep(3200, 5200, Math.sqrt(x * x + y * y)));
  };

  // Blocks: each seed's Voronoi cell, with a street's width taken off, cut back from what it meets.
  const regionOf = (x: number, y: number): number => {
    let best = 0;
    let bd = Infinity;
    city.fabric.regions.forEach((r, k) => {
      const d = (r.at[0] - x) * (r.at[0] - x) + (r.at[1] - y) * (r.at[1] - y);
      if (d < bd) {
        bd = d;
        best = k;
      }
    });
    return best;
  };
  const blocks: { p: Poly; x: number; y: number; region: number; inside: boolean; i: number; j: number }[] = [];
  for (let j = 0; j < nCells; j++) {
    for (let i = 0; i < nCells; i++) {
      const at = seedAt.get(j * 65536 + i);
      if (!at) continue;
      const [x, y] = at;
      if (!seedOK(x, y, i, j)) continue;
      seeds.push(x, y);
      const r = block * 1.3;
      let p: Poly = [x - r, y - r, x + r, y - r, x + r, y + r, x - r, y + r];
      for (let dj = -2; dj <= 2 && p.length >= 6; dj++) {
        for (let di = -2; di <= 2 && p.length >= 6; di++) {
          if (!di && !dj) continue;
          const o = seedAt.get((j + dj) * 65536 + (i + di));
          if (!o) continue;
          const nx = o[0] - x;
          const ny = o[1] - y;
          const l = Math.sqrt(nx * nx + ny * ny);
          if (l < 1e-6) continue;
          // Halfway to the neighbour, less half a street, wider on some.
          const w = street * (0.75 + 0.8 * hash2(Math.min(i, i + di) * 7 + di, Math.min(j, j + dj) * 7 + dj, seed ^ 0x77));
          p = clipHalf(p, nx / l, ny / l, (nx / l) * (x + nx / 2) + (ny / l) * (y + ny / 2) - w / 2);
        }
      }
      if (p.length < 6) continue;
      for (const s of segs.near(x - r, y - r, x + r, y + r)) {
        if (segDist2(x, y, s) > (r + s.keep) * (r + s.keep)) continue;
        p = clipFromLine(p, x, y, s);
        if (p.length < 6) break;
      }
      if (p.length < 6) continue;
      for (const h of hulls.near(x - r, y - r, x + r, y + r)) {
        p = clipFromHull(p, x, y, h);
        if (p.length < 6) break;
      }
      if (p.length < 6 || area(p) < 90) continue;
      const [cx, cy] = centroid(p);
      if (inWater(cx, cy)) continue;
      blocks.push({ p, x, y, region: regionOf(cx, cy), inside: inDomain(cx, cy), i, j });
    }
  }

  // How big a lot is in each region: what the catalogues count, spread over what ground there is.
  const regions = city.fabric.regions;
  const groundOf = regions.map(() => 0);
  for (const b of blocks) if (b.inside) groundOf[b.region] += area(b.p);
  const wOf = regions.map((r) => (r.insulae ?? 3000) + params.domus_weight * (r.domus ?? 120));
  const totalW = wOf.reduce((a, b) => a + b, 0) || 1;
  const totalA = groundOf.reduce((a, b) => a + b, 0) || 1;
  const totalLots = totalA / params.insula_area;
  const lotArea = regions.map((_, k) => clamp(groundOf[k] / Math.max(1, (totalLots * wOf[k]) / totalW), 240, 2400));
  const domusShare = regions.map((r, k) => clamp((params.domus_weight * (r.domus ?? 120)) / wOf[k] * 3, 0.05, 0.5));

  // Lots, and what stands on them.
  const offset: number[] = [0];
  const points: number[] = [];
  const base: number[] = [];
  const top: number[] = [];
  const type: number[] = [];
  const region: number[] = [];
  const style: number[] = [];
  const regionLots = regions.map(() => 0);
  const addLot = (raw: Poly, b: { region: number; inside: boolean; i: number; j: number }, k: number) => {
    const p = ccw(raw);
    const a = area(p);
    if (a < 28) return;
    const rng = new Rng(Math.imul(b.i * 4099 + b.j, 2654435761) ^ seed ^ (k * 977));
    const elev = ground.at(p[0], p[1]);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      const z = ground.at(p[i], p[i + 1]);
      lo = Math.min(lo, z);
      hi = Math.max(hi, z);
    }
    if (hi - lo > 11) return; // too steep to build on
    let kind = LOT_INSULA;
    if (!b.inside) kind = LOT_VILLA;
    else if (a > params.domus_area * 0.45 && rng.next() < domusShare[b.region] * (0.6 + smoothstep(25, 55, elev))) kind = LOT_DOMUS;
    let h: number;
    if (kind === LOT_INSULA) {
      const storeys = rng.int(params.storeys[0], params.storeys[1]);
      h = storeys * params.storey_height + rng.range(0, 0.6);
    } else if (kind === LOT_DOMUS) h = rng.int(1, 2) * 3.8 + 0.8;
    else h = rng.int(1, 2) * 3.4;
    for (let i = 0; i < p.length; i++) points.push(Math.round(p[i] * 100) / 100);
    offset.push(points.length);
    base.push(lo);
    top.push(hi + h);
    type.push(kind);
    region.push(b.region);
    style.push(rng.int(0, 255));
    if (b.inside) regionLots[b.region]++;
  };
  for (const b of blocks) {
    const rng = new Rng(Math.imul(b.i * 131 + b.j, 40503) ^ seed);
    // A few blocks stay open: a yard, a small garden, a shrine's precinct.
    if (rng.next() < 0.035) continue;
    const lots: Poly[] = [];
    const target = b.inside ? lotArea[b.region] : params.domus_area * 1.6;
    if (!b.inside && area(b.p) > target * 2) {
      // Outside the walls, houses in their own ground.
      subdivide(b.p, target, rng, lots);
      lots.forEach((l, k) => {
        if (rng.next() < 0.5) addLot(shrink(l, rng.range(3, 9)), b, k);
      });
      continue;
    }
    subdivide(b.p, target, rng, lots);
    lots.forEach((l, k) => addLot(l, b, k));
  }

  // Trees: in the gardens, a loose grid; outside the walls, scattered, and thinning with distance.
  const treeData: number[] = [];
  const treeType: number[] = [];
  const addTree = (x: number, y: number, kind: number, rng: Rng) => {
    const h = kind === 0 ? rng.range(10, 18) : kind === 1 ? rng.range(8, 16) : rng.range(6, 12);
    treeData.push(Math.round(x * 100) / 100, Math.round(y * 100) / 100, Math.round(ground.at(x, y) * 100) / 100, Math.round(h * 100) / 100);
    treeType.push(kind);
  };
  const sp = params.tree_spacing;
  for (const g of gardens) {
    const bb = minBox(g);
    const rng = new Rng(hashString(`${Math.round(bb.cx)},${Math.round(bb.cy)}`) ^ seed);
    const nu = Math.ceil((bb.hl * 2) / sp);
    const nv = Math.ceil((bb.hw * 2) / sp);
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j <= nv; j++) {
        if (rng.next() < 0.25) continue;
        const u = -bb.hl + i * sp + rng.range(-sp, sp) * 0.4;
        const v = -bb.hw + j * sp + rng.range(-sp, sp) * 0.4;
        const x = bb.cx + bb.ux * u - bb.uy * v;
        const y = bb.cy + bb.uy * u + bb.ux * v;
        if (inPoly(g, x, y) && !inWater(x, y)) addTree(x, y, rng.next() < 0.45 ? 0 : rng.next() < 0.5 ? 1 : 2, rng);
      }
    }
  }
  // The open country: copses by a low-frequency pattern, off the buildings and the river.
  const cell = 46;
  const span = Math.floor(6200 / cell);
  for (let j = -span; j <= span; j++) {
    for (let i = -span; i <= span; i++) {
      const x = i * cell + (hash2(i, j, seed ^ 0xabcd) - 0.5) * cell;
      const y = j * cell + (hash2(j, i, seed ^ 0xbcde) - 0.5) * cell;
      if (inDomain(x, y) || Math.abs(x) > 6200 || Math.abs(y) > 6000) continue;
      const u = hash2(Math.floor(i / 7), Math.floor(j / 7), seed ^ 0xcdef);
      if (hash2(i, j, seed ^ 0xdef0) > u * u * 0.9 + 0.04) continue;
      if (inWater(x, y) || solidBuckets.near(x, y, x, y).some((r) => inPoly(r, x, y))) continue;
      const rng = new Rng(Math.imul(i * 8191 + j, 31337) ^ seed);
      addTree(x, y, rng.next() < 0.3 ? 0 : rng.next() < 0.35 ? 1 : 2, rng);
    }
  }

  return {
    lots: type.length,
    offset: Int32Array.from(offset),
    points: Float32Array.from(points),
    base: Float32Array.from(base),
    top: Float32Array.from(top),
    type: Uint8Array.from(type),
    region: Uint8Array.from(region),
    style: Uint8Array.from(style),
    treeCount: treeType.length,
    trees: Float32Array.from(treeData),
    treeType: Uint8Array.from(treeType),
    regionLots,
    domain,
  };
}

/** A lot pulled in by `d` on every side, so a house stands in its own ground. */
function shrink(p: Poly, d: number): Poly {
  let out = ccw(p);
  const q = out;
  const n = q.length / 2;
  for (let i = 0; i < n && out.length >= 6; i++) {
    const j = (i + 1) % n;
    const ex = q[j * 2] - q[i * 2];
    const ey = q[j * 2 + 1] - q[i * 2 + 1];
    const l = Math.sqrt(ex * ex + ey * ey);
    if (l < 1e-6) continue;
    out = clipHalf(out, ey / l, -ex / l, (ey / l) * q[i * 2] + (-ex / l) * q[i * 2 + 1] - d);
  }
  return out;
}

/** The lot's outline, a fresh array of its points. */
export function lotPoly(p: FabricPlan, i: number): Poly {
  return Array.from(p.points.subarray(p.offset[i], p.offset[i + 1]));
}

/** The colours of plaster and of brick a house may have, as indices the shader knows. */
const facadeTint = (style: number) => style;

/** A wall of a house: its v counts metres up from the house's foot, so its windows line up. */
function facadeWall(m: Mesh, x0: number, y0: number, x1: number, y1: number, z0: number, t0: number, t1: number, zero: number, u0: number): number {
  const ex = x1 - x0;
  const ey = y1 - y0;
  const l = Math.sqrt(ex * ex + ey * ey) || 1;
  const nx = ey / l;
  const ny = -ex / l;
  const a = m.v(x0, y0, z0, nx, ny, 0, u0, z0 - zero, 0.72);
  const b = m.v(x1, y1, z0, nx, ny, 0, u0 + l, z0 - zero, 0.72);
  const c = m.v(x1, y1, t1, nx, ny, 0, u0 + l, t1 - zero);
  const d = m.v(x0, y0, t0, nx, ny, 0, u0, t0 - zero);
  m.quad(a, b, c, d);
  return l;
}

/** Raise lot i: walls, a hipped roof, and close by, what catches the eye from the street. */
export function raiseLot(m: Mesh, plan: FabricPlan, i: number, detail: number): void {
  const p = lotPoly(plan, i);
  const n = p.length / 2;
  const z0 = plan.base[i] - 1.2;
  const zero = plan.base[i];
  const zt = plan.top[i];
  const st = plan.style[i];
  const kind = plan.type[i];
  m.place(0, 0, 0);
  m.light = 1;
  const roofTint = 96 + ((st * 37) & 127);
  const a = area(p);
  const pitch = 0.2 + (st & 15) * 0.006;
  const b = minBox(p);
  const walls = (q: Poly, top: (x: number, y: number) => number, u0 = 0) => {
    m.mat = MAT.facade;
    m.tint = facadeTint(st);
    let u = u0;
    const k = q.length / 2;
    for (let e = 0; e < k; e++) {
      const j = (e + 1) % k;
      u += facadeWall(m, q[e * 2], q[e * 2 + 1], q[j * 2], q[j * 2 + 1], z0, top(q[e * 2], q[e * 2 + 1]), top(q[j * 2], q[j * 2 + 1]), zero, u);
    }
    return u;
  };
  // A house has a court open to the sky; a big block has a light well.
  const court = (kind === LOT_DOMUS && a > 300) || (kind === LOT_INSULA && a > 700 && (st & 3) !== 0);
  if (court && b.hw > 7 && b.hl > 7) {
    walls(p, () => zt);
    m.mat = MAT.tile;
    m.tint = roofTint;
    const cw = Math.min(b.hw * 0.42, 9);
    const cl = Math.min(b.hl * 0.42, 12);
    const proj = (q: Poly, ax: number, ay: number, c: number) => clipHalf(q, ax, ay, c);
    const uc = b.cx * b.ux + b.cy * b.uy;
    const vc = -b.cx * b.uy + b.cy * b.ux;
    // Four wings around the court, each its own roof.
    const north = proj(p, b.uy, -b.ux, -(vc + cw));
    const south = proj(p, -b.uy, b.ux, vc - cw);
    const middle = proj(proj(p, -b.uy, b.ux, -(vc - cw)), b.uy, -b.ux, vc + cw);
    const east = proj(middle, -b.ux, -b.uy, -(uc + cl));
    const west = proj(middle, b.ux, b.uy, uc - cl);
    for (const w of [north, south, east, west]) if (w.length >= 6 && area(w) > 6) hip(m, ccw(w), zt, pitch, 0.35);
    // The court's floor and its walls.
    const cx0 = b.cx + b.ux * cl - b.uy * cw;
    const cy0 = b.cy + b.uy * cl + b.ux * cw;
    const cx1 = b.cx - b.ux * cl - b.uy * cw;
    const cy1 = b.cy - b.uy * cl + b.ux * cw;
    const cx2 = b.cx - b.ux * cl + b.uy * cw;
    const cy2 = b.cy - b.uy * cl - b.ux * cw;
    const cx3 = b.cx + b.ux * cl + b.uy * cw;
    const cy3 = b.cy + b.uy * cl - b.ux * cw;
    m.mat = kind === LOT_DOMUS ? MAT.grass : MAT.paving;
    m.tint = 150;
    m.quad(m.v(cx3, cy3, zero + 0.4, 0, 0, 1, cx3, cy3, 0.5), m.v(cx0, cy0, zero + 0.4, 0, 0, 1, cx0, cy0, 0.5), m.v(cx1, cy1, zero + 0.4, 0, 0, 1, cx1, cy1, 0.5), m.v(cx2, cy2, zero + 0.4, 0, 0, 1, cx2, cy2, 0.5));
    m.mat = MAT.facade;
    m.tint = facadeTint(st);
    let w = 0;
    w += facadeWall(m, cx1, cy1, cx0, cy0, zero, zt, zt, zero, w);
    w += facadeWall(m, cx0, cy0, cx3, cy3, zero, zt, zt, zero, w);
    w += facadeWall(m, cx3, cy3, cx2, cy2, zero, zt, zt, zero, w);
    w += facadeWall(m, cx2, cy2, cx1, cy1, zero, zt, zt, zero, w);
  } else if ((st & 7) === 7) {
    // Now and then a low hipped roof.
    walls(p, () => zt);
    m.mat = MAT.tile;
    m.tint = roofTint;
    hip(m, p, zt, pitch * 0.9, 0.4);
  } else {
    // Mostly a ridge along the long side, the walls rising to it at the ends.
    m.mat = MAT.tile;
    m.tint = roofTint;
    const r = ridged(m, p, zt, pitch, 0.4);
    // Walls carry a point where the ridge crosses them, so the gable closes.
    const withRidge: Poly = [];
    for (let e = 0; e < n; e++) {
      const j = (e + 1) % n;
      const ax = p[e * 2];
      const ay = p[e * 2 + 1];
      const bx = p[j * 2];
      const by = p[j * 2 + 1];
      withRidge.push(ax, ay);
      const da = r.nx * ax + r.ny * ay - r.c;
      const db = r.nx * bx + r.ny * by - r.c;
      if ((da < -1e-3 && db > 1e-3) || (da > 1e-3 && db < -1e-3)) {
        const t = da / (da - db);
        withRidge.push(ax + (bx - ax) * t, ay + (by - ay) * t);
      }
    }
    walls(withRidge, r.top);
  }
  if (!detail) return;
  // What you see from the street: a timber balcony on long walls, and awnings over the shops.
  const rng = new Rng(st * 2053 + i);
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    const ex = p[j * 2] - p[k * 2];
    const ey = p[j * 2 + 1] - p[k * 2 + 1];
    const l = Math.sqrt(ex * ex + ey * ey);
    if (l < 7) continue;
    const ux = ex / l;
    const uy = ey / l;
    const nx = uy;
    const ny = -ux;
    if (kind === LOT_INSULA && zt - zero > 9 && rng.next() < 0.45) {
      const zb = zero + 3.6 + 3.3 * rng.int(0, 1);
      const inset = rng.range(0.5, 2);
      const a0 = inset;
      const a1 = l - inset;
      const px = (s: number, d: number) => p[k * 2] + ux * s + nx * d;
      const py = (s: number, d: number) => p[k * 2 + 1] + uy * s + ny * d;
      m.mat = MAT.wood;
      m.tint = 110 + (st & 31);
      // Floor, then rail.
      m.quad(m.v(px(a0, 0), py(a0, 0), zb, 0, 0, 1, 0, 0), m.v(px(a0, 1), py(a0, 1), zb, 0, 0, 1, 0, 1), m.v(px(a1, 1), py(a1, 1), zb, 0, 0, 1, l, 1), m.v(px(a1, 0), py(a1, 0), zb, 0, 0, 1, l, 0));
      m.quad(m.v(px(a0, 0), py(a0, 0), zb - 0.12, 0, 0, -1, 0, 0), m.v(px(a1, 0), py(a1, 0), zb - 0.12, 0, 0, -1, l, 0), m.v(px(a1, 1), py(a1, 1), zb - 0.12, 0, 0, -1, l, 1), m.v(px(a0, 1), py(a0, 1), zb - 0.12, 0, 0, -1, 0, 1));
      m.quad(m.v(px(a0, 1), py(a0, 1), zb - 0.12, nx, ny, 0, 0, 0), m.v(px(a1, 1), py(a1, 1), zb - 0.12, nx, ny, 0, l, 0), m.v(px(a1, 1), py(a1, 1), zb + 1, nx, ny, 0, l, 1.1), m.v(px(a0, 1), py(a0, 1), zb + 1, nx, ny, 0, 0, 1.1));
    }
    if (kind === LOT_INSULA && rng.next() < 0.3) {
      const w0 = rng.range(0.5, l * 0.4);
      const w1 = Math.min(l - 0.5, w0 + rng.range(2.5, 6));
      const z1 = zero + 3.1;
      const z2 = zero + 2.5;
      const px = (s: number, d: number) => p[k * 2] + ux * s + nx * d;
      const py = (s: number, d: number) => p[k * 2 + 1] + uy * s + ny * d;
      const q = Math.sqrt(0.6 * 0.6 + 1.5 * 1.5);
      const wx = (nx * 0.6) / q;
      const wy = (ny * 0.6) / q;
      m.mat = MAT.awning;
      m.tint = rng.int(0, 255);
      m.quad(m.v(px(w0, 0), py(w0, 0), z1, wx, wy, 1.5 / q, 0, 0), m.v(px(w0, 1.5), py(w0, 1.5), z2, wx, wy, 1.5 / q, 0, 1.5), m.v(px(w1, 1.5), py(w1, 1.5), z2, wx, wy, 1.5 / q, w1 - w0, 1.5), m.v(px(w1, 0), py(w1, 0), z1, wx, wy, 1.5 / q, w1 - w0, 0));
    }
  }
}
