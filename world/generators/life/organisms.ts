// The kit of living things: body plans for animals and plants, drawn from the sizes a taxon's
// claims give, in the mesh the city is built with. Each is written in its own frame, its front
// towards +y and the ground at z = 0, so a plan can turn it and stand it anywhere. Proportions here
// are the model's shape and not claims about any animal: what is recorded is the length, the height
// of the hips, the posture and the height of a plant; the rest says only what a body plan looks like.
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

// ——— How a body stands ———

export const POSE = { stand: 0, walk: 1, graze: 2, drink: 3, alert: 4, rest: 5 } as const;

/** What the plan says of one body. */
export interface Stance {
  /** snout to tail, and the height of the hips, in metres */
  L: number;
  H: number;
  pose: number;
  /** where in its stride it is, 0–1; and which way its tail is swung */
  phase: number;
  sway: number;
  /** 0 from afar, 1 close by */
  detail: number;
  /** colour, 0–255 */
  tint: number;
  biped: boolean;
}

/** A point of a head, given along its snout and up from it, turned down by a pitch about its joint. */
function pitched(jy: number, jz: number, pitch: number): (along: number, up: number) => [number, number] {
  const c = dcos(pitch);
  const s = dsin(pitch);
  return (along, up) => [jy + along * c + up * s, jz - along * s + up * c];
}

/** The rings of a neck, along a curve from the shoulder to the back of the head. */
function neck(from: Ring, jy: number, jz: number, r1: number, steps: number): Ring[] {
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

/** Rings from a table of [y/L, top/H, bottom/H, half-width/L], with the tail swung. */
function trunk(s: Stance, table: number[][]): Ring[] {
  const { L, H, sway } = s;
  const rings: Ring[] = [];
  const tailEnd = table[0][0];
  for (const [y, top, bottom, w] of table) {
    // Only behind the hips does the tail swing, more towards its tip.
    const behind = y < -0.14 ? (-0.14 - y) / (-0.14 - tailEnd) : 0;
    rings.push({ x: sway * L * behind * behind, y: y * L, z: ((top + bottom) * H) / 2, w: w * L, h: ((top - bottom) * H) / 2 });
  }
  return rings;
}

/** Fewer rings from afar: every other one, keeping the ends. */
function thin(rings: Ring[], detail: number): Ring[] {
  if (detail) return rings;
  return rings.filter((_, i) => i % 2 === 0 || i === rings.length - 1);
}

/** A hind leg that bends at the knee and runs up on its toes. */
function digitigrade(m: Mesh, side: number, s: Stance, y0: number, x0: number, top: number, knee: number, ankle: number, r0: number, swing: number, toes: boolean): void {
  const { L, H, detail } = s;
  const n = detail ? 8 : 4;
  const ky = y0 + (0.055 + swing * 0.55) * L;
  const ay = y0 + (-0.035 + swing * 0.8) * L;
  const fy = y0 + (0.008 + swing) * L;
  const lift = swing > 0.02 ? swing * 0.25 * H : 0;
  const kz = knee * H + lift;
  const az = ankle * H + lift;
  const fz = 0.022 * H + lift;
  const x = x0 * side;
  chain(m, [[x, y0, top * H, r0 * L * 0.92], [x * 1.04, y0 + (ky - y0) * 0.45, (top * H + kz) * 0.5, r0 * L], [x * 1.08, ky, kz, r0 * L * 0.55], [x * 1.08, (ky + ay) * 0.5, (kz + az) * 0.5, r0 * L * 0.42], [x * 1.04, ay, az, r0 * L * 0.28], [x, fy, fz, r0 * L * 0.26]], n, true);
  if (toes) {
    for (const k of [-1, 0, 1]) {
      const tx = x + k * r0 * L * 0.42;
      horn(m, x, fy, fz, tx + k * r0 * L * 0.5, fy + r0 * L * (1.5 - Math.abs(k) * 0.3), fz * 0.4 - lift * 0.3, r0 * L * 0.2, 4);
    }
  }
}

/** A leg held straight under the body. */
function pillar(m: Mesh, side: number, s: Stance, y0: number, x0: number, top: number, r0: number, swing: number): void {
  const { L, H, detail } = s;
  const n = detail ? 8 : 4;
  const x = x0 * side;
  const fy = y0 + swing * L;
  const lift = swing > 0.02 ? swing * 0.25 * H : 0;
  const pts = [
    [x, y0, top * H, r0 * L],
    [x * 1.03, y0 + (fy - y0) * 0.4, (top * 0.55 + 0.04) * H + lift * 0.4, r0 * L * 0.78],
    [x * 1.05, y0 + (fy - y0) * 0.75, (top * 0.22 + 0.02) * H + lift, r0 * L * 0.62],
    [x * 1.05, fy, lift, r0 * L * 0.78],
  ];
  chain(m, pts, n, true);
}

const swings = (s: Stance, amp: number): [number, number] => {
  if (s.pose !== POSE.walk) return [0, 0];
  const a = dsin(TAU * s.phase);
  return [a * amp, -a * amp];
};

/**
 * The head's pitch and how high its joint is, for a pose. Reaching down, the end of a head `reach`
 * long comes to the ground and no further.
 */
function headOf(s: Stance, jy: number, jz: number, reach: number, pitch: number): { jy: number; jz: number; pitch: number } {
  if (s.pose === POSE.graze || s.pose === POSE.drink) return { jy: jy + 0.02 * s.L, jz: reach * s.L * dsin(pitch) + 0.04 * s.H, pitch };
  if (s.pose === POSE.alert) return { jy: jy - 0.01 * s.L, jz: jz + 0.12 * s.H, pitch: -0.1 };
  return { jy, jz, pitch: 0.16 };
}

/** The dark of an eye, and the ridge above it. */
function eyes(m: Mesh, at: (along: number, up: number) => [number, number], along: number, up: number, across: number, r: number): void {
  const keep = m.mat;
  m.mat = MAT.dark;
  for (const side of [-1, 1]) {
    const [y, z] = at(along, up);
    lump(m, side * across, y, z, r * 0.7, r, r, 6, 4);
  }
  m.mat = keep;
}

// ——— Animals ———

function ceratopsian(m: Mesh, s: Stance): void {
  const { L, H, detail } = s;
  const n = detail ? 14 : 6;
  m.mat = MAT.hide;
  m.tint = s.tint;
  const body = trunk(s, [
    [-0.52, 0.2, 0.17, 0.006],
    [-0.44, 0.36, 0.22, 0.026],
    [-0.34, 0.6, 0.28, 0.052],
    [-0.24, 0.87, 0.32, 0.08],
    [-0.14, 1.07, 0.32, 0.112],
    [-0.05, 1.14, 0.28, 0.14],
    [0.05, 1.12, 0.26, 0.15],
    [0.14, 1.02, 0.3, 0.135],
    [0.2, 0.9, 0.38, 0.105],
  ]);
  const h = headOf(s, 0.25 * L, 0.68 * H, 0.28, 0.62);
  const last = body[body.length - 1];
  loft(m, thin([...body, ...neck(last, h.jy, h.jz, 0.066 * L, detail ? 3 : 1)], detail), n);
  const [ha, hb] = swings(s, 0.05);
  for (const side of [-1, 1]) {
    pillar(m, side, s, -0.11 * L, 0.112 * L, 0.74, 0.064, side < 0 ? ha : hb);
    pillar(m, side, s, 0.15 * L, 0.122 * L, 0.62, 0.05, side < 0 ? hb : ha);
  }
  const at = pitched(h.jy, h.jz, h.pitch);
  // The skull, deep behind and narrow to the beak.
  const skull = ([[-0.01, 0.0, 0.06, 0.06], [0.06, 0.012, 0.074, 0.08], [0.12, 0.0, 0.062, 0.066], [0.18, -0.02, 0.038, 0.046], [0.23, -0.034, 0.02, 0.028]] as const).map(([a, u, w, ht]) => {
    const [y, z] = at(a * L, u * L);
    return { y, z, w: w * L, h: ht * L };
  });
  loft(m, skull, n);
  m.mat = MAT.horn;
  m.tint = 90;
  const [by, bz] = at(0.23 * L, -0.034 * L);
  const [ty, tz] = at(0.27 * L, -0.052 * L);
  loft(m, [{ y: by, z: bz, w: 0.019 * L, h: 0.026 * L }, { y: ty, z: tz, w: 0.002 * L, h: 0.004 * L }], detail ? 8 : 4);
  // The frill: a shield swept up and back from the skull, its rim scalloped.
  m.mat = MAT.hide;
  m.tint = (s.tint + 40) & 255;
  const [cy, cz] = at(0.0 * L, 0.05 * L);
  const c = dcos(h.pitch);
  const sn = dsin(h.pitch);
  // Up and back along the frill's plane, and its normal, forward and up.
  const vy = -0.62 * c + 0.78 * sn;
  const vz = 0.62 * sn + 0.78 * c;
  const ny = -vz;
  const nz = vy;
  const R = 0.2 * L;
  const rim = detail ? 18 : 7;
  // Two sheets a little apart, each lit for the side it faces.
  for (const face of [-1, 1]) {
    const gap = face * 0.009 * L;
    const hub = m.v(0, cy + ny * gap, cz + nz * gap, 0, ny * face, nz * face, 0, 0);
    const start = m.verts;
    for (let i = 0; i <= rim; i++) {
      const a = -0.5 + ((PI + 1) * i) / rim;
      const scallop = detail ? 1 + 0.045 * dcos(a * 18) : 1;
      const rx = dcos(a) * R * 0.92 * scallop;
      const rv = (dsin(a) * 0.92 + 0.18) * R * scallop;
      m.v(rx, cy + vy * rv + ny * gap * 0.3, cz + vz * rv + nz * gap * 0.3, 0, ny * face, nz * face, i, rv);
    }
    for (let i = 0; i < rim; i++) m.tri(hub, start + i, start + i + 1);
  }
  m.mat = MAT.horn;
  m.tint = 60;
  const nh = detail ? 7 : 4;
  // Two over the eyes, one on the nose.
  for (const side of [-1, 1]) {
    const [a0, b0] = at(0.09 * L, 0.07 * L);
    const [a1, b1] = at(0.235 * L, 0.17 * L);
    horn(m, side * 0.036 * L, a0, b0, side * 0.05 * L, a1, b1, 0.02 * L, nh);
  }
  const [a0, b0] = at(0.185 * L, 0.012 * L);
  const [a1, b1] = at(0.205 * L, 0.066 * L);
  horn(m, 0, a0, b0, 0, a1, b1, 0.015 * L, nh);
  if (detail) eyes(m, at, 0.095 * L, 0.036 * L, 0.066 * L, 0.01 * L);
}

function tyrannosaur(m: Mesh, s: Stance): void {
  const { L, H, detail } = s;
  const n = detail ? 14 : 6;
  m.mat = MAT.hide;
  m.tint = s.tint;
  const body = trunk(s, [
    [-0.58, 0.64, 0.62, 0.004],
    [-0.48, 0.74, 0.68, 0.016],
    [-0.38, 0.85, 0.71, 0.03],
    [-0.28, 0.96, 0.74, 0.046],
    [-0.18, 1.07, 0.76, 0.064],
    [-0.08, 1.15, 0.7, 0.08],
    [0.02, 1.17, 0.58, 0.092],
    [0.1, 1.16, 0.6, 0.082],
    [0.16, 1.16, 0.72, 0.06],
  ]);
  const h = s.pose === POSE.drink || s.pose === POSE.graze ? { jy: 0.3 * L, jz: 0.66 * H, pitch: 0.5 } : s.pose === POSE.alert ? { jy: 0.26 * L, jz: 1.34 * H, pitch: 0.1 } : { jy: 0.27 * L, jz: 1.2 * H, pitch: 0.12 };
  loft(m, thin([...body, ...neck(body[body.length - 1], h.jy, h.jz, 0.045 * L, detail ? 3 : 1)], detail), n);
  const [a, b] = swings(s, 0.09);
  for (const side of [-1, 1]) digitigrade(m, side, s, -0.05 * L, 0.06 * L, 1.0, 0.6, 0.27, 0.046, side < 0 ? a : b, !!detail);
  // Arms, tiny.
  if (detail) {
    for (const side of [-1, 1]) {
      chain(m, [[side * 0.058 * L, 0.13 * L, 0.8 * H, 0.012 * L], [side * 0.064 * L, 0.145 * L, 0.71 * H, 0.008 * L], [side * 0.056 * L, 0.185 * L, 0.68 * H, 0.005 * L]], 5);
    }
  }
  const at = pitched(h.jy, h.jz, h.pitch);
  const rings = ([[-0.01, 0.0, 0.046, 0.055], [0.05, 0.004, 0.058, 0.07], [0.11, -0.006, 0.052, 0.062], [0.17, -0.016, 0.038, 0.046], [0.215, -0.024, 0.026, 0.03], [0.238, -0.026, 0.012, 0.015]] as const).map(([a0, u, w, ht]) => {
    const [y, z] = at(a0 * L, u * L);
    return { y, z, w: w * L, h: ht * L };
  });
  loft(m, thin(rings, detail), n);
  if (detail) {
    // The lower jaw, a little open, with the dark of the mouth above it.
    const open = s.pose === POSE.alert ? 0.022 : 0.008;
    const jaw = ([[0.03, -0.05, 0.04, 0.02], [0.1, -0.066 - open, 0.04, 0.018], [0.17, -0.058 - open * 2, 0.028, 0.012], [0.224, -0.044 - open * 3, 0.012, 0.007]] as const).map(([a0, u, w, ht]) => {
      const [y, z] = at(a0 * L, u * L);
      return { y, z, w: w * L, h: ht * L };
    });
    loft(m, jaw, 10);
    m.mat = MAT.dark;
    const gap = ([[0.05, -0.044, 0.04, 0.012], [0.15, -0.044 - open, 0.03, 0.01], [0.215, -0.036 - open, 0.014, 0.006]] as const).map(([a0, u, w, ht]) => {
      const [y, z] = at(a0 * L, u * L);
      return { y, z, w: w * L, h: ht * L };
    });
    loft(m, gap, 8);
    m.mat = MAT.hide;
    eyes(m, at, 0.078 * L, 0.03 * L, 0.05 * L, 0.0065 * L);
  }
}

function hadrosaur(m: Mesh, s: Stance): void {
  const { L, H, detail } = s;
  const n = detail ? 14 : 6;
  m.mat = MAT.hide;
  m.tint = s.tint;
  const upright = s.biped && s.pose !== POSE.graze && s.pose !== POSE.drink;
  const body = trunk(s, [
    [-0.54, 0.62, 0.58, 0.006],
    [-0.44, 0.78, 0.56, 0.018],
    [-0.34, 0.94, 0.54, 0.036],
    [-0.24, 1.08, 0.52, 0.058],
    [-0.14, 1.18, 0.46, 0.085],
    [-0.05, 1.2, 0.38, 0.108],
    [0.05, upright ? 1.22 : 1.12, upright ? 0.5 : 0.36, 0.112],
    [0.13, upright ? 1.28 : 1.02, upright ? 0.64 : 0.42, 0.092],
    [0.19, upright ? 1.36 : 0.93, upright ? 0.84 : 0.5, 0.064],
  ]);
  const h = upright ? { jy: 0.24 * L, jz: 1.5 * H, pitch: 0.2 } : headOf(s, 0.26 * L, 0.84 * H, 0.21, 1.0);
  loft(m, thin([...body, ...neck(body[body.length - 1], h.jy, h.jz, 0.036 * L, detail ? 4 : 1)], detail), n);
  const [a, b] = swings(s, 0.065);
  for (const side of [-1, 1]) {
    digitigrade(m, side, s, -0.1 * L, 0.082 * L, 0.92, 0.55, 0.2, 0.066, side < 0 ? a : b, !!detail);
    if (upright) {
      chain(m, [[side * 0.09 * L, 0.15 * L, 0.98 * H, 0.022 * L], [side * 0.098 * L, 0.17 * L, 0.72 * H, 0.016 * L], [side * 0.09 * L, 0.2 * L, 0.52 * H, 0.011 * L]], detail ? 6 : 4);
    } else {
      pillar(m, side, s, 0.13 * L, 0.082 * L, 0.74, 0.032, side < 0 ? b * 0.8 : a * 0.8);
    }
  }
  const at = pitched(h.jy, h.jz, h.pitch);
  const rings = ([[-0.01, 0, 0.034, 0.04], [0.045, 0.005, 0.038, 0.05], [0.1, -0.005, 0.032, 0.036], [0.15, -0.015, 0.036, 0.02], [0.185, -0.02, 0.04, 0.012], [0.2, -0.021, 0.026, 0.006]] as const).map(([a0, u, w, ht]) => {
    const [y, z] = at(a0 * L, u * L);
    return { y, z, w: w * L, h: ht * L };
  });
  loft(m, thin(rings, detail), n);
  if (detail) {
    m.mat = MAT.horn;
    m.tint = 100;
    const beak = ([[0.17, -0.02, 0.038, 0.011], [0.204, -0.022, 0.028, 0.005]] as const).map(([a0, u, w, ht]) => {
      const [y, z] = at(a0 * L, u * L);
      return { y, z, w: w * L, h: ht * L };
    });
    loft(m, beak, 8);
    m.mat = MAT.hide;
    eyes(m, at, 0.052 * L, 0.024 * L, 0.036 * L, 0.0065 * L);
  }
}

function ankylosaur(m: Mesh, s: Stance): void {
  const { L, H, detail } = s;
  const n = detail ? 14 : 6;
  m.mat = MAT.hide;
  m.tint = s.tint;
  const body = trunk(s, [
    [-0.54, 0.34, 0.26, 0.012],
    [-0.42, 0.42, 0.3, 0.018],
    [-0.3, 0.56, 0.36, 0.034],
    [-0.2, 0.84, 0.36, 0.09],
    [-0.1, 1.08, 0.36, 0.15],
    [0.02, 1.16, 0.34, 0.17],
    [0.14, 1.06, 0.36, 0.15],
    [0.23, 0.88, 0.4, 0.1],
    [0.28, 0.76, 0.42, 0.075],
  ]);
  loft(m, thin(body, detail), n);
  // The club, at the end of the tail.
  const tail = body[0];
  m.mat = MAT.horn;
  m.tint = 170;
  lump(m, tail.x ?? 0, tail.y, tail.z, 0.05 * L, 0.05 * L, 0.03 * L, detail ? 10 : 5, detail ? 6 : 3);
  const [a, b] = swings(s, 0.04);
  m.mat = MAT.hide;
  m.tint = s.tint;
  for (const side of [-1, 1]) {
    pillar(m, side, s, -0.08 * L, 0.125 * L, 0.56, 0.042, side < 0 ? a : b);
    pillar(m, side, s, 0.14 * L, 0.125 * L, 0.52, 0.034, side < 0 ? b : a);
  }
  // The head, broad and low, and wider behind than it is long.
  const hy = 0.3 * L;
  const hz = (s.pose === POSE.graze ? 0.32 : 0.56) * H;
  loft(m, [{ y: hy - 0.02 * L, z: hz + 0.008 * L, w: 0.06 * L, h: 0.04 * L }, { y: hy + 0.05 * L, z: hz + 0.004 * L, w: 0.066 * L, h: 0.042 * L }, { y: hy + 0.11 * L, z: hz - 0.012 * L, w: 0.04 * L, h: 0.026 * L }, { y: hy + 0.135 * L, z: hz - 0.018 * L, w: 0.016 * L, h: 0.012 * L }], n);
  if (!detail) return;
  // Bands of armour over the back, the outer ones spiked.
  m.mat = MAT.horn;
  m.tint = 190;
  for (let row = 0; row < 8; row++) {
    const y = (-0.2 + row * 0.06) * L;
    const k = 1 - ((row - 3.2) * (row - 3.2)) / 20;
    const w = 0.15 * k * L;
    const top = (0.96 + 0.2 * k) * H;
    for (let i = -3; i <= 3; i++) {
      const u = i / 3.2;
      const x = u * w;
      const z = (0.5 + (top / H - 0.5) * Math.sqrt(Math.max(0.04, 1 - u * u))) * H;
      if (i === -3 || i === 3) horn(m, x, y, z - 0.02 * H, x * 1.36, y - 0.01 * L, z - 0.06 * H, 0.016 * L, 5);
      else lump(m, x, y, z, 0.014 * L, 0.018 * L, 0.008 * L, 6, 3);
    }
  }
  const at = (along: number, up: number): [number, number] => [hy + along, hz + up];
  eyes(m, at, 0.06 * L, 0.018 * L, 0.054 * L, 0.006 * L);
}

function pachycephalosaur(m: Mesh, s: Stance): void {
  const { L, H, detail } = s;
  const n = detail ? 12 : 6;
  m.mat = MAT.hide;
  m.tint = s.tint;
  const body = trunk(s, [
    [-0.56, 0.72, 0.7, 0.004],
    [-0.44, 0.84, 0.74, 0.016],
    [-0.32, 0.96, 0.76, 0.03],
    [-0.2, 1.08, 0.74, 0.05],
    [-0.08, 1.16, 0.66, 0.07],
    [0.04, 1.2, 0.62, 0.075],
    [0.12, 1.24, 0.74, 0.056],
  ]);
  const h = s.pose === POSE.graze || s.pose === POSE.drink ? { jy: 0.24 * L, jz: 0.1 * L * dsin(0.95) + 0.05 * H, pitch: 0.95 } : { jy: 0.22 * L, jz: 1.5 * H, pitch: 0.2 };
  loft(m, thin([...body, ...neck(body[body.length - 1], h.jy, h.jz, 0.026 * L, detail ? 3 : 1)], detail), n);
  const [a, b] = swings(s, 0.08);
  for (const side of [-1, 1]) digitigrade(m, side, s, -0.04 * L, 0.05 * L, 0.98, 0.58, 0.24, 0.05, side < 0 ? a : b, !!detail);
  if (detail) for (const side of [-1, 1]) chain(m, [[side * 0.05 * L, 0.1 * L, 1.0 * H, 0.012 * L], [side * 0.058 * L, 0.12 * L, 0.82 * H, 0.009 * L], [side * 0.05 * L, 0.15 * L, 0.72 * H, 0.006 * L]], 5);
  const at = pitched(h.jy, h.jz, h.pitch);
  const rings = ([[-0.006, 0, 0.026, 0.03], [0.03, 0.002, 0.03, 0.034], [0.07, -0.01, 0.018, 0.018], [0.09, -0.016, 0.008, 0.008]] as const).map(([a0, u, w, ht]) => {
    const [y, z] = at(a0 * L, u * L);
    return { y, z, w: w * L, h: ht * L };
  });
  loft(m, rings, n);
  // The dome.
  m.mat = MAT.horn;
  m.tint = 150;
  const [dy, dz] = at(0.018 * L, 0.03 * L);
  lump(m, 0, dy, dz, 0.032 * L, 0.04 * L, 0.03 * L, detail ? 10 : 5, detail ? 6 : 3);
  if (!detail) return;
  for (let i = 0; i < 9; i++) {
    const t = (TAU * i) / 9;
    const [ky, kz] = at(0.02 * L + dcos(t) * 0.038 * L, 0.014 * L);
    horn(m, dsin(t) * 0.032 * L, ky, kz, dsin(t) * 0.042 * L, ky - dcos(t) * -0.008 * L, kz + 0.008 * L, 0.004 * L, 4);
  }
  m.mat = MAT.hide;
  eyes(m, at, 0.038 * L, 0.006 * L, 0.028 * L, 0.0048 * L);
}

function runner(m: Mesh, s: Stance, opts: { feathered: boolean; neckUp: number; neckR: number; bodyW: number; headL: number; headR: number }): void {
  const { L, H, detail } = s;
  const n = detail ? 10 : 5;
  m.mat = opts.feathered ? MAT.fur : MAT.hide;
  m.tint = s.tint;
  const w = opts.bodyW;
  const body = trunk(s, [
    [-0.56, 0.92, 0.9, 0.003],
    [-0.44, 0.98, 0.92, 0.009],
    [-0.32, 1.03, 0.93, 0.016],
    [-0.2, 1.1, 0.88, 0.028],
    [-0.09, 1.19, 0.74, w * 0.9],
    [0.02, 1.22, 0.64, w],
    [0.09, 1.22, 0.72, w * 0.8],
  ]);
  const low = s.pose === POSE.drink || s.pose === POSE.graze;
  const jy = low ? 0.24 * L : 0.17 * L;
  const jz = low ? opts.headL * L * dsin(0.8) * 1.1 + 0.06 * H : (1.28 + opts.neckUp) * H;
  loft(m, thin([...body, ...neck(body[body.length - 1], jy, jz, opts.neckR * L, detail ? 4 : 1)], detail), n);
  const [a, b] = swings(s, 0.1);
  for (const side of [-1, 1]) digitigrade(m, side, s, -0.03 * L, 0.03 * L, 1.0, 0.62, 0.26, 0.04, side < 0 ? a : b, !!detail);
  if (detail) {
    for (const side of [-1, 1]) chain(m, [[side * 0.03 * L, 0.08 * L, 1.06 * H, 0.012 * L], [side * 0.05 * L, 0.05 * L, 0.84 * H, 0.009 * L], [side * 0.042 * L, 0.11 * L, 0.72 * H, 0.006 * L]], 5);
  }
  const at = pitched(jy, jz, low ? 0.8 : 0.12);
  const hl = opts.headL;
  const hr = opts.headR;
  const rings = ([[-0.1, 0, 0.9, 0.9], [0.3, 0.02, 1.0, 1.0], [0.75, -0.06, 0.55, 0.5], [1.0, -0.1, 0.16, 0.16]] as const).map(([a0, u, wd, ht]) => {
    const [y, z] = at(a0 * hl * L, u * hl * L);
    return { y, z, w: wd * hr * L, h: ht * hr * L };
  });
  loft(m, rings, n);
  if (detail) eyes(m, at, 0.3 * hl * L, 0.35 * hr * L, 0.85 * hr * L, 0.18 * hr * L);
}

function crocodilian(m: Mesh, s: Stance): void {
  const { L, H, detail } = s;
  const n = detail ? 12 : 5;
  m.mat = MAT.hide;
  m.tint = s.tint;
  // Long and flat, the tail deep and thin, the snout long.
  const body = trunk(s, [
    [-0.5, 0.6, 0.5, 0.003],
    [-0.4, 0.82, 0.42, 0.008],
    [-0.28, 1.0, 0.42, 0.018],
    [-0.16, 1.14, 0.44, 0.034],
    [-0.06, 1.24, 0.34, 0.058],
    [0.04, 1.26, 0.3, 0.07],
    [0.13, 1.2, 0.34, 0.05],
    [0.2, 1.12, 0.46, 0.036],
    [0.25, 1.08, 0.5, 0.034],
    [0.31, 1.12, 0.62, 0.044],
    [0.37, 1.0, 0.62, 0.03],
    [0.44, 0.9, 0.62, 0.016],
    [0.5, 0.82, 0.62, 0.012],
  ]);
  loft(m, thin(body, detail), n);
  // Legs out to the sides, elbows up.
  for (const [y, r] of [[-0.09, 0.016], [0.13, 0.012]] as const) {
    for (const side of [-1, 1]) {
      chain(m, [[side * 0.05 * L, y * L, 0.72 * H, r * L], [side * 0.1 * L, (y + (side < 0 ? 0.015 : -0.015)) * L, 0.6 * H, r * L * 0.72], [side * 0.13 * L, (y + 0.015) * L, 0.02 * H, r * L * 0.6]], detail ? 5 : 3);
    }
  }
  if (detail) {
    // A row of bony plates along the back and the tail.
    m.mat = MAT.horn;
    m.tint = 40;
    for (let i = 0; i < 16; i++) {
      const y = -0.36 + i * 0.038;
      const k = i < 7 ? 0.96 + i * 0.04 : 1.26;
      for (const side of [-1, 1]) lump(m, side * 0.014 * L, y * L, k * H, 0.007 * L, 0.012 * L, 0.006 * L, 5, 2);
    }
    m.mat = MAT.dark;
    for (const side of [-1, 1]) lump(m, side * 0.03 * L, 0.32 * L, 1.1 * H, 0.005 * L, 0.006 * L, 0.005 * L, 6, 3);
  }
}

function turtle(m: Mesh, s: Stance): void {
  const { L, detail } = s;
  const n = detail ? 14 : 6;
  // Its length is the shell's.
  const lift = 0.07 * L;
  m.mat = MAT.hide;
  m.tint = s.tint;
  const legN = detail ? 6 : 3;
  for (const [x, y, r] of [[0.32, 0.3, 0.07], [0.3, -0.3, 0.055]] as const) {
    for (const side of [-1, 1]) chain(m, [[side * x * L * 0.7, y * L, lift + 0.03 * L, r * L], [side * x * L * 1.25, (y + (y > 0 ? 0.1 : -0.06)) * L, 0.015 * L, r * L * 0.72]], legN);
  }
  chain(m, [[0, 0.42 * L, lift + 0.05 * L, 0.06 * L], [0, 0.6 * L, lift + 0.09 * L, 0.05 * L], [0, 0.69 * L, lift + 0.09 * L, 0.035 * L]], detail ? 8 : 4);
  horn(m, 0, -0.45 * L, lift + 0.03 * L, 0, -0.6 * L, lift, 0.03 * L, 4);
  // The shell: a dome over a flat plastron.
  m.mat = MAT.shell;
  m.tint = s.tint;
  const rings = detail ? 6 : 3;
  const base = m.verts;
  const rx = 0.4 * L;
  const ry = 0.5 * L;
  const rz = 0.24 * L;
  for (let j = 0; j <= rings; j++) {
    const a = (PI / 2) * (j / rings);
    const ca = dcos(a);
    const sa = dsin(a);
    for (let i = 0; i <= n; i++) {
      const t = (TAU * i) / n;
      const c = dcos(t);
      const e = dsin(t);
      let nx = c * ca * ry * rz;
      let ny = e * ca * rx * rz;
      let nz = sa * rx * ry;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      m.v(c * ca * rx, e * ca * ry, lift + sa * rz, nx, ny, nz, c * ca * rx, e * ca * ry);
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

function smallMammal(m: Mesh, s: Stance): void {
  const { L, detail } = s;
  const n = detail ? 8 : 4;
  m.mat = MAT.fur;
  m.tint = s.tint;
  // Length is the whole animal's, about two fifths of it a tail.
  const R = 0.11 * L;
  lump(m, 0, 0, R * 1.3, R * 0.95, 0.24 * L, R, n, detail ? 5 : 3);
  lump(m, 0, 0.26 * L, R * 1.2, R * 0.66, 0.12 * L, R * 0.62, n, detail ? 4 : 2);
  if (!detail) return;
  horn(m, 0, -0.2 * L, R * 1.2, s.sway * L, -0.6 * L, R * 0.3, 0.02 * L, 4);
  for (const [x, y] of [[R * 0.7, 0.14 * L], [R * 0.7, -0.14 * L]] as const) {
    for (const side of [-1, 1]) horn(m, side * x, y, R * 0.9, side * x * 1.2, y + 0.01 * L, 0, 0.022 * L, 4);
  }
}

// ——— Plants ———

/** Tiers of drooping, ragged foliage round a straight trunk: a swamp cypress or a redwood. */
function conifer(m: Mesh, h: number, seed: number, detail: number, tint: number): void {
  const r = h * 0.15;
  if (!detail) {
    m.mat = MAT.needle;
    m.tint = tint;
    m.light = 0.9;
    const base = m.verts;
    const ring = 5;
    for (let i = 0; i <= ring; i++) {
      const t = (TAU * i) / ring;
      const c = dcos(t);
      const s = dsin(t);
      m.v(c * r * 1.1, s * r * 1.1, h * 0.14, c, s, 0.3, i, 0, 0.45);
      m.v(c * 0.01, s * 0.01, h, c, s, 0.5, i, h, 1);
    }
    for (let i = 0; i < ring; i++) {
      const a = base + i * 2;
      m.quad(a, a + 2, a + 3, a + 1);
    }
    return;
  }
  m.mat = MAT.bark;
  m.tint = tint;
  m.light = 0.8;
  // A flared, buttressed foot, tapering all the way up.
  const tr = h * 0.022;
  loft(m, [{ y: 0, z: -0.3, w: tr * 2.4, h: tr * 2.4 }, { y: 0, z: h * 0.03, w: tr * 1.5, h: tr * 1.5 }, { y: 0, z: h * 0.1, w: tr, h: tr }, { y: 0, z: h * 0.6, w: tr * 0.5, h: tr * 0.5 }, { y: 0, z: h, w: tr * 0.04, h: tr * 0.04 }], 8);
  m.mat = MAT.needle;
  const tiers = 13;
  for (let k = 0; k < tiers; k++) {
    const f = k / tiers;
    const z1 = h * (0.24 + 0.76 * f);
    const reach = r * (1.2 - f) * (0.72 + 0.46 * hash2(k, 1, seed));
    const z0 = z1 - h * 0.075 * (1.2 - f * 0.6);
    const lean = (hash2(k, 2, seed) - 0.5) * 0.6;
    const sides = 9;
    const light = 0.5 + 0.5 * f;
    const top = m.v(lean * r * 0.3, 0, z1 + h * 0.015, 0, 0, 1, 0, 0, light);
    const rim = m.verts;
    for (let i = 0; i <= sides; i++) {
      const t = (TAU * ((i % sides) + (k & 1) * 0.5)) / sides;
      const c = dcos(t);
      const s = dsin(t);
      const out = reach * (0.5 + 0.8 * hash2(i % sides, k + 3, seed));
      const droop = (hash2(i % sides, k + 11, seed) - 0.5) * h * 0.04;
      m.v(c * out + lean * r * 0.3, s * out, z0 + droop, c * 0.7, s * 0.7, 0.7, i, out, light * 0.85);
    }
    for (let i = 0; i < sides; i++) m.tri(top, rim + i, rim + i + 1);
  }
}

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

function broadleaf(m: Mesh, h: number, seed: number, detail: number, tint: number): void {
  const R = h * 0.34;
  const fork = h * (0.36 + 0.14 * hash2(1, 9, seed));
  if (!detail) {
    m.mat = MAT.broad;
    m.tint = tint;
    m.light = 1;
    foliage(m, 0, 0, fork + R * 0.62, R, R * 0.76, 4, 2, seed, 0);
    return;
  }
  m.mat = MAT.bark;
  m.tint = tint;
  m.light = 0.8;
  const tr = h * 0.022;
  loft(m, [{ y: 0, z: -0.3, w: tr * 1.5, h: tr * 1.5 }, { y: 0, z: h * 0.05, w: tr, h: tr }, { y: 0, z: fork, w: tr * 0.72, h: tr * 0.72 }], 7);
  const limbs = 4 + ((seed >> 3) & 1);
  const tips: number[][] = [];
  for (let k = 0; k < limbs; k++) {
    const t = (TAU * (k + hash2(k, 3, seed) * 0.5)) / limbs;
    const out = R * (0.45 + 0.28 * hash2(k, 4, seed));
    const tip = [dcos(t) * out, dsin(t) * out, fork + R * (0.34 + 0.32 * hash2(k, 5, seed))];
    tips.push(tip);
    limb(m, 0, 0, fork * 0.92, tip[0], tip[1], tip[2], tr * 0.62, tr * 0.2, 5);
  }
  m.mat = MAT.broad;
  m.tint = tint;
  m.light = 1;
  foliage(m, 0, 0, fork + R * 0.72, R * 0.68, R * 0.56, 7, 4, seed, 0.24);
  tips.forEach((tip, k) => {
    const r = R * (0.42 + 0.14 * hash2(k, 6, seed));
    foliage(m, tip[0], tip[1], tip[2] + r * 0.2, r, r * 0.74, 6, 3, seed + k + 1, 0.3);
  });
}

/** A straight palm with a head of pleated fans. */
function palm(m: Mesh, h: number, seed: number, detail: number, tint: number): void {
  const tr = h * 0.03;
  const lean = (hash2(1, 2, seed) - 0.5) * h * 0.12;
  const lean2 = (hash2(2, 2, seed) - 0.5) * h * 0.12;
  if (!detail) {
    m.mat = MAT.frond;
    m.tint = tint;
    m.light = 1;
    foliage(m, lean, lean2, h * 0.9, h * 0.26, h * 0.13, 4, 2, seed, 0);
    return;
  }
  m.mat = MAT.bark;
  m.tint = 200;
  m.light = 0.85;
  loft(m, [{ y: 0, z: -0.3, w: tr * 1.3, h: tr * 1.3 }, { x: lean * 0.2, y: lean2 * 0.2, z: h * 0.3, w: tr * 0.9, h: tr * 0.9 }, { x: lean * 0.7, y: lean2 * 0.7, z: h * 0.7, w: tr * 0.78, h: tr * 0.78 }, { x: lean, y: lean2, z: h * 0.88, w: tr * 0.82, h: tr * 0.82 }], 7);
  m.mat = MAT.frond;
  m.tint = tint;
  m.light = 1;
  const fronds = 11;
  const size = h * 0.34;
  for (let k = 0; k < fronds; k++) {
    const t = (TAU * (k + hash2(k, 7, seed) * 0.6)) / fronds;
    const up = 0.75 - 1.15 * (k / fronds) + (hash2(k, 8, seed) - 0.5) * 0.3;
    const dx = dcos(t);
    const dy = dsin(t);
    const c = lean;
    const d = lean2;
    const z0 = h * 0.88;
    // The stalk, then the fan at its end, spread across and hanging a little.
    const px = c + dx * size * 0.5;
    const py = d + dy * size * 0.5;
    const pz = z0 + size * 0.5 * up;
    limb(m, c, d, z0, px, py, pz, tr * 0.2, tr * 0.12, 3);
    const hub = m.v(px, py, pz, 0, 0, 1, 0, 0, 0.9);
    const pleats = 8;
    const rim = m.verts;
    for (let i = 0; i <= pleats; i++) {
      const a = (-1.05 + (2.1 * i) / pleats) * 1;
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

/** A rosette of arching fronds. */
function fern(m: Mesh, h: number, seed: number, tint: number): void {
  m.mat = MAT.frond;
  m.tint = tint;
  m.light = 0.8;
  const fronds = 7;
  const reach = h * 0.95;
  for (let k = 0; k < fronds; k++) {
    const t = (TAU * (k + hash2(k, 1, seed) * 0.5)) / fronds;
    const dx = dcos(t);
    const dy = dsin(t);
    const across = 0.07 * reach * (0.8 + 0.4 * hash2(k, 2, seed));
    const arch = h * (0.72 + 0.4 * hash2(k, 3, seed));
    const steps = 4;
    const base = m.verts;
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const z = arch * (f * (2 - f) * 0.9 - f * f * f * 0.72);
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

/** A mat of floating fern, on the water. */
function floatingMat(m: Mesh, r: number, seed: number, tint: number, detail: number): void {
  m.mat = MAT.frond;
  m.tint = tint;
  m.light = 1;
  const n = detail ? 12 : 6;
  const hub = m.v(0, 0, 0.012, 0, 0, 1, 0, 0);
  const rim = m.verts;
  for (let i = 0; i <= n; i++) {
    const t = (TAU * (i % n)) / n;
    const w = r * (0.6 + 0.6 * hash2(i % n, 1, seed));
    m.v(dcos(t) * w, dsin(t) * w, 0.012, 0, 0, 1, i, w);
  }
  for (let i = 0; i < n; i++) m.tri(hub, rim + i, rim + i + 1);
}

// ——— The dispatch ———

/**
 * How high the hips stand, as a share of the length, for a taxon whose claims give only its length:
 * the shape of the model, and marked as the generator's where it is used.
 */
export const HIP_SHARE: Record<string, number> = {
  ceratopsian: 0.32,
  tyrannosaur: 0.3,
  hadrosaur: 0.3,
  ankylosaur: 0.24,
  pachycephalosaur: 0.31,
  ornithopod: 0.3,
  'small-theropod': 0.33,
  crocodilian: 0.1,
  turtle: 0.2,
  'small-mammal': 0.1,
};

/** Draw an animal in the mesh's current frame. */
export function animal(m: Mesh, plan: string, s: Stance): void {
  m.light = 1;
  switch (plan) {
    case 'ceratopsian':
      return ceratopsian(m, s);
    case 'tyrannosaur':
      return tyrannosaur(m, s);
    case 'hadrosaur':
      return hadrosaur(m, s);
    case 'ankylosaur':
      return ankylosaur(m, s);
    case 'pachycephalosaur':
      return pachycephalosaur(m, s);
    case 'ornithopod':
      return runner(m, s, { feathered: false, neckUp: 0.06, neckR: 0.018, bodyW: 0.06, headL: 0.08, headR: 0.024 });
    case 'small-theropod':
      return runner(m, s, { feathered: true, neckUp: 0.14, neckR: 0.014, bodyW: 0.046, headL: 0.075, headR: 0.02 });
    case 'crocodilian':
      return crocodilian(m, s);
    case 'turtle':
      return turtle(m, s);
    case 'small-mammal':
      return smallMammal(m, s);
    default:
      throw new Error(`no kit for an animal of body plan "${plan}"`);
  }
}

/** Draw a plant, `h` metres tall, in the mesh's current frame. */
export function plant(m: Mesh, plan: string, posture: string | undefined, h: number, seed: number, detail: number, tint: number): void {
  if (posture === 'floating') return floatingMat(m, h, seed, tint, detail);
  switch (plan) {
    case 'conifer':
      return conifer(m, h, seed, detail, tint);
    case 'broadleaf':
      return broadleaf(m, h, seed, detail, tint);
    case 'palm':
      return palm(m, h, seed, detail, tint);
    case 'fern':
      // A fern is drawn only close by: from afar the ground's colour stands in for it.
      if (detail) fern(m, h, seed, tint);
      return;
    default:
      throw new Error(`no kit for a plant of body plan "${plan}"`);
  }
}
