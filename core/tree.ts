// The tree of life as the panel draws it (tree.json): every taxon with its parent and its interval,
// which fossil records belong to it, and the rows of the formations' snapshots. Lineages branch at
// their start and end at their extinction, in whichever scenario is shown, so the panel, the globe
// and the time control use one idea of when a taxon lived.
import { lookup, type Scenario } from './scenario.ts';
import type { FeatureTime } from './tileset.ts';

export interface TreeNode {
  id: string;
  label: string;
  rank?: string;
  /** the index of its parent; −1 for a root */
  parent: number;
  time: FeatureTime;
  variants?: Record<string, FeatureTime>;
  /** imported from a database, rather than written: folded away until asked for */
  imported?: boolean;
}

/** One formation's fossils: places and rows, too many to be records. */
export interface TreeFossils {
  /** the dataset */
  source: string;
  /** the plate they ride */
  plate: number;
  /** lat, lon of each collection */
  collections: [number, number][];
  /** taxon's node index, collection's index, oldest and youngest age in Ma */
  rows: [number, number, number, number][];
}

export interface TreeFile {
  format: 'lightworld-tree@1';
  nodes: TreeNode[];
  /** occurrence records and the node they belong to */
  members: { entity: string; taxon: number }[];
  fossils: TreeFossils[];
}

export const timeOfNode = (n: TreeNode, s: Scenario): FeatureTime => lookup(n.variants, s, n.time);

/** Has a lineage arisen by a time, and has it not yet ended? The rule the globe's markers use for what lasts. */
export function aliveAt(n: TreeNode, t: number, s: Scenario): boolean {
  const time = timeOfNode(n, s);
  return (time.start.best ?? -Infinity) <= t && t <= (time.end.best ?? Infinity);
}

export interface TreeIndex {
  children: number[][];
  roots: number[];
  /** how many descendants each node has */
  size: number[];
}

/** Children in the order they arose, oldest first; ties by name, so the order is stable. */
export function indexTree(nodes: TreeNode[]): TreeIndex {
  const children: number[][] = nodes.map(() => []);
  const roots: number[] = [];
  nodes.forEach((n, i) => (n.parent >= 0 ? children[n.parent].push(i) : roots.push(i)));
  const when = (i: number) => nodes[i].time.start.best ?? Infinity;
  const order = (a: number, b: number) => when(a) - when(b) || (nodes[a].label < nodes[b].label ? -1 : 1);
  for (const c of children) c.sort(order);
  roots.sort(order);
  const size = new Array<number>(nodes.length).fill(0);
  const stack: [number, boolean][] = roots.map((r) => [r, false]);
  while (stack.length) {
    const [i, done] = stack.pop()!;
    if (done) {
      for (const c of children[i]) size[i] += size[c] + 1;
      continue;
    }
    stack.push([i, true]);
    for (const c of children[i]) stack.push([c, false]);
  }
  return { children, roots, size };
}

export interface TreeRow {
  node: number;
  /** the row of its parent; −1 for a root */
  parentRow: number;
  /** has children folded away */
  folded: boolean;
}

/**
 * The rows of a tree, parent before children: one row per taxon, children of a folded node left out.
 * What is folded is a node in `folded`, or an imported node not in `open`.
 */
export function layoutTree(nodes: TreeNode[], index: TreeIndex, open: ReadonlySet<number>): TreeRow[] {
  const rows: TreeRow[] = [];
  const stack: [number, number][] = [];
  for (let i = index.roots.length - 1; i >= 0; i--) stack.push([index.roots[i], -1]);
  while (stack.length) {
    const [i, parentRow] = stack.pop()!;
    const kids = index.children[i];
    // A written taxon shows its children at once; a database's stay folded until asked for.
    const shut = kids.length > 0 && !open.has(i) && kids.every((k) => nodes[k].imported);
    const row = rows.length;
    rows.push({ node: i, parentRow, folded: shut });
    if (shut) continue;
    for (let k = kids.length - 1; k >= 0; k--) stack.push([kids[k], row]);
  }
  return rows;
}

/** A node and everything below it. */
export function subtree(index: TreeIndex, i: number): number[] {
  const out: number[] = [];
  const stack = [i];
  while (stack.length) {
    const x = stack.pop()!;
    out.push(x);
    for (const c of index.children[x]) stack.push(c);
  }
  return out;
}

/** The nodes above a node. */
export function ancestors(nodes: TreeNode[], i: number): number[] {
  const out: number[] = [];
  for (let p = nodes[i].parent; p >= 0; p = nodes[p].parent) out.push(p);
  return out;
}
