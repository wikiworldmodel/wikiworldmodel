// Forms into meshes: what core/form.ts holds as data, drawn on the city's mesh. Each body is written
// in its own frame, its front towards +y and the ground at z = 0. Lengths along and across the body are
// shares of its length L, and heights shares of its hip height H unless a part says `zl`; in a head's
// frame everything is a share of L. Only + − × ÷, square roots and integers, as for every generator, so
// that the build and the browser make the same bytes. Which parts there are, and the numbers in them,
// are data: what a taxon looks like is never in this file.
import type { Form, Part, Pose } from '../../../core/form.ts';
import { MAT, Mesh, limb } from '../city/kit.ts';
import { dcos, dsin, hash2, PI, TAU } from '../city/math.ts';

// ——— Tubes and lumps ———

/** A section of a tube: its centre, and its half-width and half-height. */
export interface Ring {
  x?: number;
  y: number;
  z: number;
  w: number;
  h: number;
}

/** A tube's end, rounded off: two smaller rings past its last, so nothing is left open. */
function rounded(rings: Ring[], flatEnd: boolean): Ring[] {
  const end = (a: Ring, b: Ring, reach = 1): Ring[] => {
    const dx = (a.x ?? 0) - (b.x ?? 0);
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const r = a.w > a.h ? a.w : a.h;
    const at = (k: number, q: number): Ring => ({ x: (a.x ?? 0) + (dx / l) * r * k * reach, y: a.y + (dy / l) * r * k * reach, z: a.z + (dz / l) * r * k * reach, w: a.w * q, h: a.h * q });
    return [at(0.5, 0.72), at(0.8, 0.3)];
  };
  const n = rings.length;
  const head = end(rings[0], rings[1]);
  return [head[1], head[0], ...rings, ...end(rings[n - 1], rings[n - 2], flatEnd ? 0.02 : 1)];
}

/** A skin through rings, each an ellipse square to the line through its neighbours, its ends closed: flat at the last, if it stands on it. */
export function loft(m: Mesh, section: Ring[], n: number, flatEnd = false): void {
  const rings = rounded(section, flatEnd);
  const base = m.verts;
  let arc = 0;
  const count = rings.length;
  for (let r = 0; r < count; r++) {
    const a = rings[r > 0 ? r - 1 : 0];
    const b = rings[r < count - 1 ? r + 1 : count - 1];
    const c = rings[r];
    let tx = (b.x ?? 0) - (a.x ?? 0);
    let ty = b.y - a.y;
    let tz = b.z - a.z;
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    // Across: x made square to the tangent; if the tube runs along x, then y.
    let rx = 1 - tx * tx;
    let ry = -tx * ty;
    let rz = -tx * tz;
    let rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
    if (rl < 0.05) {
      rx = -ty * tx;
      ry = 1 - ty * ty;
      rz = -ty * tz;
      rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
    }
    rx /= rl;
    ry /= rl;
    rz /= rl;
    // Up: across × along, so that a tube running along +y has its up towards +z.
    const ux = ry * tz - rz * ty;
    const uy = rz * tx - rx * tz;
    const uz = rx * ty - ry * tx;
    const cx = c.x ?? 0;
    for (let i = 0; i <= n; i++) {
      const t = (TAU * i) / n;
      const co = dcos(t);
      const si = dsin(t);
      const px = rx * co * c.w + ux * si * c.h;
      const py = ry * co * c.w + uy * si * c.h;
      const pz = rz * co * c.w + uz * si * c.h;
      // An ellipse's normal leans towards its flatter side.
      let nx = rx * co * c.h + ux * si * c.w;
      let ny = ry * co * c.h + uy * si * c.w;
      let nz = rz * co * c.h + uz * si * c.w;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      m.v(cx + px, c.y + py, c.z + pz, nx, ny, nz, i, arc);
    }
    if (r < count - 1) {
      const dx = (rings[r + 1].x ?? 0) - cx;
      const dy = rings[r + 1].y - c.y;
      const dz = rings[r + 1].z - c.z;
      arc += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  }
  for (let r = 0; r < count - 1; r++) {
    for (let i = 0; i < n; i++) {
      const a = base + r * (n + 1) + i;
      const d = a + n + 1;
      m.quad(a, a + 1, d + 1, d);
    }
  }
}

/** A flattened ball. */
export function lump(m: Mesh, x: number, y: number, z: number, rx: number, ry: number, rz: number, n: number, rings: number): void {
  const base = m.verts;
  for (let j = 0; j <= rings; j++) {
    const a = -PI / 2 + (PI * j) / rings;
    const ca = dcos(a);
    const sa = dsin(a);
    for (let i = 0; i <= n; i++) {
      const t = (TAU * i) / n;
      const c = dcos(t);
      const s = dsin(t);
      let nx = c * ca * ry * rz;
      let ny = s * ca * rx * rz;
      let nz = sa * rx * ry;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      m.v(x + c * ca * rx, y + s * ca * ry, z + sa * rz, nx, ny, nz, i, j);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < n; i++) {
      const a = base + j * (n + 1) + i;
      const d = a + n + 1;
      m.quad(a, a + 1, d + 1, d);
    }
  }
}

/** A point standing out of a body: a horn, a spike. */
function horn(m: Mesh, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, n: number): void {
  limb(m, ax, ay, az, bx, by, bz, r, r * 0.06, n);
}

/** A chain of joints, thick and thin: a leg or an arm. */
function chain(m: Mesh, pts: number[][], n: number, flatEnd = false): void {
  loft(
    m,
    pts.map(([x, y, z, r]) => ({ x, y, z, w: r, h: r })),
    n,
    flatEnd,
  );
}

/** A flat outline, drawn as two faces a little apart, each lit for the side it faces. Points are [x, y, z], a fan from the first. */
function sheet(m: Mesh, pts: number[][], gap: number): void {
  const [ax, ay, az] = pts[0];
  // The normal of the whole outline, from the sum of its triangles' areas.
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 1; i + 1 < pts.length; i++) {
    const ex = pts[i][0] - ax;
    const ey = pts[i][1] - ay;
    const ez = pts[i][2] - az;
    const fx = pts[i + 1][0] - ax;
    const fy = pts[i + 1][1] - ay;
    const fz = pts[i + 1][2] - az;
    nx += ey * fz - ez * fy;
    ny += ez * fx - ex * fz;
    nz += ex * fy - ey * fx;
  }
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  for (const face of [-1, 1]) {
    const start = m.verts;
    for (let i = 0; i < pts.length; i++) {
      const [x, y, z] = pts[i];
      m.v(x + nx * gap * face, y + ny * gap * face, z + nz * gap * face, nx * face, ny * face, nz * face, i, 0);
    }
    for (let i = 1; i + 1 < pts.length; i++) m.tri(start, start + i, start + i + 1);
  }
}

// ——— How a body stands ———

export const POSE = { stand: 0, walk: 1, graze: 2, drink: 3, alert: 4, rest: 5, fly: 6 } as const satisfies Record<Pose, number>;

/** Detail: 2 close by, 1 from a way off, and 0 only a shape. */
export type Detail = 0 | 1 | 2;

/** What the plan says of one body. */
export interface Stance {
  /** snout to tail, and the height of the hips, in metres */
  L: number;
  H: number;
  pose: number;
  /** where in its stride it is, 0–1; and which way its tail is swung */
  phase: number;
  sway: number;
  detail: Detail;
  /** colour, 0–255 */
  tint: number;
  biped: boolean;
}

const LOW = (p: number) => p === POSE.graze || p === POSE.drink;

export const MATERIALS: Record<string, number> = { hide: MAT.hide, horn: MAT.horn, shell: MAT.shell, fur: MAT.fur, feather: MAT.feather, membrane: MAT.membrane, chitin: MAT.chitin, dark: MAT.dark, bark: MAT.bark, needle: MAT.needle, frond: MAT.frond, broad: MAT.broad };

/** The head's frame: its joint in the body, and how far it is pitched down. */
interface HeadPlace {
  jy: number;
  jz: number;
  pitch: number;
}

const has = (p: Part, k: string) => p[k] !== undefined && p[k] !== null;
const num = (p: Part, k: string, d: number) => (typeof p[k] === 'number' ? (p[k] as number) : d);
const list = (p: Part, k: string) => p[k] as number[];
const table = (p: Part, k: string) => p[k] as number[][];
const sides = (p: Part, d: [number, number], detail: Detail): number => {
  const s = (p.sides as [number, number] | undefined) ?? d;
  return detail >= 2 ? s[0] : detail === 1 ? s[1] : Math.max(3, s[1] >> 1);
};

/** Is a part drawn in this stance, at this detail? */
function drawn(p: Part, s: Stance, upright: boolean): boolean {
  if (p.near && s.detail < 2) return false;
  if (p.far && s.detail >= 2) return false;
  if (s.detail === 0 && !TINY.has(p.type) && !p.far) return false;
  const poses = p.poses as Pose[] | undefined;
  if (poses && !poses.some((x) => POSE[x] === s.pose)) return false;
  const not = p.not as Pose[] | undefined;
  if (not && not.some((x) => POSE[x] === s.pose)) return false;
  if (p.stance === 'upright' && !upright) return false;
  if (p.stance === 'four' && upright) return false;
  return true;
}

/** What is still worth drawing when a body is only a shape. */
const TINY = new Set(['trunk', 'head', 'lump', 'pillar', 'digitigrade', 'shell', 'wing', 'tube', 'chain']);

/** The material and colour a part takes. */
function dress(m: Mesh, p: Part, s: Stance, standard: string): void {
  m.mat = MATERIALS[(p.mat as string) ?? standard] ?? MAT.hide;
  if (has(p, 'tint')) m.tint = p.tint as number;
  else if (has(p, 'tint_add')) m.tint = (s.tint + (p.tint_add as number)) & 255;
  else m.tint = s.tint;
}

/** Rings from a table of [y/L, top/H, bottom/H, half-width/L], with the tail swung. */
function trunkRings(s: Stance, rows: number[][]): Ring[] {
  const { L, H, sway } = s;
  const rings: Ring[] = [];
  const tailEnd = rows[0][0];
  for (const [y, top, bottom, w] of rows) {
    // Only behind the hips does the tail swing, more towards its tip.
    const behind = y < -0.14 ? (-0.14 - y) / (-0.14 - tailEnd) : 0;
    rings.push({ x: sway * L * behind * behind, y: y * L, z: ((top + bottom) * H) / 2, w: w * L, h: ((top - bottom) * H) / 2 });
  }
  return rings;
}

/** The rings of a neck, along a curve from the shoulder to the back of the head. */
function neckRings(from: Ring, jy: number, jz: number, r1: number, steps: number): Ring[] {
  const out: Ring[] = [];
  // The curve leaves the shoulder level and comes into the head from behind.
  const cy = from.y + (jy - from.y) * 0.6;
  const cz = from.z + (jz - from.z) * 0.15;
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const u = 1 - t;
    const y = u * u * from.y + 2 * u * t * cy + t * t * jy;
    const z = u * u * from.z + 2 * u * t * cz + t * t * jz;
    const w = from.w + (r1 - from.w) * t;
    const h = from.h + (r1 - from.h) * t;
    out.push({ y, z, w, h });
  }
  return out;
}

/** Fewer rings from afar: every other one, keeping the ends; and fewer still if it is only a shape. */
function thin(rings: Ring[], detail: Detail): Ring[] {
  if (detail >= 2) return rings;
  const half = rings.filter((_, i) => i % 2 === 0 || i === rings.length - 1);
  if (detail === 1 || half.length < 4) return half;
  return half.filter((_, i) => i % 2 === 0 || i === half.length - 1);
}

/** Where a head is, for a pose: reaching down, the end of a head `reach` long comes to the ground and no further. */
function headPlace(head: Part | null | undefined, s: Stance, upright: boolean): HeadPlace {
  const poses = (head?.at ?? {}) as Record<string, { y: number; z?: number; reach?: number; clear?: number; pitch: number }>;
  const stand = poses.stand ?? { y: 0, z: 0, pitch: 0 };
  let q = stand;
  if (LOW(s.pose) && poses.low) q = poses.low;
  else if (upright && poses.upright) q = poses.upright;
  else if (s.pose === POSE.fly && poses.fly) q = poses.fly;
  else if (s.pose === POSE.alert && poses.alert) q = poses.alert;
  const jz = q.reach !== undefined ? q.reach * s.L * dsin(q.pitch) + (q.clear ?? 0.04) * s.H : (q.z ?? 0) * s.H;
  return { jy: q.y * s.L, jz, pitch: q.pitch };
}

const swings = (s: Stance, amp: number): [number, number] => {
  if (s.pose !== POSE.walk && s.pose !== POSE.fly) return [0, 0];
  const a = dsin(TAU * s.phase);
  return [a * amp, -a * amp];
};

/** A hind leg that bends at the knee and runs up on its toes. */
function digitigrade(m: Mesh, side: number, s: Stance, p: Part, swing: number): void {
  const { L, H, detail } = s;
  const y0 = num(p, 'y', 0) * L;
  const x0 = num(p, 'x', 0) * L;
  const top = num(p, 'top', 1);
  const knee = num(p, 'knee', 0.6);
  const ankle = num(p, 'ankle', 0.25);
  const r0 = num(p, 'r', 0.04);
  const n = sides(p, [8, 4], detail);
  const ky = y0 + (0.055 + swing * 0.55) * L;
  const ay = y0 + (-0.035 + swing * 0.8) * L;
  const fy = y0 + (0.008 + swing) * L;
  const lift = swing > 0.02 ? swing * 0.25 * H : 0;
  const kz = knee * H + lift;
  const az = ankle * H + lift;
  const fz = 0.022 * H + lift;
  const x = x0 * side;
  chain(m, [[x, y0, top * H, r0 * L * 0.92], [x * 1.04, y0 + (ky - y0) * 0.45, (top * H + kz) * 0.5, r0 * L], [x * 1.08, ky, kz, r0 * L * 0.55], [x * 1.08, (ky + ay) * 0.5, (kz + az) * 0.5, r0 * L * 0.42], [x * 1.04, ay, az, r0 * L * 0.28], [x, fy, fz, r0 * L * 0.26]], n, true);
  if (p.toes !== false && detail >= 2) {
    for (const k of [-1, 0, 1]) {
      const tx = x + k * r0 * L * 0.42;
      horn(m, x, fy, fz, tx + k * r0 * L * 0.5, fy + r0 * L * (1.5 - Math.abs(k) * 0.3), fz * 0.4 - lift * 0.3, r0 * L * 0.2, 4);
    }
  }
}

/** A leg held straight under the body. */
function pillar(m: Mesh, side: number, s: Stance, p: Part, swing: number): void {
  const { L, H, detail } = s;
  const n = sides(p, [8, 4], detail);
  const y0 = num(p, 'y', 0) * L;
  const x = num(p, 'x', 0) * L * side;
  const top = num(p, 'top', 0.7);
  const r0 = num(p, 'r', 0.05);
  const fy = y0 + swing * L;
  const lift = swing > 0.02 ? swing * 0.25 * H : 0;
  chain(m, [
    [x, y0, top * H, r0 * L],
    [x * 1.03, y0 + (fy - y0) * 0.4, (top * 0.55 + 0.04) * H + lift * 0.4, r0 * L * 0.78],
    [x * 1.05, y0 + (fy - y0) * 0.75, (top * 0.22 + 0.02) * H + lift, r0 * L * 0.62],
    [x * 1.05, fy, lift, r0 * L * 0.78],
  ], n, true);
}

/** A wing: spread when flying, as a membrane or feathers from the shoulder out; folded along the flank otherwise. */
function wing(m: Mesh, side: number, s: Stance, p: Part): void {
  const { L, H, detail } = s;
  const [sx, sy, sz] = list(p, 'shoulder');
  const x0 = sx * L * side;
  const y0 = sy * L;
  const z0 = sz * H;
  if (s.pose === POSE.fly) {
    const span = num(p, 'span', 0.8) * L;
    const chord = num(p, 'chord', 0.25) * L;
    const sweep = num(p, 'sweep', 0.2) * L;
    // Beating: the tip rises and falls with the stride.
    const beat = dsin(TAU * s.phase) * num(p, 'beat', 0.25) * span;
    const mid: number[] = [x0 + side * span * 0.5, y0 + chord * 0.1, z0 + beat * 0.35];
    const tip: number[] = [x0 + side * span, y0 - sweep, z0 + beat];
    const back: number[] = [x0 + side * span * 0.5, y0 - chord, z0 + beat * 0.2];
    const root: number[] = [x0, y0 - chord * 0.9, z0];
    sheet(m, [[x0, y0, z0], mid, tip, back, root], 0.002 * L);
    if (detail >= 2) {
      const arm = num(p, 'arm', 0.012) * L;
      chain(m, [[x0, y0, z0, arm], [mid[0], mid[1], mid[2], arm * 0.7], [tip[0], tip[1], tip[2], arm * 0.2]], 5);
    }
    return;
  }
  // Folded: a long narrow leaf along the flank.
  const len = num(p, 'folded', 0.3) * L;
  const drop = num(p, 'drop', 0.12) * H;
  const chord = num(p, 'chord', 0.25) * L * 0.35;
  sheet(m, [[x0, y0, z0], [x0 + side * chord * 0.12, y0 - len * 0.3, z0 - drop * 0.1], [x0 + side * chord * 0.06, y0 - len, z0 - drop], [x0 + side * chord * 0.18, y0 - len * 0.4, z0 - drop * 0.9]], 0.003 * L);
}

// ——— The parts of an animal ———

/** Draw one part of an animal, in the mesh's current frame. */
function drawPart(m: Mesh, p: Part, s: Stance, head: HeadPlace, tailEnd: number): void {
  const { L, H, detail } = s;
  const c = dcos(head.pitch);
  const sn = dsin(head.pitch);
  const onHead = p.on === 'head';
  const zk = p.zl ? L : H;
  /** How far a tail has swung at a place along the body: whatever is on it goes with it. */
  const swung = (y: number) => {
    if (!s.sway || y >= -0.14 || tailEnd >= -0.14) return 0;
    const behind = (-0.14 - y) / (-0.14 - tailEnd);
    return s.sway * L * (behind > 1 ? 1 : behind) * (behind > 1 ? 1 : behind);
  };
  /** A point of the part's frame: across, along and up. */
  const pt = (x: number, y: number, z: number): [number, number, number] => (onHead ? [x * L, head.jy + y * L * c + z * L * sn, head.jz - y * L * sn + z * L * c] : [x * L + swung(y), y * L, z * zk]);
  const mirrored = (draw: (side: number) => void) => {
    if (p.mirror) for (const side of [-1, 1]) draw(side);
    else draw(1);
  };
  switch (p.type) {
    case 'trunk': {
      dress(m, p, s, 'hide');
      const body = trunkRings(s, table(p, 'rings'));
      const neck = p.neck as { r: number; steps?: [number, number] } | undefined;
      const rings = neck ? [...body, ...neckRings(body[body.length - 1], head.jy, head.jz, neck.r * L, detail >= 2 ? (neck.steps?.[0] ?? 3) : (neck.steps?.[1] ?? 1))] : body;
      loft(m, thin(rings, detail), sides(p, [14, 6], detail));
      return;
    }
    case 'head':
    case 'tube': {
      dress(m, p, s, 'hide');
      // A head's rings are always in its own frame, and all in shares of L.
      const inHead = p.type === 'head' || onHead;
      const rings: Ring[] = table(p, 'rings').map((r) => {
        const [x, y, z, w, h] = r.length === 4 ? [0, r[0], r[1], r[2], r[3]] : r;
        const q: [number, number, number] = inHead ? [x * L, head.jy + y * L * c + z * L * sn, head.jz - y * L * sn + z * L * c] : [x * L, y * L, z * zk];
        return { x: q[0], y: q[1], z: q[2], w: w * L, h: h * (inHead ? L : zk) };
      });
      loft(m, p.thin === false ? rings : thin(rings, detail), sides(p, [14, 6], detail), !!p.flat);
      return;
    }
    case 'chain': {
      dress(m, p, s, 'hide');
      // A chain may walk: it swings from its first joint out to its last, each side against the other.
      const amp = num(p, 'swing', 0);
      const list0 = table(p, 'points');
      mirrored((side) => {
        const [a, b] = swings(s, amp);
        const stride = (side < 0) === !!p.phase ? a : b;
        const pts = list0.map(([x, y, z, r], k) => {
          const f = list0.length > 1 ? k / (list0.length - 1) : 0;
          const q = pt(x * side, y + stride * f, z);
          return [q[0], q[1], q[2] + (stride > 0.02 ? stride * f * (1 - f) * 2 * L : 0), r * L];
        });
        chain(m, pts, sides(p, [6, 4], detail), !!p.flat);
      });
      return;
    }
    case 'lump': {
      dress(m, p, s, 'hide');
      const [x, y, z] = list(p, 'at');
      const [rx, ry, rz] = list(p, 'r');
      const bands = (p.bands as [number, number] | undefined) ?? [6, 3];
      const sway = num(p, 'sway', 0) * s.sway * L;
      mirrored((side) => {
        const q = pt(x * side, y, z);
        lump(m, q[0] + sway, q[1], q[2], rx * L, ry * L, rz * L, sides(p, [10, 5], detail), detail >= 2 ? bands[0] : Math.max(2, bands[1]));
      });
      return;
    }
    case 'spike': {
      dress(m, p, s, 'horn');
      const [ax, ay, az] = list(p, 'from');
      const [bx, by, bz] = list(p, 'to');
      const sway = num(p, 'sway', 0) * s.sway * L;
      mirrored((side) => {
        const a = pt(ax * side, ay, az);
        const b = pt(bx * side, by, bz);
        horn(m, a[0], a[1], a[2], b[0] + sway, b[1], b[2], num(p, 'r', 0.01) * L, sides(p, [7, 4], detail));
      });
      return;
    }
    case 'pillar':
    case 'digitigrade': {
      dress(m, p, s, 'hide');
      const [a, b] = swings(s, num(p, 'swing', 0.05));
      for (const side of [-1, 1]) {
        const left = side < 0 ? a : b;
        const right = side < 0 ? b : a;
        const swing = p.phase ? right : left;
        if (p.type === 'pillar') pillar(m, side, s, p, swing);
        else digitigrade(m, side, s, p, swing);
      }
      return;
    }
    case 'fan': {
      dress(m, p, s, 'hide');
      const [along, up] = list(p, 'at');
      const [dirA, dirU] = list(p, 'dir');
      const [, cy, cz] = pt(0, along, up);
      // Up and back along its plane, and its normal, forward and up.
      const vy = dirA * c + dirU * sn;
      const vz = -dirA * sn + dirU * c;
      const ny = -vz;
      const nz = vy;
      const R = num(p, 'r', 0.2) * L;
      const rim = sides(p, [18, 7], detail);
      const across = num(p, 'across', 0.92);
      const tall = num(p, 'tall', 0.92);
      const raise = num(p, 'raise', 0.18);
      const scallop = num(p, 'scallop', 0);
      const count = num(p, 'scallops', 18);
      const arc = (p.arc as [number, number] | undefined) ?? [-0.5, PI + 0.5];
      const thick = num(p, 'gap', 0.009) * L;
      // Two sheets a little apart, each lit for the side it faces.
      for (const face of [-1, 1]) {
        const gap = face * thick;
        const hub = m.v(0, cy + ny * gap, cz + nz * gap, 0, ny * face, nz * face, 0, 0);
        const start = m.verts;
        for (let i = 0; i <= rim; i++) {
          const a = arc[0] + ((arc[1] - arc[0]) * i) / rim;
          const wave = detail >= 2 ? 1 + scallop * dcos(a * count) : 1;
          const rx = dcos(a) * R * across * wave;
          const rv = (dsin(a) * tall + raise) * R * wave;
          m.v(rx, cy + vy * rv + ny * gap * 0.3, cz + vz * rv + nz * gap * 0.3, 0, ny * face, nz * face, i, rv);
        }
        for (let i = 0; i < rim; i++) m.tri(hub, start + i, start + i + 1);
      }
      return;
    }
    case 'eyes': {
      const keep = m.mat;
      m.mat = MAT.dark;
      const [x, y, z] = list(p, 'at');
      const r = num(p, 'r', 0.01) * L;
      for (const side of [-1, 1]) {
        const q = pt(x * side, y, z);
        lump(m, q[0], q[1], q[2], r * 0.7, r, r, 6, 4);
      }
      m.mat = keep;
      return;
    }
    case 'bands': {
      // Bands of armour over a back, the outer ones spiked.
      dress(m, p, s, 'horn');
      const rows = num(p, 'rows', 8);
      const y0 = num(p, 'y', -0.2);
      const step = num(p, 'step', 0.06);
      const middle = num(p, 'middle', 3.2);
      const fall = num(p, 'fall', 20);
      const wide = num(p, 'wide', 0.15);
      const [t0, t1] = (p.top as [number, number] | undefined) ?? [0.96, 0.2];
      const low = num(p, 'low', 0.5);
      const out = num(p, 'out', 1.36);
      const big = num(p, 'spike', 0.016);
      const [lx, ly, lz] = (p.scute as [number, number, number] | undefined) ?? [0.014, 0.018, 0.008];
      for (let row = 0; row < rows; row++) {
        const y = (y0 + row * step) * L;
        const k = 1 - ((row - middle) * (row - middle)) / fall;
        const w = wide * k * L;
        const top = (t0 + t1 * k) * H;
        for (let i = -3; i <= 3; i++) {
          const u = i / 3.2;
          const x = u * w;
          const z = (low + (top / H - low) * Math.sqrt(Math.max(0.04, 1 - u * u))) * H;
          if (i === -3 || i === 3) horn(m, x, y, z - 0.02 * H, x * out, y - 0.01 * L, z - 0.06 * H, big * L, 5);
          else lump(m, x, y, z, lx * L, ly * L, lz * L, 6, 3);
        }
      }
      return;
    }
    case 'row': {
      // Things in a line down a body: plates, spikes, scutes, each sized by where it is.
      dress(m, p, s, 'horn');
      const n = num(p, 'n', 8);
      const [ax, ay, az] = list(p, 'from');
      const [bx, by, bz] = list(p, 'to');
      const size = p.size as number[] | undefined;
      const item = (p.item as string) ?? 'lump';
      const r = (p.r as number[]) ?? [0.01, 0.01, 0.01];
      for (let i = 0; i < n; i++) {
        const t = n > 1 ? i / (n - 1) : 0;
        const k = size ? (() => {
          const f = t * (size.length - 1);
          const q = Math.min(size.length - 2, Math.floor(f));
          return size[q] + (size[q + 1] - size[q]) * (f - q);
        })() : 1;
        mirrored((side) => {
          const q = pt((ax + (bx - ax) * t) * side, ay + (by - ay) * t, az + (bz - az) * t);
          if (item === 'lump') lump(m, q[0], q[1], q[2], r[0] * L * k, r[1] * L * k, r[2] * L * k, sides(p, [5, 5], detail), num(p, 'bands', 2));
          else if (item === 'spike') horn(m, q[0], q[1], q[2], q[0] + side * r[0] * L * k, q[1] + r[1] * L * k, q[2] + r[2] * L * k, num(p, 'thick', 0.01) * L * k, 4);
          else {
            // A plate: a kite standing on the line, r[1] long and r[2] tall.
            const len = r[1] * L * k;
            const tall = r[2] * L * k;
            sheet(m, [[q[0], q[1] - len * 0.5, q[2]], [q[0], q[1] - len * 0.3, q[2] + tall * 0.7], [q[0], q[1], q[2] + tall], [q[0], q[1] + len * 0.3, q[2] + tall * 0.6], [q[0], q[1] + len * 0.5, q[2]]], 0.004 * L);
          }
        });
      }
      return;
    }
    case 'knobs': {
      // Small knobs in a ring around a head.
      dress(m, p, s, 'horn');
      const n = num(p, 'n', 9);
      const [along, up] = list(p, 'at');
      const [ra, rx, rout] = list(p, 'r');
      const len = num(p, 'length', 0.008);
      const thick = num(p, 'thick', 0.004) * L;
      for (let i = 0; i < n; i++) {
        const t = (TAU * i) / n;
        const [, ky, kz] = pt(0, along + dcos(t) * ra, up);
        horn(m, dsin(t) * rx * L, ky, kz, dsin(t) * rout * L, ky + dcos(t) * len * L, kz + len * L, thick, 4);
      }
      return;
    }
    case 'shell': {
      // A dome over a flat plastron. Its uv is metres on its own plan, for the scutes.
      dress(m, p, s, 'shell');
      const [srx, sry, srz] = list(p, 'r');
      const lift = num(p, 'lift', 0.07) * L;
      const n = sides(p, [14, 6], detail);
      const bandsOf = (p.bands as [number, number] | undefined) ?? [6, 3];
      const bands = detail >= 2 ? bandsOf[0] : bandsOf[1];
      const rx = srx * L;
      const ry = sry * L;
      const rz = srz * L;
      const base = m.verts;
      for (let j = 0; j <= bands; j++) {
        const a = (PI / 2) * (j / bands);
        const ca = dcos(a);
        const sa = dsin(a);
        for (let i = 0; i <= n; i++) {
          const t = (TAU * i) / n;
          const co = dcos(t);
          const e = dsin(t);
          let nx = co * ca * ry * rz;
          let ny = e * ca * rx * rz;
          let nz = sa * rx * ry;
          const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          nx /= l;
          ny /= l;
          nz /= l;
          m.v(co * ca * rx, e * ca * ry, lift + sa * rz, nx, ny, nz, co * ca * rx, e * ca * ry);
        }
      }
      for (let j = 0; j < bands; j++) {
        for (let i = 0; i < n; i++) {
          const a = base + j * (n + 1) + i;
          const d = a + n + 1;
          m.quad(a, a + 1, d + 1, d);
        }
      }
      return;
    }
    case 'sheet': {
      dress(m, p, s, 'membrane');
      mirrored((side) => {
        const pts = table(p, 'points').map(([x, y, z]) => pt(x * side, y, z));
        sheet(m, pts, num(p, 'gap', 0.003) * L);
      });
      return;
    }
    case 'wing': {
      dress(m, p, s, 'feather');
      for (const side of [-1, 1]) wing(m, side, s, p);
      return;
    }
    default:
      throw new Error(`no part of type "${p.type}" in an animal`);
  }
}

/** Draw an animal in the mesh's current frame. */
export function drawAnimal(m: Mesh, form: Form, s: Stance): void {
  m.light = 1;
  m.tint = s.tint;
  const upright = s.biped && !LOW(s.pose);
  const head = headPlace(form.parts.head, s, upright);
  // Where the tail ends: a trunk's first ring, and whatever is on it swings with it.
  let tailEnd = 0;
  for (const name of Object.keys(form.parts)) {
    const p = form.parts[name];
    if (p?.type === 'trunk' && Array.isArray(p.rings)) tailEnd = Math.min(tailEnd, (p.rings as number[][])[0][0]);
  }
  for (const name of Object.keys(form.parts)) {
    const p = form.parts[name];
    if (!p || !drawn(p, s, upright)) continue;
    drawPart(m, p, s, head, tailEnd);
  }
}

// ——— The parts of a plant ———

/** One crown of leaves, lumpy up close, a plain ball from afar. */
function foliage(m: Mesh, x: number, y: number, z: number, r: number, zr: number, n: number, rings: number, seed: number, rough: number): void {
  const base = m.verts;
  for (let j = 0; j <= rings; j++) {
    const a = -PI / 2 + (PI * j) / rings;
    const ca = dcos(a);
    const sa = dsin(a);
    for (let i = 0; i <= n; i++) {
      const t = (TAU * i) / n;
      const c = dcos(t);
      const e = dsin(t);
      const w = 1 + (hash2(i % n, j, seed) - 0.5) * rough;
      m.v(x + c * ca * r * w, y + e * ca * r * w, z + sa * zr * w, c * ca, e * ca, sa, i, j, 0.5 + 0.5 * (sa * 0.5 + 0.5));
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < n; i++) {
      const a = base + j * (n + 1) + i;
      const d = a + n + 1;
      m.quad(a, a + 1, d + 1, d);
    }
  }
}

/** Tiers of drooping, ragged foliage round a straight trunk: a swamp cypress or a redwood. */
function conifer(m: Mesh, p: Part, h: number, seed: number, detail: Detail, tint: number): void {
  const r = h * num(p, 'reach', 0.15);
  m.tint = tint;
  if (detail < 2) {
    m.mat = MATERIALS[(p.mat as string) ?? 'needle'];
    m.light = 0.9;
    const ring = detail === 1 ? 6 : 4;
    const low = num(p, 'start', 0.24) * 0.58;
    // From a way off, three cones one on another, narrowing; and only a shape, one.
    const stack = detail === 1 ? 3 : 1;
    for (let q = 0; q < stack; q++) {
      const f0 = q / stack;
      const f1 = stack === 1 ? 1 : (q + 1.25) / stack;
      const z0 = h * (low + (1 - low) * f0);
      const z1 = h * (low + (1 - low) * (f1 > 1 ? 1 : f1));
      const wide = r * 1.1 * (1 - f0 * 0.72);
      const base = m.verts;
      for (let i = 0; i <= ring; i++) {
        const t = (TAU * (i + (q & 1) * 0.5)) / ring;
        const c = dcos(t);
        const s = dsin(t);
        m.v(c * wide, s * wide, z0, c, s, 0.3, i, 0, 0.45 + 0.2 * f0);
        m.v(c * 0.01, s * 0.01, z1, c, s, 0.5, i, h, 1);
      }
      for (let i = 0; i < ring; i++) {
        const a = base + i * 2;
        m.quad(a, a + 2, a + 3, a + 1);
      }
    }
    return;
  }
  m.mat = MAT.bark;
  m.light = 0.8;
  // A flared, buttressed foot, tapering all the way up.
  const tr = h * num(p, 'trunk', 0.022);
  const flare = num(p, 'flare', 2.4);
  loft(m, [{ y: 0, z: -0.3, w: tr * flare, h: tr * flare }, { y: 0, z: h * 0.03, w: tr * 1.5, h: tr * 1.5 }, { y: 0, z: h * 0.1, w: tr, h: tr }, { y: 0, z: h * 0.6, w: tr * 0.5, h: tr * 0.5 }, { y: 0, z: h, w: tr * 0.04, h: tr * 0.04 }], 8);
  m.mat = MATERIALS[(p.mat as string) ?? 'needle'];
  const tiers = num(p, 'tiers', 13);
  const start = num(p, 'start', 0.24);
  const drop = num(p, 'drop', 0.075);
  for (let k = 0; k < tiers; k++) {
    const f = k / tiers;
    const z1 = h * (start + (1 - start) * f);
    const reach = r * (1.2 - f) * (0.72 + 0.46 * hash2(k, 1, seed));
    const z0 = z1 - h * drop * (1.2 - f * 0.6);
    const lean = (hash2(k, 2, seed) - 0.5) * 0.6;
    const around = 9;
    const light = 0.5 + 0.5 * f;
    const top = m.v(lean * r * 0.3, 0, z1 + h * 0.015, 0, 0, 1, 0, 0, light);
    const rim = m.verts;
    for (let i = 0; i <= around; i++) {
      const t = (TAU * ((i % around) + (k & 1) * 0.5)) / around;
      const c = dcos(t);
      const s = dsin(t);
      const out = reach * (0.5 + 0.8 * hash2(i % around, k + 3, seed));
      const droop = (hash2(i % around, k + 11, seed) - 0.5) * h * 0.04;
      m.v(c * out + lean * r * 0.3, s * out, z0 + droop, c * 0.7, s * 0.7, 0.7, i, out, light * 0.85);
    }
    for (let i = 0; i < around; i++) m.tri(top, rim + i, rim + i + 1);
  }
}

function broadleaf(m: Mesh, p: Part, h: number, seed: number, detail: Detail, tint: number): void {
  const R = h * num(p, 'crown', 0.34);
  const [fork0, forkVar] = (p.fork as [number, number] | undefined) ?? [0.36, 0.14];
  const fork = h * (fork0 + forkVar * hash2(1, 9, seed));
  const leaves = MATERIALS[(p.mat as string) ?? 'broad'];
  m.tint = tint;
  if (detail < 2) {
    m.mat = leaves;
    m.light = 1;
    foliage(m, 0, 0, fork + R * 0.62, R, R * 0.76, detail === 1 ? 7 : 4, detail === 1 ? 4 : 2, seed, detail === 1 ? 0.22 : 0);
    if (detail === 1) {
      m.mat = MAT.bark;
      m.light = 0.8;
      limb(m, 0, 0, -0.2, 0, 0, fork + R * 0.1, h * num(p, 'trunk', 0.022), h * num(p, 'trunk', 0.022) * 0.7, 3);
    }
    return;
  }
  m.mat = MAT.bark;
  m.light = 0.8;
  const tr = h * num(p, 'trunk', 0.022);
  loft(m, [{ y: 0, z: -0.3, w: tr * 1.5, h: tr * 1.5 }, { y: 0, z: h * 0.05, w: tr, h: tr }, { y: 0, z: fork, w: tr * 0.72, h: tr * 0.72 }], 7);
  const limbs = num(p, 'limbs', 4) + ((seed >> 3) & 1);
  const tips: number[][] = [];
  for (let k = 0; k < limbs; k++) {
    const t = (TAU * (k + hash2(k, 3, seed) * 0.5)) / limbs;
    const out = R * (0.45 + 0.28 * hash2(k, 4, seed));
    const tip = [dcos(t) * out, dsin(t) * out, fork + R * (0.34 + 0.32 * hash2(k, 5, seed))];
    tips.push(tip);
    limb(m, 0, 0, fork * 0.92, tip[0], tip[1], tip[2], tr * 0.62, tr * 0.2, 5);
  }
  m.mat = leaves;
  m.light = 1;
  foliage(m, 0, 0, fork + R * 0.72, R * 0.68, R * 0.56, 7, 4, seed, 0.24);
  tips.forEach((tip, k) => {
    const r = R * (0.42 + 0.14 * hash2(k, 6, seed));
    foliage(m, tip[0], tip[1], tip[2] + r * 0.2, r, r * 0.74, 6, 3, seed + k + 1, 0.3);
  });
}

/** A straight stem with a head of pleated fans. */
function palm(m: Mesh, p: Part, h: number, seed: number, detail: Detail, tint: number): void {
  const tr = h * num(p, 'trunk', 0.03);
  const leanBy = num(p, 'lean', 0.12);
  const lean = (hash2(1, 2, seed) - 0.5) * h * leanBy;
  const lean2 = (hash2(2, 2, seed) - 0.5) * h * leanBy;
  const leaves = MATERIALS[(p.mat as string) ?? 'frond'];
  const head = num(p, 'head', 0.88);
  const size = h * num(p, 'size', 0.34);
  m.tint = tint;
  if (detail < 2) {
    m.mat = leaves;
    m.light = 1;
    foliage(m, lean, lean2, h * (head + 0.02), size * 0.76, size * 0.38, detail === 1 ? 7 : 4, detail === 1 ? 3 : 2, seed, detail === 1 ? 0.3 : 0);
    if (detail === 1) {
      m.mat = MAT.bark;
      m.tint = 200;
      m.light = 0.85;
      limb(m, 0, 0, -0.2, lean, lean2, h * head, tr * 0.9, tr * 0.8, 3);
    }
    return;
  }
  m.mat = MAT.bark;
  m.tint = 200;
  m.light = 0.85;
  loft(m, [{ y: 0, z: -0.3, w: tr * 1.3, h: tr * 1.3 }, { x: lean * 0.2, y: lean2 * 0.2, z: h * 0.3, w: tr * 0.9, h: tr * 0.9 }, { x: lean * 0.7, y: lean2 * 0.7, z: h * 0.7, w: tr * 0.78, h: tr * 0.78 }, { x: lean, y: lean2, z: h * head, w: tr * 0.82, h: tr * 0.82 }], 7);
  m.mat = leaves;
  m.tint = tint;
  m.light = 1;
  const fronds = num(p, 'fronds', 11);
  for (let k = 0; k < fronds; k++) {
    const t = (TAU * (k + hash2(k, 7, seed) * 0.6)) / fronds;
    const up = 0.75 - 1.15 * (k / fronds) + (hash2(k, 8, seed) - 0.5) * 0.3;
    const dx = dcos(t);
    const dy = dsin(t);
    const z0 = h * head;
    // The stalk, then the fan at its end, spread across and hanging a little.
    const px = lean + dx * size * 0.5;
    const py = lean2 + dy * size * 0.5;
    const pz = z0 + size * 0.5 * up;
    limb(m, lean, lean2, z0, px, py, pz, tr * 0.2, tr * 0.12, 3);
    const hub = m.v(px, py, pz, 0, 0, 1, 0, 0, 0.9);
    const pleats = 8;
    const rim = m.verts;
    for (let i = 0; i <= pleats; i++) {
      const a = -1.05 + (2.1 * i) / pleats;
      const ca = dcos(a);
      const sa = dsin(a);
      const fx = dx * ca - dy * sa;
      const fy = dx * sa + dy * ca;
      const r = size * (0.68 + 0.08 * dcos(a * 3));
      const fold = i & 1 ? 0.04 : -0.04;
      m.v(px + fx * r, py + fy * r, pz + r * (up * 0.4 - 0.36 - 0.25 * sa * sa) + fold * size, fx * 0.4, fy * 0.4, 0.9, i, r, 1);
    }
    for (let i = 0; i < pleats; i++) m.tri(hub, rim + i, rim + i + 1);
  }
}

/** A rosette of arching fronds: at the ground, or on top of a stem, as a tree fern or a cycad. */
function fern(m: Mesh, p: Part, h: number, seed: number, detail: Detail, tint: number): void {
  const z0 = h * num(p, 'on_stem', 0);
  const tr = h * num(p, 'stem', 0.04);
  const reach = h * num(p, 'reach', 0.95);
  m.tint = tint;
  const leaves = MATERIALS[(p.mat as string) ?? 'frond'];
  if (detail < 2) {
    // From afar the ground's colour stands in for a low fern, and a ball for one on a stem.
    if (z0 <= 0) return;
    m.mat = leaves;
    m.light = 1;
    foliage(m, 0, 0, z0 + reach * 0.15, reach * 0.8, reach * 0.45, detail === 1 ? 7 : 4, detail === 1 ? 3 : 2, seed, detail === 1 ? 0.3 : 0);
    // On its stem, or it would float.
    m.mat = MAT.bark;
    m.light = 0.85;
    limb(m, 0, 0, -0.2, 0, 0, z0 + reach * 0.1, tr, tr * 0.8, detail === 1 ? 4 : 3);
    return;
  }
  if (z0 > 0) {
    m.mat = MAT.bark;
    m.light = 0.85;
    loft(m, [{ y: 0, z: -0.2, w: tr * 1.25, h: tr * 1.25 }, { y: 0, z: z0 * 0.5, w: tr, h: tr }, { y: 0, z: z0, w: tr * 0.95, h: tr * 0.95 }], 7);
    m.tint = tint;
  }
  m.mat = leaves;
  m.light = 0.8;
  const fronds = num(p, 'fronds', 7);
  const across0 = num(p, 'across', 0.07);
  const [arch0, archVar] = (p.arch as [number, number] | undefined) ?? [0.72, 0.4];
  const steps = num(p, 'steps', 4);
  for (let k = 0; k < fronds; k++) {
    const t = (TAU * (k + hash2(k, 1, seed) * 0.5)) / fronds;
    const dx = dcos(t);
    const dy = dsin(t);
    const across = across0 * reach * (0.8 + 0.4 * hash2(k, 2, seed));
    const arch = (z0 > 0 ? reach : h) * (arch0 + archVar * hash2(k, 3, seed));
    const base = m.verts;
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const z = z0 + arch * (f * (2 - f) * 0.9 - f * f * f * 0.72);
      const r = reach * f;
      const w = across * (f < 0.2 ? f * 5 : 1 - (f - 0.2) * 1.2);
      m.v(dx * r - dy * w, dy * r + dx * w, z, 0, 0, 1, i, -1, 0.6 + 0.4 * f);
      m.v(dx * r + dy * w, dy * r - dx * w, z, 0, 0, 1, i, 1, 0.6 + 0.4 * f);
    }
    for (let i = 0; i < steps; i++) {
      const a = base + i * 2;
      m.quad(a, a + 1, a + 3, a + 2);
    }
  }
}

/** A mat of floating leaves, on the water. */
function floatingMat(m: Mesh, p: Part, seed: number, detail: Detail, tint: number): void {
  m.mat = MATERIALS[(p.mat as string) ?? 'frond'];
  m.tint = tint;
  m.light = 1;
  const r = num(p, 'radius', 2.4);
  const n = detail >= 2 ? 12 : detail === 1 ? 6 : 4;
  const hub = m.v(0, 0, 0.012, 0, 0, 1, 0, 0);
  const rim = m.verts;
  for (let i = 0; i <= n; i++) {
    const t = (TAU * (i % n)) / n;
    const w = r * (0.6 + 0.6 * hash2(i % n, 1, seed));
    m.v(dcos(t) * w, dsin(t) * w, 0.012, 0, 0, 1, i, w);
  }
  for (let i = 0; i < n; i++) m.tri(hub, rim + i, rim + i + 1);
}

/** A straight jointed stem with whorls of thin branches at each joint: a horsetail, or a Calamites as a tree. */
function whorled(m: Mesh, p: Part, h: number, seed: number, detail: Detail, tint: number): void {
  const tr = h * num(p, 'trunk', 0.018);
  const reach = h * num(p, 'reach', 0.1);
  const leaves = MATERIALS[(p.mat as string) ?? 'needle'];
  m.tint = tint;
  if (detail < 2) {
    m.mat = leaves;
    m.light = 0.9;
    const base = m.verts;
    const ring = detail === 1 ? 5 : 3;
    for (let i = 0; i <= ring; i++) {
      const t = (TAU * i) / ring;
      const c = dcos(t);
      const s = dsin(t);
      m.v(c * reach * 0.7, s * reach * 0.7, h * 0.1, c, s, 0.3, i, 0, 0.5);
      m.v(c * 0.01, s * 0.01, h, c, s, 0.5, i, h, 1);
    }
    for (let i = 0; i < ring; i++) {
      const a = base + i * 2;
      m.quad(a, a + 2, a + 3, a + 1);
    }
    return;
  }
  m.mat = MATERIALS[(p.stem_mat as string) ?? 'bark'];
  m.light = 0.85;
  loft(m, [{ y: 0, z: -0.1, w: tr * 1.2, h: tr * 1.2 }, { y: 0, z: h * 0.5, w: tr * 0.9, h: tr * 0.9 }, { y: 0, z: h, w: tr * 0.2, h: tr * 0.2 }], 7);
  m.mat = leaves;
  m.light = 0.9;
  const nodes = num(p, 'nodes', 12);
  const around = num(p, 'around', 8);
  const start = num(p, 'start', 0.12);
  for (let k = 0; k < nodes; k++) {
    const f = k / nodes;
    const z = h * (start + (1 - start) * f);
    const len = reach * (1.15 - f) * (0.8 + 0.4 * hash2(k, 4, seed));
    for (let i = 0; i < around; i++) {
      const t = (TAU * (i + (k & 1) * 0.5)) / around;
      limb(m, 0, 0, z, dcos(t) * len, dsin(t) * len, z + len * 0.25, Math.max(tr * 0.12, h * 0.002), h * 0.0008, 3);
    }
  }
}

/** A tall pole that forks twice over at its top: a scale tree. */
function scaleTree(m: Mesh, p: Part, h: number, seed: number, detail: Detail, tint: number): void {
  const tr = h * num(p, 'trunk', 0.025);
  const at = h * num(p, 'fork_at', 0.72);
  const spread = h * num(p, 'spread', 0.14);
  const leaves = MATERIALS[(p.mat as string) ?? 'needle'];
  m.tint = tint;
  if (detail < 2) {
    m.mat = leaves;
    m.light = 1;
    foliage(m, 0, 0, at + (h - at) * 0.55, spread * 1.1, (h - at) * 0.55, detail === 1 ? 6 : 4, detail === 1 ? 3 : 2, seed, detail === 1 ? 0.2 : 0);
    if (detail === 1) {
      m.mat = MAT.bark;
      m.light = 0.8;
      limb(m, 0, 0, -0.2, 0, 0, at, tr, tr * 0.6, 4);
    }
    return;
  }
  m.mat = MAT.bark;
  m.light = 0.8;
  loft(m, [{ y: 0, z: -0.3, w: tr * 1.6, h: tr * 1.6 }, { y: 0, z: h * 0.05, w: tr, h: tr }, { y: 0, z: at, w: tr * 0.62, h: tr * 0.62 }], 8);
  const fork = (x: number, y: number, z: number, dirx: number, diry: number, len: number, r: number, depth: number, salt: number): void => {
    const a = TAU * hash2(depth, salt, seed) * 0.15;
    for (const side of [-1, 1]) {
      const ca = dcos(side * 0.62 + a);
      const sa = dsin(side * 0.62 + a);
      const nx = dirx * ca - diry * sa;
      const ny = dirx * sa + diry * ca;
      const ex = x + nx * len;
      const ey = y + ny * len;
      const ez = z + len * 0.72;
      m.mat = MAT.bark;
      m.light = 0.8;
      limb(m, x, y, z, ex, ey, ez, r, r * 0.68, 4);
      if (depth > 0) fork(ex, ey, ez, nx, ny, len * 0.7, r * 0.68, depth - 1, salt * 2 + side + 3);
      else {
        // Grassy leaves at the tips of the last forks.
        m.mat = leaves;
        m.light = 1;
        foliage(m, ex, ey, ez + len * 0.1, len * 0.42, len * 0.6, 6, 3, seed + salt, 0.3);
      }
    }
  };
  fork(0, 0, at, 1, 0, spread, tr * 0.5, num(p, 'forks', 2), 1);
}

/** A tuft of thin blades: a grass, a sedge or a rush, or a low clump of anything. */
function tuft(m: Mesh, p: Part, h: number, seed: number, detail: Detail, tint: number): void {
  if (detail < 2) return;
  m.mat = MATERIALS[(p.mat as string) ?? 'frond'];
  m.tint = tint;
  m.light = 0.85;
  const blades = num(p, 'blades', 12);
  const spread = h * num(p, 'spread', 0.5);
  const wide = h * num(p, 'wide', 0.025);
  for (let k = 0; k < blades; k++) {
    const t = TAU * hash2(k, 1, seed);
    const out = spread * (0.3 + 0.7 * hash2(k, 2, seed));
    const tall = h * (0.55 + 0.45 * hash2(k, 3, seed));
    const dx = dcos(t);
    const dy = dsin(t);
    const base = m.verts;
    for (let i = 0; i <= 3; i++) {
      const f = i / 3;
      const w = wide * (1 - f);
      const r = out * f * f;
      m.v(dx * r - dy * w, dy * r + dx * w, tall * f, dx * 0.3, dy * 0.3, 0.9, i, -1, 0.5 + 0.5 * f);
      m.v(dx * r + dy * w, dy * r - dx * w, tall * f, dx * 0.3, dy * 0.3, 0.9, i, 1, 0.5 + 0.5 * f);
    }
    for (let i = 0; i < 3; i++) {
      const a = base + i * 2;
      m.quad(a, a + 1, a + 3, a + 2);
    }
  }
}

/** Low lumps of leaves with no trunk: a shrub, a thicket, a cushion of moss. */
function shrub(m: Mesh, p: Part, h: number, seed: number, detail: Detail, tint: number): void {
  m.mat = MATERIALS[(p.mat as string) ?? 'broad'];
  m.tint = tint;
  m.light = 1;
  if (detail < 2) {
    foliage(m, 0, 0, h * 0.5, h * num(p, 'wide', 0.6), h * 0.5, detail === 1 ? 6 : 4, detail === 1 ? 3 : 2, seed, detail === 1 ? 0.25 : 0);
    return;
  }
  const lumps = num(p, 'lumps', 5);
  for (let k = 0; k < lumps; k++) {
    const t = TAU * hash2(k, 1, seed);
    const out = h * num(p, 'wide', 0.6) * (k === 0 ? 0 : 0.5 + 0.4 * hash2(k, 2, seed));
    const r = h * (k === 0 ? 0.55 : 0.32 + 0.14 * hash2(k, 3, seed));
    foliage(m, dcos(t) * out, dsin(t) * out, r * 0.8, r, r * 0.86, 6, 3, seed + k, 0.3);
  }
}

/** Draw a plant `h` metres tall, in the mesh's current frame. */
export function drawPlant(m: Mesh, form: Form, h: number, seed: number, detail: Detail, tint: number): void {
  m.light = 1;
  for (const name of Object.keys(form.parts)) {
    const p = form.parts[name];
    if (!p) continue;
    if (p.near && detail < 2) continue;
    switch (p.type) {
      case 'conifer':
        conifer(m, p, h, seed, detail, tint);
        break;
      case 'broadleaf':
        broadleaf(m, p, h, seed, detail, tint);
        break;
      case 'palm':
        palm(m, p, h, seed, detail, tint);
        break;
      case 'fern':
        fern(m, p, h, seed, detail, tint);
        break;
      case 'mat':
        floatingMat(m, p, seed, detail, tint);
        break;
      case 'whorled':
        whorled(m, p, h, seed, detail, tint);
        break;
      case 'scale-tree':
        scaleTree(m, p, h, seed, detail, tint);
        break;
      case 'tuft':
        tuft(m, p, h, seed, detail, tint);
        break;
      case 'shrub':
        shrub(m, p, h, seed, detail, tint);
        break;
      default:
        throw new Error(`no part of type "${p.type}" in a plant`);
    }
  }
}

// ——— What may be written ———

const COMMON = new Set(['type', 'mat', 'tint', 'tint_add', 'on', 'mirror', 'near', 'far', 'poses', 'not', 'stance', 'zl', 'sides', 'note']);

/** Every part a form may have, and the fields each may hold; the fields listed second are required. */
export const PART_TYPES: Record<string, { kind: 'animal' | 'plant'; fields: string[]; needs: string[] }> = {
  trunk: { kind: 'animal', fields: ['rings', 'neck'], needs: ['rings'] },
  head: { kind: 'animal', fields: ['rings', 'at', 'thin', 'flat'], needs: ['rings', 'at'] },
  tube: { kind: 'animal', fields: ['rings', 'thin', 'flat'], needs: ['rings'] },
  chain: { kind: 'animal', fields: ['points', 'flat', 'swing', 'phase'], needs: ['points'] },
  lump: { kind: 'animal', fields: ['at', 'r', 'bands', 'sway'], needs: ['at', 'r'] },
  spike: { kind: 'animal', fields: ['from', 'to', 'r', 'sway'], needs: ['from', 'to'] },
  pillar: { kind: 'animal', fields: ['y', 'x', 'top', 'r', 'swing', 'phase'], needs: ['y', 'x', 'top', 'r'] },
  digitigrade: { kind: 'animal', fields: ['y', 'x', 'top', 'knee', 'ankle', 'r', 'swing', 'phase', 'toes'], needs: ['y', 'x', 'top', 'r'] },
  fan: { kind: 'animal', fields: ['at', 'dir', 'r', 'across', 'tall', 'raise', 'scallop', 'scallops', 'arc', 'gap'], needs: ['at', 'dir', 'r'] },
  eyes: { kind: 'animal', fields: ['at', 'r'], needs: ['at', 'r'] },
  bands: { kind: 'animal', fields: ['rows', 'y', 'step', 'middle', 'fall', 'wide', 'top', 'low', 'out', 'spike', 'scute'], needs: [] },
  row: { kind: 'animal', fields: ['n', 'from', 'to', 'size', 'item', 'r', 'thick', 'bands'], needs: ['n', 'from', 'to', 'r'] },
  knobs: { kind: 'animal', fields: ['n', 'at', 'r', 'length', 'thick'], needs: ['at', 'r'] },
  shell: { kind: 'animal', fields: ['r', 'lift', 'bands'], needs: ['r'] },
  sheet: { kind: 'animal', fields: ['points', 'gap'], needs: ['points'] },
  wing: { kind: 'animal', fields: ['shoulder', 'span', 'chord', 'sweep', 'beat', 'arm', 'folded', 'drop'], needs: ['shoulder'] },
  conifer: { kind: 'plant', fields: ['reach', 'trunk', 'flare', 'tiers', 'start', 'drop'], needs: [] },
  broadleaf: { kind: 'plant', fields: ['crown', 'fork', 'trunk', 'limbs'], needs: [] },
  palm: { kind: 'plant', fields: ['trunk', 'lean', 'head', 'size', 'fronds'], needs: [] },
  fern: { kind: 'plant', fields: ['on_stem', 'stem', 'reach', 'fronds', 'across', 'arch', 'steps'], needs: [] },
  mat: { kind: 'plant', fields: ['radius'], needs: [] },
  whorled: { kind: 'plant', fields: ['trunk', 'reach', 'nodes', 'around', 'start', 'stem_mat'], needs: [] },
  'scale-tree': { kind: 'plant', fields: ['trunk', 'fork_at', 'spread', 'forks'], needs: [] },
  tuft: { kind: 'plant', fields: ['blades', 'spread', 'wide'], needs: [] },
  shrub: { kind: 'plant', fields: ['wide', 'lumps'], needs: [] },
};

/** What a fine mesh of one body may hold: a form that needs more is too fine to draw by the thousand. */
export const MAX_VERTICES = 30000;

/** The stance a form is checked and drawn in by default: a metre long, as its hips say. */
export const unitStance = (f: Form, pose: number, detail: Detail, phase = 0.25): Stance => ({ L: 1, H: f.hip ?? 0.3, pose, phase, sway: 0, detail, tint: 128, biped: false });

/** Everything wrong with a form, as sentences. */
export function checkForm(f: Form): string[] {
  const out: string[] = [];
  if (f.kind !== 'animal' && f.kind !== 'plant') return [`a form's kind is animal or plant, not "${String(f.kind)}"`];
  if (!f.parts || typeof f.parts !== 'object') return ['a form has parts'];
  for (const [name, p] of Object.entries(f.parts)) {
    if (!p) continue;
    const def = PART_TYPES[p.type];
    if (!def) {
      out.push(`part "${name}": no type "${p.type}"; the types are ${Object.keys(PART_TYPES).join(', ')}`);
      continue;
    }
    if (def.kind !== f.kind) out.push(`part "${name}": a ${p.type} belongs to a ${def.kind}, and this is a ${f.kind}`);
    for (const k of Object.keys(p)) if (!COMMON.has(k) && !def.fields.includes(k)) out.push(`part "${name}": a ${p.type} has no field "${k}"; it has ${def.fields.join(', ')}`);
    for (const k of def.needs) if (p[k] === undefined) out.push(`part "${name}": a ${p.type} needs "${k}"`);
    if (p.mat !== undefined && MATERIALS[p.mat as string] === undefined) out.push(`part "${name}": no material "${String(p.mat)}"; there are ${Object.keys(MATERIALS).join(', ')}`);
  }
  if (out.length) return out;
  try {
    if (f.kind === 'animal') {
      // Only what has wings is ever in the air.
      const flies = Object.values(f.parts).some((p) => p?.type === 'wing');
      for (const pose of [POSE.stand, POSE.walk, POSE.graze, POSE.alert, ...(flies ? [POSE.fly] : [])]) {
        const m = new Mesh(4096);
        drawAnimal(m, f, unitStance(f, pose, 2));
        const { low, verts } = meshBounds(m);
        if (verts > MAX_VERTICES) out.push(`a fine mesh of it has ${verts} vertices in pose ${pose}, over the budget of ${MAX_VERTICES}`);
        const allowed = pose === POSE.graze ? 0.08 : 0.05;
        if (low < -allowed) out.push(`its body goes ${low.toFixed(3)} of its length below the ground in pose ${pose}`);
      }
    } else {
      const m = new Mesh(4096);
      drawPlant(m, f, 10, 1, 2, 128);
      const { verts, low } = meshBounds(m);
      if (verts > MAX_VERTICES) out.push(`a fine mesh of it has ${verts} vertices, over the budget of ${MAX_VERTICES}`);
      if (low < -1.5) out.push(`it goes ${low.toFixed(2)} m below the ground at 10 m tall`);
    }
  } catch (e) {
    out.push(`it cannot be drawn: ${e instanceof Error ? e.message : String(e)}`);
  }
  return out;
}

/** The lowest point of a mesh and how many vertices it has. */
export function meshBounds(m: Mesh): { low: number; high: number; verts: number } {
  const { vertices } = m.arrays();
  const f = new Float32Array(vertices);
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < m.verts; i++) {
    const z = f[i * 7 + 2];
    if (z < low) low = z;
    if (z > high) high = z;
  }
  return { low, high, verts: m.verts };
}
