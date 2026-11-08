// What most wants a form: the list an agent starts from. Taxa are ranked by how many of the land's fossil
// rows name them or anything below them, as that is how often they come up on the atlas's lists; or, given the sea's
// snapshot, the sea's rows, for bodies that live in the sea.
import { classify, type AtlasParams } from './build/atlas.ts';
import type { LandSnapshot } from './pbdb.ts';
import type { World } from './world.ts';

export function formsWanted(world: World, args: string[], sea?: LandSnapshot): string {
  const field = world.fields.find((f) => f.data?.as === 'community');
  const snap = sea ?? (field ? world.landFossils.get(field.data!.from as string) : undefined);
  if (!field || !snap) return 'no snapshot of the land’s fossils is loaded';
  const p = field.params as unknown as AtlasParams;
  const known = classify(world, snap, p, sea ? 'sea' : 'land');
  const n = Number(args[args.indexOf('--n') + 1]) || 40;
  const missing = args.includes('--missing');
  const name = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--n');
  const byNo = new Map(snap.taxa.map((t) => [t[0], t]));
  const rows = new Map<number, number>();
  for (const [, , t] of snap.rows) rows.set(t, (rows.get(t) ?? 0) + 1);
  // Rows up the tree: a family counts everything under it. For what is missing, only what cannot be drawn counts.
  const under = new Map<number, number>();
  for (const [t, c] of rows) {
    if (missing && known.has(t)) continue;
    for (let x = t, g = 0; x && byNo.has(x) && g < 200; x = byNo.get(x)![3], g++) under.set(x, (under.get(x) ?? 0) + c);
  }
  let inside: Set<number> | null = null;
  if (name) {
    const root = snap.taxa.find((t) => t[1].toLowerCase() === name.toLowerCase());
    if (!root) return `no taxon "${name}" in the snapshot`;
    inside = new Set();
    for (const t of snap.taxa) for (let x = t[0], g = 0; x && byNo.has(x) && g < 200; x = byNo.get(x)![3], g++) if (x === root[0]) inside.add(t[0]);
  }
  const rank = (t: (typeof snap.taxa)[number]) => snap.words[t[2]];
  const out: string[] = [];
  const c = { own: 0, inherited: 0, none: 0, rowsDrawable: 0, rowsAll: 0 };
  for (const [t, count] of rows) {
    if (inside && !inside.has(t)) continue;
    c.rowsAll += count;
    const k = known.get(t);
    if (k?.taxon.own) c.own++;
    else if (k) c.inherited++;
    else c.none++;
    if (k) c.rowsDrawable += count;
  }
  out.push(`${name ?? (sea ? 'All the sea' : 'All the land')}: ${c.own} taxa with rows have their own form, ${c.inherited} inherit one and ${c.none} have none; ${c.rowsAll ? Math.round((c.rowsDrawable / c.rowsAll) * 100) : 0}% of ${c.rowsAll} rows can be drawn.`, '');
  if (missing) {
    // The biggest groups with no form at any node above them, in the ranks a plan is usually put at.
    const list = snap.taxa
      .filter((t) => !known.has(t[0]) && (under.get(t[0]) ?? 0) > 0 && (!inside || inside.has(t[0])) && ['class', 'subclass', 'order', 'suborder', 'infraorder', 'superfamily', 'family', 'unranked clade'].includes(rank(t)))
      .sort((a, b) => (under.get(b[0]) ?? 0) - (under.get(a[0]) ?? 0) || a[0] - b[0])
      .slice(0, n);
    out.push('rows  rank            taxon (txn number): no form at any node above it');
    for (const t of list) out.push(`${String(under.get(t[0])).padStart(6)}  ${rank(t).padEnd(15)} ${t[1]} (txn:${t[0]})${snap.words[t[9]] ? `, ${snap.words[t[9]]}` : ''}`);
    return out.join('\n');
  }
  const list = snap.taxa
    .filter((t) => (under.get(t[0]) ?? 0) > 0 && known.has(t[0]) && !known.get(t[0])!.taxon.own && (!inside || inside.has(t[0])))
    .sort((a, b) => (under.get(b[0]) ?? 0) - (under.get(a[0]) ?? 0) || a[0] - b[0])
    .slice(0, n);
  out.push('rows  rank            taxon (txn number): drawn today as');
  for (const t of list) {
    const k = known.get(t[0])!.taxon;
    const size = k.length ?? k.height;
    out.push(`${String(under.get(t[0])).padStart(6)}  ${rank(t).padEnd(15)} ${t[1]} (txn:${t[0]}): the form of ${k.form_label}${size ? `, ${size.lo === size.hi ? size.lo : `${size.lo}–${size.hi}`} m from ${size.from}` : ', no size'}`);
  }
  return out.join('\n');
}
