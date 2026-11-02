// Pass criteria for the city: what is imported from the map and how, the ground under it, the forms
// it is raised from, and the generated fabric's promises: the same everywhere, clear of everything
// real, as dense as the catalogues say, and undisturbed by an edit elsewhere.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { FORM_PARAMS, formProblem, fromLocal, toLocal, type CityFile, type CityStructure, type FormType } from '../../../core/city.ts';
import { blur, carve, flatten, lowerAround, medianUnder, sampleGrid, type GroundGrid } from '../src/build/ground.ts';
import { assembleRings, elementKey, ohmEntities, ohmKind, ohmYear, snapshotFrom, type OhmElement, type OhmSnapshot } from '../src/ohm.ts';
import { readTiff, sampleRaster, utm } from '../src/tiff.ts';
import { CityBuilder } from '../../../world/generators/city/cells.ts';
import { raise, type FormContext } from '../../../world/generators/city/forms.ts';
import { GroundSampler } from '../../../world/generators/city/ground.ts';
import { Mesh, STRIDE } from '../../../world/generators/city/kit.ts';
import { area, centroid, clipHalf, convexHull, dcos, dsin, hash2, minBox, triangulate } from '../../../world/generators/city/math.ts';
import { fabricPlan, lotPoly, planBytes } from '../../../world/generators/rome/fabric/v1.ts';
import { Skyline } from '../../../viewer/src/city/skyline.ts';
import { autoTilt, groundHit, localView, projectLocal, rayOf, sunAt } from '../../../viewer/src/city/view.ts';
import { fromSearch, quantize, toSearch, type ViewState } from '../../../viewer/src/state.ts';

const time = (start: number | null, end: number | null = null) => ({
  start: { best: start, lo: start ?? -Infinity, hi: start ?? Infinity, derived: false },
  end: { best: end, lo: end ?? -Infinity, hi: end ?? Infinity, derived: false },
  instant: false,
});

const rect = (x: number, y: number, hw: number, hl: number) => [x - hw, y - hl, x + hw, y - hl, x + hw, y + hl, x - hw, y + hl];

function structure(id: string, kind: string, form: CityStructure['form'], rings: number[][], extra: Partial<CityStructure> = {}): CityStructure {
  const at: [number, number] = rings[0] ? centroid(rings[0]) : [0, 0];
  return { id, label: id, kind, form, rings, at, base: 20, time: time(-100), basis: 'reconstruction', curated: true, rank: 1, ...extra };
}

const flatGround = (): GroundSampler => new GroundSampler([{ nx: 2, ny: 2, x0: -9000, y0: -9000, cell: 18000, z: new Float32Array([20, 20, 20, 20]) }]);

describe('deterministic math', () => {
  it('has a sine as good as the platform’s, with nothing to differ between engines', () => {
    for (let x = -20; x <= 20; x += 0.137) {
      expect(dsin(x)).toBeCloseTo(Math.sin(x), 6);
      expect(dcos(x)).toBeCloseTo(Math.cos(x), 6);
    }
  });

  it('clips, hulls, boxes and triangulates polygons', () => {
    const square = rect(0, 0, 10, 10);
    expect(area(clipHalf(square, 1, 0, 0))).toBeCloseTo(200, 6);
    expect(area(convexHull([...square, 0, 0, 5, 5]))).toBeCloseTo(400, 6);
    const c = Math.SQRT1_2;
    const turned = [-30 * c + 5 * c, -30 * c - 5 * c, 30 * c + 5 * c, 30 * c - 5 * c, 30 * c - 5 * c, 30 * c + 5 * c, -30 * c - 5 * c, -30 * c + 5 * c];
    const b = minBox(turned);
    expect(b.hl).toBeCloseTo(30, 6);
    expect(b.hw).toBeCloseTo(5, 6);
    expect(Math.abs(b.ux * c + b.uy * c)).toBeCloseTo(1, 6);
    const triArea = (pts: number[], t: number[]) => {
      let a = 0;
      for (let i = 0; i < t.length; i += 3) a += Math.abs((pts[t[i + 1] * 2] - pts[t[i] * 2]) * (pts[t[i + 2] * 2 + 1] - pts[t[i] * 2 + 1]) - (pts[t[i + 2] * 2] - pts[t[i] * 2]) * (pts[t[i + 1] * 2 + 1] - pts[t[i] * 2 + 1])) / 2;
      return a;
    };
    const L = [0, 0, 20, 0, 20, 10, 10, 10, 10, 20, 0, 20];
    const one = triangulate(L);
    expect(triArea(one.points, one.tris)).toBeCloseTo(300, 6);
    const holed = triangulate(rect(0, 0, 10, 10), [rect(0, 0, 3, 3)]);
    expect(triArea(holed.points, holed.tris)).toBeCloseTo(400 - 36, 6);
  });

  it('gives the same numbers for the same place, whatever else exists', () => {
    expect(hash2(3, 4, 99)).toBe(hash2(3, 4, 99));
    expect(hash2(3, 4, 99)).not.toBe(hash2(4, 3, 99));
  });
});

describe('the map’s snapshot', () => {
  const raw = {
    elements: [
      { type: 'way', id: 1, tags: { name: 'Templum', building: 'temple', start_date: '-0496', end_date: '0400', 'wikipedia': 'x' }, geometry: [{ lat: 41.9, lon: 12.5 }, { lat: 41.9, lon: 12.501 }, { lat: 41.901, lon: 12.501 }, { lat: 41.9, lon: 12.5 }] },
      { type: 'way', id: 2, tags: { name: 'Chiesa', building: 'church', start_date: '1500' }, geometry: [] },
      { type: 'way', id: 3, tags: { name: 'Licensed', building: 'yes', start_date: '0100', license: 'ODbL' }, geometry: [] },
      { type: 'relation', id: 4, tags: { name: 'Imperium', boundary: 'administrative', start_date: '0100' }, members: [] },
      { type: 'relation', id: 5, tags: { name: 'Tiberis', natural: 'water', type: 'multipolygon' }, members: [
        { type: 'way', role: 'outer', geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }] },
        { type: 'way', role: 'outer', geometry: [{ lat: 1, lon: 1 }, { lat: 0, lon: 1 }] },
        { type: 'way', role: 'outer', geometry: [{ lat: 1, lon: 1 }, { lat: 0, lon: 0 }] },
      ] },
      { type: 'node', id: 6, tags: { name: 'Porta', historic: 'city_gate', start_date: '0275' }, lat: 41.9, lon: 12.5 },
    ],
  };

  it('keeps what is of antiquity and free to use, in a stable order, and joins relations into rings', () => {
    const s = snapshotFrom(raw, '2026-11-01', [41, 12, 42, 13]);
    expect(s.elements.map(elementKey)).toEqual(['node/6', 'relation/5', 'way/1']);
    expect(s.elements[2].tags.wikipedia).toBeUndefined();
    expect(s.elements[1].outer).toHaveLength(1);
    expect(s.elements[1].outer![0]).toHaveLength(4);
    expect(s.query).toContain('41,12,42,13');
  });

  it('joins ways end to end, either way round, and leaves what will not close as a chain', () => {
    const a: [number, number] = [0, 0];
    const b: [number, number] = [0, 1];
    const c: [number, number] = [1, 1];
    expect(assembleRings([[a, b], [c, b], [c, a]])[0]).toHaveLength(4);
    expect(assembleRings([[a, b], [[5, 5], [6, 6]]])).toHaveLength(2);
  });

  it('reads the map’s dates as years on the axis, with 1 BCE as year 0', () => {
    expect(ohmYear('-0496')).toBe(-496);
    expect(ohmYear('0075-01-01')).toBe(75);
    expect(ohmYear('312-10-28')).toBe(312);
    expect(ohmYear('0400?')).toBe(400);
    expect(ohmYear('sometime')).toBeUndefined();
  });

  it('says what kind of thing an element is', () => {
    const kind = (tags: Record<string, string>) => ohmKind({ type: 'way', id: 1, tags });
    expect(kind({ building: 'temple' })).toBe('building/temple');
    expect(kind({ amenity: 'theatre', 'theatre:type': 'amphi' })).toBe('building/amphitheatre');
    expect(kind({ highway: 'primary' })).toBe('works/road');
    expect(kind({ waterway: 'canal', name: 'Cloaca Maxima' })).toBe('works/sewer');
    expect(kind({ waterway: 'canal', name: 'Aqua Claudia' })).toBe('works/aqueduct');
    expect(kind({ building: 'yes', name: 'Arcus Titi' })).toBe('monument/arch');
    expect(kind({ leisure: 'garden' })).toBe('open/garden');
    expect(kind({ place: 'islet', name: 'Insula Tiberina' })).toBe('open/island');
  });

  it('makes each element a machine’s proposal, unless a written record has adopted it, and keeps a start that follows its end', () => {
    const snap: OhmSnapshot = { format: 'lightworld-ohm-snapshot@1', snapshot: '2026-11-01', bbox: [0, 0, 1, 1], query: '', elements: [
      { type: 'way', id: 1, tags: { name: 'A', building: 'temple', start_date: '0100', end_date: '0050', height: '12' }, line: [[0, 0], [0, 1], [1, 1], [0, 0]] },
      { type: 'way', id: 2, tags: { name: 'B', building: 'yes', start_date: '0100' }, line: [[0, 0], [0, 1], [1, 1], [0, 0]] },
    ] as OhmElement[] };
    const out = ohmEntities(snap, 'src:x', 'f.json', 'frame:f', new Set(['way/2']));
    expect(out.map((e) => e.id)).toEqual(['rome/ohm/way-1']);
    const claims = Object.fromEntries(out[0].claims.map((c) => [c.prop, c]));
    expect(claims.start.value).toBe('100 CE');
    expect(claims.end).toBeUndefined();
    expect(claims.start.status).toBe('proposed');
    expect(claims.start.author).toBe('machine:ohm-import');
    expect(claims.start.note).toContain('before its start');
    expect(claims.height.value).toBe(12);
    expect(claims.footprint.value).toEqual({ from: 'src:x', elements: ['way/1'] });
  });

  it('calls the river what the rest of the map’s stretches are called, and keeps the name it has', () => {
    const line: [number, number][] = [[0, 0], [0, 1], [1, 1], [0, 0]];
    const river = (id: number, tags: Record<string, string>): OhmElement => ({ type: 'way', id, tags: { natural: 'water', water: 'river', ...tags }, line });
    const snap: OhmSnapshot = { format: 'lightworld-ohm-snapshot@1', snapshot: '2026-11-01', bbox: [0, 0, 1, 1], query: '', elements: [river(1, { name: 'Tiberis' }), river(2, {})] };
    const names = ohmEntities(snap, 'src:x', 'f.json', 'frame:f', new Set()).map((e) => e.claims.find((c) => c.prop === 'name')!.value);
    expect(names).toEqual([{ en: 'The Tiber', la: 'Tiberis' }, { en: 'The Tiber' }]);
  });
});

describe('form claims', () => {
  it('say only what a form can hold', () => {
    expect(formProblem({ type: 'temple', order: 'corinthian' })).toBeUndefined();
    expect(formProblem({ type: 'temple', arches: 3 })).toContain('has no "arches"');
    expect(formProblem({ type: 'pagoda' })).toContain('no form "pagoda"');
    expect(formProblem('temple')).toContain('a mapping');
  });
});

describe('reading elevation grids', () => {
  const tiff = (tags: [number, number, number, number[]][], blocks: Uint8Array[]): string => {
    // Classic little-endian TIFF, its values out of line after its directory.
    const dir = 8;
    const size = 2 + tags.length * 12 + 4;
    let at = dir + size;
    const chunks: Uint8Array[] = [];
    const entries: number[][] = [];
    const push = (b: Uint8Array) => {
      const o = at;
      chunks.push(b);
      at += b.length;
      return o;
    };
    const offs = blocks.map(push);
    const bytes: Record<number, number> = { 3: 2, 4: 4, 12: 8 };
    for (const [tag, type, n, vals] of tags) {
      const values = tag === 273 || tag === 324 ? offs : vals;
      const total = bytes[type] * n;
      if (total <= 4) {
        const v = new DataView(new ArrayBuffer(4));
        values.forEach((x, i) => (type === 3 ? v.setUint16(i * 2, x, true) : v.setUint32(i * 4, x, true)));
        entries.push([tag, type, n, v.getUint32(0, true)]);
      } else {
        const b = new Uint8Array(total);
        const v = new DataView(b.buffer);
        values.forEach((x, i) => (type === 3 ? v.setUint16(i * 2, x, true) : type === 4 ? v.setUint32(i * 4, x, true) : v.setFloat64(i * 8, x, true)));
        entries.push([tag, type, n, push(b)]);
      }
    }
    const head = new DataView(new ArrayBuffer(dir + size));
    head.setUint8(0, 0x49);
    head.setUint8(1, 0x49);
    head.setUint16(2, 42, true);
    head.setUint32(4, dir, true);
    head.setUint16(dir, entries.length, true);
    entries.forEach(([tag, type, n, v], i) => {
      const o = dir + 2 + i * 12;
      head.setUint16(o, tag, true);
      head.setUint16(o + 2, type, true);
      head.setUint32(o + 4, n, true);
      head.setUint32(o + 8, v, true);
    });
    const path = join(mkdtempSync(join(tmpdir(), 'tiff-')), 't.tif');
    writeFileSync(path, Buffer.concat([new Uint8Array(head.buffer), ...chunks]));
    return path;
  };

  it('reads raw 16-bit strips', async () => {
    const px = new Int16Array([1, 2, 3, 4]);
    const path = tiff([[256, 4, 1, [2]], [257, 4, 1, [2]], [258, 3, 1, [16]], [259, 3, 1, [1]], [273, 4, 1, [0]], [277, 3, 1, [1]], [278, 4, 1, [2]], [279, 4, 1, [8]], [339, 3, 1, [2]], [33550, 12, 3, [10, 10, 0]], [33922, 12, 6, [0, 0, 0, 100, 200, 0]]], [new Uint8Array(px.buffer)]);
    const r = await readTiff(path);
    expect([...r.data]).toEqual([1, 2, 3, 4]);
    expect([r.x0, r.y0, r.dx, r.dy]).toEqual([100, 200, 10, 10]);
    // Pixel centres: (105, 195) is the first.
    expect(sampleRaster(r, 105, 195)).toBeCloseTo(1, 6);
    expect(sampleRaster(r, 110, 190)).toBeCloseTo(2.5, 6);
    expect(sampleRaster(r, 500, 500)).toBeUndefined();
  });

  it('reads deflated floats under the floating-point predictor', async () => {
    const values = new Float32Array([1.5, -2.25, 1000.125, 0.5]);
    const raw = new DataView(values.buffer);
    // Split into planes, most significant first, then difference along the row.
    const row = new Uint8Array(16);
    for (let i = 0; i < 4; i++) for (let b = 0; b < 4; b++) row[b * 4 + i] = raw.getUint8(i * 4 + (3 - b));
    for (let i = 15; i > 0; i--) row[i] = (row[i] - row[i - 1]) & 255;
    const path = tiff([[256, 4, 1, [4]], [257, 4, 1, [1]], [258, 3, 1, [32]], [259, 3, 1, [8]], [317, 3, 1, [3]], [273, 4, 1, [0]], [277, 3, 1, [1]], [278, 4, 1, [1]], [279, 4, 1, [zlibSync(row).length]], [339, 3, 1, [3]], [33550, 12, 3, [1, 1, 0]], [33922, 12, 6, [0, 0, 0, 0, 0, 0]]], [zlibSync(row)]);
    const r = await readTiff(path);
    expect([...r.data]).toEqual([1.5, -2.25, 1000.125, 0.5]);
  });

  it('projects onto UTM as the survey does', () => {
    // The tile w46075 runs from 750 km to 800 km east in zone 32, and Rome lies in it.
    const [e, n] = utm(41.8925, 12.4853, 32);
    expect(e).toBeGreaterThan(780000);
    expect(e).toBeLessThan(800000);
    expect(n).toBeGreaterThan(4630000);
    expect(n).toBeLessThan(4650000);
    expect(utm(0, 9, 32)[0]).toBeCloseTo(500000, 3);
  });
});

describe('the ground', () => {
  const hill = (): GroundGrid => {
    const nx = 41;
    const z = new Float32Array(nx * nx);
    for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = 30 + (i - 20) * 0.5;
    return { x0: -200, y0: -200, nx, ny: nx, cell: 10, z };
  };

  it('is level under a place, and eases back around it', () => {
    const g = hill();
    flatten(g, { rings: [rect(0, 0, 40, 40)], level: 12, margin: 30 });
    expect(sampleGrid(g, 0, 0)).toBeCloseTo(12, 5);
    expect(sampleGrid(g, 30, 30)).toBeCloseTo(12, 5);
    const far = 30 + 18 * 0.5;
    expect(sampleGrid(g, 180, 0)).toBeCloseTo(far + 0, 0);
    const mid = sampleGrid(g, 60, 0);
    expect(mid).toBeGreaterThan(12);
    expect(mid).toBeLessThan(36);
  });

  it('has a river bed under the water, and low banks by it', () => {
    const g = hill();
    carve(g, [rect(0, 0, 200, 30)], [rect(0, 0, 20, 15)], 7, 40);
    expect(sampleGrid(g, 100, 0)).toBeCloseTo(3, 5);
    // The island stands clear of the water.
    expect(sampleGrid(g, 0, 0)).toBeCloseTo(10.5, 5);
    expect(sampleGrid(g, 100, 40)).toBeLessThan(30);
    // Far from the bank the ground is as it was.
    expect(sampleGrid(g, 100, 150)).toBeCloseTo(35, 5);
  });

  it('carves a river the map has twice, as it does one it has once', () => {
    const reach = rect(0, 0, 200, 30);
    const g = hill();
    carve(g, [reach, reach], [], 7, 40);
    expect(sampleGrid(g, 100, 0)).toBeCloseTo(3, 5);
    // Reaches that overlap are water all the way along too.
    const h = hill();
    carve(h, [rect(-100, 0, 110, 30), rect(100, 0, 110, 30)], [], 7, 40);
    expect(sampleGrid(h, 5, 0)).toBeCloseTo(3, 5);
  });

  it('lets a buried valley down, but never raises ground', () => {
    const g = hill();
    lowerAround(g, 0, 0, 10, 100);
    expect(sampleGrid(g, 0, 0)).toBeCloseTo(10, 4);
    expect(sampleGrid(g, 190, 190)).toBeCloseTo(39.5, 5);
    const before = sampleGrid(g, 150, 0);
    lowerAround(g, 150, 0, before + 20, 40);
    expect(sampleGrid(g, 150, 0)).toBeCloseTo(before, 6);
  });

  it('smooths a step without moving the mean, and finds the median under a ring', () => {
    const g = hill();
    const before = sampleGrid(g, 0, 0);
    blur(g, 2);
    expect(sampleGrid(g, 0, 0)).toBeCloseTo(before, 3);
    expect(medianUnder(g, [rect(0, 0, 30, 30)])).toBeCloseTo(30, 0);
  });

  it('eases from a finer grid to a coarser one, as the shader does', () => {
    const coarse = { nx: 3, ny: 3, x0: -1000, y0: -1000, cell: 1000, z: new Float32Array(9).fill(50) };
    const fine = { nx: 201, ny: 201, x0: -500, y0: -500, cell: 5, z: new Float32Array(201 * 201).fill(10) };
    const s = new GroundSampler([fine, coarse]);
    expect(s.at(0, 0)).toBeCloseTo(10, 5);
    expect(s.at(800, 800)).toBeCloseTo(50, 5);
    const edge = s.at(495, 0);
    expect(edge).toBeGreaterThan(10);
    expect(edge).toBeLessThan(50);
  });

  it('reads decimetres the same as the build’s metres', () => {
    const a = new GroundSampler([{ nx: 2, ny: 2, x0: 0, y0: 0, cell: 10, z: new Int16Array([100, 200, 300, 400]) }]);
    expect(a.at(0, 0)).toBeCloseTo(10, 5);
    expect(a.at(5, 5)).toBeCloseTo(25, 5);
  });
});

describe('the forms', () => {
  const ctx: FormContext = { ground: flatGround(), detail: 1, water: 7, clip: [-5000, -5000, 5000, 5000], streetDistance: (x, y) => Math.hypot(x, y), wallDirection: () => [1, 0] };
  const footprint = rect(100, 50, 30, 60);
  const lined = (type: FormType) => (type === 'wall' || type === 'aqueduct' || type === 'bridge' ? { rings: [] as number[][], lines: [[0, 0, 200, 40, 400, 40]], kind: type === 'wall' ? 'works/wall' : type === 'bridge' ? 'works/bridge' : 'works/aqueduct' } : {});

  const check = (m: Mesh, label: string) => {
    const { vertices, indices } = m.arrays();
    const f = new Float32Array(vertices);
    const b = new Uint8Array(vertices);
    const n = vertices.byteLength / STRIDE;
    expect(n, `${label} draws something`).toBeGreaterThan(0);
    expect(indices.length % 3, label).toBe(0);
    for (const i of indices) if (i >= n) throw new Error(`${label}: index ${i} past ${n}`);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) if (!Number.isFinite(f[i * 7 + k])) throw new Error(`${label}: vertex ${i} is not finite`);
      if (!Number.isFinite(f[i * 7 + 4]) || !Number.isFinite(f[i * 7 + 5])) throw new Error(`${label}: uv ${i} is not finite`);
      const nx = b[i * STRIDE + 12] / 255 - 0.5;
      const ny = b[i * STRIDE + 13] / 255 - 0.5;
      const nz = b[i * STRIDE + 14] / 255 - 0.5;
      const l = Math.hypot(nx, ny, nz) * 2;
      if (l < 0.75 || l > 1.25) throw new Error(`${label}: normal ${i} has length ${l}`);
    }
    return { f, n };
  };

  for (const type of Object.keys(FORM_PARAMS) as FormType[]) {
    it(`raises a ${type} near and far, with sound geometry`, () => {
      const counts = [0, 1].map((detail) => {
        const m = new Mesh();
        m.entity = 7;
        const s = structure('t', 'building/other', { type }, [footprint], lined(type));
        raise(m, s, { ...ctx, detail });
        const { f, n } = check(m, `${type} at detail ${detail}`);
        // Everything stands near its footprint: a form must not fly off.
        for (let i = 0; i < n; i++) {
          const dx = Math.abs(f[i * 7] - s.at[0]);
          const dy = Math.abs(f[i * 7 + 1] - s.at[1]);
          if (Math.hypot(dx, dy) > 600) throw new Error(`${type}: vertex ${i} is ${Math.hypot(dx, dy)} m away`);
          if (f[i * 7 + 2] < -10 || f[i * 7 + 2] > 220) throw new Error(`${type}: vertex ${i} at height ${f[i * 7 + 2]}`);
        }
        return m.count;
      });
      // Up close is never less than from afar.
      expect(counts[1]).toBeGreaterThanOrEqual(counts[0]);
    });
  }

  /** What share of lines of sight from outside first meet the back of a face, and whether a given line meets anything. */
  const triangles = (m: Mesh) => {
    const { vertices, indices } = m.arrays();
    const f = new Float32Array(vertices);
    const p = (i: number) => [f[i * 7], f[i * 7 + 1], f[i * 7 + 2]];
    const out: number[][][] = [];
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = [p(indices[i]), p(indices[i + 1]), p(indices[i + 2])];
      const e = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const g = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [e[1] * g[2] - e[2] * g[1], e[2] * g[0] - e[0] * g[2], e[0] * g[1] - e[1] * g[0]];
      if (Math.hypot(...n) > 1e-6) out.push([a, b, c, n]);
    }
    return out;
  };
  const firstHit = (tris: number[][][], o: number[], d: number[]): { u: number; back: boolean } | undefined => {
    let best: { u: number; back: boolean } | undefined;
    for (const [a, b, c, n] of tris) {
      const den = n[0] * d[0] + n[1] * d[1] + n[2] * d[2];
      if (den === 0) continue;
      const u = (n[0] * (a[0] - o[0]) + n[1] * (a[1] - o[1]) + n[2] * (a[2] - o[2])) / den;
      if (u <= 0 || (best && u >= best.u)) continue;
      const q = [o[0] + d[0] * u, o[1] + d[1] * u, o[2] + d[2] * u];
      const side = (v: number[], w: number[]) => {
        const e = [w[0] - v[0], w[1] - v[1], w[2] - v[2]];
        const g = [q[0] - v[0], q[1] - v[1], q[2] - v[2]];
        return (e[1] * g[2] - e[2] * g[1]) * n[0] + (e[2] * g[0] - e[0] * g[2]) * n[1] + (e[0] * g[1] - e[1] * g[0]) * n[2];
      };
      if (side(a, b) >= 0 && side(b, c) >= 0 && side(c, a) >= 0) best = { u, back: den > 0 };
    }
    return best;
  };

  for (const [type, kind, ring] of [
    ['amphitheatre', 'building/amphitheatre', rect(0, 0, 78, 94)],
    ['theatre', 'building/theatre', rect(0, 0, 65, 65)],
    ['circus', 'building/circus', rect(0, 0, 60, 300)],
  ] as const) {
    it(`shows the outside of a ${type} from outside: its arcades are not inside out`, () => {
      const m = new Mesh();
      raise(m, structure('t', kind, { type }, [[...ring]]), ctx);
      const tris = triangles(m);
      const top = m.top();
      let hits = 0;
      let backs = 0;
      for (let k = 0; k < 24; k++) {
        const t = ((k + 0.37) / 24) * 2 * Math.PI;
        for (const h of [0.15, 0.4, 0.65]) {
          const hit = firstHit(tris, [Math.cos(t) * 500, Math.sin(t) * 500, 20 + (top - 20) * h], [-Math.cos(t), -Math.sin(t), 0]);
          if (!hit) continue;
          hits++;
          if (hit.back) backs++;
        }
      }
      expect(hits).toBeGreaterThan(40);
      expect(backs / hits).toBeLessThan(0.08);
    });
  }

  it('keeps every face turned the way its normal says', () => {
    const m = new Mesh();
    // Deliberately wound the wrong way round, with a normal facing +y.
    const a = m.v(0, 0, 0, 0, 1, 0, 0, 0);
    const b = m.v(1, 0, 0, 0, 1, 0, 0, 0);
    const c = m.v(0, 0, 1, 0, 1, 0, 0, 0);
    m.tri(a, b, c);
    const [t] = triangles(m);
    expect(t[3][1]).toBeGreaterThan(0);
  });

  it('opens an arch, an aqueduct and a gate right through', () => {
    const through = (s: CityStructure, o: number[], d: number[]) => {
      const m = new Mesh();
      raise(m, s, ctx);
      return firstHit(triangles(m), o, d);
    };
    const arch = structure('a', 'monument/arch', { type: 'arch', bays: 3, width: 26, depth: 8, faces: 0 }, [rect(0, 0, 13, 4)], { height: 21 });
    expect(through(arch, [0, -100, 22], [0, 1, 0])).toBeUndefined();
    // Its piers stand either side of the way through.
    expect(through(arch, [12.5, -100, 22], [0, 1, 0])).toBeDefined();
    const aqueduct = structure('q', 'works/aqueduct', { type: 'aqueduct' }, [], { lines: [[-200, 0, 200, 0]] });
    const m = new Mesh();
    raise(m, aqueduct, ctx);
    const tris = triangles(m);
    let open = 0;
    for (let x = -100; x < 100; x += 1.3) if (!firstHit(tris, [x, -100, 22], [0, 1, 0])) open++;
    expect(open).toBeGreaterThan(40);
  });

  it('takes columns and height from the claim, and turns the front the way it faces', () => {
    const count = (front: number) => {
      const m = new Mesh();
      raise(m, structure('t', 'building/temple', { type: 'temple', front, side: 8, plan: 'peripteral', order: 'corinthian' }, [rect(0, 0, 10, 20)]), ctx);
      return m.count;
    };
    expect(count(8)).toBeGreaterThan(count(4));
    const stairsSide = (faces: number) => {
      const m = new Mesh();
      raise(m, structure('t', 'building/temple', { type: 'temple', faces, plan: 'prostyle' }, [rect(0, 0, 10, 20)]), ctx);
      const f = new Float32Array(m.arrays().vertices);
      let sum = 0;
      const n = f.length / 7;
      // The steps are low down and far forward: the mean of the low vertices leans toward the front.
      let c = 0;
      for (let i = 0; i < n; i++) {
        if (f[i * 7 + 2] < 21) {
          sum += f[i * 7 + 1];
          c++;
        }
      }
      return sum / c;
    };
    expect(stairsSide(0)).toBeGreaterThan(stairsSide(180));
  });

  it('draws an amphitheatre to the height its record gives', () => {
    const m = new Mesh();
    raise(m, structure('c', 'building/amphitheatre', { type: 'amphitheatre', tiers: 3, attic: true, bays: 80 }, [rect(0, 0, 96, 78)], { height: 48.5 }), ctx);
    const f = new Float32Array(m.arrays().vertices);
    let top = 0;
    for (let i = 0; i < f.length / 7; i++) if (f[i * 7 + 2] > top && Math.hypot(f[i * 7], f[i * 7 + 1]) < 200) top = f[i * 7 + 2];
    // Its masts rise above the wall by a few metres.
    expect(top).toBeGreaterThan(20 + 48.5);
    expect(top).toBeLessThan(20 + 48.5 + 8);
  });

  it('walks a wall stretch by stretch, so a cell draws only what falls in it', () => {
    const s = structure('w', 'works/wall', { type: 'wall' }, [], { lines: [[0, 0, 1000, 0]] });
    const part = new Mesh();
    raise(part, s, { ...ctx, clip: [0, -50, 200, 50] });
    const whole = new Mesh();
    raise(whole, s, { ...ctx, clip: [0, -50, 1000, 50] });
    expect(part.count).toBeGreaterThan(0);
    expect(part.count).toBeLessThan(whole.count * 0.3);
  });
});

/** A small city: a wall around it, a street, some monuments, two regions the catalogues count differently. */
function smallCity(extra: CityStructure[] = []): CityFile {
  const R = 900;
  const wall: number[] = [];
  for (let i = 0; i < 24; i++) wall.push(Math.round(Math.cos((i / 24) * 2 * Math.PI) * R * 100) / 100, Math.round(Math.sin((i / 24) * 2 * Math.PI) * R * 100) / 100);
  const params = {
    site: { id: 'x', label: 'X', origin: { lat: 41.9, lon: 12.5 }, span: [-1000, 1950], slice: 315, water_level: 7 },
    block: 78,
    street: 3.2,
    insula_area: 620,
    domus_area: 1100,
    domus_weight: 1.8,
    storeys: [3, 6],
    storey_height: 3.3,
    tree_spacing: 22,
  };
  return {
    format: 'lightworld-city@1',
    site: { id: 'x', label: 'X', origin: params.site.origin, span: [-1000, 1950], slice: 315, water_level: 7 },
    ground: [],
    structures: [
      structure('rome/aurelian-walls', 'works/wall', { type: 'wall' }, [], { lines: [[...wall, wall[0], wall[1]]], at: [R, 0] }),
      structure('x/street', 'works/road', { type: 'generic' }, [], { lines: [[-R, 0, R, 0]], look: { highway: 'primary' }, at: [0, 0] }),
      structure('x/temple', 'building/temple', { type: 'temple' }, [rect(-300, 200, 40, 60)]),
      structure('x/later', 'building/temple', { type: 'temple' }, [rect(300, 200, 40, 60)], { time: time(1000) }),
      structure('x/garden', 'open/garden', { type: 'generic' }, [rect(0, -500, 120, 120)]),
      ...extra,
    ].sort((a, b) => (a.id < b.id ? -1 : 1)),
    water: [rect(700, -700, 50, 150)],
    islands: [],
    fabric: {
      generator: 'gen:rome/fabric',
      version: 1,
      seed: 'x/fabric',
      basis: 'procedural',
      params,
      regions: [
        { id: 'x/west', label: 'West', at: [-450, 0], insulae: 4000, domus: 100 },
        { id: 'x/east', label: 'East', at: [450, 0], insulae: 1000, domus: 100 },
      ],
      outputSha256: '',
    },
  };
}

describe('the generated fabric', () => {
  const ground = flatGround();

  it('is the same every time, to the byte', () => {
    expect(planBytes(fabricPlan(smallCity(), ground))).toEqual(planBytes(fabricPlan(smallCity(), ground)));
  });

  it('builds on nothing real: no monument standing at its date, no garden, no river, no street', () => {
    const c = smallCity();
    const plan = fabricPlan(c, ground);
    expect(plan.lots).toBeGreaterThan(200);
    const temple = c.structures.find((s) => s.id === 'x/temple')!.rings[0];
    const garden = c.structures.find((s) => s.id === 'x/garden')!.rings[0];
    const inside = (r: number[], x: number, y: number) => x > r[0] && x < r[2] && y > r[1] && y < r[5];
    for (let i = 0; i < plan.lots; i++) {
      const p = lotPoly(plan, i);
      for (let k = 0; k < p.length; k += 2) {
        expect(inside(temple, p[k], p[k + 1])).toBe(false);
        expect(inside(garden, p[k], p[k + 1])).toBe(false);
        expect(inside(c.water[0], p[k], p[k + 1])).toBe(false);
      }
      const [cx, cy] = centroid(p);
      // The street runs along y = 0, 7.5 m wide.
      expect(Math.abs(cy)).toBeGreaterThan(3);
      expect(Number.isFinite(cx)).toBe(true);
    }
  });

  it('does not keep clear of what is not yet built', () => {
    const c = smallCity();
    const plan = fabricPlan(c, ground);
    const later = c.structures.find((s) => s.id === 'x/later')!.rings[0];
    let overlaps = 0;
    for (let i = 0; i < plan.lots; i++) {
      const [x, y] = centroid(lotPoly(plan, i));
      if (x > later[0] && x < later[2] && y > later[1] && y < later[5]) overlaps++;
    }
    expect(overlaps).toBeGreaterThan(0);
  });

  it('is as dense in each region as the catalogues say', () => {
    const plan = fabricPlan(smallCity(), ground);
    // West counts four times the insulae of East, on about as much ground.
    expect(plan.regionLots[0] / plan.regionLots[1]).toBeGreaterThan(1.8);
  });

  it('is left alone by an edit elsewhere: only blocks near a moved temple change', () => {
    const a = fabricPlan(smallCity(), ground);
    // A change of height changes nothing.
    const taller = smallCity();
    taller.structures.find((s) => s.id === 'x/temple')!.height = 40;
    expect(planBytes(fabricPlan(taller, ground))).toEqual(planBytes(a));
    // Adding a temple changes what is near it, and leaves the far side of the city as it was.
    const edited = fabricPlan(smallCity([structure('x/new', 'building/temple', { type: 'temple' }, [rect(-400, -300, 30, 40)])]), ground);
    const key = (p: typeof a, i: number) => lotPoly(p, i).join();
    const before = new Set(Array.from({ length: a.lots }, (_, i) => key(a, i)));
    const after = new Set(Array.from({ length: edited.lots }, (_, i) => key(edited, i)));
    let farDiff = 0;
    for (let i = 0; i < a.lots; i++) {
      const [x, y] = centroid(lotPoly(a, i));
      if (Math.hypot(x + 400, y + 300) > 450 && !after.has(key(a, i))) farDiff++;
    }
    expect(farDiff / a.lots).toBeLessThan(0.3);
    expect([...before].some((k) => !after.has(k))).toBe(true);
  });

  it('cuts into cells, each entity in its place, and draws nothing past its own', () => {
    const c = smallCity();
    const b = new CityBuilder(c, [{ nx: 2, ny: 2, x0: -9000, y0: -9000, cell: 18000, z: new Float32Array([20, 20, 20, 20]) }]);
    const cells = b.cells();
    expect(cells.length).toBeGreaterThan(10);
    const entities = b.entities();
    const kept = c.structures.findIndex((s) => s.id === 'x/later');
    expect(entities[(kept + 1) * 4]).toBe(1000);
    expect(entities[(kept + 1) * 4 + 2]).toBe(1);
    expect(entities[b.lotEntity * 4 + 2]).toBe(3);
    expect(entities[b.treeEntity * 4 + 2]).toBe(3);
    let verts = 0;
    for (const k of cells) verts += b.build(k, 0).verts;
    expect(verts).toBeGreaterThan(1000);
    const fine = b.build(cells[Math.floor(cells.length / 2)], 1);
    expect(fine.count).toBeGreaterThan(0);
    const { data } = b.mask(256);
    let built = 0;
    let garden = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]) built++;
      if (data[i + 1]) garden++;
    }
    expect(built).toBeGreaterThan(0);
    expect(garden).toBeGreaterThan(0);
    const w = b.water();
    expect(w.indices.length).toBeGreaterThan(0);
    expect(w.vertices[2]).toBe(7);
    // A structure's height is what it was raised to; one drawn along a line has none.
    const tops = b.tops();
    expect(tops[kept]).toBeGreaterThan(20);
    expect(tops[c.structures.findIndex((s) => s.id === 'rome/aurelian-walls')]).toBe(0);
  });
});

describe('what the eye can see', () => {
  const always = [-Infinity, Infinity] as const;
  const sky = () => {
    const s = new Skyline();
    s.add(rect(0, 0, 20, 20), 50, ...always, 1);
    // A court: its walls stand round an open space.
    s.add(rect(200, 0, 40, 40), 30, ...always, 2);
    s.add(rect(0, 200, 20, 20), 60, 300, 400, 3);
    return s;
  };

  it('is cut by a wall lower down, and passes over one that is lower than the line', () => {
    const s = sky();
    expect(s.blocked(-100, 0, 22, 100, 0, 22, 0, -1)).toBe(true);
    expect(s.blocked(-100, 0, 80, 100, 0, 80, 0, -1)).toBe(false);
    // Coming down from high up to well beyond it, it clears the wall.
    expect(s.blocked(-100, 0, 400, 60, 0, 22, 0, -1)).toBe(false);
    // Coming down close behind it, it does not.
    expect(s.blocked(-100, 0, 400, 25, 0, 22, 0, -1)).toBe(true);
    // Nothing in the way.
    expect(s.blocked(-100, 100, 22, 100, 100, 22, 0, -1)).toBe(false);
  });

  it('is not cut by what it looks at', () => {
    expect(sky().blocked(-100, 0, 22, 0, 0, 45, 0, 1)).toBe(false);
  });

  it('sees across a court from inside it, and not through its walls from outside', () => {
    const s = sky();
    expect(s.blocked(180, 0, 22, 220, 0, 22, 0, -1)).toBe(false);
    expect(s.blocked(100, 0, 22, 200, 0, 22, 0, -1)).toBe(true);
  });

  it('is cut only by what stands at the time', () => {
    const s = sky();
    expect(s.blocked(-100, 200, 22, 100, 200, 22, 350, -1)).toBe(true);
    expect(s.blocked(-100, 200, 22, 100, 200, 22, 100, -1)).toBe(false);
  });

  it('follows a line at any angle across buckets', () => {
    const s = new Skyline();
    s.add(rect(137, -91, 1, 1), 50, ...always, 1);
    expect(s.blocked(-500, -91 - 637 * 0.002, 22, 900, -91 + 763 * 0.002, 22, 0, -1)).toBe(true);
    expect(s.blocked(137, -500, 22, 137, 500, 22, 0, -1)).toBe(true);
    expect(s.blocked(137, 500, 22, 137, -500, 22, 0, -1)).toBe(true);
    expect(s.blocked(900, -91, 22, -500, -91, 22, 0, -1)).toBe(true);
  });
});

describe('the camera near the ground', () => {
  const origin = { lat: 41.8925, lon: 12.4853 };
  const ground = new GroundSampler([{ nx: 2, ny: 2, x0: -1e6, y0: -1e6, cell: 2e6, z: new Float32Array([30, 30, 30, 30]) }]);
  const R = 6371000;

  it('looks straight down from over the point it is given, with north up', () => {
    const v = localView({ lat: origin.lat, lon: origin.lon, dist: 1 + 500 / R }, origin, ground, 1000, 500);
    expect(v.eye[0]).toBeCloseTo(0, 3);
    expect(v.eye[1]).toBeCloseTo(0, 3);
    expect(v.eye[2]).toBeCloseTo(530, 1);
    expect(v.forward).toEqual([0, 0, -1]);
    expect(v.up[1]).toBeCloseTo(1, 6);
    const p = projectLocal(v, 0, 0, 30)!;
    expect(p.x).toBeCloseTo(500, 3);
    expect(p.y).toBeCloseTo(250, 3);
    const north = projectLocal(v, 0, 100, 30)!;
    expect(north.y).toBeLessThan(250);
    const east = projectLocal(v, 100, 0, 30)!;
    expect(east.x).toBeGreaterThan(500);
  });

  it('stands back along its heading when tilted, looking at the same point', () => {
    const v = localView({ lat: origin.lat, lon: origin.lon, dist: 1 + 100 / R, heading: 90, tilt: 60 }, origin, ground, 1000, 500);
    // Facing east, so standing to the west.
    expect(v.eye[0]).toBeLessThan(-80);
    expect(v.eye[1]).toBeCloseTo(0, 3);
    expect(v.eye[2]).toBeGreaterThan(30);
    const p = projectLocal(v, v.target[0], v.target[1], v.target[2])!;
    expect(p.x).toBeCloseTo(500, 3);
    expect(p.y).toBeCloseTo(250, 3);
  });

  it('never goes under the ground, and can look up from the street', () => {
    const v = localView({ lat: origin.lat, lon: origin.lon, dist: 1 + 3 / R, heading: 0, tilt: 105 }, origin, ground, 1000, 500);
    expect(v.eye[2]).toBeGreaterThanOrEqual(30 + 1.7 - 1e-6);
    expect(v.forward[2]).toBeGreaterThan(0);
  });

  it('finds where a ray meets the ground, and the middle of the screen is where it looks', () => {
    const v = localView({ lat: origin.lat, lon: origin.lon, dist: 1 + 800 / R, heading: 30, tilt: 45 }, origin, ground, 1000, 500);
    const d = rayOf(v, 500, 250);
    expect(d[0]).toBeCloseTo(v.forward[0], 6);
    expect(d[2]).toBeCloseTo(v.forward[2], 6);
    const hit = groundHit(v, d, ground)!;
    expect(hit[0]).toBeCloseTo(v.target[0], 0);
    expect(hit[1]).toBeCloseTo(v.target[1], 0);
    expect(hit[2]).toBeCloseTo(30, 0);
    // Looking at the sky hits nothing.
    expect(groundHit(v, [0, 0, 1], ground)).toBeUndefined();
  });

  it('holds a place to the centimetre', () => {
    const [lat, lon] = fromLocal(origin, 123.45, -67.89);
    const [x, y] = toLocal(origin, lat, lon);
    expect(x).toBeCloseTo(123.45, 6);
    expect(y).toBeCloseTo(-67.89, 6);
  });

  it('tilts by itself as it comes down, and looks straight down from orbit', () => {
    expect(autoTilt(1e6)).toBe(0);
    expect(autoTilt(1000)).toBeCloseTo(66, 3);
    expect(autoTilt(50000)).toBeGreaterThan(0);
    expect(autoTilt(50000)).toBeLessThan(66);
  });

  it('has the sun high at noon, in the west in the evening, and below the horizon at night', () => {
    const noon = sunAt(12, 41.9);
    expect(noon[2]).toBeGreaterThan(0.8);
    expect(noon[1]).toBeLessThan(0);
    const evening = sunAt(17.4, 41.9);
    expect(evening[0]).toBeLessThan(-0.5);
    expect(evening[2]).toBeGreaterThan(0);
    expect(sunAt(0, 41.9)[2]).toBeLessThan(0);
    expect(Math.hypot(...sunAt(9, 41.9))).toBeCloseTo(1, 6);
  });

  it('keeps a street-level view in its link, and leaves the globe’s links as they were', () => {
    const defaults: ViewState = { t: 1950, cam: { lat: 12, lon: -28, dist: 3.3 }, window: [-100, 100], evidence: false, clouds: true, alt: [], picks: [], sel: null, hour: 17.4 };
    const near = quantize({ ...defaults, t: 315, cam: { lat: 41.89123456, lon: 12.49123456, dist: 1 + 2.5 / R, heading: 301.234, tilt: 91.5 } });
    expect(near.cam.lat).toBeCloseTo(41.8912346, 7);
    expect((near.cam.dist - 1) * R).toBeCloseTo(2.5, 1);
    const search = toSearch('b', near);
    expect(search).toContain('h=301.23');
    expect(search).toContain('v=91.5');
    const back = fromSearch(search, defaults).state;
    expect(back.cam).toEqual(near.cam);
    const far = quantize({ ...defaults, cam: { lat: 12.34567, lon: -28.12345, dist: 3.30004 } });
    expect(far.cam).toEqual({ lat: 12.346, lon: -28.123, dist: 3.3 });
    expect(quantize({ ...defaults, hour: 22 }).hour).toBe(18.6);
    expect(quantize({ ...defaults, hour: 2 }).hour).toBe(5.4);
    const link = toSearch('b', far);
    expect(link).not.toContain('h=');
    expect(link).not.toContain('v=');
    expect(link).not.toContain('hour=');
  });
});
