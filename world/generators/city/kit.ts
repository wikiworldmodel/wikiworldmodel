// The builder's kit: a mesh that grows as it is built, placed by a frame so that a form can be
// written in its own coordinates (its front towards +y), and the parts everything is made of.
// Each vertex carries a material and an entity: the shader draws the one and looks up when the
// other stood, so a building can rise and fall without any geometry being rebuilt.
import type { Part } from '../../../core/fingerprint.ts';
import { bearingVector, ccw, clamp, dcos, dsin, inPoly, minBox, PI, triangulate, TAU, type Obb, type Poly } from './math.ts';

export const MAT = {
  marble: 1,
  travertine: 2,
  brick: 3,
  plaster: 4,
  tile: 5,
  gilt: 6,
  bronze: 7,
  granite: 8,
  wood: 9,
  dark: 10,
  paving: 11,
  basalt: 12,
  sand: 13,
  concrete: 14,
  lead: 15,
  leaf: 16,
  trunk: 17,
  grass: 18,
  shaft: 19,
  facade: 20,
  statue: 21,
  earth: 22,
  seats: 23,
  awning: 24,
  spiral: 25,
  cloth: 26,
  skin: 27,
  dentil: 28,
  frieze: 29,
  pool: 30,
  hide: 31,
  horn: 32,
  shell: 33,
  fur: 34,
  needle: 35,
  frond: 36,
  bark: 37,
  broad: 38,
  feather: 39,
  membrane: 40,
  chitin: 41,
  thatch: 42,
  mud: 43,
} as const;

export type Material = (typeof MAT)[keyof typeof MAT];

/** Bytes a vertex takes: position 12, normal and light 4, uv 8, material, tint and entity 4. */
export const STRIDE = 28;

export class Mesh {
  private buf: ArrayBuffer;
  private f: Float32Array;
  private b: Uint8Array;
  private s: Uint16Array;
  private i: Uint32Array;
  verts = 0;
  count = 0;
  mat: number = MAT.marble;
  tint = 128;
  entity = 0;
  /** how much sky a vertex sees, 0–1 */
  light = 1;
  private ox = 0;
  private oy = 0;
  private oz = 0;
  private cx = 1;
  private sx = 0;

  constructor(verts = 4096) {
    this.buf = new ArrayBuffer(verts * STRIDE);
    this.f = new Float32Array(this.buf);
    this.b = new Uint8Array(this.buf);
    this.s = new Uint16Array(this.buf);
    this.i = new Uint32Array(verts * 3);
  }

  /** Where the coordinates given from now on are: an origin, and the direction their +y points. */
  place(ox: number, oy: number, oz: number, fx = 0, fy = 1): void {
    this.ox = ox;
    this.oy = oy;
    this.oz = oz;
    // +y of the frame goes to (fx, fy), so +x goes to (fy, −fx).
    this.cx = fy;
    this.sx = -fx;
  }

  private grow(): void {
    const buf = new ArrayBuffer(this.buf.byteLength * 2);
    new Uint8Array(buf).set(this.b);
    this.buf = buf;
    this.f = new Float32Array(buf);
    this.b = new Uint8Array(buf);
    this.s = new Uint16Array(buf);
  }

  /** A vertex, in the frame's coordinates. */
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, w: number, light = this.light): number {
    if ((this.verts + 1) * STRIDE > this.buf.byteLength) this.grow();
    const n = this.verts++;
    const f = n * 7;
    this.f[f] = this.ox + x * this.cx - y * this.sx;
    this.f[f + 1] = this.oy + x * this.sx + y * this.cx;
    this.f[f + 2] = this.oz + z;
    const wx = nx * this.cx - ny * this.sx;
    const wy = nx * this.sx + ny * this.cx;
    const b = n * STRIDE + 12;
    this.b[b] = (wx * 127 + 128) | 0;
    this.b[b + 1] = (wy * 127 + 128) | 0;
    this.b[b + 2] = (nz * 127 + 128) | 0;
    this.b[b + 3] = (light * 255) | 0;
    this.f[f + 4] = u;
    this.f[f + 5] = w;
    this.b[n * STRIDE + 24] = this.mat;
    this.b[n * STRIDE + 25] = this.tint;
    this.s[n * 14 + 13] = this.entity;
    return n;
  }

  /** The height of the highest vertex so far. */
  top(): number {
    let z = -Infinity;
    for (let i = 0; i < this.verts; i++) z = Math.max(z, this.f[i * 7 + 2]);
    return z;
  }
  /** A triangle, turned to face the way its first corner's normal says, so culling hides only its back. */
  tri(a: number, b: number, c: number): void {
    if (this.count + 3 > this.i.length) {
      const i = new Uint32Array(this.i.length * 2);
      i.set(this.i);
      this.i = i;
    }
    const f = this.f;
    const ex = f[b * 7] - f[a * 7];
    const ey = f[b * 7 + 1] - f[a * 7 + 1];
    const ez = f[b * 7 + 2] - f[a * 7 + 2];
    const gx = f[c * 7] - f[a * 7];
    const gy = f[c * 7 + 1] - f[a * 7 + 1];
    const gz = f[c * 7 + 2] - f[a * 7 + 2];
    const px = ey * gz - ez * gy;
    const py = ez * gx - ex * gz;
    const pz = ex * gy - ey * gx;
    const n = a * STRIDE + 12;
    const along = px * (this.b[n] - 128) + py * (this.b[n + 1] - 128) + pz * (this.b[n + 2] - 128);
    // Against it by more than a smoothed normal could be.
    const flip = along < 0 && along * along > 0.04 * 127 * 127 * (px * px + py * py + pz * pz);
    this.i[this.count++] = a;
    this.i[this.count++] = flip ? c : b;
    this.i[this.count++] = flip ? b : c;
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  /** The finished arrays, trimmed. */
  arrays(): { vertices: ArrayBuffer; indices: Uint32Array } {
    return { vertices: this.buf.slice(0, this.verts * STRIDE), indices: this.i.slice(0, this.count) };
  }
}

/**
 * A mesh's vertices and indices as parts of a fingerprint (core/fingerprint.ts): positions, normals, light and
 * texture coordinates within the tolerance; materials, tints, entities and the indices exactly.
 */
export function meshParts(vertices: ArrayBuffer, indices: ArrayLike<number>, prefix = 'mesh'): Part[] {
  const n = vertices.byteLength / STRIDE;
  const f = new Float32Array(vertices);
  const b = new Uint8Array(vertices);
  const s = new Uint16Array(vertices);
  const pos = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const shade = new Uint8Array(n * 4);
  const which = new Uint32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos.set(f.subarray(i * 7, i * 7 + 3), i * 3);
    uv.set(f.subarray(i * 7 + 4, i * 7 + 6), i * 2);
    shade.set(b.subarray(i * STRIDE + 12, i * STRIDE + 16), i * 4);
    which[i * 3] = b[i * STRIDE + 24];
    which[i * 3 + 1] = b[i * STRIDE + 25];
    which[i * 3 + 2] = s[i * 14 + 13];
  }
  return [
    { name: `${prefix}.position`, values: pos },
    { name: `${prefix}.uv`, values: uv },
    { name: `${prefix}.shade`, values: shade },
    { name: `${prefix}.material`, values: which, identity: true },
    { name: `${prefix}.indices`, values: indices, identity: true },
  ];
}

// ——— Flat parts ———

/** A vertical wall from (x0, y0) to (x1, y1), its outside on the right of that direction. */
export function wall(m: Mesh, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, u0 = 0, lightBottom = m.light): number {
  const ex = x1 - x0;
  const ey = y1 - y0;
  const l = Math.sqrt(ex * ex + ey * ey) || 1;
  const nx = ey / l;
  const ny = -ex / l;
  const a = m.v(x0, y0, z0, nx, ny, 0, u0, z0, lightBottom);
  const b = m.v(x1, y1, z0, nx, ny, 0, u0 + l, z0, lightBottom);
  const c = m.v(x1, y1, z1, nx, ny, 0, u0 + l, z1);
  const d = m.v(x0, y0, z1, nx, ny, 0, u0, z1);
  m.quad(a, b, c, d);
  return l;
}

/** A vertical wall whose top and bottom are given at each end, for walls that follow the ground. */
export function wallSloped(m: Mesh, x0: number, y0: number, b0: number, t0: number, x1: number, y1: number, b1: number, t1: number, u0: number): number {
  const ex = x1 - x0;
  const ey = y1 - y0;
  const l = Math.sqrt(ex * ex + ey * ey) || 1;
  const nx = ey / l;
  const ny = -ex / l;
  const a = m.v(x0, y0, b0, nx, ny, 0, u0, b0, 0.7);
  const b = m.v(x1, y1, b1, nx, ny, 0, u0 + l, b1, 0.7);
  const c = m.v(x1, y1, t1, nx, ny, 0, u0 + l, t1);
  const d = m.v(x0, y0, t0, nx, ny, 0, u0, t0);
  m.quad(a, b, c, d);
  return l;
}

/** A flat cap over a polygon, facing up or down, its uv in metres. */
export function cap(m: Mesh, p: Poly, z: number, holes: Poly[] = [], up = true): void {
  const { points, tris } = triangulate(p, holes);
  const base = m.verts;
  const nz = up ? 1 : -1;
  for (let i = 0; i < points.length; i += 2) m.v(points[i], points[i + 1], z, 0, 0, nz, points[i], points[i + 1]);
  for (let i = 0; i < tris.length; i += 3) {
    if (up) m.tri(base + tris[i], base + tris[i + 1], base + tris[i + 2]);
    else m.tri(base + tris[i], base + tris[i + 2], base + tris[i + 1]);
  }
}

/** A polygon raised: its walls, and optionally its top. */
export function prism(m: Mesh, poly: Poly, z0: number, z1: number, top = true, holes: Poly[] = []): void {
  const p = ccw(poly);
  const n = p.length / 2;
  let u = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    u += wall(m, p[i * 2], p[i * 2 + 1], p[j * 2], p[j * 2 + 1], z0, z1, u);
  }
  for (const h of holes) {
    // A hole's walls face into it.
    const q = ccw(h);
    const k = q.length / 2;
    let w = 0;
    for (let i = k - 1; i >= 0; i--) {
      const j = (i + k - 1) % k;
      w += wall(m, q[i * 2], q[i * 2 + 1], q[j * 2], q[j * 2 + 1], z0, z1, w);
    }
  }
  if (top) cap(m, p, z1, holes);
}

/** A box in the frame's coordinates. */
export function box(m: Mesh, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, top = true, bottom = false): void {
  wall(m, x0, y0, x1, y0, z0, z1, x0);
  wall(m, x1, y0, x1, y1, z0, z1, y0);
  wall(m, x1, y1, x0, y1, z0, z1, -x1);
  wall(m, x0, y1, x0, y0, z0, z1, -y1);
  if (top) {
    const a = m.v(x0, y0, z1, 0, 0, 1, x0, y0);
    const b = m.v(x1, y0, z1, 0, 0, 1, x1, y0);
    const c = m.v(x1, y1, z1, 0, 0, 1, x1, y1);
    const d = m.v(x0, y1, z1, 0, 0, 1, x0, y1);
    m.quad(a, b, c, d);
  }
  if (bottom) {
    const a = m.v(x0, y0, z0, 0, 0, -1, x0, y0);
    const b = m.v(x0, y1, z0, 0, 0, -1, x0, y1);
    const c = m.v(x1, y1, z0, 0, 0, -1, x1, y1);
    const d = m.v(x1, y0, z0, 0, 0, -1, x1, y0);
    m.quad(a, b, c, d);
  }
}

// ——— Roofs ———

/**
 * A gabled roof over a rectangle of the frame, its ridge along y: two tiled slopes and the two
 * triangles of its gables. Roof's u runs across the tiles, so the ridges of the tiles fall down the slope.
 */
export function gable(m: Mesh, x0: number, y0: number, x1: number, y1: number, z: number, rise: number, over = 0.5, gableMat?: number): void {
  const mid = (x0 + x1) / 2;
  const halfW = (x1 - x0) / 2;
  const eaveDrop = (over * rise) / halfW;
  const slope = Math.sqrt(halfW * halfW + rise * rise);
  const nx = rise / slope;
  const nz = halfW / slope;
  const e = z - eaveDrop;
  const roofMat = m.mat;
  // East slope (+x), then west.
  const a = m.v(x1 + over, y0 - over, e, nx, 0, nz, y0 - over, 0);
  const b = m.v(x1 + over, y1 + over, e, nx, 0, nz, y1 + over, 0);
  const c = m.v(mid, y1 + over, z + rise, nx, 0, nz, y1 + over, slope + over);
  const d = m.v(mid, y0 - over, z + rise, nx, 0, nz, y0 - over, slope + over);
  m.quad(a, b, c, d);
  const a2 = m.v(x0 - over, y1 + over, e, -nx, 0, nz, y1 + over, 0);
  const b2 = m.v(x0 - over, y0 - over, e, -nx, 0, nz, y0 - over, 0);
  const c2 = m.v(mid, y0 - over, z + rise, -nx, 0, nz, y0 - over, slope + over);
  const d2 = m.v(mid, y1 + over, z + rise, -nx, 0, nz, y1 + over, slope + over);
  m.quad(a2, b2, c2, d2);
  if (gableMat !== undefined) m.mat = gableMat;
  // The gable ends, as walls.
  for (const [y, ny] of [[y0, -1], [y1, 1]] as const) {
    const p = m.v(ny < 0 ? x0 : x1, y, z, 0, ny, 0, ny < 0 ? x0 : -x1, z);
    const q = m.v(ny < 0 ? x1 : x0, y, z, 0, ny, 0, ny < 0 ? x1 : -x0, z);
    const r = m.v(mid, y, z + rise, 0, ny, 0, ny < 0 ? mid : -mid, z + rise);
    m.tri(p, q, r);
  }
  m.mat = roofMat;
}

/**
 * A hipped roof over a convex polygon: each edge's slope rises at `pitch` towards the middle, and
 * the slopes meet where they are equally far from their edges. Works for any convex lot.
 */
export function hip(m: Mesh, poly: Poly, z: number, pitch: number, over = 0.45): void {
  const q = ccw(poly);
  const n = q.length / 2;
  // Each edge: its outward unit normal, and that normal's offset, moved out by the overhang.
  const eN: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = q[j * 2] - q[i * 2];
    const ey = q[j * 2 + 1] - q[i * 2 + 1];
    const l = Math.sqrt(ex * ex + ey * ey);
    if (l < 0.05) {
      eN.push(0, 0, 0);
      continue;
    }
    const nx = ey / l;
    const ny = -ex / l;
    eN.push(nx, ny, nx * q[i * 2] + ny * q[i * 2 + 1] + over);
  }
  // The eave polygon: every edge moved out.
  let eave: Poly = [];
  {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < q.length; i += 2) {
      minX = Math.min(minX, q[i]);
      maxX = Math.max(maxX, q[i]);
      minY = Math.min(minY, q[i + 1]);
      maxY = Math.max(maxY, q[i + 1]);
    }
    const g = over * 6 + 1;
    eave = [minX - g, minY - g, maxX + g, minY - g, maxX + g, maxY + g, minX - g, maxY + g];
    for (let i = 0; i < n; i++) if (eN[i * 3] !== 0 || eN[i * 3 + 1] !== 0) eave = clipHalfLocal(eave, eN[i * 3], eN[i * 3 + 1], eN[i * 3 + 2]);
  }
  for (let i = 0; i < n; i++) {
    const nx = eN[i * 3];
    const ny = eN[i * 3 + 1];
    if (nx === 0 && ny === 0) continue;
    const c = eN[i * 3 + 2];
    // This edge's slope is where it is the nearest edge.
    let facet = eave;
    for (let k = 0; k < n && facet.length >= 6; k++) {
      if (k === i || (eN[k * 3] === 0 && eN[k * 3 + 1] === 0)) continue;
      // distance_i ≤ distance_k: (c_i − n_i·p) ≤ (c_k − n_k·p)
      facet = clipHalfLocal(facet, eN[k * 3] - nx, eN[k * 3 + 1] - ny, eN[k * 3 + 2] - c);
    }
    if (facet.length < 6) continue;
    const len = Math.sqrt(1 + pitch * pitch);
    const wx = (nx * pitch) / len;
    const wy = (ny * pitch) / len;
    const wz = 1 / len;
    const base = m.verts;
    const fn = facet.length / 2;
    for (let k = 0; k < fn; k++) {
      const x = facet[k * 2];
      const y = facet[k * 2 + 1];
      const d = c - nx * x - ny * y;
      // u along the eave, v up the slope.
      m.v(x, y, z - over * pitch + d * pitch, wx, wy, wz, -ny * x + nx * y, d * len);
    }
    for (let k = 1; k < fn - 1; k++) m.tri(base, base + k, base + k + 1);
  }
}

/**
 * A gabled roof over any convex polygon, its ridge along the polygon's long axis: two planes rising
 * to the ridge. Its walls should go up to `top`, which gives the plane's height at a point.
 */
export function ridged(m: Mesh, poly: Poly, z: number, pitch: number, over = 0.4): { top: (x: number, y: number) => number; nx: number; ny: number; c: number } {
  const b = minBox(poly);
  // n is across the ridge.
  const nx = -b.uy;
  const ny = b.ux;
  const c = nx * b.cx + ny * b.cy;
  const top = (x: number, y: number) => z + pitch * (b.hw - Math.abs(nx * x + ny * y - c));
  const eave = outsetLocal(ccw(poly), over);
  for (const side of [1, -1]) {
    const half = clipHalfLocal(eave, -side * nx, -side * ny, -side * c);
    if (half.length < 6) continue;
    const len = Math.sqrt(1 + pitch * pitch);
    const wx = (side * nx * pitch) / len;
    const wy = (side * ny * pitch) / len;
    const wz = 1 / len;
    const base = m.verts;
    const n = half.length / 2;
    for (let i = 0; i < n; i++) {
      const x = half[i * 2];
      const y = half[i * 2 + 1];
      const d = Math.abs(nx * x + ny * y - c);
      // u along the eave, v up the slope from the eave side.
      m.v(x, y, top(x, y), wx, wy, wz, b.ux * x + b.uy * y, (b.hw + over - d) * len);
    }
    for (let i = 1; i < n - 1; i++) m.tri(base, base + i, base + i + 1);
  }
  return { top, nx, ny, c };
}

/** A convex polygon moved out by `d` along its corners. */
function outsetLocal(q: Poly, d: number): Poly {
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
    let nx = ay + by;
    let ny = -ax - bx;
    const l = Math.sqrt(nx * nx + ny * ny) || 1;
    nx /= l;
    ny /= l;
    const k = Math.max(0.5, nx * by - ny * bx);
    out.push(q[i * 2] + (nx * d) / k, q[i * 2 + 1] + (ny * d) / k);
  }
  return out;
}

function clipHalfLocal(p: Poly, a: number, b: number, c: number): Poly {
  const out: Poly = [];
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const d0 = a * p[i * 2] + b * p[i * 2 + 1] - c;
    const d1 = a * p[j * 2] + b * p[j * 2 + 1] - c;
    if (d0 <= 1e-9) out.push(p[i * 2], p[i * 2 + 1]);
    if ((d0 < -1e-9 && d1 > 1e-9) || (d0 > 1e-9 && d1 < -1e-9)) {
      const t = d0 / (d0 - d1);
      out.push(p[i * 2] + (p[j * 2] - p[i * 2]) * t, p[i * 2 + 1] + (p[j * 2 + 1] - p[i * 2 + 1]) * t);
    }
  }
  return out;
}

// ——— Round parts ———

/**
 * A surface of revolution about (cx, cy): a profile of [radius, z] from the bottom up, smooth
 * around and faceted between the profile's points, unless `smoothUp`.
 */
export function lathe(m: Mesh, cx: number, cy: number, profile: number[][], n: number, smoothUp = false, a0 = 0, a1 = TAU): void {
  const rings = profile.length;
  const seg = n;
  for (let r = 0; r < rings - 1; r++) {
    const [r0, z0] = profile[r];
    const [r1, z1] = profile[r + 1];
    const dr = r1 - r0;
    const dz = z1 - z0;
    const l = Math.sqrt(dr * dr + dz * dz) || 1;
    let nr0 = dz / l;
    let nz0 = -dr / l;
    let nr1 = nr0;
    let nz1 = nz0;
    if (smoothUp) {
      if (r > 0) {
        const pr = profile[r - 1];
        const a = r1 - pr[0];
        const b = z1 - pr[1];
        const q = Math.sqrt(a * a + b * b) || 1;
        nr0 = b / q;
        nz0 = -a / q;
      }
      if (r < rings - 2) {
        const nx = profile[r + 2];
        const a = nx[0] - r0;
        const b = nx[1] - z0;
        const q = Math.sqrt(a * a + b * b) || 1;
        nr1 = b / q;
        nz1 = -a / q;
      }
    }
    const base = m.verts;
    for (let i = 0; i <= seg; i++) {
      const t = a0 + ((a1 - a0) * i) / seg;
      const c = dcos(t);
      const s = dsin(t);
      m.v(cx + c * r0, cy + s * r0, z0, c * nr0, s * nr0, nz0, ((t - a0) / TAU) * seg, z0);
      m.v(cx + c * r1, cy + s * r1, z1, c * nr1, s * nr1, nz1, ((t - a0) / TAU) * seg, z1);
    }
    for (let i = 0; i < seg; i++) {
      const a = base + i * 2;
      m.quad(a, a + 2, a + 3, a + 1);
    }
  }
}

/** A disc facing up (or down), as a flat cap of a lathe. */
export function disc(m: Mesh, cx: number, cy: number, r: number, z: number, n: number, up = true): void {
  const nz = up ? 1 : -1;
  const c0 = m.v(cx, cy, z, 0, 0, nz, cx, cy);
  const base = m.verts;
  for (let i = 0; i <= n; i++) {
    const t = (TAU * i) / n;
    const x = cx + dcos(t) * r;
    const y = cy + dsin(t) * r;
    m.v(x, y, z, 0, 0, nz, x, y);
  }
  for (let i = 0; i < n; i++) (up ? m.tri(c0, base + i, base + i + 1) : m.tri(c0, base + i + 1, base + i));
}

/** A dome: part of a sphere of radius r, centred at height zc, from angle e0 up to e1 above its base. */
export function dome(m: Mesh, cx: number, cy: number, r: number, zc: number, n: number, rings: number, e0 = 0, e1 = PI / 2): void {
  for (let j = 0; j < rings; j++) {
    const a0 = e0 + ((e1 - e0) * j) / rings;
    const a1 = e0 + ((e1 - e0) * (j + 1)) / rings;
    const base = m.verts;
    for (let i = 0; i <= n; i++) {
      const t = (TAU * i) / n;
      const c = dcos(t);
      const s = dsin(t);
      const c0 = dcos(a0);
      const s0 = dsin(a0);
      const c1 = dcos(a1);
      const s1 = dsin(a1);
      m.v(cx + c * c0 * r, cy + s * c0 * r, zc + s0 * r, c * c0, s * c0, s0, t * r, a0 * r);
      m.v(cx + c * c1 * r, cy + s * c1 * r, zc + s1 * r, c * c1, s * c1, s1, t * r, a1 * r);
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 2;
      m.quad(a, a + 2, a + 3, a + 1);
    }
  }
}

/** A half-cylinder vault over a rectangle of the frame, its axis along y. */
export function barrel(m: Mesh, x0: number, y0: number, x1: number, y1: number, z: number, n = 8, rise?: number, endMat?: number): void {
  const cx = (x0 + x1) / 2;
  const rx = (x1 - x0) / 2;
  const rz = rise ?? rx;
  const base = m.verts;
  for (let i = 0; i <= n; i++) {
    const t = (PI * i) / n;
    const c = dcos(t);
    const s = dsin(t);
    const nx = c * rz;
    const nz = s * rx;
    const l = Math.sqrt(nx * nx + nz * nz) || 1;
    m.v(cx + c * rx, y0, z + s * rz, nx / l, 0, nz / l, y0, t * rx);
    m.v(cx + c * rx, y1, z + s * rz, nx / l, 0, nz / l, y1, t * rx);
  }
  for (let i = 0; i < n; i++) {
    const a = base + i * 2;
    m.quad(a, a + 1, a + 3, a + 2);
  }
  const keep = m.mat;
  if (endMat !== undefined) m.mat = endMat;
  // The two half-round ends.
  for (const [y, ny] of [[y0, -1], [y1, 1]] as const) {
    const c0 = m.v(cx, y, z, 0, ny, 0, ny < 0 ? cx : -cx, z);
    const b = m.verts;
    for (let i = 0; i <= n; i++) {
      const t = (PI * i) / n;
      const x = cx + dcos(t) * rx;
      const zz = z + dsin(t) * rz;
      m.v(x, y, zz, 0, ny, 0, ny < 0 ? x : -x, zz);
    }
    for (let i = 0; i < n; i++) (ny > 0 ? m.tri(c0, b + i + 1, b + i) : m.tri(c0, b + i, b + i + 1));
  }
  m.mat = keep;
}

// ——— Architecture ———

export type Order = 'tuscan' | 'doric' | 'ionic' | 'corinthian' | 'composite';

/**
 * A column: base, tapering shaft and capital. `D` is its diameter at the foot. At coarse detail a
 * bare prism with the shaft's taper. The shaft's u wraps once around, in flutes, for the shader.
 */
export function column(m: Mesh, x: number, y: number, z: number, h: number, D: number, order: Order, detail: number, shaftMat: number = MAT.shaft, capMat: number = MAT.marble): void {
  const r = D / 2;
  const top = z + h;
  if (detail === 0) {
    const keep = m.mat;
    m.mat = capMat;
    lathe(m, x, y, [[r, z], [r * 0.85, top]], 5);
    m.mat = keep;
    return;
  }
  const n = 12;
  const baseH = order === 'doric' ? 0 : r * 1.0;
  const capH = order === 'corinthian' || order === 'composite' ? D * 1.15 : order === 'ionic' ? D * 0.5 : D * 0.42;
  const shaftTop = top - capH;
  const keep = m.mat;
  m.mat = capMat;
  if (baseH) lathe(m, x, y, [[r * 1.35, z], [r * 1.35, z + baseH * 0.3], [r * 1.12, z + baseH * 0.55], [r * 1.18, z + baseH * 0.8], [r * 1.0, z + baseH]], n);
  m.mat = shaftMat;
  lathe(m, x, y, [[r, z + baseH], [r * 0.98, z + baseH + (shaftTop - z - baseH) * 0.33], [r * 0.9, shaftTop - (shaftTop - z) * 0.2], [r * 0.84, shaftTop]], n, true);
  m.mat = capMat;
  const a = r * 0.84;
  if (order === 'corinthian' || order === 'composite') {
    lathe(m, x, y, [[a, shaftTop], [a * 1.08, shaftTop + capH * 0.35], [a * 1.32, shaftTop + capH * 0.68], [a * 1.7, shaftTop + capH * 0.86]], n);
    box(m, x - a * 1.75, y - a * 1.75, shaftTop + capH * 0.86, x + a * 1.75, y + a * 1.75, top);
  } else if (order === 'ionic') {
    lathe(m, x, y, [[a, shaftTop], [a * 1.25, shaftTop + capH * 0.6]], n);
    box(m, x - a * 1.7, y - a * 1.2, shaftTop + capH * 0.35, x + a * 1.7, y + a * 1.2, shaftTop + capH * 0.8);
    box(m, x - a * 1.35, y - a * 1.35, shaftTop + capH * 0.8, x + a * 1.35, y + a * 1.35, top);
  } else {
    lathe(m, x, y, [[a, shaftTop], [a * 1.4, shaftTop + capH * 0.6]], n);
    box(m, x - a * 1.45, y - a * 1.45, shaftTop + capH * 0.6, x + a * 1.45, y + a * 1.45, top);
  }
  m.mat = keep;
}

/**
 * One bay of an arcade in a wall: a pier either side and an arch between. It runs from (x0, y0)
 * to (x1, y1), outside on the right, from z0 to z1; the arch springs at `spring` above z0 and its
 * opening goes `depth` back to a dark face. Coarse detail draws the bay as a flat wall.
 */
export function arcadeBay(m: Mesh, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, spring: number, pier: number, depth: number, detail: number, segments = 6, closed = true): void {
  const ex = x1 - x0;
  const ey = y1 - y0;
  const w = Math.sqrt(ex * ex + ey * ey) || 1;
  const ux = ex / w;
  const uy = ey / w;
  const nx = uy;
  const ny = -ux;
  if (detail === 0) {
    wall(m, x0, y0, x1, y1, z0, z1);
    return;
  }
  const p = Math.min(pier, w * 0.4);
  const open = w - 2 * p;
  const rad = open / 2;
  const h = z1 - z0;
  const sp = Math.min(spring, h - rad - 0.05);
  const at = (s: number, z: number, d: number, fnx: number, fny: number, fnz: number, u = s, v = z) => m.v(x0 + ux * s - nx * d, y0 + uy * s - ny * d, z, fnx, fny, fnz, u, v);
  // Piers.
  for (const [s0, s1] of [[0, p], [w - p, w]] as const) {
    m.quad(at(s0, z0, 0, nx, ny, 0), at(s1, z0, 0, nx, ny, 0), at(s1, z1, 0, nx, ny, 0), at(s0, z1, 0, nx, ny, 0));
  }
  // Above the arch: a fan from the corners to the curve.
  const cx = w / 2;
  const cz = z0 + sp;
  const arc: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = (PI * i) / segments;
    arc.push(cx - dcos(t) * rad, cz + dsin(t) * rad);
  }
  // Left half to the top-left corner, right half to the top-right.
  const tl = at(p, z1, 0, nx, ny, 0);
  const tr = at(w - p, z1, 0, nx, ny, 0);
  const half = segments >> 1;
  for (let i = 0; i < segments; i++) {
    const a = at(arc[i * 2], arc[i * 2 + 1], 0, nx, ny, 0);
    const b = at(arc[i * 2 + 2], arc[i * 2 + 3], 0, nx, ny, 0);
    m.tri(a, i < half ? b : tr, i < half ? tl : b);
  }
  m.tri(tl, at(arc[half * 2], arc[half * 2 + 1], 0, nx, ny, 0), tr);
  // Inside: the jambs, and the soffit of the arch.
  const keepLight = m.light;
  m.light = keepLight * 0.55;
  m.quad(at(p, z0, 0, ux, uy, 0), at(p, z0, depth, ux, uy, 0), at(p, cz, depth, ux, uy, 0), at(p, cz, 0, ux, uy, 0));
  m.quad(at(w - p, z0, depth, -ux, -uy, 0), at(w - p, z0, 0, -ux, -uy, 0), at(w - p, cz, 0, -ux, -uy, 0), at(w - p, cz, depth, -ux, -uy, 0));
  for (let i = 0; i < segments; i++) {
    const t = (PI * (i + 0.5)) / segments;
    const c = dcos(t);
    const s = dsin(t);
    const fx = ux * c;
    const fy = uy * c;
    const fz = -s;
    const a = at(arc[i * 2], arc[i * 2 + 1], 0, fx, fy, fz);
    const b = at(arc[i * 2], arc[i * 2 + 1], depth, fx, fy, fz);
    const c2 = at(arc[i * 2 + 2], arc[i * 2 + 3], depth, fx, fy, fz);
    const d = at(arc[i * 2 + 2], arc[i * 2 + 3], 0, fx, fy, fz);
    m.quad(a, b, c2, d);
  }
  // The dark behind, unless the arch opens right through.
  if (closed) {
    const keepMat = m.mat;
    m.mat = MAT.dark;
    const back = m.verts;
    at(p, z0, depth, nx, ny, 0);
    at(w - p, z0, depth, nx, ny, 0);
    for (let i = 0; i <= segments; i++) at(arc[i * 2], arc[i * 2 + 1], depth, nx, ny, 0);
    m.tri(back, back + 1, back + 2 + segments);
    for (let i = 0; i < segments; i++) m.tri(back, back + 2 + segments - i, back + 2 + segments - i - 1);
    m.mat = keepMat;
  }
  m.light = keepLight;
}

/** A half-round window over a→b with the outside on the right, rising `rise` from its sill, split by mullions. */
export function lunette(m: Mesh, ax: number, ay: number, bx: number, by: number, z: number, rise: number, mullions: number, frame: number): void {
  const ex = bx - ax;
  const ey = by - ay;
  const l = Math.sqrt(ex * ex + ey * ey) || 1;
  const nx = ey / l;
  const ny = -ex / l;
  const keep = m.mat;
  m.mat = MAT.dark;
  const n = 12;
  const c = m.v((ax + bx) / 2, (ay + by) / 2, z, nx, ny, 0, 0, 0);
  for (let i = 0; i < n; i++) {
    const t0 = (PI * i) / n;
    const t1 = (PI * (i + 1)) / n;
    const at = (t: number) => m.v((ax + bx) / 2 + (ex / 2) * dcos(t), (ay + by) / 2 + (ey / 2) * dcos(t), z + rise * dsin(t), nx, ny, 0, t, 0);
    m.tri(c, at(t0), at(t1));
  }
  m.mat = frame;
  const w = 0.016;
  for (let k = 1; k <= mullions; k++) {
    const s = k / (mullions + 1);
    const q = 2 * s - 1;
    const top = z + rise * Math.sqrt(Math.max(0, 1 - q * q));
    const ox = nx * 0.08;
    const oy = ny * 0.08;
    wall(m, ax + ex * (s - w) + ox, ay + ey * (s - w) + oy, ax + ex * (s + w) + ox, ay + ey * (s + w) + oy, z, top);
  }
  m.mat = keep;
}

/** An arched window over a→b with the outside on the right, from its sill at z0 to the crown of its arch at z1. */
export function archedWindow(m: Mesh, ax: number, ay: number, bx: number, by: number, z0: number, z1: number): void {
  const keep = m.mat;
  const half = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) / 2;
  const spring = Math.max(z0, z1 - half);
  m.mat = MAT.dark;
  wall(m, ax, ay, bx, by, z0, spring);
  lunette(m, ax, ay, bx, by, spring, z1 - spring, 0, keep);
  m.mat = keep;
}

/** A band around a polygon: a cornice or a string course, sticking out by `out`. */
export function band(m: Mesh, poly: Poly, z0: number, z1: number, out: number): void {
  const p = ccw(poly);
  const n = p.length / 2;
  const q = outsetRing(p, out);
  let u = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = p[i * 2];
    const ay = p[i * 2 + 1];
    const bx = p[j * 2];
    const by = p[j * 2 + 1];
    const cx = q[i * 2];
    const cy = q[i * 2 + 1];
    const dx = q[j * 2];
    const dy = q[j * 2 + 1];
    const l = wall(m, cx, cy, dx, dy, z0, z1, u);
    u += l;
    if (out > 0) {
      // Its top and underside.
      m.quad(m.v(cx, cy, z1, 0, 0, 1, cx, cy), m.v(dx, dy, z1, 0, 0, 1, dx, dy), m.v(bx, by, z1, 0, 0, 1, bx, by), m.v(ax, ay, z1, 0, 0, 1, ax, ay));
      m.quad(m.v(ax, ay, z0, 0, 0, -1, ax, ay), m.v(bx, by, z0, 0, 0, -1, bx, by), m.v(dx, dy, z0, 0, 0, -1, dx, dy), m.v(cx, cy, z0, 0, 0, -1, cx, cy));
    }
  }
}

/** A ring moved out by `d` along its corners' mitres; works for concave rings too, for small d. */
export function outsetRing(p: Poly, d: number): Poly {
  const n = p.length / 2;
  const out: Poly = [];
  for (let i = 0; i < n; i++) {
    const h = (i + n - 1) % n;
    const j = (i + 1) % n;
    let ax = p[i * 2] - p[h * 2];
    let ay = p[i * 2 + 1] - p[h * 2 + 1];
    let bx = p[j * 2] - p[i * 2];
    let by = p[j * 2 + 1] - p[i * 2 + 1];
    const la = Math.sqrt(ax * ax + ay * ay) || 1;
    const lb = Math.sqrt(bx * bx + by * by) || 1;
    ax /= la;
    ay /= la;
    bx /= lb;
    by /= lb;
    let nx = ay + by;
    let ny = -ax - bx;
    const l = Math.sqrt(nx * nx + ny * ny) || 1;
    nx /= l;
    ny /= l;
    const k = clamp(nx * by - ny * bx, 0.35, 1);
    out.push(p[i * 2] + (nx * d) / k, p[i * 2 + 1] + (ny * d) / k);
  }
  return out;
}

/** A standing figure on a point: enough for a statue seen from the street. */
export function figure(m: Mesh, x: number, y: number, z: number, h: number, detail: number): void {
  const r = h * 0.11;
  const n = detail ? 7 : 4;
  lathe(m, x, y, [[r * 0.8, z], [r * 1.0, z + h * 0.5], [r * 1.25, z + h * 0.74], [r * 0.5, z + h * 0.84]], n);
  if (detail) {
    dome(m, x, y, h * 0.075, z + h * 0.9, 6, 3, -PI / 2, PI / 2);
    // An arm raised.
    lathe(m, x + r * 1.2, y, [[r * 0.32, z + h * 0.68], [r * 0.26, z + h * 1.02]], 4);
  }
}

/** Someone in the street: a robe, shoulders and a head. */
/** A round limb from one point to another, its radius r0 at the first and r1 at the second. */
export function limb(m: Mesh, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r0: number, r1: number, n: number): void {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const uz = dz / l;
  // Two directions across it.
  const across = Math.sqrt(ux * ux + uy * uy);
  const px = across > 1e-4 ? -uy / across : 1;
  const py = across > 1e-4 ? ux / across : 0;
  const qx = uy * 0 - uz * py;
  const qy = uz * px;
  const qz = ux * py - uy * px;
  const base = m.verts;
  for (let i = 0; i <= n; i++) {
    const t = (TAU * i) / n;
    const c = dcos(t);
    const s = dsin(t);
    const nx = px * c + qx * s;
    const ny = py * c + qy * s;
    const nz = qz * s;
    m.v(ax + nx * r0, ay + ny * r0, az + nz * r0, nx, ny, nz, i, 0);
    m.v(bx + nx * r1, by + ny * r1, bz + nz * r1, nx, ny, nz, i, l);
  }
  for (let i = 0; i < n; i++) {
    const a = base + i * 2;
    m.quad(a, a + 2, a + 3, a + 1);
  }
}

/** A lathe flattened front to back, as a body is: facing (fx, fy), `depth` of its width through. */
function torso(m: Mesh, x: number, y: number, fx: number, fy: number, depth: number, profile: number[][], n: number): void {
  for (let r = 0; r + 1 < profile.length; r++) {
    const [r0, z0] = profile[r];
    const [r1, z1] = profile[r + 1];
    const dr = r1 - r0;
    const dz = z1 - z0;
    const l = Math.sqrt(dr * dr + dz * dz) || 1;
    const nr = dz / l;
    const nz = -dr / l;
    const base = m.verts;
    for (let i = 0; i <= n; i++) {
      const t = (TAU * i) / n;
      const c = dcos(t);
      const s = dsin(t);
      // Across the shoulders is c, through the body is s.
      const ox = fy * c + fx * s * depth;
      const oy = -fx * c + fy * s * depth;
      const nx = fy * c + fx * s;
      const ny = -fx * c + fy * s;
      m.v(x + ox * r0, y + oy * r0, z0, nx * nr, ny * nr, nz, i, z0);
      m.v(x + ox * r1, y + oy * r1, z1, nx * nr, ny * nr, nz, i, z1);
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 2;
      m.quad(a, a + 2, a + 3, a + 1);
    }
  }
}

/** A passer-by: a head, shoulders, arms at its sides, and a tunic to the knee or a robe to the ground. */
export function person(m: Mesh, x: number, y: number, z: number, h: number, cloth: number, skin: number): void {
  // Which way it is turned, and what it wears, follow from its colours.
  const a = (((cloth * 97 + skin * 31) & 255) / 256) * TAU;
  const fx = dcos(a);
  const fy = dsin(a);
  const ax = -fy;
  const ay = fx;
  const robe = (skin & 3) === 0;
  const swing = (cloth & 1 ? 0.05 : -0.05) * h;
  const at = (across: number, front: number): [number, number] => [x + ax * across * h + fx * front, y + ay * across * h + fy * front];
  const skinTone = () => {
    m.mat = MAT.skin;
    m.tint = skin;
  };
  if (!robe) {
    for (const side of [-1, 1]) {
      const [lx, ly] = at(side * 0.055, side * swing * 0.6);
      skinTone();
      limb(m, x + ax * side * 0.055 * h, y + ay * side * 0.055 * h, z + h * 0.38, lx, ly, z + h * 0.03, h * 0.04, h * 0.026, 5);
      m.mat = MAT.wood;
      m.tint = 90;
      limb(m, lx - fx * 0.02 * h, ly - fy * 0.02 * h, z + h * 0.018, lx + fx * 0.075 * h, ly + fy * 0.075 * h, z + h * 0.014, h * 0.024, h * 0.02, 4);
    }
  }
  m.mat = MAT.cloth;
  m.tint = cloth;
  const skirt = robe ? [[0.128, 0.02], [0.112, 0.28]] : [[0.122, 0.3]];
  torso(m, x, y, fx, fy, 0.68, [...skirt, [0.102, 0.46], [0.096, 0.57], [0.116, 0.7], [0.136, 0.785], [0.05, 0.835]].map(([r, q]) => [r * h, z + q * h]), 10);
  for (const side of [-1, 1]) {
    const [sx, sy] = at(side * 0.14, 0);
    const [ex, ey] = at(side * 0.158, -side * swing * 0.5);
    const [hx, hy] = at(side * 0.15, -side * swing);
    m.mat = MAT.cloth;
    m.tint = cloth;
    limb(m, sx, sy, z + h * 0.78, ex, ey, z + h * 0.6, h * 0.04, h * 0.032, 5);
    skinTone();
    limb(m, ex, ey, z + h * 0.61, hx, hy, z + h * 0.45, h * 0.028, h * 0.024, 5);
  }
  skinTone();
  limb(m, x, y, z + h * 0.82, x, y, z + h * 0.875, h * 0.03, h * 0.028, 5);
  dome(m, x, y, h * 0.062, z + h * 0.915, 8, 4, -PI / 2, PI / 2);
  m.mat = MAT.dark;
  dome(m, x - fx * h * 0.003, y - fy * h * 0.003, h * 0.066, z + h * 0.915, 8, 2, 0.35, PI / 2);
}

/** A horse and rider, or a horse alone, facing +y. */
export function horse(m: Mesh, x: number, y: number, z: number, h: number, detail: number): void {
  const bh = h * 0.62;
  const l = h * 0.55;
  const w = h * 0.14;
  box(m, x - w, y - l * 0.6, z + bh * 0.62, x + w, y + l * 0.6, z + bh);
  if (detail) {
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) box(m, x + dx * w * 0.8 - h * 0.03, y + dy * l * 0.52 - h * 0.03, z, x + dx * w * 0.8 + h * 0.03, y + dy * l * 0.52 + h * 0.03, z + bh * 0.66);
    box(m, x - w * 0.6, y + l * 0.5, z + bh * 0.85, x + w * 0.6, y + l * 0.85, z + bh * 1.3);
  }
}

// ——— The plan of a footprint ———

export interface Plan {
  /** the box around the footprint, its long axis as given by the box */
  box: Obb;
  /** the direction the front faces, a unit vector, and the size across it and along it */
  fx: number;
  fy: number;
  /** half the width across the front, and half the length back from it */
  hw: number;
  hl: number;
}

/**
 * The frame of a footprint: its box, turned so that +y is the way its front faces. `faces` is a
 * compass bearing; absent, the front is at whichever end of the long axis `prefer` says.
 */
export function planOf(rings: Poly[], at: [number, number], faces: number | undefined, prefer?: (x: number, y: number) => number): Plan {
  const pts = rings.flat();
  const b = pts.length >= 6 ? minBox(pts) : { cx: at[0], cy: at[1], ux: 0, uy: 1, hl: 1, hw: 1 };
  let fx = b.ux;
  let fy = b.uy;
  let hw = b.hw;
  let hl = b.hl;
  if (faces !== undefined) {
    const [vx, vy] = bearingVector(faces);
    // The box axis nearest the bearing, either way along it.
    const along = vx * b.ux + vy * b.uy;
    const across = -vx * b.uy + vy * b.ux;
    if (Math.abs(along) >= Math.abs(across)) {
      fx = along >= 0 ? b.ux : -b.ux;
      fy = along >= 0 ? b.uy : -b.uy;
    } else {
      fx = across >= 0 ? -b.uy : b.uy;
      fy = across >= 0 ? b.ux : -b.ux;
      hw = b.hl;
      hl = b.hw;
    }
  } else if (prefer && prefer(b.cx + b.ux * b.hl, b.cy + b.uy * b.hl) > prefer(b.cx - b.ux * b.hl, b.cy - b.uy * b.hl)) {
    fx = -b.ux;
    fy = -b.uy;
  }
  return { box: b, fx, fy, hw, hl };
}

export { inPoly };
