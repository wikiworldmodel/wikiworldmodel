// The land under a living scene: noise, a river's course and its old bends, and the height of the plain they cut.
// Written with only + − × ÷, square roots and integer operations, as generators were before any arithmetic was
// allowed; what the build and a browser make is now held to agree within the tolerance of core/fingerprint.ts.
import { dcos, dsin, hash2, Rng, TAU } from '../city/math.ts';
import type { Oxbow, RiverPath } from './rivers.ts';

/** How a river and its plain are drawn. Nothing here is a claim about any river. */
export interface PlainParams {
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
export function riverPath(g: PlainParams, seed: number, reach: number): number[] {
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
  /** where the world says where the rivers run: each drawn, and the oxbows of their older courses */
  paths?: RiverPath[];
  oxbowList?: Oxbow[];
}

/** Everywhere there is water on the plain, away from the river. */
export function watersOf(g: PlainParams, seed: number, reach: number): Waters {
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
export function plainGrid(spec: GridSpec, g: PlainParams, water: number, seed: number, w: Waters): Float32Array {
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
  if (best < 0) {
    // No bend near the middle: the river's nearest point, come to from the middle.
    let near = 0;
    let d = Infinity;
    for (let k = 0; k < n; k++) {
      const e = r[k * 2] * r[k * 2] + r[k * 2 + 1] * r[k * 2 + 1];
      if (e < d) {
        d = e;
        near = k;
      }
    }
    const x = r[near * 2];
    const y = r[near * 2 + 1];
    const l = Math.sqrt(d) || 1;
    return { at: [x - (x / l) * inset, y - (y / l) * inset], toRiver: [x / l, y / l] };
  }
  const i = bestK;
  const x = r[i * 2];
  const y = r[i * 2 + 1];
  const mx = (r[(i - span) * 2] + r[(i + span) * 2]) / 2 - x;
  const my = (r[(i - span) * 2 + 1] + r[(i + span) * 2 + 1]) / 2 - y;
  const l = Math.sqrt(mx * mx + my * my) || 1;
  return { at: [x + (mx / l) * inset, y + (my / l) * inset], toRiver: [-mx / l, -my / l] };
}

