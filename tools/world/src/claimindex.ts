// One index of claims (docs/STRUCTURE.md section 3.1): the records' claims, the rows' claims as their fields
// map them, and the overlays' claims about rows, each with where it comes from. What reads claims asks the
// index by subject, an entity or a row, and never the storage beneath it.
import { levelOf, type CheckStep, type Level } from '../../../core/ladder.ts';
import type { Basis } from '../../../core/tileset.ts';
import { readTable, rowClaims, rowRef, type Table } from './tables.ts';
import type { Citation, Overlay, Rank, Status, World } from './world.ts';

export type Origin = 'record' | 'row' | 'overlay';

export interface IndexedClaim {
  /** an entity, a phase, or a row: src:<dataset>#<key> */
  subject: string;
  prop: string;
  value: unknown;
  sources: Citation[];
  method?: string;
  basis: Basis;
  author: string;
  status: Status;
  rank: Rank;
  checked: CheckStep[];
  level: Level;
  note?: string;
  alt?: string;
  origin: Origin;
  /** where it is written: a record's file and key, or the dataset's row */
  where: string;
}

/** The author of what a dataset's rows say: the dataset, read by the build. */
export const ROW_AUTHOR = 'machine:dataset';

export class ClaimIndex {
  private constructor(
    private world: World,
    /** the datasets read as tables, by id */
    readonly tables: Map<string, Table>,
    private overlays: Map<string, Overlay>,
  ) {}

  /** The index of a world; its tables are read for the datasets named (all the world's, by default) that are here. */
  static async of(world: World, datasets?: Iterable<string>): Promise<ClaimIndex> {
    const want = datasets ? new Set(datasets) : undefined;
    const tables = new Map<string, Table>();
    for (const f of world.fields) {
      if (!f.rows || !f.data || (want && !want.has(f.data.from))) continue;
      const t = await readTable(world, f);
      if (t) tables.set(t.dataset, t);
    }
    return ClaimIndex.from(world, tables);
  }

  /** The index of a world with its tables already read. */
  static from(world: World, tables: Map<string, Table>): ClaimIndex {
    return new ClaimIndex(world, tables, new Map(world.overlays.map((o) => [o.row, o])));
  }

  /** Every claim about a subject: a record's, or a row's and its overlay's. */
  of(subject: string): IndexedClaim[] {
    const hash = subject.indexOf('#');
    if (subject.startsWith('src:') && hash > 0) return this.ofRow(subject.slice(0, hash), decodeURIComponent(subject.slice(hash + 1)));
    if (subject.startsWith('src:')) return [];
    const e = this.world.entity.get(subject.split('@')[0]);
    if (!e) return [];
    return e.claims
      .filter((c) => c.subject === subject || (!subject.includes('@') && c.subject.startsWith(`${subject}@`)))
      .map((c) => ({ subject: c.subject, prop: c.prop, value: c.value, sources: c.sources, method: c.method, basis: c.basis, author: c.author, status: c.status, rank: c.rank, checked: c.checked, level: levelOf(c.checked, c.status), note: c.note, alt: c.alt, origin: 'record', where: `${c.file} ${c.where}` }));
  }

  private ofRow(dataset: string, key: string): IndexedClaim[] {
    const ref = rowRef(dataset, key);
    const out: IndexedClaim[] = [];
    const table = this.tables.get(dataset);
    for (const c of table ? rowClaims(table, key) : []) {
      out.push({ subject: ref, prop: c.prop, value: c.value, sources: [c.source], method: c.method, basis: c.basis, author: ROW_AUTHOR, status: 'proposed', rank: 'normal', checked: [], level: 'unchecked', origin: 'row', where: `${dataset} row ${key}` });
    }
    for (const c of this.overlays.get(ref)?.claims ?? []) {
      out.push({ subject: ref, prop: c.prop, value: c.value, sources: c.sources, method: c.method, basis: c.basis, author: c.author, status: c.status, rank: c.rank, checked: c.checked, level: levelOf(c.checked, c.status), note: c.note, alt: c.alt, origin: 'overlay', where: `${c.file} ${c.where}` });
    }
    return out;
  }

  /**
   * The claim of a property the default picture shows: a preferred one if there is one, else the only one that is
   * not deprecated, else the row's own. An overlay's correction is ranked preferred, so it wins over its row.
   */
  chosen(subject: string, prop: string): IndexedClaim | undefined {
    const cs = this.of(subject).filter((c) => c.prop === prop && !c.alt && c.rank !== 'deprecated');
    return cs.find((c) => c.rank === 'preferred') ?? (cs.length === 1 ? cs[0] : cs.find((c) => c.origin === 'row'));
  }

  /** The corrections of a dataset's rows in the default picture, by row key: what the build applies to them. */
  corrections(dataset: string): Map<string, { prop: string; value: unknown }[]> {
    const out = new Map<string, { prop: string; value: unknown }[]>();
    for (const o of this.overlays.values()) {
      if (o.dataset !== dataset) continue;
      const fix = o.claims.filter((c) => c.rank === 'preferred' && !c.alt).map((c) => ({ prop: c.prop, value: c.value }));
      if (fix.length) out.set(o.key, fix);
    }
    return out;
  }
}
