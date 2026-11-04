// A curated database as a snapshot: which of the service's rows are kept, and the records that come
// of them. A record written by hand adopts a taxon by its number, and keeps what it says itself.
import { describe, expect, it } from 'vitest';
import { pbdbEntities, pbdbId, pbdbNumber, snapshotFrom, type PbdbSnapshot } from '../src/pbdb.ts';
import type { Entity } from '../src/world.ts';

const query = { occurrences: 'occ', collections: 'coll', taxa: 'tax' };
const colls = [
  { collection_no: 2, collection_name: 'B', lat: 47, lng: -106, formation: 'Hell Creek', environment: 'channel', lithology1: 'sandstone' },
  { collection_no: 1, collection_name: 'A', lat: 46, lng: -104, formation: 'Hell Creek' },
  { collection_no: 3, collection_name: 'C', lat: 40, lng: -100, formation: 'Shell Creek' },
];
const occs = [
  { occurrence_no: 11, collection_no: 2, accepted_no: 30, identified_name: 'Triceratops horridus', max_ma: 70, min_ma: 66, early_interval: 'Lancian' },
  { occurrence_no: 10, collection_no: 1, accepted_no: 20, accepted_name: 'Triceratops', max_ma: 70, min_ma: 66, early_interval: 'Maastrichtian', late_interval: 'Danian' },
  { occurrence_no: 12, collection_no: 3, accepted_no: 30, identified_name: 'elsewhere', max_ma: 100, min_ma: 90, early_interval: 'x' },
  { occurrence_no: 13, collection_no: 1, accepted_no: 0, identified_name: 'no taxon', max_ma: 70, min_ma: 66, early_interval: 'x' },
];
const taxa = [
  { orig_no: 30, accepted_no: 30, taxon_name: 'Triceratops horridus', accepted_rank: 'species', parent_no: 20, is_extant: 'extinct', firstapp_max_ma: 70, firstapp_min_ma: 66, lastapp_max_ma: 70, lastapp_min_ma: 66, n_occs: 40 },
  { orig_no: 20, accepted_no: 20, taxon_name: 'Triceratops', accepted_rank: 'genus', parent_no: 10, is_extant: 'extinct', firstapp_max_ma: 72, firstapp_min_ma: 66, lastapp_max_ma: 66, lastapp_min_ma: 66, n_occs: 90 },
  { orig_no: 21, accepted_no: 20, taxon_name: 'Triceratops (a spelling)', accepted_rank: 'genus', parent_no: 10 },
  { orig_no: 10, accepted_no: 10, taxon_name: 'Ceratopsidae', accepted_rank: 'family', parent_no: 5, is_extant: 'extinct', firstapp_max_ma: 500, firstapp_min_ma: 400, n_occs: 900 },
  { orig_no: 5, accepted_no: 5, taxon_name: 'Dinosauria', accepted_rank: 'unranked clade', parent_no: 0, is_extant: 'extant', firstapp_max_ma: 240, firstapp_min_ma: 230, n_occs: 9000 },
];

const snap = (): PbdbSnapshot => snapshotFrom('Hell Creek', '2026-11-04', 'CC0', query, occs, colls, taxa);
const claimOf = (e: Entity, prop: string) => e.claims.find((c) => c.prop === prop);

const written = (id: string, no: number, parent?: string): Entity =>
  ({
    id,
    kind: 'taxon',
    summary: 'written',
    same_as: { pbdb: `txn:${no}` },
    phases: [],
    claims: [],
    relations: parent ? [{ rel: 'descends-from', to: parent }] : [],
    file: 'x',
  }) as unknown as Entity;

describe('a snapshot of a formation', () => {
  it('keeps only the formation itself, and only rows with an accepted taxon, in number order', () => {
    const s = snap();
    expect(s.collections.map((c) => c.no)).toEqual([1, 2]);
    expect(s.occurrences.map((o) => o.no)).toEqual([10, 11]);
    expect(s.occurrences[0].interval).toBe('Maastrichtian–Danian');
    expect(s.collections[1].environment).toBe('channel');
  });

  it('knows a taxon by its concept, not by a spelling', () => {
    expect(snap().taxa.map((t) => t.no)).toEqual([5, 10, 20, 30]);
    expect(snap().taxa.find((t) => t.no === 30)!.parent).toBe(20);
  });
});

describe('the records of a snapshot', () => {
  it('are every taxon named and all its parents, up to one the world has placed', () => {
    const made = pbdbEntities(snap(), 'src:x', 'f', [written('life/taxa/dinosauria', 5, 'life/taxa/archosauria')]);
    expect(made.map((e) => e.id)).toEqual([pbdbId(10), pbdbId(20), pbdbId(30)]);
    const genus = made.find((e) => e.id === pbdbId(20))!;
    expect(genus.relations[0].to).toBe(pbdbId(10));
    expect(made.find((e) => e.id === pbdbId(10))!.relations[0].to).toBe('life/taxa/dinosauria');
  });

  it('say they are machine work, resting on the dataset, with the taxon as locator', () => {
    const [e] = pbdbEntities(snap(), 'src:x', 'f', []).filter((x) => x.id === pbdbId(30));
    const name = claimOf(e, 'name')!;
    expect(name.author).toBe('machine:pbdb-import');
    expect(name.status).toBe('proposed');
    expect(name.sources[0]).toEqual({ ref: 'src:x', loc: 'taxon 30' });
  });

  it('give a start only to a genus or below: a higher group starts with its members', () => {
    const made = pbdbEntities(snap(), 'src:x', 'f', []);
    expect(claimOf(made.find((e) => e.id === pbdbId(20))!, 'start')!.value).toEqual({ lo: '72 Ma', hi: '66 Ma' });
    expect(claimOf(made.find((e) => e.id === pbdbId(10))!, 'start')).toBeUndefined();
  });

  it('end what is extinct, and not what is not', () => {
    const made = pbdbEntities(snap(), 'src:x', 'f', []);
    expect(claimOf(made.find((e) => e.id === pbdbId(20))!, 'end')!.value).toBe('66 Ma');
    expect(claimOf(made.find((e) => e.id === pbdbId(5))!, 'end')).toBeUndefined();
  });

  it('fill in what a written record does not say, in its own claims, and leave the rest', () => {
    const mine = written('life/taxa/triceratops', 20);
    mine.claims.push({ prop: 'start', value: '68 Ma' } as never);
    const made = pbdbEntities(snap(), 'src:x', 'f', [mine]);
    expect(made.find((e) => e.id === pbdbId(20))).toBeUndefined();
    expect(pbdbNumber(mine)).toBe(20);
    expect(mine.claims.filter((c) => c.prop === 'start').map((c) => c.value)).toEqual(['68 Ma']);
    expect(claimOf(mine, 'end')!.value).toBe('66 Ma');
    expect(claimOf(mine, 'taxon_rank')!.value).toBe('genus');
    expect(mine.relations[0].to).toBe(pbdbId(10));
    // A species under it points at the record that adopted its parent.
    expect(made.find((e) => e.id === pbdbId(30))!.relations[0].to).toBe('life/taxa/triceratops');
  });
});
