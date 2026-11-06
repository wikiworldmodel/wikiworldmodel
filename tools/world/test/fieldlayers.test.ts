// Fields of points, lines and areas, the one way (docs/STRUCTURE.md section 3.6): a field's rows, read as its
// mapping says and drawn as its style says, with nothing in the code about which dataset they come from.
import { describe, expect, it } from 'vitest';
import { geometryLines, layerRows } from '../src/build/fieldlayers.ts';
import { GEOMETRY } from '../src/tables.ts';
import type { Field } from '../src/world.ts';

const LANGUAGES: Field = {
  id: 'field:test/languages',
  title: 'Languages',
  file: 'fields/languages.yaml',
  time: { lo: '1950 CE', hi: '2100 CE' },
  data: { from: 'src:test/glottolog' },
  kind: 'points',
  rows: { kind: 'language', key: '{Glottocode}', claims: { name: { column: 'Name', as: 'text' }, location: { column: ['Latitude', 'Longitude'], as: 'point' } } },
  layer: { where: { Level: 'language' }, group: { column: 'Family_ID', word: 'Family', name: { key: 'ID', column: 'Name' } }, color: { by: 'group', saturation: 78, lightness: 68 }, describe: 'Language', key_label: 'Glottocode' },
};

const ROADS: Field = {
  id: 'field:test/roads',
  title: 'Roads',
  file: 'fields/roads.yaml',
  time: { lo: '300 BCE', hi: '300 CE' },
  data: { from: 'src:test/itinere' },
  kind: 'lines',
  rows: { kind: 'works/road', key: '{#}', claims: { start: { column: 'Lower_Date', as: 'year', none: [9999] }, end: { column: 'Upper_Date', as: 'year-end', none: [9999] } } },
  layer: { crs: 'world-mercator', thin: 0.01, color: { value: '#ffe2aa' }, width: { by: 'Type', values: { 'Main Road': 0.9 }, otherwise: 0.55 }, describe: 'Road' },
};

describe('a field of points', () => {
  it('keeps the rows its style wants, with a place, naming their group from the group\'s own row', () => {
    const raw = [
      { ID: 'indo1319', Name: 'Indo-European', Level: 'family', Latitude: '', Longitude: '', Family_ID: '', Glottocode: 'indo1319' },
      { ID: 'stan1293', Name: 'English', Level: 'language', Latitude: '53.0', Longitude: '-1.0', Family_ID: 'indo1319', Glottocode: 'stan1293' },
      { ID: 'basq1248', Name: 'Basque', Level: 'language', Latitude: '43.27', Longitude: '-2.75', Family_ID: '', Glottocode: 'basq1248' },
      { ID: 'nowh1234', Name: 'Nowhere', Level: 'language', Latitude: '', Longitude: '', Family_ID: '', Glottocode: 'nowh1234' },
      { ID: 'dial1234', Name: 'A dialect', Level: 'dialect', Latitude: '1', Longitude: '1', Family_ID: 'indo1319', Glottocode: 'dial1234' },
    ];
    const { rows, groups } = layerRows(LANGUAGES, raw, raw.map((r) => r.Glottocode), new Map([[1, ['name']]]));
    expect(rows.map((r) => r.label).sort()).toEqual(['Basque', 'English']);
    const english = rows.find((r) => r.label === 'English')!;
    expect(english).toMatchObject({ row: 'src:test/glottolog#stan1293', at: [-1, 53], says: ['Family: Indo-European', 'Glottocode stan1293'], corrected: ['name'] });
    expect(groups[english.group!]).toBe('Indo-European');
    // A language in no larger family is tinted by its own name.
    expect(groups[rows.find((r) => r.label === 'Basque')!.group!]).toBe('Basque');
    expect(english.from).toBe(1950);
    expect(english.to).toBe(2100);
  });
});

describe('a field of lines', () => {
  it('reads its geometry from the dataset\'s projection, thinned, keeping the ends', () => {
    const line = { type: 'MultiLineString', coordinates: [[[0, 0, 1], [111319.49, 0, 1], [222638.98, 0, 1]]] };
    expect(geometryLines(line, 'world-mercator', 0.01)).toEqual([[0, 0, 200, 0]]);
    expect(geometryLines({ type: 'LineString', coordinates: [[1, 1], [1, 1]] }, undefined)).toEqual([]);
    expect(geometryLines(null, undefined)).toEqual([]);
  });

  it('takes its years from the dataset where it gives them, and the span where it writes 9999, and its width from a column', () => {
    const f = (Lower_Date: number, Upper_Date: number, Type: string) => ({ Type, Lower_Date, Upper_Date, [GEOMETRY]: { type: 'LineString', coordinates: [[0, 0], [111319.49, 0]] } });
    const raw = [f(-100, 200, 'Main Road'), f(9999, 9999, 'Secondary Road')];
    const { rows } = layerRows(ROADS, raw, ['0', '1'], new Map());
    const dated = rows.find((r) => r.row === 'src:test/itinere#0')!;
    expect([dated.from, dated.to, dated.w]).toEqual([-99, 201, 0.9]);
    const undated = rows.find((r) => r.row === 'src:test/itinere#1')!;
    expect([undated.from, undated.to, undated.w]).toEqual([-299, 300, 0.55]);
  });
});
