// Houses from a dwelling's parameters (core/dwelling.ts), on the city's kit: a plan, walls, a roof and a floor, each
// from what the tradition's claims say and, where they say nothing, from proportions of the house itself. Nothing here
// is a fact about any house: sizes come from the claims, and what they leave open is drawn plainly, as a type. The
// front faces +y; the frame places it.
import { mid, type DwellingSpec } from '../../../core/dwelling.ts';
import { box, cap, dome, gable, hip, lathe, MAT, prism, type Mesh } from '../city/kit.ts';
import type { Poly } from '../city/math.ts';

/** How finely a house is drawn: 0 up close, 1 at a middle distance, 2 far off, as a block. */
export type HouseDetail = 0 | 1 | 2;

/** What each material is drawn as. */
const WALL: Record<NonNullable<DwellingSpec['walls']>, number> = {
  mudbrick: MAT.mud,
  'fired-brick': MAT.brick,
  stone: MAT.granite,
  timber: MAT.wood,
  'wattle-and-daub': MAT.plaster,
  'pole-and-thatch': MAT.thatch,
  reed: MAT.thatch,
  'rammed-earth': MAT.mud,
  cob: MAT.mud,
  hide: MAT.hide,
  felt: MAT.cloth,
  bark: MAT.bark,
  sod: MAT.grass,
  snow: MAT.plaster,
  none: MAT.thatch,
};

const ROOF: Record<NonNullable<DwellingSpec['roof_material']>, number> = {
  earth: MAT.mud,
  thatch: MAT.thatch,
  tile: MAT.tile,
  timber: MAT.wood,
  bark: MAT.bark,
  hide: MAT.hide,
  felt: MAT.cloth,
  reed: MAT.thatch,
  stone: MAT.granite,
  turf: MAT.grass,
  snow: MAT.plaster,
};

/** The size of a house of a dwelling, in metres, as the generator draws it: width, length and height to the eaves and the top. */
export function houseSize(d: DwellingSpec): { w: number; l: number; eaves: number; top: number; round: boolean } {
  const round = d.plan === 'round' || d.plan === 'oval';
  const diameter = mid(d.diameter, 5);
  const w = round ? diameter : mid(d.width, d.plan === 'long' ? 6 : d.plan === 'courtyard' ? 12 : 5);
  const l = round ? (d.plan === 'oval' ? diameter * 1.4 : diameter) : mid(d.length, d.plan === 'long' ? Math.max(w * 4, 20) : d.plan === 'square' ? w : d.plan === 'courtyard' ? w : w * 1.6);
  const storeys = Math.max(1, Math.round(mid(d.storeys, 1)));
  const wallH = d.walls === 'none' ? 0.2 : mid(d.wall_height, d.walls === 'felt' || d.walls === 'hide' ? 1.4 : 2.4);
  const eaves = wallH * storeys + (d.floor === 'stilts' ? 1.6 : d.floor === 'platform' ? 1 : d.floor === 'raised' ? 0.4 : d.floor === 'sunken' ? -0.8 : 0);
  const roof = d.roof ?? 'gable';
  const rise = roof === 'flat' ? 0.4 : roof === 'dome' ? Math.min(w, l) * 0.45 : roof === 'conical' || roof === 'tent' ? Math.min(w, l) * 0.5 : Math.min(w, l) * 0.45;
  const top = Math.max(mid(d.height, eaves + rise), eaves + 0.3);
  return { w, l, eaves: Math.max(0.2, eaves), top, round };
}

/** A house of a dwelling, drawn into a mesh at the frame's origin. `tint` varies its colour a little between houses. */
export function drawDwelling(m: Mesh, d: DwellingSpec, detail: HouseDetail, tint = 128): void {
  const { w, l, eaves, top, round } = houseSize(d);
  const wallMat = WALL[d.walls ?? 'wattle-and-daub'];
  const roofMat = ROOF[d.roof_material ?? (d.roof === 'flat' ? 'earth' : 'thatch')];
  const base = d.floor === 'stilts' ? 1.6 : d.floor === 'platform' ? 1 : d.floor === 'raised' ? 0.4 : 0;
  const sides = detail === 0 ? 16 : detail === 1 ? 10 : 6;
  m.tint = tint;
  // What it stands on.
  if (d.floor === 'platform' || d.floor === 'raised') {
    m.mat = d.floor === 'platform' ? MAT.granite : MAT.mud;
    box(m, -w / 2 - 1, -l / 2 - 1, -0.6, w / 2 + 1, l / 2 + 1, base, true);
  } else if (d.floor === 'stilts') {
    m.mat = MAT.wood;
    const p = 0.12;
    const posts = detail === 2 ? [[-1, -1], [1, 1]] : [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1]];
    for (const [sx, sy] of posts) box(m, (sx * w) / 2 - p, (sy * l) / 2 - p, -0.5, (sx * w) / 2 + p, (sy * l) / 2 + p, base, true);
    m.mat = MAT.wood;
    box(m, -w / 2, -l / 2, base - 0.15, w / 2, l / 2, base, true, true);
  }
  if (round) {
    const r = w / 2;
    const ry = l / 2;
    // A round house: a wall, then its roof; a tent or a hut is all roof. An oval one is drawn round, as wide as it is long.
    void ry;
    if (d.walls !== 'none' && eaves > base + 0.25) {
      m.mat = wallMat;
      lathe(m, 0, 0, [[r, base - 0.4], [r, eaves]], sides);
    }
    m.mat = roofMat;
    const roof = d.roof ?? 'conical';
    const z0 = d.walls === 'none' ? base : eaves;
    if (roof === 'dome') dome(m, 0, 0, r * 1.02, z0, sides, detail === 0 ? 5 : 3);
    else if (roof === 'flat') cap(m, circle(r, sides), eaves + 0.15);
    else {
      // A cone, overhanging the wall; a tent's slopes curve in a little.
      const over = d.walls === 'none' ? 0 : 0.5;
      const prof = roof === 'tent' ? [[r + 0.15, z0 - 0.1], [r * 0.55, z0 + (top - z0) * 0.6], [r * 0.12, top - 0.05], [0.05, top]] : [[r + over, z0 - over * 0.6], [r * 0.5, z0 + (top - z0) * 0.55], [0.05, top]];
      lathe(m, 0, 0, prof, sides);
      if (detail === 0) {
        m.mat = roofMat;
        cap(m, circle(r + over, sides), z0 - over * 0.6, [], false);
      }
    }
    return;
  }
  // A house of corners. A courtyard house is ranges of rooms around an open court; a room block, cells stacked back.
  m.mat = wallMat;
  const z0 = d.floor === 'sunken' ? -0.4 : base;
  if (d.plan === 'courtyard' || d.court) {
    const depth = Math.min(4, Math.min(w, l) * 0.3);
    const outer: Poly = [-w / 2, -l / 2, w / 2, -l / 2, w / 2, l / 2, -w / 2, l / 2];
    const inner: Poly = [-w / 2 + depth, -l / 2 + depth, w / 2 - depth, -l / 2 + depth, w / 2 - depth, l / 2 - depth, -w / 2 + depth, l / 2 - depth];
    prism(m, outer, z0 - 0.4, eaves, false);
    if (detail < 2) prism(m, inner, z0 - 0.4, eaves, false);
    m.mat = roofMat;
    if (d.roof === 'flat' || !d.roof) cap(m, outer, eaves, detail < 2 ? [inner] : []);
    else {
      // Pitched ranges: a gable over each side.
      gable(m, -w / 2, -l / 2, -w / 2 + depth, l / 2, eaves, depth * 0.5, 0.3);
      gable(m, w / 2 - depth, -l / 2, w / 2, l / 2, eaves, depth * 0.5, 0.3);
    }
    if (detail === 0) {
      m.mat = MAT.dark;
      box(m, -0.6, -l / 2 - 0.05, z0, 0.6, -l / 2 + 0.05, z0 + 2.0, false);
    }
    return;
  }
  if (d.plan === 'room-block') {
    const cells = Math.max(2, Math.round(mid(d.rooms, 6)));
    const across = Math.ceil(Math.sqrt(cells));
    const cw = w / across;
    for (let c = 0; c < cells; c++) {
      const i = c % across;
      const j = Math.floor(c / across);
      const back = j / Math.max(1, Math.ceil(cells / across) - 1 || 1);
      const h = eaves + back * eaves * 0.8;
      m.mat = wallMat;
      box(m, -w / 2 + i * cw, -l / 2 + j * (l / across), z0 - 0.4, -w / 2 + (i + 1) * cw, -l / 2 + (j + 1) * (l / across), h, true);
    }
    return;
  }
  box(m, -w / 2, -l / 2, z0 - 0.4, w / 2, l / 2, eaves, d.roof === 'flat');
  m.mat = roofMat;
  const roof = d.roof ?? 'gable';
  const rise = Math.max(0.3, top - eaves);
  if (roof === 'flat') {
    cap(m, [-w / 2, -l / 2, w / 2, -l / 2, w / 2, l / 2, -w / 2, l / 2], eaves + 0.05);
    if (detail === 0) {
      // A low parapet round the roof.
      m.mat = wallMat;
      prism(m, [-w / 2, -l / 2, w / 2, -l / 2, w / 2, l / 2, -w / 2, l / 2], eaves, eaves + 0.4, false);
    }
  } else if (roof === 'hip') hip(m, [-w / 2, -l / 2, w / 2, -l / 2, w / 2, l / 2, -w / 2, l / 2], eaves, rise / (w / 2), detail === 2 ? 0 : 0.5);
  else if (roof === 'dome') dome(m, 0, 0, Math.min(w, l) / 2, eaves, sides, 3);
  else if (roof === 'vault') {
    // A barrel along the house's length, drawn as a steep gable from afar.
    gable(m, -w / 2, -l / 2, w / 2, l / 2, eaves, rise, 0.1, wallMat);
  } else gable(m, -w / 2, -l / 2, w / 2, l / 2, eaves, rise, detail === 2 ? 0 : 0.6, wallMat);
  if (detail === 0 && !round) {
    // A door in the front.
    m.mat = MAT.dark;
    box(m, -0.5, -l / 2 - 0.05, z0, 0.5, -l / 2 + 0.05, z0 + Math.min(1.9, eaves - z0 - 0.1), false);
  }
  if (apsidal(d) && detail < 2) {
    m.mat = wallMat;
    lathe(m, 0, l / 2, [[w / 2, z0 - 0.4], [w / 2, eaves]], sides, false, -Math.PI / 2, Math.PI / 2);
  }
}

const apsidal = (d: DwellingSpec) => d.plan === 'apsidal';

function circle(r: number, n: number): Poly {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.sin((2 * Math.PI * i) / n) * r, Math.cos((2 * Math.PI * i) / n) * r);
  return out;
}
