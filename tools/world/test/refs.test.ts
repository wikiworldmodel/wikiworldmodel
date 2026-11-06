import { describe, expect, it } from 'vitest';
import { parseRef } from '../../../core/refs.ts';

describe('references', () => {
  it('name entities by bare id, with a phase after @ or a claim or relation after #', () => {
    expect(parseRef('earth/lips/deccan-traps')).toEqual({ type: 'entity', id: 'earth/lips/deccan-traps' });
    expect(parseRef('earth/lips/deccan-traps@main')).toEqual({ type: 'entity', id: 'earth/lips/deccan-traps', phase: 'main' });
    expect(parseRef('rome/colosseum#c2')).toEqual({ type: 'entity', id: 'rome/colosseum', part: 'c2' });
  });
  it('resolve local shorthand inside an entity file', () => {
    expect(parseRef('@main', 'earth/lips/deccan-traps')).toEqual({ type: 'entity', id: 'earth/lips/deccan-traps', phase: 'main' });
    expect(() => parseRef('#c1')).toThrow(/local shorthand/);
  });
  it('name other records by prefix, and external ids by scheme', () => {
    expect(parseRef('src:pbdb/collection-90190')).toEqual({ type: 'src', id: 'src:pbdb/collection-90190' });
    expect(parseRef('frame:paleomap/plate-201')).toEqual({ type: 'frame', id: 'frame:paleomap/plate-201' });
    expect(parseRef('alt:time-scale/pbdb-2022')).toEqual({ type: 'alt', id: 'alt:time-scale/pbdb-2022' });
    expect(parseRef('wikidata:Q10285')).toEqual({ type: 'external', scheme: 'wikidata', id: 'Q10285' });
  });
  it('reject malformed references', () => {
    for (const bad of ['Deccan Traps', 'deccan', 'earth/lips/deccan-traps@main#c1', 'src:', 'src:Bad Id', 'a/b@']) expect(() => parseRef(bad)).toThrow();
  });
});

describe('rows of datasets (docs/STRUCTURE.md section 3.1)', () => {
  it('are addressed inside their dataset, with only what a reference would misread encoded', async () => {
    const { encodeRowKey, rowRef } = await import('../../../core/refs.ts');
    expect(parseRef('src:pbdb-land-2026-11-05#occ:820351')).toEqual({ type: 'row', id: 'src:pbdb-land-2026-11-05', key: 'occ:820351' });
    expect(rowRef('src:cliopatria-0.2.1', 'Roman Empire@-27')).toBe('src:cliopatria-0.2.1#Roman%20Empire@-27');
    expect(parseRef(rowRef('src:cliopatria-0.2.1', 'Roman Empire@-27'))).toEqual({ type: 'row', id: 'src:cliopatria-0.2.1', key: 'Roman Empire@-27' });
    expect(encodeRowKey('a#b%c')).toBe('a%23b%25c');
    expect(() => parseRef('src:x#%E0%A4%A')).toThrow(/malformed row key/);
  });
});
