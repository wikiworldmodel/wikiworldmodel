// Reading a series from a dataset's table: what comes before the table, and what its time column counts.
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { claimedPoints, parseTable, YEAR } from '../src/build/series.ts';
import { loadWorld } from '../src/world.ts';

describe('parseTable', () => {
  it('reads a table under comment lines', () => {
    expect(parseTable('# a note\n\nage,co2\n1,280\n')).toEqual([{ age: '1', co2: '280' }]);
  });

  it('leaves out the block that opens a PANGAEA file', () => {
    const file = '/* DATA DESCRIPTION:\nCitation:\tSomeone (2007): A title\nParameter(s):\tAge [ka]\n*/\nAge [ka]\tdelta T [°C]\n0.038\t0.88\n0.047\t\n';
    expect(parseTable(file)).toEqual([
      { 'Age [ka]': '0.038', 'delta T [°C]': '0.88' },
      { 'Age [ka]': '0.047', 'delta T [°C]': '' },
    ]);
  });

  it('leaves out the metadata above the line saying data in a CEDA file', () => {
    const file = 'Conventions,G,Excel file,1,,\ntitle,G,A title,,,\ndata,,,,,\n1,2,3,4\n-0.019,409.9,-0.019,1866.3\n,,0.05,900\n';
    expect(parseTable(file)).toEqual([
      { 1: '-0.019', 2: '409.9', 3: '-0.019', 4: '1866.3' },
      { 1: '', 2: '', 3: '0.05', 4: '900' },
    ]);
  });
});

describe('time units', () => {
  it('counts ka-b2k from 2000, and the others from 1950', () => {
    expect(YEAR['ka-b2k'](-0.019)).toBeCloseTo(2019, 6);
    expect(YEAR['ka-b2k'](0.05)).toBeCloseTo(1950, 6);
    expect(YEAR.ka(0.05)).toBeCloseTo(1900, 6);
    expect(YEAR.BP(50)).toBe(1900);
  });
});

describe('a series of the world’s own measurements', () => {
  it('reads each record’s claim of a property at the record’s date, with the band it gives', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wikiworldmodel-fixture-'));
    const cite = 'source: { ref: src:test/report, loc: p. 1 }';
    const entity = (id: string, body: string) => `id: ${id}\nkind: occurrence\nauthor: fixture\nclaims:\n${body}`;
    const files: Record<string, string> = {
      'sources/report.yaml': 'id: src:test/report\ntype: publication\nkind: measurement\ncitation: A fixture source, not a real publication.\n',
      'entities/a.yaml': entity('test/a', `  when: { prop: date, value: 100 Ma, ${cite} }\n  size: { prop: diameter, value: 21.5, ${cite} }\n`),
      'entities/b.yaml': entity('test/b', `  when: { prop: date, value: 200 Ma, ${cite} }\n  size: { prop: diameter, value: { mean: 20, sd: 1 }, ${cite} }\n`),
      'entities/c.yaml': entity('test/c', `  when: { prop: date, value: 300 Ma, ${cite} }\n  size: { prop: diameter, value: { lo: 18, hi: 19 }, ${cite} }\n`),
      'entities/d.yaml': entity('test/d', `  size: { prop: diameter, value: 3, ${cite} }\n`),
    };
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const points = claimedPoints(await loadWorld(root), 'diameter');
    rmSync(root, { recursive: true, force: true });
    // Oldest first; a record with no date gives no point.
    expect(points.map((p) => p.slice(1))).toEqual([[18.5, 18, 19], [20, 19, 21], [21.5, null, null]]);
    expect(points[0][0]).toBe(Math.round(1950 - 300e6));
  });
});
