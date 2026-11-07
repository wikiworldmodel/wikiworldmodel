// Today's relief under the sea of each time (field:earth/relief): today's water on the grid, hollows the ocean does not
// reach held at the pass they would spill over, and the finer tiles a field of a tenth of a degree is cut into.
import { describe, expect, it } from 'vitest';
import { fieldFor, fieldLods, sliceField, tileGrid, timeBins, type GridField, type Snapshot } from '../src/build/fields.ts';
import { fillFromOcean, rasterize, WATER, waterMask, type Areas } from '../src/build/relief.ts';
import type { Field } from '../src/world.ts';

const square = (w: number, s: number, e: number, n: number) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
const areas = (...polygons: number[][][][]): Areas => ({ features: [{ geometry: { type: 'MultiPolygon', coordinates: polygons } }] });

describe('today\'s water on a grid', () => {
  it('marks the nodes inside a polygon, and none inside its hole', () => {
    // A 1° grid: 360 × 181 nodes from 90°N and 180°W.
    const inside = rasterize([square(-10, -10, 10, 10), square(-2, -2, 2, 2)], 360, 181, 1);
    const at = (lat: number, lon: number) => inside[(90 - lat) * 360 + (lon + 180)];
    expect(inside.reduce((n, v) => n + v, 0)).toBe(20 * 20 - 4 * 4);
    expect([at(0, -10), at(9, 9), at(-10, 0), at(0, 0), at(10, 0), at(0, 10)]).toEqual([1, 1, 1, 0, 0, 0]);
  });

  it('marks the poles from inside their caps', () => {
    // A cap to 75°N on a 10° grid: the pole's row and 80°N are inside it, and 70°N is not.
    const cap = rasterize([square(-180, 75, 180, 90)], 36, 19, 10);
    expect(cap.subarray(0, 72).every((v) => v === 1)).toBe(true);
    expect(cap.subarray(72).every((v) => v === 0)).toBe(true);
  });

  it('takes the largest polygon of the ocean for the ocean, and holds any other, and the lakes, as lakes', () => {
    const ocean = areas([square(-180, -60, 0, 60)], [square(40, 30, 50, 40)]);
    const lakes = areas([square(20, 0, 25, 5)], [square(-20, 0, -10, 5)]);
    const w = waterMask(ocean, lakes, 360, 181, 1);
    const at = (lat: number, lon: number) => w[(90 - lat) * 360 + (lon + 180)];
    expect([at(0, -90), at(35, 45), at(2, 22), at(70, 0)]).toEqual([WATER.ocean, WATER.lake, WATER.lake, WATER.land]);
    // A lake inside the ocean's own area stays ocean.
    expect(at(2, -15)).toBe(WATER.ocean);
  });
});

describe('the ground a coast is drawn on', () => {
  // A strip of ten nodes around the globe's waist, three rows deep: ocean to the west, then a lowland, a ridge, a hollow
  // below sea level, a second ridge, and a lake below sea level beyond.
  const nx = 10;
  const ny = 3;
  const row = [-200, 30, -3, 50, -120, -80, 60, -40, 20, -500];
  const kinds = [WATER.ocean, WATER.ocean, WATER.land, WATER.land, WATER.land, WATER.land, WATER.land, WATER.lake, WATER.land, WATER.ocean];
  const elev = Float32Array.from({ length: nx * ny }, (_, k) => row[k % nx]);
  const water = Uint8Array.from({ length: nx * ny }, (_, k) => kinds[k % nx]);
  const ground = [...fillFromOcean(elev, water, nx, ny).subarray(nx, 2 * nx)];

  it('keeps the ocean below today\'s sea, though its cell is mostly land', () => {
    expect(ground[0]).toBe(-200);
    expect(ground[1]).toBe(-1);
    expect(ground[9]).toBe(-500);
  });

  it('holds land at least a metre above today\'s sea, and a hollow at the pass it would spill over', () => {
    expect(ground[2]).toBe(1);
    expect(ground[3]).toBe(50);
    expect(ground[4]).toBe(50);
    expect(ground[5]).toBe(50);
  });

  it('keeps a lake\'s depth, and fills the land beyond it from the lower of its two ways to the ocean', () => {
    expect(ground[7]).toBe(-40);
    // East around the globe the ocean is one node away.
    expect(ground[8]).toBe(20);
    expect(ground[6]).toBe(60);
  });
});

describe('the tiles of a field finer than 1°', () => {
  const field = (id: string) => ({ id }) as Field;
  const snap = (ageMa: number, src?: Snapshot['src']): Snapshot => {
    const n = src ? src.width * src.height : 360 * 181;
    return { ageMa, elev: new Int16Array(n), plate: new Uint16Array(n), src };
  };
  const relief: GridField = { field: field('relief'), mode: 'elevation', snapshots: [snap(0, { width: 3600, height: 1801, step: 0.1 })], coverMa: [0.798, -0.01], res: 0.1, seaLevel: 'series' };
  const deep: GridField = { field: field('deep'), mode: 'elevation', snapshots: [0, 5, 10, 15, 20].map((a) => snap(a)), coverMa: [20, -0.01], res: 1 };
  const grids = [relief, deep];
  const bins = timeBins(20, -20, [0, 20, 0.798]);

  it('cuts the bins where the finer field begins, and covers each with the finer field where both do', () => {
    expect(bins).toEqual([[0, -20], [0.798, 0], [20, 0.798]]);
    expect(fieldFor(grids, [0.798, 0])?.field.id).toBe('relief');
    expect(fieldFor(grids, [20, 0.798])?.field.id).toBe('deep');
  });

  it('has the finer levels only in the past bins of the finer field, in cells that tile the globe', () => {
    const lods = fieldLods(bins, grids);
    expect(lods.map((l) => [l.lod, l.step, l.across])).toEqual([[0, 2, 1], [1, 1, 4], [2, 0.25, 12], [3, 0.1, 36]]);
    for (const l of lods.filter((x) => x.lod >= 2)) {
      expect(l.binsMa).toEqual([[0.798, 0]]);
      const area = l.cells.reduce((a, [w, s, e, n]) => a + (e - w) * (n - s), 0);
      expect(area).toBe(360 * 180);
    }
    // A cell of the finest level carries its 100 × 100 nodes and a border of one, whole numbers of them.
    const g = tileGrid(lods[3], lods[3].cells[0]);
    expect([g.nx, g.ny, g.lon0, g.lat0]).toEqual([103, 102, -180.1, 90]);
  });

  it('averages a finer source onto a coarser tile, and takes the finest tile straight from it', () => {
    const src = { width: 3600, height: 1801, step: 0.1 };
    const s = snap(0, src);
    // A ramp from west to east: each node's height is its column.
    for (let k = 0; k < s.elev.length; k++) s.elev[k] = k % src.width;
    const lods = fieldLods(bins, grids);
    const fine = tileGrid(lods[3], [0, 0, 10, 10]);
    const [a] = sliceField([s], fine, new Map());
    // Node (row 0, column 1) of that tile is at 0°E, where the ramp is at column 1800.
    expect(a.elev[1]).toBe(1800);
    const coarse = tileGrid(lods[1], [0, 0, 90, 90]);
    const [b] = sliceField([s], coarse, new Map());
    // A tent over ±1° is symmetric, so a straight ramp averages to its middle.
    expect(b.elev[coarse.nx + 1]).toBe(1800);
  });
});
