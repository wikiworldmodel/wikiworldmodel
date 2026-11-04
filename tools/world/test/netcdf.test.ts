// The reader for classic NetCDF: a file made by hand, big-endian, as the format says.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openNetcdf, parseHeader } from '../src/netcdf.ts';

/** A CDF-1 file with one record dimension's worth of fixed data: t(time=2, lat=2, lon=3) as floats and lat(lat) as doubles. */
function sampleFile(): Uint8Array {
  const parts: number[] = [];
  const u32 = (x: number) => parts.push((x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255);
  const name = (s: string) => {
    u32(s.length);
    for (const c of s) parts.push(c.charCodeAt(0));
    while (parts.length % 4) parts.push(0);
  };
  parts.push(0x43, 0x44, 0x46, 1);
  u32(0); // no records
  u32(10); // NC_DIMENSION
  u32(3);
  name('time');
  u32(2);
  name('lat');
  u32(2);
  name('lon');
  u32(3);
  u32(12); // NC_ATTRIBUTE
  u32(1);
  name('title');
  u32(2); // char
  u32(4);
  for (const c of 'test') parts.push(c.charCodeAt(0));
  u32(11); // NC_VARIABLE
  u32(2);
  // Headers end before the data, whose places are given: work out the size first.
  const header = (beginT: number, beginLat: number) => {
    name('t');
    u32(3);
    u32(0);
    u32(1);
    u32(2);
    u32(0); // no attributes
    u32(0);
    u32(5); // float
    u32(2 * 2 * 3 * 4);
    u32(beginT);
    name('lat');
    u32(1);
    u32(1);
    u32(0);
    u32(0);
    u32(6); // double
    u32(2 * 8);
    u32(beginLat);
  };
  const before = parts.length;
  header(0, 0);
  const size = parts.length;
  parts.length = before;
  header(size, size + 48);
  const out = new Uint8Array(size + 48 + 16);
  out.set(parts);
  const v = new DataView(out.buffer);
  for (let i = 0; i < 12; i++) v.setFloat32(size + i * 4, i + 0.5);
  v.setFloat64(size + 48, -45);
  v.setFloat64(size + 56, 45);
  return out;
}

const dir = mkdtempSync(join(tmpdir(), 'netcdf-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('a classic NetCDF file', () => {
  it('has its dimensions, attributes and variables read from its header', () => {
    const h = parseHeader(sampleFile());
    expect(h.dims).toEqual([{ name: 'time', size: 2 }, { name: 'lat', size: 2 }, { name: 'lon', size: 3 }]);
    expect(h.attrs.title).toBe('test');
    expect(h.variables.get('t')!.dims.map((d) => d.name)).toEqual(['time', 'lat', 'lon']);
    expect(h.variables.get('lat')!.type).toBe(6);
  });

  it('reads a variable, or a run of it along its first dimension, from its place in the file', async () => {
    const path = join(dir, 'a.nc');
    writeFileSync(path, sampleFile());
    const f = await openNetcdf(path);
    expect([...(await f.read('lat'))]).toEqual([-45, 45]);
    expect([...(await f.read('t'))]).toEqual(Array.from({ length: 12 }, (_, i) => i + 0.5));
    expect([...(await f.read('t', 1, 1))]).toEqual([6.5, 7.5, 8.5, 9.5, 10.5, 11.5]);
    await f.close();
  });

  it('refuses what it cannot read', () => {
    expect(() => parseHeader(new Uint8Array([0x89, 0x48, 0x44, 0x46]))).toThrow('not a classic NetCDF');
    expect(() => parseHeader(new Uint8Array([0x43, 0x44, 0x46, 5]))).toThrow('not supported');
  });
});
