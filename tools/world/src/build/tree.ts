// The tree of life for the panel (tree.json): every taxon, its parent as the world records it, and
// its interval in every scenario; and which fossils belong to it, as records or as snapshot rows.
import type { TreeFile, TreeFossils, TreeNode } from '../../../../core/tree.ts';
import { splitRef } from '../../../../core/refs.ts';
import { pbdbId, pbdbNumber } from '../pbdb.ts';
import { claimOf, labeller, subjectTime, type Solved } from './records.ts';

export function tree(s: Solved): TreeFile {
  const w = s.world;
  const labelOf = labeller(s);
  const taxa = w.entities.filter((e) => e.kind === 'taxon').sort((a, b) => (a.id < b.id ? -1 : 1));
  const index = new Map(taxa.map((e, i) => [e.id, i]));
  const nodes: TreeNode[] = taxa.map((e) => {
    const parent = e.relations.find((r) => r.rel === 'descends-from' && r.rank !== 'deprecated' && r.status !== 'deprecated');
    const rank = claimOf(s, e.id, 'taxon_rank')?.value as string | undefined;
    const node: TreeNode = { id: e.id, label: labelOf(e.id), parent: parent ? index.get(splitRef(parent.to).record) ?? -1 : -1, ...subjectTime(s, e.id) };
    if (rank) node.rank = rank;
    if (e.id.startsWith('life/pbdb/')) node.imported = true;
    return node;
  });
  const members: TreeFile['members'] = [];
  for (const e of w.entities) {
    if (e.kind !== 'occurrence') continue;
    const m = e.relations.find((r) => r.rel === 'member-of');
    const taxon = m ? index.get(splitRef(m.to).record) : undefined;
    if (taxon !== undefined) members.push({ entity: e.id, taxon });
  }
  // A row belongs to the nearest taxon above it that is a record: its own, as a rule.
  const adopted = new Map<number, string>();
  for (const e of taxa) {
    const no = pbdbNumber(e);
    if (no !== undefined) adopted.set(no, e.id);
  }
  const fossils: TreeFossils[] = [];
  for (const [source, snap] of [...w.fossils].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const d = w.manifest.datasets[source];
    const frame = d.import!.frame;
    const byNo = new Map(snap.taxa.map((t) => [t.no, t]));
    const nodeOf = (no: number): number | undefined => {
      for (let x = no; x && byNo.has(x); x = byNo.get(x)!.parent) {
        const i = index.get(adopted.get(x) ?? pbdbId(x));
        if (i !== undefined) return i;
      }
      return undefined;
    };
    const collections: [number, number][] = snap.collections.map((c) => [c.lat, c.lng]);
    const place = new Map(snap.collections.map((c, i) => [c.no, i]));
    const rows: TreeFossils['rows'] = [];
    for (const o of snap.occurrences) {
      const taxon = nodeOf(o.taxon);
      const coll = place.get(o.collection);
      if (taxon !== undefined && coll !== undefined) rows.push([taxon, coll, o.max, o.min]);
    }
    fossils.push({ source, plate: w.frame.get(frame!)?.transform?.plate ?? 0, collections, rows });
  }
  return { format: 'lightworld-tree@1', nodes, members, fossils };
}
