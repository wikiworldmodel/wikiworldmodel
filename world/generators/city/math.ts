// Geometry for the city's generators. Like every generator here it uses only + − × ÷, sqrt,
// floor and 32-bit integer operations, whose results IEEE 754 fixes: sine and cosine are
// polynomials rather than Math.sin, so every JavaScript engine makes the same city.

export const PI = 3.141592653589793;
export const TAU = 2 * PI;

/** Sine, by reducing to a quarter turn and a Taylor series good to 1e-9 there. */
export function dsin(x: number): number {
  const turns = Math.floor(x / TAU + 0.5);
  let r = x - turns * TAU; // −π … π
  if (r > PI / 2) r = PI - r;
  else if (r < -PI / 2) r = -PI - r;
  const q = r * r;
  return r * (1 + q * (-1 / 6 + q * (1 / 120 + q * (-1 / 5040 + q * (1 / 362880 + q * (-1 / 39916800))))));
}

export const dcos = (x: number) => dsin(x + PI / 2);

export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** FNV-1a, 32 bit. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mixHash(h: number): number {
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A number in [0, 1) from integers: the same everywhere, and independent of anything else in the world. */
export function hash2(a: number, b: number, seed: number): number {
  return mixHash(seed ^ Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1)) / 4294967296;
}

export function hash3(a: number, b: number, c: number, seed: number): number {
  return mixHash(seed ^ Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) / 4294967296;
}

/** A small stream of random numbers. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    this.s = mixHash(this.s + 0x9e3779b9);
    return this.s / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }
}

/** A polygon: flat [x, y, x, y, …], closed implicitly. */
export type Poly = number[];

/** Twice the signed area; positive when counter-clockwise. */
export function signedArea2(p: Poly): number {
  let a = 0;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += p[j * 2] * p[i * 2 + 1] - p[i * 2] * p[j * 2 + 1];
  return a;
}

export const area = (p: Poly) => Math.abs(signedArea2(p)) / 2;

export function ccw(p: Poly): Poly {
  if (signedArea2(p) >= 0) return p;
  const out: Poly = [];
  for (let i = p.length - 2; i >= 0; i -= 2) out.push(p[i], p[i + 1]);
  return out;
}

export function centroid(p: Poly): [number, number] {
  let a = 0;
  let x = 0;
  let y = 0;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const c = p[j * 2] * p[i * 2 + 1] - p[i * 2] * p[j * 2 + 1];
    a += c;
    x += (p[j * 2] + p[i * 2]) * c;
    y += (p[j * 2 + 1] + p[i * 2 + 1]) * c;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i++) {
      sx += p[i * 2];
      sy += p[i * 2 + 1];
    }
    return [sx / n, sy / n];
  }
  return [x / (3 * a), y / (3 * a)];
}

/** Keep the part of a convex polygon where a·x + b·y ≤ c. */
export function clipHalf(p: Poly, a: number, b: number, c: number): Poly {
  const out: Poly = [];
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = p[i * 2];
    const y0 = p[i * 2 + 1];
    const x1 = p[j * 2];
    const y1 = p[j * 2 + 1];
    const d0 = a * x0 + b * y0 - c;
    const d1 = a * x1 + b * y1 - c;
    if (d0 <= 0) out.push(x0, y0);
    if ((d0 < 0 && d1 > 0) || (d0 > 0 && d1 < 0)) {
      const t = d0 / (d0 - d1);
      out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    }
  }
  return out;
}

/** A convex polygon shrunk inward by `d`; empty if nothing is left. */
export function insetConvex(p: Poly, d: number): Poly {
  let out = ccw(p);
  const q = out;
  const n = q.length / 2;
  for (let i = 0; i < n && out.length >= 6; i++) {
    const j = (i + 1) % n;
    const ex = q[j * 2] - q[i * 2];
    const ey = q[j * 2 + 1] - q[i * 2 + 1];
    const l = Math.sqrt(ex * ex + ey * ey);
    if (l < 1e-6) continue;
    // Outward normal of a counter-clockwise edge.
    const nx = ey / l;
    const ny = -ex / l;
    out = clipHalf(out, nx, ny, nx * q[i * 2] + ny * q[i * 2 + 1] - d);
  }
  return out.length >= 6 ? out : [];
}

/** A convex polygon grown outward by `d`, its corners mitred (for a roof's overhang). */
export function outsetConvex(p: Poly, d: number): Poly {
  const q = ccw(p);
  const n = q.length / 2;
  const out: Poly = [];
  for (let i = 0; i < n; i++) {
    const h = (i + n - 1) % n;
    const j = (i + 1) % n;
    let ax = q[i * 2] - q[h * 2];
    let ay = q[i * 2 + 1] - q[h * 2 + 1];
    let bx = q[j * 2] - q[i * 2];
    let by = q[j * 2 + 1] - q[i * 2 + 1];
    const la = Math.sqrt(ax * ax + ay * ay) || 1;
    const lb = Math.sqrt(bx * bx + by * by) || 1;
    ax /= la;
    ay /= la;
    bx /= lb;
    by /= lb;
    const nx = ay + by;
    const ny = -ax - bx;
    const k = nx * by - ny * bx; // |sum of normals| projected on one normal
    const s = Math.abs(k) < 0.2 ? d : d / k;
    out.push(q[i * 2] + nx * s, q[i * 2 + 1] + ny * s);
  }
  return out;
}

/** The convex hull, counter-clockwise (Andrew's monotone chain). */
export function convexHull(pts: Poly): Poly {
  const idx: number[] = [];
  for (let i = 0; i < pts.length / 2; i++) idx.push(i);
  idx.sort((a, b) => pts[a * 2] - pts[b * 2] || pts[a * 2 + 1] - pts[b * 2 + 1]);
  const cross = (o: number, a: number, b: number) => (pts[a * 2] - pts[o * 2]) * (pts[b * 2 + 1] - pts[o * 2 + 1]) - (pts[a * 2 + 1] - pts[o * 2 + 1]) * (pts[b * 2] - pts[o * 2]);
  const lo: number[] = [];
  for (const i of idx) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], i) <= 0) lo.pop();
    lo.push(i);
  }
  const hi: number[] = [];
  for (let k = idx.length - 1; k >= 0; k--) {
    const i = idx[k];
    while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], i) <= 0) hi.pop();
    hi.push(i);
  }
  lo.pop();
  hi.pop();
  const out: Poly = [];
  for (const i of [...lo, ...hi]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

export interface Obb {
  /** centre */
  cx: number;
  cy: number;
  /** unit vector along the long axis */
  ux: number;
  uy: number;
  /** half lengths along it and across it */
  hl: number;
  hw: number;
}

/** The smallest box around points: it lies along one edge of their hull. */
export function minBox(pts: Poly): Obb {
  const hull = convexHull(pts);
  const n = hull.length / 2;
  let best: Obb | undefined;
  let bestArea = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let ux = hull[j * 2] - hull[i * 2];
    let uy = hull[j * 2 + 1] - hull[i * 2 + 1];
    const l = Math.sqrt(ux * ux + uy * uy);
    if (l < 1e-6) continue;
    ux /= l;
    uy /= l;
    let a0 = Infinity;
    let a1 = -Infinity;
    let b0 = Infinity;
    let b1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const a = hull[k * 2] * ux + hull[k * 2 + 1] * uy;
      const b = -hull[k * 2] * uy + hull[k * 2 + 1] * ux;
      if (a < a0) a0 = a;
      if (a > a1) a1 = a;
      if (b < b0) b0 = b;
      if (b > b1) b1 = b;
    }
    const size = (a1 - a0) * (b1 - b0);
    if (size < bestArea) {
      bestArea = size;
      const ca = (a0 + a1) / 2;
      const cb = (b0 + b1) / 2;
      const cx = ca * ux - cb * uy;
      const cy = ca * uy + cb * ux;
      const long = a1 - a0 >= b1 - b0;
      best = long ? { cx, cy, ux, uy, hl: (a1 - a0) / 2, hw: (b1 - b0) / 2 } : { cx, cy, ux: -uy, uy: ux, hl: (b1 - b0) / 2, hw: (a1 - a0) / 2 };
    }
  }
  return best ?? { cx: pts[0] ?? 0, cy: pts[1] ?? 0, ux: 1, uy: 0, hl: 0.5, hw: 0.5 };
}

/** A unit vector from a compass bearing in degrees: 0 is north (+y), 90 east (+x). */
export function bearingVector(deg: number): [number, number] {
  const r = (deg * PI) / 180;
  return [dsin(r), dcos(r)];
}

/** Is a point inside a polygon? (even-odd) */
export function inPoly(p: Poly, x: number, y: number): boolean {
  let inside = false;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = p[i * 2 + 1];
    const yj = p[j * 2 + 1];
    if (yi > y !== yj > y && x < ((p[j * 2] - p[i * 2]) * (y - yi)) / (yj - yi) + p[i * 2]) inside = !inside;
  }
  return inside;
}

/**
 * Triangles of a simple polygon by ear clipping, as indices into its points; holes are joined to
 * it first by a bridge from each hole's rightmost point. O(n²), for the small polygons of a plan.
 */
export function triangulate(outer: Poly, holes: Poly[] = []): { points: Poly; tris: number[] } {
  let pts = ccw(outer).slice();
  for (const h of [...holes].sort((a, b) => maxX(b) - maxX(a))) pts = bridge(pts, ccw(h));
  const n = pts.length / 2;
  const prev = new Int32Array(n);
  const next = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    prev[i] = (i + n - 1) % n;
    next[i] = (i + 1) % n;
  }
  const tris: number[] = [];
  let count = n;
  let i = 0;
  let stall = 0;
  const cross = (a: number, b: number, c: number) => (pts[b * 2] - pts[a * 2]) * (pts[c * 2 + 1] - pts[a * 2 + 1]) - (pts[b * 2 + 1] - pts[a * 2 + 1]) * (pts[c * 2] - pts[a * 2]);
  while (count > 2 && stall < count + 2) {
    const a = prev[i];
    const b = i;
    const c = next[i];
    let ear = cross(a, b, c) > 1e-9;
    if (ear) {
      for (let k = next[c]; k !== a; k = next[k]) {
        if (pts[k * 2] === pts[a * 2] && pts[k * 2 + 1] === pts[a * 2 + 1]) continue;
        if (pts[k * 2] === pts[b * 2] && pts[k * 2 + 1] === pts[b * 2 + 1]) continue;
        if (pts[k * 2] === pts[c * 2] && pts[k * 2 + 1] === pts[c * 2 + 1]) continue;
        if (cross(a, b, k) >= 0 && cross(b, c, k) >= 0 && cross(c, a, k) >= 0) {
          ear = false;
          break;
        }
      }
    }
    if (ear) {
      tris.push(a, b, c);
      next[a] = c;
      prev[c] = a;
      count--;
      stall = 0;
      i = c;
    } else {
      stall++;
      i = next[i];
    }
  }
  return { points: pts, tris };
}

function maxX(p: Poly): number {
  let m = -Infinity;
  for (let i = 0; i < p.length; i += 2) if (p[i] > m) m = p[i];
  return m;
}

/** Join a hole to a polygon: a slit from the hole's rightmost point to the outer ring. */
function bridge(outer: Poly, hole: Poly): Poly {
  // The hole runs the other way round from the ring it cuts.
  const h: Poly = [];
  for (let i = hole.length - 2; i >= 0; i -= 2) h.push(hole[i], hole[i + 1]);
  let hi = 0;
  for (let i = 0; i < h.length; i += 2) if (h[i] > h[hi]) hi = i;
  const hx = h[hi];
  const hy = h[hi + 1];
  let bestX = Infinity;
  let best = -1;
  const n = outer.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const y0 = outer[i * 2 + 1];
    const y1 = outer[j * 2 + 1];
    if (y0 === y1 || y0 > hy === y1 > hy) continue;
    const x = outer[i * 2] + ((hy - y0) / (y1 - y0)) * (outer[j * 2] - outer[i * 2]);
    if (x >= hx && x < bestX) {
      bestX = x;
      best = outer[i * 2] > outer[j * 2] ? i : j;
    }
  }
  if (best < 0) return outer;
  const out: Poly = [];
  for (let i = 0; i <= best; i++) out.push(outer[i * 2], outer[i * 2 + 1]);
  const m = h.length / 2;
  const start = hi / 2;
  for (let i = 0; i <= m; i++) {
    const k = (start + i) % m;
    out.push(h[k * 2], h[k * 2 + 1]);
  }
  for (let i = best; i < n; i++) out.push(outer[i * 2], outer[i * 2 + 1]);
  return out;
}
