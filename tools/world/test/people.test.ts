// Where people lived: HYDE's grids read from its archive and added up, the snapshot that makes, and what the
// build and the viewer read of it. The tests of the snapshot need only the repository.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { cellAt, gridSize, levelOf, peopleAt, rangeAt, stepsAround, type PeopleFile } from '../../../core/layers.ts';
import { peopleTable } from '../src/build/layers.ts';
import { centralDirectory, coarsen, inflate64, parseAsciiGrid, snapshotText, stepOf, type Member } from '../src/hyde.ts';
import { loadManifest } from '../src/manifest.ts';
import { REPO } from '../src/paths.ts';

const fixture = new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures/deflate64.zip')));

describe('reading HYDE’s archive', () => {
  it('finds a zip’s members from its tail', () => {
    const [m, ...rest] = centralDirectory(fixture, 0);
    expect(rest).toEqual([]);
    expect(m).toMatchObject({ name: 'd.bin', method: 9, size: 110301 });
  });

  it('reads a zip64 directory, where the sizes and the offset stand in an extra field', () => {
    const name = new TextEncoder().encode('a/b.asc');
    const big = 5_000_000_000;
    const buf = new Uint8Array(46 + name.length + 28 + 56 + 20 + 22);
    const v = new DataView(buf.buffer);
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(10, 9, true);
    v.setUint32(16, 0xdeadbeef, true);
    v.setUint32(20, 0xffffffff, true);
    v.setUint32(24, 0xffffffff, true);
    v.setUint16(28, name.length, true);
    v.setUint16(30, 28, true);
    v.setUint32(42, 0xffffffff, true);
    buf.set(name, 46);
    let p = 46 + name.length;
    v.setUint16(p, 1, true);
    v.setUint16(p + 2, 24, true);
    v.setBigUint64(p + 4, 2n * BigInt(big), true);
    v.setBigUint64(p + 12, BigInt(big), true);
    v.setBigUint64(p + 20, 3n * BigInt(big), true);
    p += 28;
    const start = 7_000_000_000;
    v.setUint32(p, 0x06064b50, true);
    v.setBigUint64(p + 32, 1n, true);
    v.setBigUint64(p + 48, BigInt(start), true);
    const z = p;
    p += 56;
    v.setUint32(p, 0x07064b50, true);
    v.setBigUint64(p + 8, BigInt(start + z), true);
    p += 20;
    v.setUint32(p, 0x06054b50, true);
    v.setUint16(p + 10, 0xffff, true);
    v.setUint32(p + 16, 0xffffffff, true);
    expect(centralDirectory(buf, start)).toEqual([{ name: 'a/b.asc', method: 9, crc: 0xdeadbeef, compressed: big, size: 2 * big, offset: 3 * big }]);
  });

  it('inflates what 7-Zip compressed with Deflate64: a run far past Deflate’s longest match, and matches over 32 KiB back', () => {
    const [m] = centralDirectory(fixture, 0);
    const start = m.offset + 30 + new DataView(fixture.buffer, fixture.byteOffset).getUint16(m.offset + 26, true) + new DataView(fixture.buffer, fixture.byteOffset).getUint16(m.offset + 28, true);
    const out = inflate64(fixture.subarray(start, start + m.compressed), m.size);
    expect(crc32(out)).toBe(m.crc);
    expect(out.subarray(0, 70000).every((b) => b === 97)).toBe(true);
    // The last 300 bytes repeat what stands 40,001 back.
    expect(new TextDecoder().decode(out.subarray(-300))).toBe(new TextDecoder().decode(out.subarray(70000, 70300)));
  });

  it('inflates plain Deflate that has no 258-byte match, whose codes mean the same in both, stored blocks too', () => {
    let seed = 7;
    const data = new Uint8Array(200_000);
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = 97 + (seed >>> 28);
    }
    expect(inflate64(deflateRawSync(data, { level: 9 }), data.length)).toEqual(data);
    expect(inflate64(deflateRawSync(data, { level: 0 }), data.length)).toEqual(data);
  });

  it('says when a stream does not come to what the directory says', () => {
    expect(() => inflate64(deflateRawSync(new Uint8Array([1, 2, 3])), 4)).toThrow(/3 bytes where 4/);
  });

  it('reads an Arc ASCII grid, and adds its cells up, leaving out what has no data', () => {
    const text = 'ncols 4\nnrows 2\nxllcorner -180\nyllcorner -90\ncellsize 90\nNODATA_value -9999\n1 2.5 -9999 4\n0 1e2 3 -9999\n';
    const g = parseAsciiGrid(new TextEncoder().encode(text));
    expect([g.ncols, g.nrows, g.xll, g.yll, g.cell]).toEqual([4, 2, -180, -90, 90]);
    expect(Number.isNaN(g.values[2])).toBe(true);
    expect(g.values[5]).toBe(100);
    expect([...coarsen(g, 2)]).toEqual([103.5, 7]);
    expect(() => coarsen(g, 3)).toThrow(/does not divide/);
    expect(() => parseAsciiGrid(new TextEncoder().encode('ncols 2\nnrows 2\nxllcorner 0\nyllcorner 0\ncellsize 1\nNODATA_value -1\n1 2 3\n'))).toThrow(/ends after 3/);
  });

  it('names a step as the series does', () => {
    expect(stepOf('baseline/asc/10000BC_pop/popc_10000BC.asc')).toBe(-10000);
    expect(stepOf('baseline/asc/0AD_pop/popc_0AD.asc')).toBe(0);
    expect(stepOf('baseline/asc/2015AD_pop/popc_2015AD.asc')).toBe(2015);
    expect(stepOf('baseline/asc/0AD_pop/popd_0AD.asc')).toBeUndefined();
  });

  it('writes a snapshot with what it came from, and the build reads back what it wrote', () => {
    const member = (name: string): Member => ({ name, method: 9, crc: 0xabc, compressed: 3, size: 5, offset: 0 });
    // Two rows of four cells of 90°, with one cell that never rounds to anyone.
    const cells = (a: number[]) => new Float64Array(a);
    const text = snapshotText(
      [
        { step: -100, member: member('x/popc_100BC.asc'), sha256: 'aa', sum: 12.34, cells: cells([0, 0, 3.4, 0, 0, 0, 0, 0.4]) },
        { step: 0, member: member('x/popc_0AD.asc'), sha256: 'bb', sum: 56.78, cells: cells([0, 7.6, 3, 0, 0, 0, 0, 0.2]) },
      ],
      { member: member('g/maxln_cr.asc'), sha256: 'cc', cells: cells([0, 10.2, 20.6, 0, 0, 0, 0, 5]) },
      { nx: 4, ny: 2, res: 90 },
    );
    expect(text).toContain('# x/popc_100BC.asc,3,5,00000abc,aa,12.3\n');
    expect(text).toContain('# g/maxln_cr.asc,3,5,00000abc,cc\n');
    const rows = text.split('\n').filter((l) => l && !l.startsWith('#'));
    expect(rows).toEqual(['lat,lon,land_km2,-100,0', '0,-90,10,,8', '0,0,21,3,3']);
    const t = peopleTable(text, 90);
    expect(t.steps).toEqual([-100, 0]);
    expect([...t.cell]).toEqual([1, 2]);
    expect([...t.land]).toEqual([10, 21]);
    // A whole row of cells for each step.
    expect([...t.people]).toEqual([0, 3, 8, 3]);
    expect(() => peopleTable('lat,lon,land_km2,0\n0.5,0,1,1\n', 90)).toThrow(/not a corner/);
    expect(() => peopleTable('lat,lon,land_km2,0\n0,0,1,1\n0,-90,1,1\n', 90)).toThrow(/out of order/);
    expect(() => peopleTable('year,people\n0,1\n', 90)).toThrow(/starts "lat,lon,land_km2"/);
  });
});

describe('the snapshot of HYDE’s grids', () => {
  const path = 'world/snapshots/hyde-3.2.1-population-1deg.csv';
  const text = readFileSync(join(REPO, path), 'utf8');
  const t = peopleTable(text, 1);
  const n = t.cell.length;
  const series = new Map(
    readFileSync(join(REPO, 'world/snapshots/hyde-3.2.1-world-population.csv'), 'utf8')
      .split('\n')
      .filter((l) => /^-?\d/.test(l))
      .map((l) => l.split(',').map(Number) as [number, number]),
  );
  const file = (): PeopleFile => ({ format: 'lightworld-people@1', title: '', source: '', res: 1, steps: t.steps, scale: { lo: 0.01, hi: 1000 }, range: [], cell: t.cell, land: t.land, people: t.people });
  const peopleIn = (lon: number, lat: number, step: number) => {
    const c = cellAt({ res: 1, cell: t.cell }, lon, lat);
    return c.index < 0 ? 0 : t.people[t.steps.indexOf(step) * n + c.index];
  };

  it('is the file the manifest pins', async () => {
    const d = (await loadManifest()).datasets['src:hyde-3.2.1-population-grid'];
    expect(d.fetch.url).toBe(`repo:${path}`);
    expect(createHash('sha256').update(text).digest('hex')).toBe(d.fetch.sha256);
    expect(Buffer.byteLength(text)).toBe(d.fetch.bytes);
    expect((await loadManifest()).publish.licenses).toContain(d.license);
  });

  it('has a grid for each of the series’ steps, from the first to 2015, and says which member each came from', () => {
    expect(t.steps).toEqual([...series.keys()].filter((y) => y <= 2015));
    for (const s of t.steps) {
      const name = s < 0 ? `${-s}BC` : `${s}AD`;
      expect(text).toMatch(new RegExp(`^# baseline/asc/${name}_pop/popc_${name}\\.asc,\\d+,\\d+,[0-9a-f]{8},[0-9a-f]{64},\\d+\\.\\d$`, 'm'));
    }
    expect(text).toMatch(/^# general_files\/maxln_cr\.asc,\d+,\d+,[0-9a-f]{8},[0-9a-f]{64}$/m);
  });

  it('adds up to the world’s series at every step, to within rounding each cell to a person', () => {
    for (let j = 0; j < t.steps.length; j++) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += t.people[j * n + i];
      const total = series.get(t.steps[j])!;
      expect(Math.abs(sum - total) / total, `at ${t.steps[j]}: ${sum} against ${total}`).toBeLessThan(3e-5);
    }
  });

  it('has people where people are known to have lived at 1 CE, and next to none where they are not', () => {
    // The Nile's delta, the Ganges, the Yellow River and Rome's own cell.
    for (const [lon, lat] of [[31.5, 30.5], [83, 25.5], [114, 35], [12.5, 41.9]]) expect(peopleIn(lon, lat, 0)).toBeGreaterThan(200_000);
    // The middle of the Sahara, the ice of Greenland and of Antarctica, and the open sea.
    for (const [lon, lat] of [[12, 20], [-40, 72], [30, -80], [-150, 0]]) expect(peopleIn(lon, lat, 0)).toBeLessThan(100);
    // All the same, the scale tells them apart.
    const f = file();
    const level = (lon: number, lat: number) => {
      const c = cellAt(f, lon, lat);
      return c.index < 0 ? 0 : levelOf(peopleIn(lon, lat, 0) / f.land[c.index], f.scale);
    };
    expect(level(31.5, 30.5)).toBeGreaterThan(0.7);
    expect(level(12, 20)).toBe(0);
    expect(level(-40, 72)).toBe(0);
  });

  it('fills up: more cells hold anyone in 2015 than in 10,000 BCE, and many more people', () => {
    const count = (step: number) => {
      const j = t.steps.indexOf(step);
      let cells = 0;
      for (let i = 0; i < n; i++) if (t.people[j * n + i] > 0) cells++;
      return cells;
    };
    expect(count(2015)).toBeGreaterThan(count(-10000));
    expect(peopleIn(31.5, 30.5, 2015)).toBeGreaterThan(10 * peopleIn(31.5, 30.5, 0));
  });
});

describe('a grid of people', () => {
  const f: PeopleFile = {
    format: 'lightworld-people@1',
    title: '',
    source: '',
    res: 90,
    steps: [-100, 0, 100],
    scale: { lo: 0.01, hi: 1000 },
    range: [[-9999, 95], [1, 75], [2000, 1]],
    cell: new Uint32Array([1, 6]),
    land: new Uint32Array([100, 50]),
    people: new Uint32Array([10, 0, 20, 5, 40, 15]),
  };

  it('knows the steps around a time, and nothing outside them', () => {
    expect(stepsAround(f.steps, -100)).toEqual({ a: 0, b: 0, mix: 0 });
    expect(stepsAround(f.steps, -50)).toEqual({ a: 0, b: 1, mix: 0.5 });
    expect(stepsAround(f.steps, 0)).toEqual({ a: 1, b: 1, mix: 0 });
    expect(stepsAround(f.steps, 100)).toEqual({ a: 2, b: 2, mix: 0 });
    expect(stepsAround(f.steps, -101)).toBeUndefined();
    expect(stepsAround(f.steps, 101)).toBeUndefined();
  });

  it('runs straight between steps, so its sum does too, as the series does', () => {
    const out = new Float64Array(2);
    expect(peopleAt(f, -50, out)).toBe(true);
    expect([...out]).toEqual([15, 2.5]);
    expect(peopleAt(f, 50, out)).toBe(true);
    expect([...out]).toEqual([30, 10]);
    expect(peopleAt(f, 500, out)).toBe(false);
    expect([...out]).toEqual([30, 10]);
  });

  it('finds the cell at a point, or none, and stays on the grid at its edges', () => {
    expect(gridSize(90)).toEqual({ nx: 4, ny: 2 });
    expect(cellAt(f, -45, 45)).toEqual({ row: 0, col: 1, index: 0 });
    expect(cellAt(f, 45, -45)).toEqual({ row: 1, col: 2, index: 1 });
    expect(cellAt(f, -135, 45).index).toBe(-1);
    expect(cellAt(f, 180, -90)).toEqual({ row: 1, col: 3, index: -1 });
    expect(cellAt(f, -180, 90)).toEqual({ row: 0, col: 0, index: -1 });
  });

  it('gives the authors’ range straight between the years they name, and holds its ends', () => {
    expect(rangeAt(f.range, -20000)).toBe(95);
    expect(rangeAt(f.range, -9999)).toBe(95);
    expect(rangeAt(f.range, 1)).toBe(75);
    expect(rangeAt(f.range, (-9999 + 1) / 2)).toBe(85);
    expect(rangeAt(f.range, 3000)).toBe(1);
    expect(rangeAt([], 0)).toBeUndefined();
  });

  it('places a density on the viewer’s scale, in its logarithm: nothing below it, and no more than the top', () => {
    expect(levelOf(0, f.scale)).toBe(0);
    expect(levelOf(0.01, f.scale)).toBe(0);
    expect(levelOf(0.1, f.scale)).toBeCloseTo(0.2, 9);
    expect(levelOf(1, f.scale)).toBeCloseTo(0.4, 9);
    expect(levelOf(1000, f.scale)).toBeCloseTo(1, 9);
    expect(levelOf(1e5, f.scale)).toBe(1);
  });
});
