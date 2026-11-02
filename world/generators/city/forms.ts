// How a structure is raised: from its footprint and height, and what its form claim says of its
// architecture. A form's parameters are facts where a claim gives them and the generator's guess
// where it does not, and no dimension is written here that a record could give instead: the
// constants below are proportions, the rules of thumb of a Roman builder.
import type { CityStructure, FormSpec } from '../../../core/city.ts';
import type { GroundSampler } from './ground.ts';
import { arcadeBay, archedWindow, band, barrel, box, cap, column, disc, dome, figure, gable, hip, horse, lathe, lunette, MAT, Mesh, outsetRing, planOf, prism, wall, wallSloped, type Order, type Plan } from './kit.ts';
import { area, bearingVector, ccw, centroid, clamp, clipHalf, dcos, dsin, hash2, hashString, insetConvex, minBox, mix, PI, Rng, signedArea2, TAU, type Poly } from './math.ts';

export interface FormContext {
  ground: GroundSampler;
  /** 0 from afar, 1 close by */
  detail: number;
  /** for structures that run along lines, only what falls in this box of the city */
  clip?: [number, number, number, number];
  /** how far the nearest street is from a point, to guess which way a front faces */
  streetDistance?: (x: number, y: number) => number;
  /** the direction of the nearest city wall at a point, to set a gate in it */
  wallDirection?: (x: number, y: number) => [number, number] | undefined;
  /** the river's surface */
  water: number;
}

/** A column's height in its own diameters, by order. */
const DIAMETERS: Record<Order, number> = { tuscan: 7, doric: 7.5, ionic: 9, corinthian: 10, composite: 10 };

const stoneOf = (s: CityStructure) => (s.look?.['building:colour'] === '#ffdead' ? MAT.travertine : MAT.marble);

function shaftMat(f: FormSpec): number {
  return f.shaft === 'granite' ? MAT.granite : f.shaft === 'travertine' ? MAT.travertine : f.shaft === 'stucco' ? MAT.plaster : MAT.shaft;
}

const roofMat = (f: FormSpec): number => (f.roof === 'gilded' ? MAT.gilt : f.roof === 'bronze' ? MAT.bronze : f.roof === 'lead' ? MAT.lead : MAT.tile);

function placeBy(m: Mesh, s: CityStructure, ctx: FormContext, faces: number | undefined, swap = false): Plan {
  const prefer = ctx.streetDistance;
  const plan = planOf(s.rings, s.at, faces, prefer);
  if (swap && faces === undefined && plan.hw > plan.hl) {
    // Across its long side.
    const { fx, fy, hw, hl } = plan;
    plan.fx = fy;
    plan.fy = -fx;
    plan.hw = hl;
    plan.hl = hw;
  }
  m.place(plan.box.cx, plan.box.cy, s.base, plan.fx, plan.fy);
  return plan;
}

// ——— Temples ———

function temple(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const f = s.form;
  const d = ctx.detail;
  const plan = placeBy(m, s, ctx, f.faces);
  let hw = Math.max(plan.hw, 2);
  let hl = Math.max(plan.hl, 2);
  // A footprint this large is the temple's precinct: paved, walled and colonnaded, the temple at its back.
  const fronted = f.front ?? (hw * 2 < 11 ? 4 : hw * 2 < 26 ? 6 : 8);
  if ((hw * 2) / (fronted - 1) > 8.5 && !f.column_height) {
    const stone = stoneOf(s);
    const ch = clamp(Math.sqrt(hw * hl) * 0.11, 5, 12);
    m.mat = MAT.travertine;
    box(m, -hw, -hl, -2, hw, hl, 1.2, false);
    m.mat = MAT.paving;
    m.tint = 190;
    cap(m, [-hw, -hl, hw, -hl, hw, hl, -hw, hl], 1.2);
    const depth = clamp(ch * 0.7, 3, 7);
    const wh = ch * 1.5;
    const corners = [-hw, -hl, hw, -hl, hw, hl, -hw, hl];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const [ax, ay, bx, by] = [corners[i * 2], corners[i * 2 + 1], corners[j * 2], corners[j * 2 + 1]];
      m.mat = MAT.travertine;
      wall(m, ax, ay, bx, by, 0, 1.2 + wh);
      wall(m, bx, by, ax, ay, 1.2, 1.2 + wh);
      const ux = bx - ax;
      const uy = by - ay;
      const l = Math.sqrt(ux * ux + uy * uy);
      const nx = uy / l;
      const ny = -ux / l;
      colonnade(m, bx - nx * depth, by - ny * depth, ax - nx * depth, ay - ny * depth, 1.2, ch, f.order ?? 'corinthian', depth, d, stone, f);
    }
    // The temple, in proportion to its precinct, standing at the back and facing the way in.
    const tw = Math.min(hw * 0.46, 22);
    const tl = tw * 1.6;
    const cy = hl * 0.86 - tl - hl * 0.6;
    m.place(plan.box.cx - plan.fx * cy, plan.box.cy - plan.fy * cy, s.base + 1.2, plan.fx, plan.fy);
    hw = tw;
    hl = tl;
  }
  const W = hw * 2;
  if (hw > hl * 1.05) return generic(m, s, ctx);
  const order: Order = f.order ?? 'corinthian';
  const front = f.front ?? (W < 11 ? 4 : W < 26 ? 6 : 8);
  const podium = f.podium_height ?? clamp(W * 0.13, 1.1, 5);
  const stairs = clamp(podium * 1.6, 1, hl * 0.3);
  const margin = W * 0.04;
  const span = W - 2 * margin;
  let D = clamp(span / (front * 3 - 2) * 1.05, 0.35, 3);
  const pitch = (span - D) / (front - 1);
  const rise = W * 0.13;
  let ch = f.column_height ?? (s.height ? (s.height - podium - rise) / 1.24 : DIAMETERS[order] * D);
  ch = Math.max(ch, 2);
  if (f.column_height || s.height) D = clamp(ch / DIAMETERS[order], 0.3, pitch * 0.55);
  const stone = stoneOf(s);
  const y0 = -hl;
  const y1 = hl - stairs;
  m.mat = MAT.travertine;
  // The podium, with a moulding at its foot and head.
  box(m, -hw, y0, -1.5, hw, y1, podium);
  if (d) {
    m.mat = stone;
    box(m, -hw - 0.12, y0 - 0.12, -0.2, hw + 0.12, y1 + 0.12, 0.35, false);
    box(m, -hw - 0.1, y0 - 0.1, podium - 0.3, hw + 0.1, y1 + 0.1, podium, true);
  }
  // The steps up to it.
  m.mat = stone;
  const steps = Math.max(2, Math.round(podium / 0.3));
  if (d) {
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const z1 = podium * (1 - t0);
      box(m, -hw * 0.88, y1 + stairs * t0, -0.5, hw * 0.88, y1 + stairs * (t0 + 1 / steps), z1, true);
    }
  } else {
    const n = Math.SQRT1_2;
    m.quad(m.v(-hw * 0.88, y1 + stairs, 0, 0, n, n, 0, 0), m.v(hw * 0.88, y1 + stairs, 0, 0, n, n, 2, 0), m.v(hw * 0.88, y1, podium, 0, n, n, 2, 2), m.v(-hw * 0.88, y1, podium, 0, n, n, 0, 2));
  }
  const zc = podium;
  const top = zc + ch;
  // Where the columns stand and where the cella's walls are.
  const planType = f.plan ?? (hl > hw * 1.25 && W >= 18 ? 'peripteral' : 'prostyle');
  const colX = (i: number) => -span / 2 + D / 2 + i * pitch;
  const rowFront = y1 - margin - D / 2;
  const side = f.side ?? Math.max(4, Math.round((rowFront - (y0 + margin + D / 2)) / pitch) + 1);
  const pitchY = (rowFront - (y0 + margin + D / 2)) / (side - 1);
  const stands = (x: number, y: number) => column(m, x, y, zc, ch, D, order, d, shaftMat(f), stone);
  m.mat = stone;
  for (let i = 0; i < front; i++) stands(colX(i), rowFront);
  let cellaFront: number;
  let cellaHw: number;
  let cellaBack: number;
  if (planType === 'peripteral' || planType === 'dipteral' || planType === 'sine-postico') {
    const back = planType === 'sine-postico' ? 0 : 1;
    for (let k = 1; k < side - back; k++) {
      stands(colX(0), rowFront - k * pitchY);
      stands(colX(front - 1), rowFront - k * pitchY);
    }
    if (back) for (let i = 1; i < front - 1; i++) stands(colX(i), rowFront - (side - 1) * pitchY);
    cellaHw = hw - margin - D - pitch * 0.9;
    cellaFront = rowFront - pitchY * 2;
    cellaBack = back ? y0 + margin + D + pitchY * 0.9 : y0 + margin;
    if (planType === 'sine-postico') cellaHw = hw - margin - D * 0.2;
  } else {
    cellaHw = hw - margin;
    const depth = Math.min(pitch * (planType === 'in-antis' ? 1 : 2), (rowFront - y0) * 0.45);
    cellaFront = rowFront - depth;
    cellaBack = y0 + margin;
    if (planType !== 'in-antis') for (const x of [colX(0), colX(front - 1)]) stands(x, rowFront - depth * 0.5);
  }
  // The cella, its door dark in the middle of its front.
  m.mat = planType === 'sine-postico' ? stone : stone;
  box(m, -cellaHw, cellaBack, zc, cellaHw, cellaFront, top);
  if (planType === 'pseudoperipteral' && d) {
    for (let k = 1; k < side; k++) {
      const y = rowFront - k * pitchY;
      if (y > cellaFront || y < cellaBack) continue;
      column(m, -cellaHw, y, zc, ch, D * 0.9, order, 1, stone, stone);
      column(m, cellaHw, y, zc, ch, D * 0.9, order, 1, stone, stone);
    }
  }
  m.mat = MAT.dark;
  const dw = Math.min(cellaHw * 0.3, D * 1.6);
  box(m, -dw, cellaFront, zc, dw, cellaFront + 0.05, zc + ch * 0.72, false);
  // The entablature, whole across the roof, its underside the porch's ceiling.
  const rx0 = -hw + margin * 0.3;
  const rx1 = hw - margin * 0.3;
  const ry0 = y0 + margin * 0.3;
  const ry1 = y1 - margin * 0.3;
  const E = ch * 0.24;
  m.mat = stone;
  box(m, rx0, ry0, top, rx1, ry1, top + E * 0.62, false, true);
  if (d) {
    // Architrave below, a carved frieze, a row of dentils, then the cornice.
    m.mat = MAT.frieze;
    box(m, rx0 + E * 0.02, ry0 + E * 0.02, top + E * 0.3, rx1 - E * 0.02, ry1 - E * 0.02, top + E * 0.62, false);
    m.mat = MAT.dentil;
    box(m, rx0 - E * 0.05, ry0 - E * 0.05, top + E * 0.62, rx1 + E * 0.05, ry1 + E * 0.05, top + E * 0.76, false, true);
    m.mat = stone;
    box(m, rx0 - E * 0.22, ry0 - E * 0.22, top + E * 0.76, rx1 + E * 0.22, ry1 + E * 0.22, top + E, true, true);
  } else {
    box(m, rx0 - E * 0.2, ry0 - E * 0.2, top + E * 0.62, rx1 + E * 0.2, ry1 + E * 0.2, top + E, true);
  }
  const zr = top + E;
  m.mat = roofMat(f);
  m.tint = 120 + (hashString(s.id) & 63);
  gable(m, rx0 - E * 0.1, ry0 - E * 0.1, rx1 + E * 0.1, ry1 + E * 0.1, zr, (rx1 - rx0) * 0.13, E * 0.2, stone);
  if (d) {
    // Figures in the pediment, tallest in the middle.
    m.mat = MAT.marble;
    const span2 = (rx1 - rx0) * 0.42;
    const peakH = (rx1 - rx0) * 0.13;
    for (let i = -4; i <= 4; i++) {
      const u = i / 4.5;
      const fh = peakH * (1 - Math.abs(u)) * 0.72;
      if (fh < 0.3) continue;
      figure(m, u * span2, ry1 + 0.05, zr + 0.1, fh, 1);
    }
    // What stands on the roof: at the peak of each pediment and its corners.
    m.mat = MAT.statue;
    const fh = clamp(ch * 0.2, 1, 4);
    const peak = zr + (rx1 - rx0) * 0.13;
    figure(m, 0, ry1, peak, fh, 1);
    figure(m, 0, ry0, peak, fh, 1);
    figure(m, rx0, ry1, zr, fh * 0.75, 1);
    figure(m, rx1, ry1, zr, fh * 0.75, 1);
  }
}

function tholos(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const f = s.form;
  const d = ctx.detail;
  const plan = placeBy(m, s, ctx, f.faces);
  const R = Math.max(Math.min(plan.hw, plan.hl), 2);
  const podium = f.podium_height ?? clamp(R * 0.25, 0.8, 3.2);
  const order = f.order ?? 'corinthian';
  const n = f.columns ?? 20;
  const pitch = (TAU * (R * 0.86)) / n;
  const D = clamp(pitch * 0.42, 0.3, 1.4);
  const ch = f.column_height ?? (s.height ? (s.height - podium) / 1.65 : DIAMETERS[order] * D);
  const seg = d ? 32 : 14;
  const stone = stoneOf(s);
  m.mat = stone;
  lathe(m, 0, 0, [[R, -1], [R, podium]], seg);
  disc(m, 0, 0, R, podium, seg);
  for (let i = 0; i < n; i++) {
    const t = (TAU * i) / n;
    column(m, dcos(t) * R * 0.86, dsin(t) * R * 0.86, podium, ch, D, order, d, shaftMat(f), stone);
  }
  m.mat = stone;
  lathe(m, 0, 0, [[R * 0.62, podium], [R * 0.62, podium + ch]], seg);
  const E = ch * 0.2;
  lathe(m, 0, 0, [[R * 0.8, podium + ch], [R * 0.92, podium + ch], [R * 0.92, podium + ch + E * 0.7], [R * 0.98, podium + ch + E]], seg);
  m.mat = roofMat(f);
  lathe(m, 0, 0, [[R * 1.0, podium + ch + E], [R * 0.3, podium + ch + E + R * 0.42], [R * 0.05, podium + ch + E + R * 0.5]], seg, true);
}

// ——— Halls ———

/** A sloped roof between an outer and an inner rectangle: the aisles of a basilica. */
function leanTo(m: Mesh, x0: number, y0: number, x1: number, y1: number, a0: number, b0: number, a1: number, b1: number, zo: number, zi: number): void {
  const p = [[x0, y0, a0, b0], [x1, y0, a1, b0], [x1, y1, a1, b1], [x0, y1, a0, b1]];
  for (let i = 0; i < 4; i++) {
    const [ox0, oy0, ix0, iy0] = p[i];
    const [ox1, oy1, ix1, iy1] = p[(i + 1) % 4];
    const ex = ox1 - ox0;
    const ey = oy1 - oy0;
    const l = Math.sqrt(ex * ex + ey * ey) || 1;
    const nx = ey / l;
    const ny = -ex / l;
    const dx = Math.max(Math.abs(ix0 - ox0), Math.abs(iy0 - oy0)) || 1;
    const k = (zi - zo) / dx;
    const q = Math.sqrt(k * k + 1);
    const wx = (nx * k) / q;
    const wy = (ny * k) / q;
    const wz = 1 / q;
    m.quad(m.v(ox0, oy0, zo, wx, wy, wz, 0, 0), m.v(ox1, oy1, zo, wx, wy, wz, l, 0), m.v(ix1, iy1, zi, wx, wy, wz, l, dx * q), m.v(ix0, iy0, zi, wx, wy, wz, 0, dx * q));
  }
}

/** An arcade along a straight wall, from a to b with its outside on the right, in bays about `bay` wide. */
function arcadeAlong(m: Mesh, ax: number, ay: number, bx: number, by: number, z0: number, z1: number, bay: number, d: number, depth = 1.6): void {
  const l = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
  const n = Math.max(1, Math.round(l / bay));
  const h = z1 - z0;
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    const w = l / n;
    arcadeBay(m, ax + (bx - ax) * t0, ay + (by - ay) * t0, ax + (bx - ax) * t1, ay + (by - ay) * t1, z0, z1, Math.min(h * 0.55, h - w * 0.45), w * 0.17, depth, d, d ? 6 : 3);
  }
}

function basilica(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const f = s.form;
  const d = ctx.detail;
  const plan = placeBy(m, s, ctx, f.faces, true);
  const hw = Math.max(plan.hw, 3);
  const hl = Math.max(plan.hl, 3);
  const stone = stoneOf(s);
  const storeys = f.storeys ?? 2;
  const H = s.height ?? clamp(Math.min(hw, hl) * 0.75, 10, 26);
  const roofH = H * 0.2;
  const aisle = (H - roofH) * 0.72;
  const step = 1.6;
  const depth = Math.min(hw, hl) * 0.3;
  m.mat = MAT.travertine;
  box(m, -hw, -hl, -1, hw, hl, step);
  if (d) {
    m.mat = stone;
    for (let i = 0; i < 4; i++) box(m, -hw - 1.6 + i * 0.4, hl + 0.0, -0.5, hw + 1.6 - i * 0.4, hl + 1.6 - i * 0.4, step * ((i + 1) / 4), true);
  }
  m.mat = stone;
  const tier = (aisle - step) / storeys;
  const bay = clamp(tier * 0.75, 3.5, 7);
  for (let k = 0; k < storeys; k++) {
    const z0 = step + k * tier;
    const z1 = z0 + tier;
    arcadeAlong(m, -hw, -hl, hw, -hl, z0, z1, bay, d);
    arcadeAlong(m, hw, -hl, hw, hl, z0, z1, bay, d);
    arcadeAlong(m, hw, hl, -hw, hl, z0, z1, bay, d);
    arcadeAlong(m, -hw, hl, -hw, -hl, z0, z1, bay, d);
    if (d) {
      const ring = [-hw, -hl, hw, -hl, hw, hl, -hw, hl];
      band(m, ring, z1 - 0.5, z1, 0.25);
    }
  }
  // The raised nave, its clerestory lit by windows, and a tiled roof over all.
  const nx0 = -hw + depth;
  const nx1 = hw - depth;
  const ny0 = -hl + depth;
  const ny1 = hl - depth;
  const clear = H - roofH;
  m.mat = roofMat(f);
  m.tint = 130;
  leanTo(m, -hw - 0.4, -hl - 0.4, hw + 0.4, hl + 0.4, nx0, ny0, nx1, ny1, aisle, aisle + (clear - aisle) * 0.6);
  m.mat = MAT.facade;
  m.tint = 240;
  box(m, nx0, ny0, aisle, nx1, ny1, clear, false);
  m.mat = roofMat(f);
  m.tint = 130;
  // The ridge along the long side.
  if (nx1 - nx0 >= ny1 - ny0) {
    m.place(plan.box.cx, plan.box.cy, s.base, plan.fy, -plan.fx);
    gable(m, ny0, nx0, ny1, nx1, clear, (ny1 - ny0) * 0.18, 0.5, stone);
    m.place(plan.box.cx, plan.box.cy, s.base, plan.fx, plan.fy);
  } else gable(m, nx0, ny0, nx1, ny1, clear, (nx1 - nx0) * 0.18, 0.5, stone);
}

/** A great vaulted hall: a nave of three groin vaults, three barrel-vaulted bays either side. */
function hall(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const f = s.form;
  const d = ctx.detail;
  const plan = planOf(s.rings, s.at, f.faces, ctx.streetDistance);
  // Its nave runs along the long side of the box.
  const b = plan.box;
  m.place(b.cx, b.cy, s.base, b.ux, b.uy);
  const hl = b.hl;
  const hw = b.hw;
  const H = s.height ?? clamp(hw * 1.0, 18, 40);
  const nave = hw * 0.47;
  const sideH = H * 0.7;
  const bays = f.bays ?? 3;
  const bay = (hl * 2) / bays;
  m.mat = MAT.concrete;
  box(m, -hw, -hl, -1, hw, hl, 1.2);
  m.mat = MAT.brick;
  m.tint = 170;
  // The side bays, each a barrel across the nave.
  for (const side of [-1, 1]) {
    for (let i = 0; i < bays; i++) {
      const y0 = -hl + i * bay;
      const y1 = y0 + bay;
      const xa = side < 0 ? -hw : nave;
      const xb = side < 0 ? -nave : hw;
      box(m, xa, y0 + 0.4, 0, xb, y1 - 0.4, sideH * 0.62, false);
      // Its barrel runs out from the nave, so turn the frame a quarter.
      m.place(b.cx + b.ux * (y0 + y1) * 0.5 + b.uy * ((xa + xb) / 2), b.cy + b.uy * (y0 + y1) * 0.5 - b.ux * ((xa + xb) / 2), s.base, b.uy, -b.ux);
      m.mat = MAT.tile;
      m.tint = 120;
      barrel(m, -bay / 2 + 0.2, -(xb - xa) / 2, bay / 2 - 0.2, (xb - xa) / 2, sideH * 0.62, d ? 10 : 5, sideH * 0.38, MAT.brick);
      m.mat = MAT.brick;
      m.tint = 170;
      m.place(b.cx, b.cy, s.base, b.ux, b.uy);
      if (d) {
        // Arched windows in the outer end.
        const face = side < 0 ? -hw - 0.05 : hw + 0.05;
        m.mat = MAT.dark;
        const wy = (y0 + y1) / 2;
        for (const k of [-1, 0, 1]) {
          const wx = wy + (k * bay) / 3.6;
          if (side < 0) archedWindow(m, face, wx + 1.8, face, wx - 1.8, sideH * 0.3, sideH * 0.58);
          else archedWindow(m, face, wx - 1.8, face, wx + 1.8, sideH * 0.3, sideH * 0.58);
        }
        m.mat = MAT.brick;
      }
    }
  }
  // The nave: tall walls, and vaults crossing over it.
  box(m, -nave, -hl, 0, nave, hl, H * 0.72, false);
  m.mat = MAT.tile;
  m.tint = 120;
  for (let i = 0; i < bays; i++) {
    const y0 = -hl + i * bay;
    m.place(b.cx + b.ux * (y0 + bay / 2), b.cy + b.uy * (y0 + bay / 2), s.base, b.uy, -b.ux);
    barrel(m, -bay / 2, -nave, bay / 2, nave, H * 0.72, d ? 12 : 6, H * 0.28, MAT.brick);
    m.place(b.cx, b.cy, s.base, b.ux, b.uy);
  }
  barrel(m, -nave, -hl - 0.3, nave, hl + 0.3, H * 0.72, d ? 12 : 6, H * 0.28, MAT.brick);
  m.mat = MAT.brick;
  // Great windows in the lunettes the crossing vaults leave above the side bays.
  if (d) {
    for (const x of [-nave - 0.05, nave + 0.05]) {
      for (let i = 0; i < bays; i++) {
        const y = -hl + (i + 0.5) * bay;
        const a = y - bay * 0.42;
        const c = y + bay * 0.42;
        if (x < 0) lunette(m, x, c, x, a, H * 0.73, H * 0.24, 2, MAT.brick);
        else lunette(m, x, a, x, c, H * 0.73, H * 0.24, 2, MAT.brick);
      }
    }
  }
}

// ——— Courts ———

/** A colonnade on a line with its back to the right of it: columns, the beam above them, and a sloping roof to the wall behind. */
function colonnade(m: Mesh, ax: number, ay: number, bx: number, by: number, z: number, ch: number, order: Order, depth: number, d: number, stone: number, f: FormSpec): void {
  const ex = bx - ax;
  const ey = by - ay;
  const l = Math.sqrt(ex * ex + ey * ey);
  if (l < 0.5) return;
  const ux = ex / l;
  const uy = ey / l;
  const nx = uy;
  const ny = -ux;
  const D = ch / DIAMETERS[order];
  const pitch = D * 3.2;
  const n = Math.max(1, Math.round(l / pitch));
  m.mat = stone;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    column(m, ax + ex * t, ay + ey * t, z, ch, D, order, d, shaftMat(f), stone);
  }
  const E = ch * 0.2;
  const top = z + ch;
  // The beam along it.
  wall(m, ax - nx * D, ay - ny * D, bx - nx * D, by - ny * D, top, top + E);
  wall(m, bx + nx * D, by + ny * D, ax + nx * D, ay + ny * D, top, top + E);
  m.quad(m.v(ax - nx * D, ay - ny * D, top, 0, 0, -1, 0, 0), m.v(ax + nx * D, ay + ny * D, top, 0, 0, -1, 0, 1), m.v(bx + nx * D, by + ny * D, top, 0, 0, -1, l, 1), m.v(bx - nx * D, by - ny * D, top, 0, 0, -1, l, 0));
  // Its ceiling and roof, back to the wall.
  const zr = top + E;
  const zb = zr + depth * 0.22;
  const nl = Math.sqrt(1 + 0.22 * 0.22);
  m.light = 0.45;
  m.quad(m.v(ax + nx * depth, ay + ny * depth, top, 0, 0, -1, 0, depth), m.v(bx + nx * depth, by + ny * depth, top, 0, 0, -1, l, depth), m.v(bx, by, top, 0, 0, -1, l, 0), m.v(ax, ay, top, 0, 0, -1, 0, 0));
  m.light = 1;
  m.mat = MAT.tile;
  m.tint = 118;
  const wx = (-nx * 0.22) / nl;
  const wy = (-ny * 0.22) / nl;
  m.quad(m.v(ax - nx * D * 1.2, ay - ny * D * 1.2, zr, wx, wy, 1 / nl, 0, 0), m.v(bx - nx * D * 1.2, by - ny * D * 1.2, zr, wx, wy, 1 / nl, l, 0), m.v(bx + nx * depth, by + ny * depth, zb, wx, wy, 1 / nl, l, depth), m.v(ax + nx * depth, ay + ny * depth, zb, wx, wy, 1 / nl, 0, depth));
  m.mat = stone;
}

/** An open court: paved, and if the form names an order, ringed by a colonnade before a high wall. */
function court(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const f = s.form;
  const d = ctx.detail;
  m.place(0, 0, s.base);
  const rings = s.rings.map(ccw);
  m.mat = MAT.paving;
  m.tint = f.paving === 'marble' ? 230 : 180;
  for (const r of rings) cap(m, r, 0.12, (s.holes ?? []).filter((h) => inside(r, h)));
  const covered = s.kind !== 'open/forum' || f.order || f.wall_height;
  if (!covered) return;
  const order = f.order ?? 'corinthian';
  const ch = f.column_height ?? clamp(Math.sqrt(area(rings[0] ?? [])) * 0.1, 4, 14);
  const depth = clamp(ch * 0.75, 3, 9);
  const stone = stoneOf(s);
  const wallH = f.wall_height ?? ch * 1.6;
  for (const r of rings) {
    const n = r.length / 2;
    // The outer wall, then the columns on a ring set in from it.
    const q = outsetRing(r, -depth);
    m.mat = MAT.travertine;
    // A great wall stands only at the back, away from the way the court faces; the rest is the portico's own.
    const back = f.faces !== undefined ? bearingVector(f.faces) : undefined;
    const usual = Math.min(wallH, ch * 1.7);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const tx = r[j * 2] - r[i * 2];
      const ty = r[j * 2 + 1] - r[i * 2 + 1];
      const l = Math.sqrt(tx * tx + ty * ty);
      const rear = back && wallH > usual && l > 3 && (ty / l) * back[0] + (-tx / l) * back[1] < -0.6;
      const h = rear ? wallH : usual;
      wall(m, r[i * 2], r[i * 2 + 1], r[j * 2], r[j * 2 + 1], -0.5, h);
      wall(m, r[j * 2], r[j * 2 + 1], r[i * 2], r[i * 2 + 1], 0, h);
      if (l < 3) continue;
      colonnade(m, q[j * 2], q[j * 2 + 1], q[i * 2], q[i * 2 + 1], 0.12, ch, order, depth, d, stone, f);
      m.mat = MAT.travertine;
      m.quad(m.v(r[i * 2], r[i * 2 + 1], h, 0, 0, 1, 0, 0), m.v(r[j * 2], r[j * 2 + 1], h, 0, 0, 1, l, 0), m.v(r[j * 2] - (ty / l) * 0.8, r[j * 2 + 1] + (tx / l) * 0.8, h, 0, 0, 1, l, 1), m.v(r[i * 2] - (ty / l) * 0.8, r[i * 2 + 1] + (tx / l) * 0.8, h, 0, 0, 1, 0, 1));
    }
  }
}

function inside(r: Poly, hole: Poly): boolean {
  const [x, y] = centroid(hole);
  let c = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = r[i * 2 + 1];
    const yj = r[j * 2 + 1];
    if (yi > y !== yj > y && x < ((r[j * 2] - r[i * 2]) * (y - yi)) / (yj - yi) + r[i * 2]) c = !c;
  }
  return c;
}

// ——— Places of spectacle ———

/** Points of an ellipse, and each one's outward normal, counter-clockwise. */
function ellipse(a: number, b: number, n: number): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (TAU * i) / n;
    x.push(dcos(t) * a);
    y.push(dsin(t) * b);
  }
  return { x, y };
}

function amphitheatre(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const f = s.form;
  const d = ctx.detail;
  const b = minBox(s.rings.flat().length ? s.rings.flat() : [s.at[0] - 40, s.at[1] - 30, s.at[0] + 40, s.at[1] + 30]);
  m.place(b.cx, b.cy, s.base, -b.uy, b.ux);
  // In this frame the long axis is +x.
  const a0 = b.hl;
  const b0 = b.hw;
  const H = s.height ?? clamp(a0 * 0.5, 12, 50);
  const tiers = f.tiers ?? 3;
  const attic = f.attic ?? (H > 40);
  const bays = f.bays ?? clamp(Math.round((a0 + b0) * PI / 7.4), 16, 96) & ~1;
  const stone = MAT.travertine;
  const atticH = attic ? H * 0.28 : 0;
  const tierH = (H - atticH) / tiers;
  const out = ellipse(a0, b0, bays);
  const inner = ellipse(a0 - tierH * 0.42, b0 - tierH * 0.42, bays);
  const order: Order[] = ['tuscan', 'ionic', 'corinthian'];
  m.mat = stone;
  m.tint = 170;
  for (let k = 0; k < tiers; k++) {
    const z0 = k * tierH;
    const z1 = z0 + tierH;
    for (let i = 0; i < bays; i++) {
      // Going anticlockwise, so the outside is on the right.
      const x0 = out.x[i];
      const y0 = out.y[i];
      const x1 = out.x[i + 1];
      const y1 = out.y[i + 1];
      arcadeBay(m, x0, y0, x1, y1, z0 - (k === 0 ? 1 : 0), z1, tierH * 0.46, Math.hypot(x1 - x0, y1 - y0) * 0.19, d ? 3.2 : 0, d, 6);
      if (d) {
        // A half-column on the pier, in the order of its storey.
        const cx = x1;
        const cy = y1;
        const len = Math.sqrt(cx * cx / (a0 * a0) + cy * cy / (b0 * b0)) || 1;
        const ox = (cx / (a0 * a0) / len) * a0;
        const oy = (cy / (b0 * b0) / len) * b0;
        const ol = Math.sqrt(ox * ox + oy * oy) || 1;
        column(m, cx + (ox / ol) * 0.22, cy + (oy / ol) * 0.22, z0, tierH - tierH * 0.12, tierH * 0.075, order[Math.min(k, 2)], 1, stone, stone);
      }
    }
    // The cornice over the storey.
    const ring: Poly = [];
    for (let i = 0; i < bays; i++) ring.push(out.x[i], out.y[i]);
    band(m, ring, z1 - tierH * 0.12, z1, d ? 0.42 : 0.2);
  }
  // The attic, solid, with pilasters and windows.
  const zAttic = tiers * tierH;
  const ringOut: Poly = [];
  const ringIn: Poly = [];
  for (let i = 0; i < bays; i++) {
    ringOut.push(out.x[i], out.y[i]);
    ringIn.push(inner.x[i], inner.y[i]);
  }
  if (attic) {
    prism(m, ringOut, zAttic, H, false);
    if (d) {
      m.mat = MAT.dark;
      for (let i = 0; i < bays; i += 2) {
        const x0 = mix(out.x[i + 1], out.x[i], 0.35);
        const y0 = mix(out.y[i + 1], out.y[i], 0.35);
        const x1 = mix(out.x[i + 1], out.x[i], 0.65);
        const y1 = mix(out.y[i + 1], out.y[i], 0.65);
        const l = 1.004;
        wall(m, x0 * l, y0 * l, x1 * l, y1 * l, zAttic + atticH * 0.42, zAttic + atticH * 0.72);
      }
      m.mat = stone;
      for (let i = 0; i < bays; i++) {
        const x = out.x[i];
        const y = out.y[i];
        lathe(m, x, y, [[0.5, zAttic], [0.42, H - atticH * 0.1]], 4);
      }
      // The masts of the awning.
      for (let i = 0; i < bays; i += 2) lathe(m, out.x[i] * 0.995, out.y[i] * 0.995, [[0.14, H], [0.1, H + 7]], 4);
    }
    band(m, ringOut, H - atticH * 0.12, H, 0.5);
  }
  m.mat = stone;
  // Inner face of the outer wall: a colonnade at the top in travertine.
  {
    const x = ringOut;
    const q = ringIn;
    const n = x.length / 2;
    const zt = attic ? H : tiers * tierH;
    const zb = zt - tierH * 0.55;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      // top of wall
      m.quad(m.v(x[i * 2], x[i * 2 + 1], zt, 0, 0, 1, 0, 0), m.v(x[j * 2], x[j * 2 + 1], zt, 0, 0, 1, 1, 0), m.v(q[j * 2], q[j * 2 + 1], zt, 0, 0, 1, 1, 1), m.v(q[i * 2], q[i * 2 + 1], zt, 0, 0, 1, 0, 1));
      // the wall's inside face
      wall(m, q[i * 2], q[i * 2 + 1], q[j * 2], q[j * 2 + 1], zb, zt);
    }
  }
  // The seats: rows stepping down to the arena.
  const arenaA = f.arena_length ? f.arena_length / 2 : a0 * 0.46;
  const arenaB = f.arena_width ? f.arena_width / 2 : b0 * 0.36;
  const podium = clamp(H * 0.08, 2, 4);
  const zTop = (attic ? H : tiers * tierH) - tierH * 0.55;
  const rows = d ? 14 : 5;
  const segs = d ? 72 : 28;
  const qa = a0 - tierH * 0.42;
  const qb = b0 - tierH * 0.42;
  m.mat = MAT.seats;
  m.tint = 190;
  let row0 = ellipse(qa, qb, segs);
  for (let r = 0; r < rows; r++) {
    const t1 = (r + 1) / rows;
    const z0 = mix(zTop, podium, r / rows);
    const z1 = mix(zTop, podium, t1);
    const next = ellipse(mix(qa, arenaA, t1), mix(qb, arenaB, t1), segs);
    for (let i = 0; i < segs; i++) {
      // The tread, then the riser below its inner edge.
      const j = i + 1;
      const l = 0.75;
      m.light = l;
      m.quad(m.v(row0.x[i], row0.y[i], z0, 0, 0, 1, i * 3, r), m.v(next.x[i], next.y[i], z0, 0, 0, 1, i * 3, r + 1), m.v(next.x[j], next.y[j], z0, 0, 0, 1, j * 3, r + 1), m.v(row0.x[j], row0.y[j], z0, 0, 0, 1, j * 3, r));
      const nx = -next.x[i];
      const ny = -next.y[i];
      const nl = Math.sqrt(nx * nx + ny * ny) || 1;
      m.quad(m.v(next.x[i], next.y[i], z0, nx / nl, ny / nl, 0, i * 3, r + 0.5), m.v(next.x[i], next.y[i], z1, nx / nl, ny / nl, 0, i * 3, r + 1), m.v(next.x[j], next.y[j], z1, nx / nl, ny / nl, 0, j * 3, r + 1), m.v(next.x[j], next.y[j], z0, nx / nl, ny / nl, 0, j * 3, r + 0.5));
      m.light = 1;
    }
    row0 = next;
  }
  // The arena, its wall, and the sand.
  m.mat = MAT.marble;
  const ae = ellipse(arenaA, arenaB, segs);
  for (let i = 0; i < segs; i++) {
    const nx = -ae.x[i];
    const ny = -ae.y[i];
    const nl = Math.sqrt(nx * nx + ny * ny) || 1;
    m.quad(m.v(ae.x[i], ae.y[i], 0, nx / nl, ny / nl, 0, i, 0), m.v(ae.x[i], ae.y[i], podium, nx / nl, ny / nl, 0, i, podium), m.v(ae.x[i + 1], ae.y[i + 1], podium, nx / nl, ny / nl, 0, i + 1, podium), m.v(ae.x[i + 1], ae.y[i + 1], 0, nx / nl, ny / nl, 0, i + 1, 0));
  }
  m.mat = MAT.sand;
  const sand: Poly = [];
  for (let i = 0; i < segs; i++) sand.push(ae.x[i], ae.y[i]);
  cap(m, sand, 0.15);
}

/** A half-round of seating facing +y, with its stage building: a theatre or an odeon. */
function theatre(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const f = s.form;
  const d = ctx.detail;
  const plan = placeBy(m, s, ctx, f.faces, true);
  const hw = Math.max(plan.hw, 6);
  const hl = Math.max(plan.hl, 4);
  const R = hw;
  const cy = hl - R * 0.42;
  const H = s.height ?? clamp(R * 0.62, 10, 34);
  const tiers = f.tiers ?? (R > 35 ? 3 : 2);
  const tierH = H / tiers;
  const bays = f.bays ?? clamp(Math.round((PI * R) / 6), 12, 48);
  const stone = MAT.travertine;
  m.mat = stone;
  m.tint = 175;
  const ox: number[] = [];
  const oy: number[] = [];
  // The curve runs behind: from east, round the back, to west.
  for (let i = 0; i <= bays; i++) {
    const t = PI + (PI * i) / bays;
    ox.push(dcos(t) * R);
    oy.push(cy + dsin(t) * Math.min(R, hl + cy));
  }
  for (let k = 0; k < tiers; k++) {
    const z0 = k * tierH;
    const z1 = z0 + tierH;
    for (let i = 0; i < bays; i++) arcadeBay(m, ox[i], oy[i], ox[i + 1], oy[i + 1], z0 - (k ? 0 : 1), z1, tierH * 0.56, 0.9, d ? 2.8 : 0, d, 6);
    if (d) {
      const line: Poly = [];
      for (let i = 0; i <= bays; i++) line.push(ox[i], oy[i]);
      for (let i = 0; i < bays; i++) {
        const nx = (oy[i + 1] - oy[i]);
        const ny = -(ox[i + 1] - ox[i]);
        const nl = Math.sqrt(nx * nx + ny * ny) || 1;
        wall(m, ox[i] + (nx / nl) * 0.3, oy[i] + (ny / nl) * 0.3, ox[i + 1] + (nx / nl) * 0.3, oy[i + 1] + (ny / nl) * 0.3, z1 - tierH * 0.1, z1);
      }
    }
  }
  // The cavea, rows falling from the back to the orchestra.
  const rows = d ? 12 : 4;
  const segs = d ? 36 : 16;
  const ro = R * 0.26;
  m.mat = MAT.seats;
  m.tint = 195;
  const curve = (rad: number, i: number): [number, number] => {
    const t = PI + (PI * i) / segs;
    return [dcos(t) * rad, cy + dsin(t) * rad * (Math.min(R, hl + cy) / R)];
  };
  for (let r = 0; r < rows; r++) {
    const r0 = mix(R - 1, ro, r / rows);
    const r1 = mix(R - 1, ro, (r + 1) / rows);
    const z0 = mix(H, 0.8, r / rows);
    const z1 = mix(H, 0.8, (r + 1) / rows);
    for (let i = 0; i < segs; i++) {
      const [a, b] = curve(r0, i);
      const [c, e] = curve(r0, i + 1);
      const [g, h] = curve(r1, i + 1);
      const [o, p] = curve(r1, i);
      m.light = 0.8;
      m.quad(m.v(a, b, z0, 0, 0, 1, i * 3, r), m.v(o, p, z0, 0, 0, 1, i * 3, r + 1), m.v(g, h, z0, 0, 0, 1, (i + 1) * 3, r + 1), m.v(c, e, z0, 0, 0, 1, (i + 1) * 3, r));
      const nx = -(o);
      const ny = cy - p;
      const nl = Math.sqrt(nx * nx + ny * ny) || 1;
      m.quad(m.v(o, p, z0, nx / nl, ny / nl, 0, i * 3, r + 1), m.v(o, p, z1, nx / nl, ny / nl, 0, i * 3, r + 1.5), m.v(g, h, z1, nx / nl, ny / nl, 0, (i + 1) * 3, r + 1.5), m.v(g, h, z0, nx / nl, ny / nl, 0, (i + 1) * 3, r + 1));
      m.light = 1;
    }
  }
  // The orchestra.
  m.mat = MAT.marble;
  disc(m, 0, cy, ro, 0.8, segs);
  // The stage building across the front, as tall as the seats.
  const stageDepth = clamp(R * 0.2, 4, 14);
  const y0 = cy + ro * 0.5;
  const y1 = Math.min(y0 + stageDepth, hl);
  const SH = f.stage_height ?? H;
  m.mat = stone;
  box(m, -R, y0, -1, R, y1, SH);
  if (d) {
    const k = Math.max(1, tiers - 1);
    for (let i = 0; i < k; i++) arcadeAlong(m, R, y1 + 0.02, -R, y1 + 0.02, (i * SH) / k, ((i + 1) * SH) / k, 5.5, 1, 0.6);
  }
  m.mat = MAT.marble;
  // The stage's columned front, facing the seats.
  if (d) {
    const zs = 1.4;
    const ch = (SH - zs) / 3.4;
    const D = ch / 9;
    for (let k = 0; k < 3; k++) for (let i = 0; i <= 8; i++) column(m, -R * 0.82 + (R * 1.64 * i) / 8, y0 - 0.9, zs + k * ch * 1.12, ch, D, 'corinthian', 1, MAT.granite, MAT.marble);
    for (let k = 1; k <= 3; k++) box(m, -R * 0.85, y0 - 1.3, zs + k * ch * 1.12 - ch * 0.12, R * 0.85, y0, zs + k * ch * 1.12, true, true);
  }
  m.mat = MAT.tile;
  m.tint = 125;
  gable(m, -R, y0, R, y1, SH, Math.min(R, (y1 - y0)) * 0.22, 0.4, MAT.travertine);
}

/** A course for chariots, or a stadium for runners: a long U of seating with a curved end. */
function circus(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const f = s.form;
  const d = ctx.detail;
  const plan = placeBy(m, s, ctx, f.faces);
  const hw = Math.max(plan.hw, 6);
  const hl = Math.max(plan.hl, 12);
  // +y is the open end, where the starting gates stand; the curve is at −y.
  const H = s.height ?? clamp(hw * 0.36, 7, 30);
  const tiers = f.tiers ?? (H > 20 ? 3 : 2);
  const tierH = H / tiers;
  const stand = clamp(hw * 0.32, 5, 34);
  const cy = -hl + hw;
  const segsEnd = d ? 24 : 12;
  // A path from the open end down one side, round the curve, back up the other, on the outside.
  const pts: number[] = [];
  pts.push(hw, hl);
  for (let i = 0; i <= segsEnd; i++) {
    const t = (PI * i) / segsEnd;
    pts.push(dcos(t) * hw, cy - dsin(t) * hw);
  }
  pts.push(-hw, hl);
  // Walk it so the outside is on the right: −x side first going down would have outside on the left.
  const rev: number[] = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) rev.push(pts[i], pts[i + 1]);
  m.mat = MAT.travertine;
  m.tint = 170;
  const n = rev.length / 2;
  const bay = clamp(tierH * 0.9, 3.5, 8);
  for (let k = 0; k < tiers; k++) {
    const z0 = k * tierH;
    const z1 = z0 + tierH;
    for (let i = 0; i < n - 1; i++) arcadeAlong(m, rev[i * 2], rev[i * 2 + 1], rev[i * 2 + 2], rev[i * 2 + 3], z0 - (k ? 0 : 1), z1, bay, d, d ? 2 : 0);
  }
  // The seats, sloping inward: on each side and round the curve.
  const inner: number[] = [];
  const rI = hw - stand;
  inner.push(-rI, hl);
  inner.push(-rI, cy);
  for (let i = 1; i < segsEnd; i++) {
    const t = PI - (PI * i) / segsEnd;
    inner.push(dcos(t) * rI, cy - dsin(t) * rI);
  }
  inner.push(rI, cy);
  inner.push(rI, hl);
  const outer: number[] = [];
  outer.push(-hw, hl);
  outer.push(-hw, cy);
  for (let i = 1; i < segsEnd; i++) {
    const t = PI - (PI * i) / segsEnd;
    outer.push(dcos(t) * hw, cy - dsin(t) * hw);
  }
  outer.push(hw, cy);
  outer.push(hw, hl);
  const rows = d ? 9 : 3;
  const m0 = inner.length / 2;
  m.mat = MAT.seats;
  m.tint = 180;
  const wallTop = clamp(H * 0.14, 1.5, 4);
  for (let r = 0; r < rows; r++) {
    const a = r / rows;
    const b = (r + 1) / rows;
    const za = mix(H, wallTop, a);
    const zb = mix(H, wallTop, b);
    for (let i = 0; i < m0 - 1; i++) {
      const p = (t: number, k: number): [number, number] => [mix(outer[k * 2], inner[k * 2], t), mix(outer[k * 2 + 1], inner[k * 2 + 1], t)];
      const [x0, y0] = p(a, i);
      const [x1, y1] = p(a, i + 1);
      const [x2, y2] = p(b, i + 1);
      const [x3, y3] = p(b, i);
      const len = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
      m.light = 0.8;
      m.quad(m.v(x0, y0, za, 0, 0, 1, 0, r), m.v(x3, y3, za, 0, 0, 1, 0, r + 1), m.v(x2, y2, za, 0, 0, 1, len, r + 1), m.v(x1, y1, za, 0, 0, 1, len, r));
      const nx = -(y2 - y3);
      const ny = x2 - x3;
      const nl = Math.sqrt(nx * nx + ny * ny) || 1;
      m.quad(m.v(x3, y3, za, nx / nl, ny / nl, 0, 0, r + 1), m.v(x3, y3, zb, nx / nl, ny / nl, 0, 0, r + 1.4), m.v(x2, y2, zb, nx / nl, ny / nl, 0, len, r + 1.4), m.v(x2, y2, za, nx / nl, ny / nl, 0, len, r + 1));
      m.light = 1;
    }
  }
  // The track.
  m.mat = MAT.sand;
  const track: Poly = [];
  for (let i = 0; i < m0; i++) track.push(inner[i * 2], inner[i * 2 + 1]);
  cap(m, track, 0.1);
  // Wall round the track.
  m.mat = MAT.marble;
  for (let i = 0; i < m0 - 1; i++) wall(m, inner[i * 2], inner[i * 2 + 1], inner[i * 2 + 2], inner[i * 2 + 3], 0, wallTop);
  // The spine, with its turning posts.
  if (f.spina ?? hl > 180) {
    const sh = (hl - hw) * 0.42 + hw * 0.1;
    const sy = -hl + hw + (hl * 2 - hw * 1.4) / 2;
    const sw = clamp(hw * 0.05, 2, 5);
    m.mat = MAT.marble;
    box(m, -sw, sy - sh, 0, sw, sy + sh, 1.8);
    m.mat = MAT.statue;
    for (const e of [-1, 1]) for (const dx of [-1, 0, 1]) lathe(m, dx * sw * 0.55, sy + e * (sh + 3), [[0.9, 0], [0.8, 3.2], [0.1, 6.5]], 6);
    m.mat = MAT.granite;
    obeliskAt(m, 0, sy, 1.8, 23.7, 2.4, d);
    if (d) {
      m.mat = MAT.bronze;
      for (let i = 0; i < 5; i++) figure(m, 0, sy + (sh * (i - 2.0)) / 2.2 + sh * 0.05 + 8, 1.8, 3, 1);
    }
  }
  // The starting gates across the open end.
  if (!f.open_end) {
    m.mat = MAT.travertine;
    box(m, -hw, hl - 7, -1, hw, hl, H * 0.55);
    if (d) {
      m.mat = MAT.dark;
      const k = 12;
      for (let i = 0; i < k; i++) {
        const x0 = -hw * 0.9 + (i * hw * 1.8) / k + 0.8;
        const x1 = x0 + (hw * 1.8) / k - 1.6;
        wall(m, x1, hl - 7.05, x0, hl - 7.05, 0, H * 0.32);
      }
    }
    m.mat = MAT.tile;
    m.tint = 125;
    gable(m, -hw, hl - 7, hw, hl, H * 0.55, 1.2, 0.3, MAT.travertine);
  }
}

// ——— Baths ———

function baths(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const f = s.form;
  const d = ctx.detail;
  const plan = placeBy(m, s, ctx, f.faces);
  const hw = Math.max(plan.hw, 4);
  const hl = Math.max(plan.hl, 4);
  if (hw < 18 || hl < 18) return generic(m, s, ctx);
  // A great precinct, if the footprint is large, with the bath block in its middle.
  const large = hw > 90;
  const pw = large ? hw : 0;
  const pl = large ? hl : 0;
  const stone = MAT.travertine;
  if (large) {
    m.mat = MAT.brick;
    m.tint = 165;
    const wh = 8;
    for (const [a, b, c, e] of [[-pw, -pl, pw, -pl], [pw, -pl, pw, pl], [pw, pl, -pw, pl], [-pw, pl, -pw, -pl]] as const) {
      arcadeAlong(m, a, b, c, e, -1, wh, 6.5, d, 1.5);
      wall(m, c, e, a, b, 0, wh);
    }
    band(m, [-pw, -pl, pw, -pl, pw, pl, -pw, pl], wh, wh + 0.5, 0.25);
    // Great exedrae on the flanks.
    m.mat = stone;
    for (const side of [-1, 1]) {
      const R = pl * 0.28;
      m.mat = MAT.brick;
      m.tint = 165;
      const a0 = side < 0 ? PI / 2 : -PI / 2;
      const a1 = side < 0 ? (3 * PI) / 2 : PI / 2;
      lathe(m, side * pw, 0, [[R, -1], [R, 11]], d ? 28 : 12, false, a0, a1);
      m.mat = MAT.tile;
      m.tint = 120;
      lathe(m, side * pw, 0, [[R + 0.3, 11], [R * 0.72, 11 + R * 0.26], [0.1, 11 + R * 0.36]], d ? 28 : 12, false, a0, a1);
    }
    m.mat = MAT.grass;
    m.tint = 110;
    cap(m, [-pw + 1, -pl + 1, pw - 1, -pl + 1, pw - 1, pl - 1, -pw + 1, pl - 1], 0.25);
  }
  // The bath block.
  const bw = large ? hw * 0.62 : hw * 0.98;
  const bl = large ? hl * 0.52 : hl * 0.98;
  const by = large ? hl * 0.08 : 0;
  const H = s.height ?? (large ? 36 : clamp(bl * 0.5, 12, 26));
  m.mat = MAT.paving;
  m.tint = 180;
  cap(m, [-bw - 4, by - bl - 4, bw + 4, by - bl - 4, bw + 4, by + bl + 4, -bw - 4, by + bl + 4], 0.3);
  // Low ranges all around.
  const low = H * 0.42;
  m.mat = MAT.brick;
  m.tint = 175;
  for (const [a, b, c, e] of [[-bw, by - bl, bw, by - bl], [bw, by - bl, bw, by + bl], [bw, by + bl, -bw, by + bl], [-bw, by + bl, -bw, by - bl]] as const) arcadeAlong(m, a, b, c, e, 0, low, 7.5, d, 1.8);
  // Its roofs, around the courts: the palaestrae either side, open to the sky.
  const courtIn = bw * 0.42;
  const courtOut = bw * 0.88;
  const courtL = bl * 0.55;
  m.mat = MAT.tile;
  m.tint = 122;
  for (const [x0, y0, x1, y1] of [
    [-bw, by + courtL, bw, by + bl],
    [-bw, by - bl, bw, by - courtL],
    [-bw, by - courtL, -courtOut, by + courtL],
    [courtOut, by - courtL, bw, by + courtL],
    [-courtIn, by - courtL, courtIn, by + courtL],
  ]) {
    hip(m, [x0, y0, x1, y0, x1, y1, x0, y1], low, 0.2, 0.3);
  }
  m.mat = MAT.brick;
  m.tint = 175;
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? -courtOut : courtIn;
    const x1 = side < 0 ? -courtIn : courtOut;
    // Walking the court so that its inside is on the right.
    for (const [a, b, c, e] of [[x0, by - courtL, x0, by + courtL], [x0, by + courtL, x1, by + courtL], [x1, by + courtL, x1, by - courtL], [x1, by - courtL, x0, by - courtL]] as const) arcadeAlong(m, a, b, c, e, 0, low, 5, d, 1.2);
  }
  m.mat = MAT.paving;
  m.tint = 195;
  for (const side of [-1, 1]) {
    const cx0 = side * courtIn;
    const cx1 = side * courtOut;
    cap(m, side < 0 ? [cx1, by - bl * 0.55, cx0, by - bl * 0.55, cx0, by + bl * 0.55, cx1, by + bl * 0.55] : [cx0, by - bl * 0.55, cx1, by - bl * 0.55, cx1, by + bl * 0.55, cx0, by + bl * 0.55], low + 0.05);
    if (d) {
      m.mat = MAT.marble;
      const n = 8;
      const ch = Math.min(low * 0.8, 9);
      for (let i = 0; i <= n; i++) {
        const cx = cx0 + (cx1 - cx0) * (0.05 + 0.9 * (i / n));
        column(m, cx, by - courtL + 3, 0.3, ch, ch * 0.055, 'corinthian', 1, MAT.granite, MAT.marble);
        column(m, cx, by + courtL - 3, 0.3, ch, ch * 0.055, 'corinthian', 1, MAT.granite, MAT.marble);
      }
      m.mat = MAT.paving;
    }
  }
  // The great hall across the middle, under three cross vaults.
  const fw = bw * 0.42;
  const fl = bl * 0.42;
  m.mat = MAT.brick;
  m.tint = 180;
  box(m, -fw, by - fl, low, fw, by + fl, H * 0.78, false);
  m.mat = MAT.tile;
  m.tint = 118;
  m.place(plan.box.cx + plan.fx * by, plan.box.cy + plan.fy * by, s.base, plan.fy, -plan.fx);
  barrel(m, -fl, -fw, fl, fw, H * 0.78, d ? 12 : 6, H * 0.22, MAT.brick);
  m.place(plan.box.cx, plan.box.cy, s.base, plan.fx, plan.fy);
  const cross = fl * 0.6;
  for (const k of [-1, 0, 1]) barrel(m, k * fw * 0.66 - cross * 0.8, by - fl - 0.3, k * fw * 0.66 + cross * 0.8, by + fl + 0.3, H * 0.78, d ? 12 : 6, H * 0.22, MAT.brick);
  if (d) {
    // A thermal window in the end of each vault.
    for (const k of [-1, 0, 1]) {
      const x0 = k * fw * 0.66 - cross * 0.72;
      const x1 = k * fw * 0.66 + cross * 0.72;
      lunette(m, x1, by + fl + 0.32, x0, by + fl + 0.32, H * 0.78 + 0.1, H * 0.195, 2, MAT.brick);
      lunette(m, x0, by - fl - 0.32, x1, by - fl - 0.32, H * 0.78 + 0.1, H * 0.195, 2, MAT.brick);
    }
  }
  // The hot room: a rotunda on the garden side, with a dome.
  if (f.rotunda ?? hw > 150) {
    const R = Math.min(bl * 0.34, 20);
    const cy = by - bl - R * 0.45;
    m.mat = MAT.brick;
    m.tint = 180;
    lathe(m, 0, cy, [[R, 0], [R, H * 0.68]], d ? 32 : 14);
    if (d) {
      m.mat = MAT.dark;
      for (let i = 0; i < 8; i++) {
        const t = -PI / 2 + ((i - 3.5) * PI) / 7.5;
        const a = 0.09;
        const c1 = dcos(t + a);
        const e1 = dsin(t + a);
        const c0 = dcos(t - a);
        const e0 = dsin(t - a);
        wall(m, c0 * (R + 0.08), cy + e0 * (R + 0.08), c1 * (R + 0.08), cy + e1 * (R + 0.08), H * 0.32, H * 0.6);
      }
    }
    m.mat = MAT.lead;
    dome(m, 0, cy, R, H * 0.68, d ? 28 : 12, d ? 8 : 4);
  }
}

// ——— Round buildings ———

/** The drum, the dome and the columned porch. Everything from the claims, or by Roman proportion. */
function rotunda(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const f = s.form;
  const d = ctx.detail;
  const plan = placeBy(m, s, ctx, f.faces);
  // The drum stands at the back of the footprint.
  const hw = Math.max(plan.hw, 3);
  const hl = Math.max(plan.hl, 3);
  const diam = f.diameter ?? Math.min(hw, hl) * 2 * 0.88;
  const wallT = diam * 0.14;
  const Rout = diam / 2 + wallT;
  const porch = f.porch_front !== undefined;
  const cy = porch ? -hl + Rout : 0;
  const H = s.height ?? diam * 1.0;
  const drum = f.drum_height ?? H * 0.5;
  const stone = MAT.travertine;
  const seg = d ? 48 : 18;
  m.mat = MAT.brick;
  m.tint = 180;
  lathe(m, 0, cy, [[Rout, -1], [Rout, drum]], seg);
  if (d) {
    m.mat = stone;
    for (const k of [0.34, 0.66, 1]) lathe(m, 0, cy, [[Rout, drum * k - 0.9], [Rout + 0.35, drum * k - 0.6], [Rout + 0.35, drum * k - 0.15], [Rout, drum * k]], seg);
    disc(m, 0, cy, Rout + 0.35, drum, seg);
  }
  // The dome: steps at its haunch, smooth above.
  m.mat = roofMat({ ...f, roof: f.roof ?? 'lead' });
  m.tint = 140;
  const zb = drum;
  const domeTop = H - zb;
  if (d) {
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const r0 = Rout - i * (wallT * 0.75) / steps;
      const z0 = zb + i * (domeTop * 0.32) / steps;
      lathe(m, 0, cy, [[r0, z0], [r0, z0 + (domeTop * 0.32) / steps], [r0 - (wallT * 0.75) / steps, z0 + (domeTop * 0.32) / steps]], seg);
    }
  }
  const oculus = (f.oculus ?? diam * 0.19) / 2;
  const zRing = zb + domeTop * (d ? 0.32 : 0);
  const profile: number[][] = [];
  const startR = d ? Rout - wallT * 0.75 : Rout;
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * (PI / 2);
    const rr = dcos(a) * startR;
    const zz = zRing + dsin(a) * (H - zRing);
    if (rr < oculus) {
      profile.push([oculus, zz]);
      break;
    }
    profile.push([rr, zz]);
  }
  lathe(m, 0, cy, profile, seg, true);
  m.mat = MAT.statue;
  const lastZ = profile[profile.length - 1][1];
  lathe(m, 0, cy, [[oculus + 0.7, lastZ - 0.2], [oculus + 0.7, lastZ + 0.5], [oculus, lastZ + 0.5]], seg);
  m.mat = MAT.dark;
  disc(m, 0, cy, oculus, lastZ + 0.45, seg);
  // The porch.
  if (porch) {
    const front = f.porch_front!;
    const order = f.order ?? 'corinthian';
    const ch = f.column_height ?? (front >= 8 ? diam * 0.33 : diam * 0.3);
    const D = ch / DIAMETERS[order];
    const span = D * (front * 3 - 2);
    const podium = 1.3;
    const yFront = hl - podium * 1.4;
    const yBack = cy + Rout * 0.72;
    const y1 = Math.max(yFront, yBack + D * 6);
    const pitch = span / (front - 1);
    m.mat = stone;
    box(m, -span / 2 - D, yBack, -1, span / 2 + D, y1 + D, podium);
    m.mat = MAT.marble;
    if (d) for (let i = 0; i < 5; i++) box(m, -span / 2 - D, y1 + D + i * 0.32, -0.6, span / 2 + D, y1 + D + (i + 1) * 0.32, podium * (1 - i / 5), true);
    const sm = f.order === undefined ? MAT.granite : MAT.granite;
    for (let i = 0; i < front; i++) column(m, -span / 2 + i * pitch, y1, podium, ch, D, order, d, sm, MAT.marble);
    for (const row of [1, 2]) {
      for (const i of [0, front - 1]) column(m, -span / 2 + i * pitch, y1 - row * pitch, podium, ch, D, order, d, sm, MAT.marble);
    }
    // The block joining it to the drum, and the entablature and pediment.
    m.mat = MAT.brick;
    m.tint = 180;
    box(m, -span / 2, yBack - Rout * 0.15, podium, span / 2, y1 - 2.4 * pitch, podium + ch * 1.28, false);
    m.mat = MAT.marble;
    const top = podium + ch;
    const E = ch * 0.24;
    box(m, -span / 2 - D, yBack, top, span / 2 + D, y1 + D, top + E, true, true);
    m.mat = MAT.bronze;
    m.tint = 110;
    gable(m, -span / 2 - D, yBack, span / 2 + D, y1 + D, top + E, (span / 2 + D) * 0.3, 0.3, MAT.marble);
  }
}

function mausoleum(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const f = s.form;
  const d = ctx.detail;
  const plan = placeBy(m, s, ctx, f.faces);
  const hw = Math.max(plan.hw, 2);
  const hl = Math.max(plan.hl, 2);
  const round = hw / hl > 0.82 && s.rings.length > 0 && (s.rings[0].length >= 24 || f.drum_height !== undefined);
  const stone = MAT.travertine;
  if (!round) {
    // A small tomb: a block with a cornice, on a plinth.
    const H = s.height ?? clamp(hw * 1.5, 3, 12);
    m.mat = stone;
    m.tint = 160;
    box(m, -hw, -hl, -1, hw, hl, H * 0.25);
    m.mat = MAT.marble;
    box(m, -hw * 0.9, -hl * 0.9, H * 0.25, hw * 0.9, hl * 0.9, H * 0.9, false);
    box(m, -hw * 0.97, -hl * 0.97, H * 0.9, hw * 0.97, hl * 0.97, H, true);
    return;
  }
  const R = Math.min(hw, hl);
  const drumH = f.drum_height ?? clamp(R * 0.3, 4, 22);
  const moundH = f.mound_height ?? R * 0.5;
  const seg = d ? 48 : 18;
  m.mat = stone;
  m.tint = 190;
  lathe(m, 0, 0, [[R, -1], [R, drumH]], seg);
  if (d) {
    m.mat = MAT.marble;
    lathe(m, 0, 0, [[R, drumH - 1], [R + 0.35, drumH - 0.7], [R + 0.35, drumH]], seg);
  }
  m.mat = MAT.earth;
  m.tint = 110;
  const zt = drumH + moundH;
  lathe(m, 0, 0, [[R + 0.2, drumH], [R * 0.75, drumH + moundH * 0.3], [R * 0.32, drumH + moundH * 0.86]], seg);
  // Cypresses on the mound.
  if (d) {
    const rng = new Rng(hashString(s.id));
    m.mat = MAT.leaf;
    for (let i = 0; i < 26; i++) {
      const a = rng.range(0, TAU);
      const r = rng.range(R * 0.36, R * 0.85);
      const z = mix(drumH + moundH * 0.86, drumH, (r - R * 0.32) / (R * 0.7));
      tree(m, dcos(a) * r, dsin(a) * r, z - 0.3, 1, rng.range(6, 10), 1, rng.int(0, 255));
    }
  }
  // A drum on top, and a statue on it.
  m.mat = stone;
  m.tint = 190;
  lathe(m, 0, 0, [[R * 0.32, drumH + moundH * 0.85], [R * 0.32, zt + R * 0.06]], d ? 24 : 10);
  disc(m, 0, 0, R * 0.32, zt + R * 0.06, d ? 24 : 10);
  m.mat = MAT.bronze;
  figure(m, 0, 0, zt + R * 0.06, clamp(R * 0.14, 3, 8), d);
}

// ——— Monuments ———

function arch(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const f = s.form;
  const d = ctx.detail;
  const plan = placeBy(m, s, ctx, f.faces, true);
  const W = f.width ?? Math.max(plan.hw * 2, 5);
  const D = f.depth ?? Math.max(plan.hl * 2, 2.5);
  if (D > W * 1.1) return generic(m, s, ctx);
  const hw = W / 2;
  const hd = D / 2;
  const H = s.height ?? W * 0.85;
  const atticH = f.attic_height ?? H * 0.3;
  const zt = H - atticH;
  const bays = f.bays ?? (W > 18 ? 3 : 1);
  const stone = MAT.marble;
  const mainW = bays === 3 ? W * 0.26 : W * 0.46;
  const sideW = W * 0.13;
  const seg = (a: number, b: number, open: number, spring: number) => {
    // Front and back faces, each with an arch that runs through to the middle.
    arcadeBay(m, b, hd, a, hd, 0, zt, spring, (Math.abs(b - a) - open) / 2, hd, d, d ? 8 : 4, false);
    arcadeBay(m, a, -hd, b, -hd, 0, zt, spring, (Math.abs(b - a) - open) / 2, hd, d, d ? 8 : 4, false);
  };
  m.mat = stone;
  if (bays === 3) {
    const cw = mainW + sideW * 0.65;
    seg(-cw / 2, cw / 2, mainW, zt * 0.58);
    seg(-hw, -cw / 2, sideW, zt * 0.34);
    seg(cw / 2, hw, sideW, zt * 0.34);
  } else seg(-hw, hw, mainW, zt * 0.55);
  wall(m, hw, -hd, hw, hd, 0, zt);
  wall(m, -hw, hd, -hw, -hd, 0, zt);
  // Columns standing before the piers, on pedestals.
  if (bays === 3 && d) {
    const cw = mainW + sideW * 0.65;
    const ch = zt * 0.72;
    const Dc = ch / 10;
    const ped = zt * 0.2;
    for (const y of [hd + Dc * 0.8, -hd - Dc * 0.8]) {
      for (const x of [-hw + Dc, -cw / 2 - Dc * 0.2, cw / 2 + Dc * 0.2, hw - Dc]) {
        m.mat = stone;
        box(m, x - Dc * 0.8, y - Dc * 0.8, 0, x + Dc * 0.8, y + Dc * 0.8, ped);
        column(m, x, y, ped, ch, Dc, f.order ?? 'composite', 1, MAT.marble, stone);
      }
    }
  }
  m.mat = stone;
  band(m, [-hw, -hd, hw, -hd, hw, hd, -hw, hd], zt - H * 0.05, zt, 0.3);
  // The attic, for the inscription.
  box(m, -hw, -hd, zt, hw, hd, H, true);
  if (d) band(m, [-hw, -hd, hw, -hd, hw, hd, -hw, hd], H - 0.4, H, 0.2);
  if (f.quadriga ?? bays === 3) {
    m.mat = MAT.bronze;
    const hh = H * 0.13;
    for (const x of [-1.5, -0.5, 0.5, 1.5]) horse(m, x * hh * 0.55, hd * 0.1, H, hh, d);
    figure(m, 0, -hd * 0.3, H, hh * 1.1, d);
  }
}

/** An obelisk from z up: a tapering square shaft and its tip. */
function obeliskAt(m: Mesh, x: number, y: number, z: number, h: number, base: number, _d: number): void {
  const a = base / 2;
  const b = a * 0.6;
  const t = z + h * 0.93;
  const keep = m.mat;
  const p = [[-a, -a, -b, -b], [a, -a, b, -b], [a, a, b, b], [-a, a, -b, b]];
  for (let i = 0; i < 4; i++) {
    const [x0, y0, u0, v0] = p[i];
    const [x1, y1, u1, v1] = p[(i + 1) % 4];
    const nx = y1 - y0;
    const ny = x0 - x1;
    const l = Math.sqrt(nx * nx + ny * ny) || 1;
    m.quad(m.v(x + x0, y + y0, z, nx / l, ny / l, 0.03, 0, z), m.v(x + x1, y + y1, z, nx / l, ny / l, 0.03, base, z), m.v(x + u1, y + v1, t, nx / l, ny / l, 0.03, base, t), m.v(x + u0, y + v0, t, nx / l, ny / l, 0.03, 0, t));
    const c = m.mat;
    m.mat = MAT.gilt;
    const k = Math.SQRT1_2;
    m.tri(m.v(x + u0, y + v0, t, (nx / l) * k, (ny / l) * k, k, 0, 0), m.v(x + u1, y + v1, t, (nx / l) * k, (ny / l) * k, k, 1, 0), m.v(x, y, z + h, (nx / l) * k, (ny / l) * k, k, 0.5, 1));
    m.mat = c;
  }
  m.mat = keep;
}

function obelisk(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const f = s.form;
  const h = s.height ?? 22;
  const ped = f.pedestal_height ?? h * 0.12;
  const base = f.base_width ?? h * 0.1;
  m.place(s.at[0], s.at[1], s.base);
  m.mat = MAT.marble;
  box(m, -base * 0.95, -base * 0.95, -0.5, base * 0.95, base * 0.95, ped);
  m.mat = MAT.granite;
  m.tint = 90;
  obeliskAt(m, 0, 0, ped, h, base, ctx.detail);
}

function pyramid(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const f = s.form;
  const plan = placeBy(m, s, ctx, undefined);
  const a = f.base_width ? f.base_width / 2 : Math.max(plan.hw, plan.hl, 4);
  const h = s.height ?? a * 3;
  m.mat = MAT.marble;
  m.tint = 215;
  const p = [[-a, -a], [a, -a], [a, a], [-a, a]];
  for (let i = 0; i < 4; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % 4];
    const nx = (y1 - y0) / (2 * a);
    const ny = (x0 - x1) / (2 * a);
    const l = Math.sqrt(h * h + a * a);
    const w = h / l;
    const z = a / l;
    m.tri(m.v(x0, y0, -0.5, nx * w, ny * w, z, 0, 0), m.v(x1, y1, -0.5, nx * w, ny * w, z, 2 * a, 0), m.v(0, 0, h, nx * w, ny * w, z, a, l));
  }
}

function honorColumn(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const f = s.form;
  const d = ctx.detail;
  const plan = placeBy(m, s, ctx, f.faces);
  const H = s.height ?? 30;
  const ped = f.pedestal_height ?? H * 0.15;
  const Dc = f.diameter ?? clamp(H * 0.105, 0.8, 4);
  const pw = Math.max(Dc * 0.9, Math.min(plan.hw, plan.hl, Dc * 1.5));
  m.mat = MAT.marble;
  m.tint = 230;
  box(m, -pw, -pw, -0.5, pw, pw, ped);
  if (d) {
    box(m, -pw - 0.2, -pw - 0.2, ped - 0.4, pw + 0.2, pw + 0.2, ped, true);
    box(m, -pw - 0.3, -pw - 0.3, -0.5, pw + 0.3, pw + 0.3, 0.5, false);
  }
  const statue = f.statue ?? true;
  const figH = statue ? clamp(H * 0.1, 1.5, 5) : 0;
  column(m, 0, 0, ped, H - ped - figH, Dc, f.order ?? 'doric', d, f.spiral ?? false ? MAT.spiral : MAT.shaft, MAT.marble);
  if (statue) {
    m.mat = MAT.bronze;
    figure(m, 0, 0, H - figH, figH, d);
  }
}

function statue(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const f = s.form;
  const d = ctx.detail;
  const big = s.rings.length ? minBox(s.rings.flat()) : undefined;
  // Colossal figures have their own height; a mapped element may be odd, so stand at the point.
  const H = s.height ?? 6;
  const ped = f.pedestal_height ?? clamp(H * 0.18, 1, 6);
  const [x, y] = big && big.hl < 30 ? [big.cx, big.cy] : s.at;
  m.place(x, y, s.base);
  m.mat = MAT.marble;
  const w = clamp(H * 0.16, 0.8, 7);
  box(m, -w, -w, -0.5, w, w, ped);
  m.mat = f.material === 'marble' ? MAT.marble : MAT.bronze;
  if (f.equestrian) {
    horse(m, 0, 0, ped, H * 0.7, d);
    figure(m, 0, 0, ped + H * 0.42, H * 0.58, d);
  } else figure(m, 0, 0, ped, H - ped, d);
}

function fountain(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const f = s.form;
  const d = ctx.detail;
  const plan = placeBy(m, s, ctx, undefined);
  const R = f.diameter ? f.diameter / 2 : Math.min(plan.hw, plan.hl, 40);
  const H = s.height ?? R * 1.3;
  const seg = d ? 32 : 12;
  if (plan.hw / Math.max(plan.hl, 0.1) > 1.8 || plan.hl / Math.max(plan.hw, 0.1) > 1.8) {
    // A long fountain front: three storeys of columns (the Septizodium).
    const hw = plan.hw;
    const hl = plan.hl;
    m.mat = MAT.marble;
    const levels = 3;
    const lh = H / levels;
    for (let k = 0; k < levels; k++) {
      const z0 = k * lh;
      m.mat = MAT.brick;
      m.tint = 170;
      box(m, -hw, -hl, z0, hw, hl * 0.2, z0 + lh, false);
      m.mat = MAT.marble;
      const n = Math.max(5, Math.round((hw * 2) / (lh * 0.55)));
      for (let i = 0; i <= n; i++) column(m, -hw + (hw * 2 * i) / n, hl * 0.75, z0, lh * 0.82, lh * 0.08, 'corinthian', d, MAT.granite, MAT.marble);
      box(m, -hw, -hl * 0.2, z0 + lh * 0.82, hw, hl, z0 + lh, true, true);
    }
    return;
  }
  m.mat = MAT.marble;
  m.tint = 225;
  lathe(m, 0, 0, [[R, -0.5], [R, 1.1]], seg);
  m.mat = MAT.pool;
  disc(m, 0, 0, R * 0.96, 0.9, seg);
  m.mat = MAT.travertine;
  m.tint = 190;
  lathe(m, 0, 0, [[R * 0.46, 0], [R * 0.34, H * 0.4], [R * 0.17, H * 0.78], [R * 0.05, H]], seg, true);
  m.mat = MAT.gilt;
  dome(m, 0, 0, R * 0.08, H, 8, 3, -PI / 2, PI / 2);
}

// ——— Generic buildings ———

/** How a generic building looks: stone, stucco or brick; from the map's colour tag, or by what kind of thing it is. */
function wallLook(s: CityStructure): { mat: number; tint: number } {
  const c = s.look?.['building:colour'];
  if (c === '#fffaf0') return { mat: MAT.marble, tint: 215 };
  if (c === '#ffdead') return { mat: MAT.travertine, tint: 180 };
  if (s.kind === 'building/temple' || s.kind.startsWith('monument')) return { mat: MAT.marble, tint: 215 };
  if (s.kind === 'building/civic' || s.kind === 'building/palace') return { mat: MAT.travertine, tint: 190 };
  return { mat: MAT.brick, tint: 170 };
}

const GENERIC_H: Record<string, number> = {
  'building/palace': 18,
  'building/baths': 14,
  'building/temple': 12,
  'building/civic': 12,
  'building/market': 12,
  'building/warehouse': 10,
  'building/house': 10,
  'building/barracks': 8,
  'building/theatre': 16,
  'monument/other': 3,
  'monument/arch': 8,
};

/** Is a ring close enough to its box to be roofed as a rectangle? */
function boxy(r: Poly): boolean {
  const b = minBox(r);
  return area(r) > 0.86 * 4 * b.hl * b.hw;
}

function isConvex(p: Poly): boolean {
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const k = (i + 2) % n;
    const c = (p[j * 2] - p[i * 2]) * (p[k * 2 + 1] - p[j * 2 + 1]) - (p[j * 2 + 1] - p[i * 2 + 1]) * (p[k * 2] - p[j * 2]);
    if (c < -1e-6) return false;
  }
  return true;
}

function generic(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const d = ctx.detail;
  m.place(0, 0, s.base);
  const look = wallLook(s);
  const levels = Number(s.look?.['building:levels'] ?? 0);
  const minH = Number(s.look?.min_height ?? 0);
  const rings = s.rings;
  if (!rings.length) {
    // A point: a small marker of a thing the map only names.
    if (s.kind.startsWith('open')) return;
    m.place(s.at[0], s.at[1], s.base);
    m.mat = look.mat;
    m.tint = look.tint;
    const h = s.height ?? 4;
    box(m, -1.2, -1.2, -0.5, 1.2, 1.2, h);
    return;
  }
  for (const raw of rings) {
    if (raw.length < 6) continue;
    const r = ccw(raw);
    const a = area(r);
    const H = s.height ?? (levels ? levels * 4.5 : clamp((GENERIC_H[s.kind] ?? 9) * clamp(Math.sqrt(a) / 25, 0.5, 1.5), 2.5, 28));
    const holes = (s.holes ?? []).filter((h) => inside(r, h));
    m.mat = look.mat;
    m.tint = look.tint;
    const shape = s.look?.['roof:shape'];
    const useFacade = look.mat !== MAT.marble && H > 7;
    if (useFacade) {
      m.mat = MAT.facade;
      m.tint = look.mat === MAT.brick ? 170 : 225;
    }
    prism(m, r, minH - 1, H, false, holes);
    m.mat = look.mat;
    m.tint = look.tint;
    if (d && H > 5) band(m, r, H - 0.5, H, 0.3);
    const flatRoof = shape === 'flat' || a < 12;
    const simple = !holes.length && !flatRoof;
    if (shape === 'dome') {
      const c = centroid(r);
      const b = minBox(r);
      m.mat = MAT.lead;
      dome(m, c[0], c[1], Math.min(b.hl, b.hw), H, d ? 20 : 10, d ? 6 : 3);
    } else if (shape === 'pyramidal') {
      m.mat = MAT.tile;
      m.tint = 124;
      hip(m, convexOf(r), H, 0.7, 0.2);
    } else if (simple && boxy(r)) {
      const b = minBox(r);
      m.place(b.cx, b.cy, s.base, b.ux, b.uy);
      m.mat = MAT.tile;
      m.tint = 118 + (hashString(s.id) & 31);
      gable(m, -b.hw, -b.hl, b.hw, b.hl, H, b.hw * 0.36, 0.45, look.mat);
      m.place(0, 0, s.base);
    } else if (simple && isConvex(r)) {
      m.mat = MAT.tile;
      m.tint = 118 + (hashString(s.id) & 31);
      hip(m, r, H, 0.34, 0.4);
    } else {
      // A flat terrace with a parapet; and, on the bigger ones, ranges of roofs over most of it.
      m.mat = a > 300 ? MAT.paving : look.mat;
      m.tint = 120;
      cap(m, r, H, holes);
      if (a > 180) roofRanges(m, r, holes, H, s, look.mat, d);
    }
  }
}

/** Long ranges of roofs side by side across a terrace, broken here and there by a court: a great complex's roofscape. */
function roofRanges(m: Mesh, r: Poly, holes: Poly[], z: number, s: CityStructure, walls: number, d: number): void {
  const b = minBox(r);
  const seed = hashString(s.id);
  const cell = clamp(Math.sqrt(area(r)) * 0.2, 9, 22);
  const nu = Math.floor((b.hl * 2) / cell);
  const nv = Math.floor((b.hw * 2) / cell);
  m.place(b.cx, b.cy, s.base, b.ux, b.uy);
  const clear = (u0: number, v0: number, u1: number, v1: number) =>
    [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].every(([u, v]) => {
      const x = b.cx + b.ux * u - b.uy * v;
      const y = b.cy + b.uy * u + b.ux * v;
      const at = [x, y, x, y, x, y];
      return inside(r, at) && !holes.some((h) => inside(h, at));
    });
  for (let j = 0; j < nv; j++) {
    const v0 = -b.hw + (j + 0.04) * cell;
    const v1 = v0 + cell * 0.92;
    let start = -1;
    for (let i = 0; i <= nu; i++) {
      const u0 = -b.hl + i * cell;
      const open = i < nu && hash2(i, j, seed) > 0.2 && clear(u0, v0, u0 + cell, v1);
      if (open && start < 0) start = i;
      if (!open && start >= 0) {
        m.mat = MAT.tile;
        m.tint = 112 + Math.floor(hash2(j, start, seed) * 40);
        // The frame's x runs the other way from v.
        gable(m, -v1, -b.hl + start * cell + 0.3, -v0, -b.hl + i * cell - 0.3, z, (v1 - v0) * 0.13 + 0.2, d ? 0.2 : 0, walls);
        start = -1;
      }
    }
  }
  m.place(0, 0, s.base);
}

function convexOf(r: Poly): Poly {
  if (isConvex(r)) return r;
  const b = minBox(r);
  const pt = (u: number, v: number) => [b.cx + b.ux * u - b.uy * v, b.cy + b.uy * u + b.ux * v];
  return [...pt(-b.hl, -b.hw), ...pt(b.hl, -b.hw), ...pt(b.hl, b.hw), ...pt(-b.hl, b.hw)];
}

// ——— Warehouses, palaces, markets, camps ———

function warehouse(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const d = ctx.detail;
  const f = s.form;
  const plan = placeBy(m, s, ctx, undefined);
  const hw = Math.max(plan.hw, 3);
  const hl = Math.max(plan.hl, 3);
  const levels = f.levels ?? 2;
  const H = s.height ?? levels * 4.4;
  m.mat = MAT.brick;
  m.tint = 165;
  if (hl > hw * 3) {
    // A long range of parallel vaults, across its length.
    const n = Math.round((hl * 2) / 8.3);
    const w = (hl * 2) / n;
    for (let i = 0; i < n; i++) {
      const y0 = -hl + i * w;
      m.mat = MAT.brick;
      m.tint = 165;
      box(m, -hw, y0, -1, hw, y0 + w, H * 0.75, false);
      m.mat = MAT.tile;
      m.tint = 115 + (i * 7) % 20;
      m.place(plan.box.cx + plan.fx * (y0 + w / 2), plan.box.cy + plan.fy * (y0 + w / 2), s.base + (i % 3) * 0.15, plan.fy, -plan.fx);
      barrel(m, -w / 2 + 0.1, -hw, w / 2 - 0.1, hw, H * 0.75, d ? 6 : 3, H * 0.25, MAT.brick);
      m.place(plan.box.cx, plan.box.cy, s.base, plan.fx, plan.fy);
    }
    return;
  }
  // Wings around a long yard.
  const dw = Math.min(hw * 0.32, 14);
  const wings: [number, number, number, number][] = [
    [-hw, -hl, hw, -hl + dw],
    [-hw, hl - dw, hw, hl],
    [-hw, -hl + dw, -hw + dw, hl - dw],
    [hw - dw, -hl + dw, hw, hl - dw],
  ];
  for (const [x0, y0, x1, y1] of wings) {
    m.mat = MAT.facade;
    m.tint = 170;
    box(m, x0, y0, -1, x1, y1, H, false);
    m.mat = MAT.tile;
    m.tint = 115 + Math.floor(hash2(x0 | 0, y0 | 0, 7) * 25);
    hip(m, [x0, y0, x1, y0, x1, y1, x0, y1], H, 0.36, 0.3);
  }
  m.mat = MAT.earth;
  m.tint = 130;
  cap(m, [-hw + dw, -hl + dw, hw - dw, -hl + dw, hw - dw, hl - dw, -hw + dw, hl - dw], 0.1);
}

function palace(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const f = s.form;
  const storeys = f.storeys ?? 3;
  generic(m, { ...s, height: s.height ?? storeys * 6, look: { 'building:colour': '#ffdead', ...s.look, 'roof:shape': 'flat' } }, ctx);
}

/** Terraces of shops, each storey set back from the one below, with arches along their fronts. */
function market(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const f = s.form;
  const d = ctx.detail;
  m.place(0, 0, s.base);
  const levels = f.levels ?? 3;
  const H = s.height ?? levels * 5;
  const lh = H / levels;
  for (const raw of s.rings) {
    let r = ccw(raw);
    for (let k = 0; k < levels; k++) {
      const n = r.length / 2;
      m.mat = MAT.brick;
      m.tint = 175;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        arcadeAlong(m, r[i * 2], r[i * 2 + 1], r[j * 2], r[j * 2 + 1], k * lh - (k ? 0 : 1), (k + 1) * lh, 4.2, d, 1.2);
      }
      const q = outsetRing(r, -clamp(Math.sqrt(area(r)) * 0.05, 2, 8));
      m.mat = MAT.tile;
      m.tint = 120;
      if (signedArea2(q) <= 0 || k === levels - 1) cap(m, r, (k + 1) * lh);
      else {
        cap(m, r, (k + 1) * lh, [q]);
        r = q;
      }
    }
  }
}

function barracks(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const f = s.form;
  const d = ctx.detail;
  m.place(0, 0, s.base);
  if (!s.rings.length) return generic(m, s, ctx);
  const wh = f.wall_height ?? 4.7;
  for (const raw of s.rings) {
    const r = ccw(raw);
    m.mat = MAT.brick;
    m.tint = 165;
    const n = r.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      wall(m, r[i * 2], r[i * 2 + 1], r[j * 2], r[j * 2 + 1], -1, wh);
      wall(m, r[j * 2], r[j * 2 + 1], r[i * 2], r[i * 2 + 1], 0, wh);
    }
    band(m, r, wh, wh + 0.5, 0.2);
    const a = area(r);
    if (a < 900) {
      m.mat = MAT.tile;
      m.tint = 120;
      cap(m, r, wh);
      continue;
    }
    // Rows of barrack blocks inside.
    const b = minBox(r);
    const hull = convexOf(r);
    const rowW = 22;
    const rows = Math.floor((b.hw * 2 - 20) / rowW);
    for (let k = 0; k < rows; k++) {
      const v0 = -b.hw + 10 + k * rowW;
      const v1 = v0 + 11;
      const pt = (u: number, v: number) => [b.cx + b.ux * u - b.uy * v, b.cy + b.uy * u + b.ux * v];
      let lot: Poly = [...pt(-b.hl + 12, v0), ...pt(b.hl - 12, v0), ...pt(b.hl - 12, v1), ...pt(-b.hl + 12, v1)];
      const h = ccw(hull);
      const hn = h.length / 2;
      for (let i = 0; i < hn && lot.length >= 6; i++) {
        const j = (i + 1) % hn;
        const ex = h[j * 2] - h[i * 2];
        const ey = h[j * 2 + 1] - h[i * 2 + 1];
        const l = Math.sqrt(ex * ex + ey * ey) || 1;
        lot = clipHalf(lot, ey / l, -ex / l, (ey / l) * h[i * 2] + (-ex / l) * h[i * 2 + 1] - 6);
      }
      if (lot.length < 8 || area(lot) < 60) continue;
      m.mat = MAT.brick;
      m.tint = 170;
      prism(m, lot, -0.5, 5, false);
      m.mat = MAT.tile;
      m.tint = 112 + (k * 11) % 30;
      hip(m, lot, 5, 0.34, 0.3);
    }
    if (d) void 0;
  }
}

// ——— Things along lines ———

/** Each stretch of a line cut to steps of about `step` metres, with what falls in the clip box. */
function walkLine(line: number[], step: number, clip: [number, number, number, number] | undefined, visit: (x0: number, y0: number, x1: number, y1: number, s0: number) => void): void {
  let run = 0;
  for (let i = 0; i < line.length - 2; i += 2) {
    const ax = line[i];
    const ay = line[i + 1];
    const bx = line[i + 2];
    const by = line[i + 3];
    const l = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    const n = Math.max(1, Math.ceil(l / step));
    for (let k = 0; k < n; k++) {
      const t0 = k / n;
      const t1 = (k + 1) / n;
      const x0 = ax + (bx - ax) * t0;
      const y0 = ay + (by - ay) * t0;
      const x1 = ax + (bx - ax) * t1;
      const y1 = ay + (by - ay) * t1;
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      if (!clip || (mx >= clip[0] && mx < clip[2] && my >= clip[1] && my < clip[3])) visit(x0, y0, x1, y1, run + (l * k) / n);
    }
    run += l;
  }
}

/** A city wall along its line, following the ground: brick, walkway and merlons, with square towers. */
function cityWall(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const f = s.form;
  const d = ctx.detail;
  m.place(0, 0, 0);
  const H = s.height ?? 8;
  const W = f.width ?? 3.5;
  const spacing = f.tower_spacing ?? 30;
  const TH = f.tower_height ?? H * 1.9;
  const g = ctx.ground;
  m.mat = MAT.brick;
  m.tint = 172;
  const lines = [...(s.lines ?? []), ...s.rings.map((r) => [...r, r[0], r[1]])];
  for (const line of lines) {
    walkLine(line, 8, ctx.clip, (x0, y0, x1, y1, s0) => {
      const ex = x1 - x0;
      const ey = y1 - y0;
      const l = Math.sqrt(ex * ex + ey * ey) || 1;
      const nx = (ey / l) * (W / 2);
      const ny = (-ex / l) * (W / 2);
      const z0 = g.at(x0, y0);
      const z1 = g.at(x1, y1);
      const top0 = z0 + H;
      const top1 = z1 + H;
      m.mat = MAT.brick;
      wallSloped(m, x0 + nx, y0 + ny, z0 - 2, top0, x1 + nx, y1 + ny, z1 - 2, top1, s0);
      wallSloped(m, x1 - nx, y1 - ny, z1 - 2, top1, x0 - nx, y0 - ny, z0 - 2, top0, s0);
      m.quad(m.v(x0 + nx, y0 + ny, top0, 0, 0, 1, 0, 0), m.v(x1 + nx, y1 + ny, top1, 0, 0, 1, l, 0), m.v(x1 - nx, y1 - ny, top1, 0, 0, 1, l, W), m.v(x0 - nx, y0 - ny, top0, 0, 0, 1, 0, W));
      if (d) {
        // Merlons on the outer edge.
        const k = Math.max(1, Math.round(l / 1.6));
        for (let i = 0; i < k; i += 2) {
          const a = i / k;
          const b = (i + 1) / k;
          const px = x0 + ex * a + nx;
          const py = y0 + ey * a + ny;
          const qx = x0 + ex * b + nx;
          const qy = y0 + ey * b + ny;
          const zb = mix(top0, top1, a);
          m.mat = MAT.brick;
          box(m, Math.min(px, qx) - 0.12, Math.min(py, qy) - 0.12, zb, Math.max(px, qx) + 0.12, Math.max(py, qy) + 0.12, zb + 1.3);
        }
      }
      // A tower every so many metres along the line.
      const k0 = Math.floor(s0 / spacing);
      const k1 = Math.floor((s0 + l) / spacing);
      if (k1 > k0) {
        const t = (k1 * spacing - s0) / l;
        const tx = x0 + ex * t;
        const ty = y0 + ey * t;
        const z = g.at(tx, ty);
        const hw = 3.8;
        const c = ex / l;
        const e = ey / l;
        m.place(tx, ty, z, e, -c);
        m.mat = MAT.brick;
        box(m, -hw, -W * 0.6, -2, hw, W + 3.5, TH - 3.6, true);
        // Its upper room, with arched windows, and a small roof.
        if (d) {
          m.mat = MAT.dark;
          for (const wx of [-2, 0, 2]) wall(m, wx - 0.5, W + 3.55, wx + 0.5, W + 3.55, TH - 6.7, TH - 4.4);
          m.mat = MAT.tile;
          m.tint = 120;
        }
        m.mat = MAT.tile;
        m.tint = 118 + (k1 * 5) % 28;
        gable(m, -hw - 0.2, -W * 0.6 - 0.2, hw + 0.2, W + 3.7, TH - 3.6, 1.8, 0.2, MAT.brick);
        m.tint = 172;
        m.place(0, 0, 0);
      }
    });
  }
}

/** A gate: an arch between two round towers, set across the wall it stands in. */
function gate(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const f = s.form;
  const d = ctx.detail;
  const [x, y] = s.rings.length ? centroid(s.rings[0]) : s.at;
  const dir = ctx.wallDirection?.(x, y);
  const [fx, fy] = f.faces !== undefined ? bearingVector(f.faces) : dir ? [dir[1], -dir[0]] : [0, 1];
  m.place(x, y, ctx.ground.at(x, y), fx, fy);
  const H = s.height ?? 14;
  const arches = f.arches ?? 1;
  const towers = f.towers ?? 2;
  const R = 3.8;
  const open = arches === 2 ? 8 : 4.2;
  const hw = open / 2 + 1;
  m.mat = MAT.travertine;
  m.tint = 195;
  arcadeBay(m, hw, 1.8, -hw, 1.8, -1, H * 0.62, H * 0.3, 1, 1.8, d, 6, false);
  arcadeBay(m, -hw, -1.8, hw, -1.8, -1, H * 0.62, H * 0.3, 1, 1.8, d, 6, false);
  m.mat = MAT.brick;
  m.tint = 172;
  box(m, -hw, -1.8, H * 0.62, hw, 1.8, H * 0.9);
  if (d) {
    m.mat = MAT.dark;
    for (const wx of [-2.4, -0.8, 0.8, 2.4]) wall(m, wx + 0.4, 1.85, wx - 0.4, 1.85, H * 0.68, H * 0.84);
    m.mat = MAT.brick;
  }
  if (towers) {
    const seg = d ? 18 : 8;
    for (const sx of [-1, 1]) {
      const cx = sx * (hw + R * 0.8);
      m.mat = MAT.brick;
      lathe(m, cx, 0.5, [[R, -1.5], [R, H]], seg);
      m.mat = MAT.travertine;
      lathe(m, cx, 0.5, [[R + 0.1, 0], [R + 0.1, H * 0.35]], seg);
      m.mat = MAT.tile;
      m.tint = 122;
      lathe(m, cx, 0.5, [[R + 0.2, H], [0.3, H + R * 0.55]], seg);
      m.tint = 172;
    }
  }
}

/** Arches carrying an aqueduct at a steady level above the ground. */
function aqueduct(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const f = s.form;
  const d = ctx.detail;
  if (s.look?.tunnel) return;
  if (s.look?.bridge !== 'aqueduct' && !s.curated) return;
  const g = ctx.ground;
  m.place(0, 0, 0);
  const W = f.width ?? 2.8;
  const span = 6.4;
  const clearance = s.height ?? 10;
  for (const line of s.lines ?? []) {
    // The channel keeps a level: the highest ground nearby, plus the clearance, changing only slowly.
    const samples: number[] = [];
    const step = 60;
    walkLine(line, step, undefined, (x0, y0) => samples.push(g.at(x0, y0)));
    const reach = 10;
    const levels = samples.map((_, i) => {
      let top = -Infinity;
      for (let k = Math.max(0, i - reach); k <= Math.min(samples.length - 1, i + reach); k++) top = Math.max(top, samples[k]);
      return top;
    });
    const smooth = levels.map((_, i) => {
      let a = 0;
      let n = 0;
      for (let k = Math.max(0, i - reach); k <= Math.min(levels.length - 1, i + reach); k++) {
        a += levels[k];
        n++;
      }
      return a / n;
    });
    let total = 0;
    for (let i = 0; i < line.length - 2; i += 2) total += Math.sqrt((line[i + 2] - line[i]) * (line[i + 2] - line[i]) + (line[i + 3] - line[i + 1]) * (line[i + 3] - line[i + 1]));
    const per = samples.length / Math.max(total, 1);
    const lv = (s0: number) => (smooth[Math.max(0, Math.min(smooth.length - 1, Math.floor(s0 * per)))] ?? 0) + clearance * 0.5;
    walkLine(line, span, ctx.clip, (x0, y0, x1, y1, s0) => {
      const z = lv(s0);
      const ex = x1 - x0;
      const ey = y1 - y0;
      const l = Math.sqrt(ex * ex + ey * ey) || 1;
      const ux = ex / l;
      const uy = ey / l;
      const nx = uy * (W / 2);
      const ny = -ux * (W / 2);
      const g0 = g.at((x0 + x1) / 2, (y0 + y1) / 2);
      if (z - g0 < 2.5) {
        // Near the ground the channel runs on a low wall.
        m.mat = MAT.brick;
        m.tint = 168;
        wall(m, x0 + nx, y0 + ny, x1 + nx, y1 + ny, g0 - 1, z + 1.6);
        wall(m, x1 - nx, y1 - ny, x0 - nx, y0 - ny, g0 - 1, z + 1.6);
      } else {
        m.mat = MAT.brick;
        m.tint = 168;
        const zb = z - 0.2;
        const span0 = Math.max(g0 - 1.2, 0);
        const spring = Math.max(1.2, zb - span0 - l * 0.5);
        arcadeBay(m, x0 + nx, y0 + ny, x1 + nx, y1 + ny, span0, zb, spring, 1.3, W, d, d ? 6 : 3, false);
        arcadeBay(m, x1 - nx, y1 - ny, x0 - nx, y0 - ny, span0, zb, spring, 1.3, 0, d, d ? 6 : 3, false);
      }
      // The channel on top.
      m.mat = MAT.concrete;
      m.tint = 170;
      const zc = z + 1.6;
      wall(m, x0 + nx, y0 + ny, x1 + nx, y1 + ny, z - 0.2, zc);
      wall(m, x1 - nx, y1 - ny, x0 - nx, y0 - ny, z - 0.2, zc);
      m.quad(m.v(x0 + nx, y0 + ny, zc, 0, 0, 1, 0, 0), m.v(x1 + nx, y1 + ny, zc, 0, 0, 1, l, 0), m.v(x1 - nx, y1 - ny, zc, 0, 0, 1, l, W), m.v(x0 - nx, y0 - ny, zc, 0, 0, 1, 0, W));
    });
  }
}

function bridge(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const f = s.form;
  const d = ctx.detail;
  const lines = s.lines ?? [];
  const W = f.width ?? 8;
  const g = ctx.ground;
  m.place(0, 0, 0);
  for (const line of lines) {
    if (line.length < 4) continue;
    const n = line.length - 2;
    const ax = line[0];
    const ay = line[1];
    const bx = line[n];
    const by = line[n + 1];
    const ex = bx - ax;
    const ey = by - ay;
    const l = Math.sqrt(ex * ex + ey * ey);
    if (l < 4) continue;
    const ux = ex / l;
    const uy = ey / l;
    const nx = (uy * W) / 2;
    const ny = (-ux * W) / 2;
    const deck = Math.max(g.at(ax, ay), g.at(bx, by), ctx.water + 9) + 0.5;
    const arches = f.arches ?? Math.max(1, Math.round(l / 22));
    const z0 = ctx.water - 1;
    m.mat = MAT.travertine;
    m.tint = 195;
    for (let i = 0; i < arches; i++) {
      const t0 = i / arches;
      const t1 = (i + 1) / arches;
      const pier = Math.min(4, (l / arches) * 0.2);
      arcadeBay(m, ax + ex * t0 + nx, ay + ey * t0 + ny, ax + ex * t1 + nx, ay + ey * t1 + ny, z0, deck, 1.5, pier, W, d, d ? 8 : 4, false);
      arcadeBay(m, ax + ex * t1 - nx, ay + ey * t1 - ny, ax + ex * t0 - nx, ay + ey * t0 - ny, z0, deck, 1.5, pier, 0, d, d ? 8 : 4, false);
    }
    // The deck, and its parapets.
    m.mat = MAT.basalt;
    m.tint = 130;
    m.quad(m.v(ax + nx, ay + ny, deck, 0, 0, 1, 0, 0), m.v(bx + nx, by + ny, deck, 0, 0, 1, l, 0), m.v(bx - nx, by - ny, deck, 0, 0, 1, l, W), m.v(ax - nx, ay - ny, deck, 0, 0, 1, 0, W));
    m.mat = MAT.travertine;
    m.tint = 195;
    wall(m, ax + nx, ay + ny, bx + nx, by + ny, deck, deck + 1.1);
    wall(m, bx - nx, by - ny, ax - nx, ay - ny, deck, deck + 1.1);
    wall(m, bx + nx * 0.9, by + ny * 0.9, ax + nx * 0.9, ay + ny * 0.9, deck, deck + 1.1);
    wall(m, ax - nx * 0.9, ay - ny * 0.9, bx - nx * 0.9, by - ny * 0.9, deck, deck + 1.1);
  }
}

/** A paved road, its ribbon following the ground. */
export function road(m: Mesh, s: CityStructure, ctx: FormContext): void {
  const kind = s.look?.highway;
  const major = kind === 'primary' || kind === 'secondary' || s.curated;
  const W = major ? 7.5 : kind === 'steps' || kind === 'footway' ? 3 : 5;
  const g = ctx.ground;
  m.place(0, 0, 0);
  m.mat = MAT.basalt;
  m.tint = major ? 130 : 118;
  for (const line of s.lines ?? []) {
    walkLine(line, 10, ctx.clip, (x0, y0, x1, y1, s0) => {
      const ex = x1 - x0;
      const ey = y1 - y0;
      const l = Math.sqrt(ex * ex + ey * ey) || 1;
      const nx = ((ey / l) * W) / 2;
      const ny = ((-ex / l) * W) / 2;
      const lift = 0.14;
      const a0 = g.at(x0 + nx, y0 + ny) + lift;
      const b0 = g.at(x0 - nx, y0 - ny) + lift;
      const a1 = g.at(x1 + nx, y1 + ny) + lift;
      const b1 = g.at(x1 - nx, y1 - ny) + lift;
      m.quad(m.v(x0 + nx, y0 + ny, a0, 0, 0, 1, s0, 0), m.v(x1 + nx, y1 + ny, a1, 0, 0, 1, s0 + l, 0), m.v(x1 - nx, y1 - ny, b1, 0, 0, 1, s0 + l, W), m.v(x0 - nx, y0 - ny, b0, 0, 0, 1, s0, W));
    });
  }
}

// ——— Trees ———

/** Trees of the Roman garden: 0 umbrella pine, 1 cypress, 2 a broad-leaved tree. */
/** A rough ball of leaves, flattened, each of its points pushed in or out by up to `rough` of its size. */
function crown(m: Mesh, x: number, y: number, zc: number, r: number, zr: number, n: number, rings: number, seed: number, rough: number): void {
  for (let j = 0; j < rings; j++) {
    const a0 = -PI / 2 + (PI * j) / rings;
    const a1 = -PI / 2 + (PI * (j + 1)) / rings;
    const base = m.verts;
    for (let i = 0; i <= n; i++) {
      const t = (TAU * i) / n;
      const c = dcos(t);
      const e = dsin(t);
      const w0 = 1 + (hash2(i % n, j, seed) - 0.5) * rough;
      const w1 = 1 + (hash2(i % n, j + 1, seed) - 0.5) * rough;
      const c0 = dcos(a0);
      const s0 = dsin(a0);
      const c1 = dcos(a1);
      const s1 = dsin(a1);
      m.v(x + c * c0 * r * w0, y + e * c0 * r * w0, zc + s0 * zr, c * c0, e * c0, s0, x + t * 2, zc + a0 * 2, 0.55 + 0.45 * (s0 * 0.5 + 0.5));
      m.v(x + c * c1 * r * w1, y + e * c1 * r * w1, zc + s1 * zr, c * c1, e * c1, s1, x + t * 2, zc + a1 * 2, 0.55 + 0.45 * (s1 * 0.5 + 0.5));
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 2;
      m.quad(a, a + 2, a + 3, a + 1);
    }
  }
}

export function tree(m: Mesh, x: number, y: number, z: number, type: number, h: number, detail: number, shade: number): void {
  const keep = m.mat;
  const n = detail ? 10 : 4;
  m.tint = shade;
  if (type === 1) {
    m.mat = MAT.leaf;
    const r = h * 0.11;
    lathe(m, x, y, [[r * 0.5, z], [r, z + h * 0.18], [r * 0.82, z + h * 0.6], [r * 0.25, z + h * 0.92], [0.03, z + h]], n, true);
  } else {
    const trunkTop = type === 0 ? z + h * 0.72 : z + h * 0.42;
    m.mat = MAT.trunk;
    if (detail) lathe(m, x, y, [[h * 0.028, z - 0.2], [h * 0.018, trunkTop + h * 0.02]], 4);
    m.mat = MAT.leaf;
    const r = type === 0 ? h * 0.4 : h * 0.34;
    const zc = type === 0 ? trunkTop + h * 0.08 : trunkTop + r * 0.72;
    const zr = type === 0 ? h * 0.15 : r * 0.82;
    const seed = shade * 13;
    if (!detail) crown(m, x, y, zc, r, zr, n, 2, seed, 0);
    else {
      // Up close, a mass of leaves with clumps standing out of it.
      crown(m, x, y, zc, r * 0.8, zr * 0.92, n, 5, seed, 0.2);
      const clumps = type === 0 ? 7 : 6;
      for (let k = 0; k < clumps; k++) {
        const a = (TAU * (k + hash2(k, 1, seed) * 0.6)) / clumps;
        const out = r * (0.5 + 0.2 * hash2(k, 2, seed));
        const up = zr * (hash2(k, 3, seed) - 0.3) * (type === 0 ? 0.45 : 0.9);
        crown(m, x + dcos(a) * out, y + dsin(a) * out, zc + up, r * (0.36 + 0.14 * hash2(k, 4, seed)), zr * (0.58 + 0.2 * hash2(k, 5, seed)), 8, 4, seed + k + 1, 0.22);
      }
    }
  }
  m.mat = keep;
}

// ——— The dispatch ———

const FORMS: Partial<Record<FormSpec['type'], (m: Mesh, s: CityStructure, ctx: FormContext) => void>> = {
  temple,
  tholos,
  basilica,
  hall,
  court,
  amphitheatre,
  theatre,
  circus,
  baths,
  rotunda,
  mausoleum,
  arch,
  column: honorColumn,
  obelisk,
  pyramid,
  statue,
  fountain,
  palace,
  market,
  warehouse,
  barracks,
  wall: cityWall,
  gate,
  aqueduct,
  bridge,
  generic,
};

/** Forms that run along lines, and so are drawn stretch by stretch in each part of the city they cross. */
export const LINE_FORMS = new Set<string>(['wall', 'aqueduct']);

/** Raise a structure into a mesh. A structure with no form draws nothing here: a road or a garden. */
export function raise(m: Mesh, s: CityStructure, ctx: FormContext): void {
  m.light = 1;
  m.tint = 128;
  if (s.kind === 'works/road') return road(m, s, ctx);
  if (s.kind === 'open/garden' || s.kind === 'open/water' || s.kind === 'open/island' || s.kind === 'open/district' || s.kind === 'open/region' || s.kind === 'works/sewer') return;
  if (s.kind === 'open/square' || s.kind === 'open/cemetery' || s.kind === 'open/enclosure') {
    if (s.kind === 'open/square' && s.rings.length) {
      m.place(0, 0, s.base);
      m.mat = MAT.paving;
      m.tint = 180;
      for (const r of s.rings) cap(m, ccw(r), 0.1);
    }
    return;
  }
  const form = FORMS[s.form.type] ?? generic;
  form(m, s, ctx);
}

export { insetConvex };
