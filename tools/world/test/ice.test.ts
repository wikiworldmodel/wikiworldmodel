// The ice sheets: how the distance to their margin is worked out, how a time finds its keyframes,
// how much ice a grid holds, and the snapshot they are read from.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { decodeMargin, decodeThickness, encodeMargin, encodeThickness, iceFrame, iceKeysAt, iceScenario, sampleGrid, THICKNESS_TOP, type IceKeyframe, type IceScenario } from '../../../core/ice.ts';
import { parseHeader } from '../src/netcdf.ts';
import { climateGrid } from '../src/build/climate.ts';
import { distanceToContour, iceVolume } from '../src/build/ice.ts';
import { loadManifest } from '../src/manifest.ts';
import { REPO } from '../src/paths.ts';
import { sha256 } from '../src/util.ts';

const grid = climateGrid(1);
const R = 6371;
const RAD = Math.PI / 180;

/** A round ice cap, thick in the middle, of a given radius around a place. */
function cap(lat0: number, lon0: number, radiusKm: number, top: number): Float64Array {
  const out = new Float64Array(grid.nx * grid.ny);
  const c = [Math.cos(lat0 * RAD) * Math.cos(lon0 * RAD), Math.cos(lat0 * RAD) * Math.sin(lon0 * RAD), Math.sin(lat0 * RAD)];
  for (let j = 0; j < grid.ny; j++) {
    for (let i = 0; i < grid.nx; i++) {
      const la = (grid.lat0 - j) * RAD;
      const lo = (grid.lon0 + i) * RAD;
      const dot = Math.cos(la) * Math.cos(lo) * c[0] + Math.cos(la) * Math.sin(lo) * c[1] + Math.sin(la) * c[2];
      const km = Math.acos(Math.min(1, dot)) * R;
      out[j * grid.nx + i] = km < radiusKm ? top * (1 - km / radiusKm) : 0;
    }
  }
  return out;
}

describe('the distance to the margin', () => {
  it('is positive inside the ice and negative outside, and right to within a node', () => {
    // A cone whose 100 m contour is 99% of the way out.
    const d = distanceToContour(grid, cap(60, -90, 1000, 10000), 100, 1020);
    const at = (lat: number, lon: number) => d[(90 - lat) * grid.nx + (lon + 180)];
    expect(at(60, -90)).toBeGreaterThan(970 - 15);
    expect(at(60, -90)).toBeLessThan(990 + 15);
    // Five degrees from the middle along a meridian is about 556 km from it, and so about 434 km from its edge.
    expect(at(65, -90)).toBeGreaterThan(434 - 20);
    expect(at(65, -90)).toBeLessThan(434 + 20);
    // Ten degrees out is about 1112 km from the middle, and outside the ice by about 122 km.
    expect(at(50, -90)).toBeLessThan(-100);
    expect(at(50, -90)).toBeGreaterThan(-150);
    // It says nothing further than its reach.
    expect(at(0, 90)).toBe(-1020);
  });

  it('wraps at the date line and reaches over a pole', () => {
    const d = distanceToContour(grid, cap(0, 179, 500, 10000), 100, 1020);
    expect(d[90 * grid.nx + 359]).toBeGreaterThan(0);
    // The node across the date line, 2° from the middle, is inside; 10° across it is outside.
    expect(d[90 * grid.nx + 1]).toBeGreaterThan(0);
    expect(d[90 * grid.nx + 9]).toBeLessThan(0);
    const polar = distanceToContour(grid, cap(90, 0, 500, 10000), 100, 1020);
    for (const lon of [0, 90, 180, 270]) expect(polar[3 * grid.nx + lon]).toBeGreaterThan(0);
    // Seven degrees from the pole on any meridian is the same way from a round margin.
    const ring = [0, 90, 180, 270].map((lon) => polar[7 * grid.nx + lon]);
    for (const x of ring) expect(Math.abs(x - ring[0])).toBeLessThan(15);
    expect(ring[0]).toBeLessThan(0);
  });

  it('is the far side of the reach everywhere if the grid has no contour', () => {
    const d = distanceToContour(grid, new Float64Array(grid.nx * grid.ny), 100, 1020);
    expect(d.every((x) => x === -1020)).toBe(true);
    expect(distanceToContour(grid, new Float64Array(grid.nx * grid.ny).fill(500), 100, 1020).every((x) => x === 1020)).toBe(true);
  });
});

describe('the bytes the globe reads', () => {
  it('keep the side of the margin a node is on, and thickness to within a few metres where it is thin', () => {
    expect(decodeMargin(encodeMargin(1))).toBeGreaterThan(0);
    expect(decodeMargin(encodeMargin(-1))).toBeLessThan(0);
    expect(decodeMargin(encodeMargin(400))).toBeCloseTo(400, -1);
    expect(encodeMargin(5000)).toBe(255);
    expect(encodeMargin(-5000)).toBe(0);
    expect(decodeThickness(encodeThickness(0))).toBe(0);
    expect(Math.abs(decodeThickness(encodeThickness(100)) - 100)).toBeLessThan(5);
    expect(Math.abs(decodeThickness(encodeThickness(3000)) - 3000)).toBeLessThan(30);
    expect(decodeThickness(encodeThickness(THICKNESS_TOP))).toBe(THICKNESS_TOP);
  });

  it('are read between nodes, across the date line too', () => {
    const v = new Float64Array(grid.nx * grid.ny);
    v[90 * grid.nx] = 10; // 0°, 180°W
    expect(sampleGrid(grid, v, 0, -180)).toBe(10);
    expect(sampleGrid(grid, v, 0, -179.5)).toBe(5);
    expect(sampleGrid(grid, v, 0, 179.5)).toBe(5);
    expect(sampleGrid(grid, v, 0.5, -180)).toBe(5);
  });
});

describe('the keyframes of a time', () => {
  const ages = [0, 0.0025, 0.005];
  it('are the ones either side, with how far between them it is', () => {
    expect(iceKeysAt(ages, 0.0025)).toEqual({ younger: 0.0025, older: 0.0025, mix: 0 });
    const k = iceKeysAt(ages, 0.003)!;
    expect(k.younger).toBe(0.0025);
    expect(k.older).toBe(0.005);
    expect(k.mix).toBeCloseTo(0.2, 9);
  });

  it('hold the youngest after it, and are none before the oldest', () => {
    expect(iceKeysAt(ages, -1)).toEqual({ younger: 0, older: 0, mix: 0 });
    expect(iceKeysAt(ages, 0.0051)).toBeNull();
  });

  const frame = (ageMa: number, n: number): IceKeyframe => ({ ageMa, margin: n, thickness: n + 1 });
  const scenarios: IceScenario[] = [
    { id: 'a', title: 'A', keyframes: [frame(0, 0), frame(1, 2), frame(2, 4)] },
    { id: 'b', title: 'B', alt: 'alt:x/b', keyframes: [frame(1, 6)] },
  ];

  it('are the default picture\'s unless an alternative draws another, which has them only where it differs', () => {
    expect(iceScenario({ scenarios }, []).id).toBe('a');
    expect(iceScenario({ scenarios }, ['alt:other/thing']).id).toBe('a');
    const b = iceScenario({ scenarios }, ['alt:other/thing', 'alt:x/b']);
    expect(b.id).toBe('b');
    expect(iceFrame({ scenarios }, b, 1).margin).toBe(6);
    expect(iceFrame({ scenarios }, b, 2).margin).toBe(4);
  });
});

describe('the volume of ice on a grid', () => {
  it('is the thickness times the sphere\'s area', () => {
    // A metre of ice over the whole Earth.
    const km3 = iceVolume(grid, new Float64Array(grid.nx * grid.ny).fill(1));
    expect(km3).toBeCloseTo(4 * Math.PI * R * R * 1e-3, 0);
  });

  it('ignores the small negative values interpolation leaves', () => {
    const h = new Float64Array(grid.nx * grid.ny);
    h[100] = -0.08;
    expect(iceVolume(grid, h)).toBe(0);
  });
});

describe('the snapshot', () => {
  it('is what the manifest pins, holds both scenarios at every keyframe, and is CC BY', async () => {
    const m = await loadManifest();
    const d = m.datasets['src:paleomist-1.0'];
    const zip = new Uint8Array(readFileSync(join(REPO, d.fetch.url.slice('repo:'.length))));
    expect(zip.length).toBe(d.fetch.bytes);
    expect(sha256(zip)).toBe(d.fetch.sha256);
    expect(d.license).toBe('CC-BY-4.0');
    expect(m.publish.licenses).toContain(d.license);
    const nc = unzipSync(zip)[d.fetch.files!.grid.path];
    expect(sha256(nc)).toBe(d.fetch.files!.grid.sha256);
    const h = parseHeader(nc);
    expect(h.dims.map((x) => [x.name, x.size])).toEqual([['time', 33], ['lat', 181], ['lon', 361]]);
    for (const v of ['ice_thickness_maximal', 'ice_thickness_minimal']) {
      expect(h.variables.get(v)!.dims.map((x) => x.name)).toEqual(['time', 'lat', 'lon']);
      expect(h.variables.get(v)!.attrs.units).toBe('m');
    }
  });
});
