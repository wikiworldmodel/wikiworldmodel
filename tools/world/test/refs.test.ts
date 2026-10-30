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
