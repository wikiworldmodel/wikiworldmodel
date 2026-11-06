// Generic land, version 1 of gen:earth/generic-land: the prior the globe draws where nothing records where the land
// was (docs/STRUCTURE.md section 3.3). Before the plate model reaches, and after today's map stops being held, the
// planet still had land; a confidently empty ocean would be less honest than a labelled guess. So this makes a
// plausible scatter of cratons, nothing more: where they are and what shape is invented, and how much of the planet
// they cover is the record's stated placeholder, not a reconstruction. Everything it makes is procedural, and the
// viewer says so.
//
// The output is an equirectangular grid, row 0 at the north pole: 128 is the coast, above it land, and the further
// above, the further inland. A share of the cells given by `land_share` stands above 128.
import { fbm, hashString } from '../clouds/v1.ts';

export const GENERATOR = 'gen:earth/generic-land';
export const VERSION = 1;

export interface GenericLandParams {
  width: number;
  height: number;
  /** how much of the planet the cratons cover: the record's placeholder */
  land_share: number;
  /** how large the cratons are: noise cells across the planet's radius */
  scale: number;
  octaves: number;
  /** how far the coast is smoothed, in the noise's units */
  shore: number;
}

/** The land mask: one byte a cell, 128 at the coast. */
export function generateGenericLand(seed: string, p: GenericLandParams): Uint8Array {
  const s = hashString(seed);
  const n = p.width * p.height;
  const v = new Float64Array(n);
  for (let j = 0; j < p.height; j++) {
    const lat = Math.PI / 2 - ((j + 0.5) / p.height) * Math.PI;
    const z = Math.sin(lat);
    const r = Math.cos(lat);
    for (let i = 0; i < p.width; i++) {
      const lon = -Math.PI + ((i + 0.5) / p.width) * 2 * Math.PI;
      const x = r * Math.cos(lon);
      const y = r * Math.sin(lon);
      // A few broad cratons, roughened at the coast.
      v[j * p.width + i] = fbm(x * p.scale + 11, y * p.scale + 23, z * p.scale + 37, p.octaves, s);
    }
  }
  // The level at which the land's share of the planet's area is the placeholder's: cells near the poles are smaller.
  const weighted: [number, number][] = [];
  for (let j = 0; j < p.height; j++) {
    const area = Math.cos(Math.PI / 2 - ((j + 0.5) / p.height) * Math.PI);
    for (let i = 0; i < p.width; i++) weighted.push([v[j * p.width + i], area]);
  }
  weighted.sort((a, b) => b[0] - a[0]);
  const total = weighted.reduce((t, w) => t + w[1], 0);
  let acc = 0;
  let level = weighted[0][0];
  for (const [value, area] of weighted) {
    acc += area;
    level = value;
    if (acc >= total * p.land_share) break;
  }
  const out = new Uint8Array(n);
  for (let k = 0; k < n; k++) out[k] = Math.max(0, Math.min(255, Math.round(128 + ((v[k] - level) / p.shore) * 127)));
  return out;
}

/** Is a direction on land, by the mask? */
export function genericLandAt(mask: Uint8Array, p: Pick<GenericLandParams, 'width' | 'height'>, lat: number, lon: number): boolean {
  const j = Math.min(p.height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * p.height)));
  const i = Math.min(p.width - 1, Math.max(0, Math.floor(((lon + 180) / 360) * p.width)));
  return mask[j * p.width + i] > 128;
}
