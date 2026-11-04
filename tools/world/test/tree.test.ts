// The tree of life as the panel lays it out: parent before child, what a database adds folded away
// until asked for, and fast enough for thousands of taxa.
import { describe, expect, it } from 'vitest';
import { aliveAt, ancestors, indexTree, layoutTree, subtree, timeOfNode, type TreeNode } from '../../../core/tree.ts';
import type { FeatureTime } from '../../../core/tileset.ts';

const est = (x: number | null) => ({ best: x, lo: x ?? -Infinity, hi: x ?? Infinity, derived: false });
const span = (a: number | null, b: number | null): FeatureTime => ({ start: est(a), end: est(b), instant: false });
const node = (id: string, parent: number, start: number | null, end: number | null = null, imported = false): TreeNode => ({ id, label: id, parent, time: span(start, end), ...(imported ? { imported: true } : {}) });

const NODES: TreeNode[] = [
  node('life', -1, -3e9),
  node('plants', 0, -4.7e8),
  node('animals', 0, -6e8),
  node('dinosaurs', 2, -2.3e8, -6.6e7),
  node('imported-genus', 3, -7e7, -6.6e7, true),
  node('imported-species', 4, -6.9e7, -6.6e7, true),
];

describe('the tree', () => {
  it('orders children by when they arose, and counts what is below each', () => {
    const ix = indexTree(NODES);
    expect(ix.roots).toEqual([0]);
    expect(ix.children[0]).toEqual([2, 1]);
    expect(ix.size).toEqual([5, 0, 3, 2, 1, 0]);
  });

  it('lays out parents before children, each row knowing its parent', () => {
    const ix = indexTree(NODES);
    const rows = layoutTree(NODES, ix, new Set());
    expect(rows.map((r) => NODES[r.node].id)).toEqual(['life', 'animals', 'dinosaurs', 'plants']);
    expect(rows[2].folded).toBe(true);
    rows.forEach((r, i) => expect(r.parentRow).toBeLessThan(i));
  });

  it('keeps what a database adds folded until it is opened', () => {
    const ix = indexTree(NODES);
    const rows = layoutTree(NODES, ix, new Set([3, 4]));
    expect(rows.map((r) => NODES[r.node].id)).toEqual(['life', 'animals', 'dinosaurs', 'imported-genus', 'imported-species', 'plants']);
    expect(rows.some((r) => r.folded)).toBe(false);
  });

  it('knows a group and the line above it', () => {
    const ix = indexTree(NODES);
    expect(subtree(ix, 3).sort()).toEqual([3, 4, 5]);
    expect(ancestors(NODES, 5)).toEqual([4, 3, 2, 0]);
  });

  it('has a lineage alive from its start to its end, and follows a scenario', () => {
    const n = { ...NODES[3], variants: { 'x#late': span(-1e8, -6.6e7) } };
    expect(aliveAt(n, -2e8, {})).toBe(true);
    expect(aliveAt(n, -2e8, { picks: ['x#late'] })).toBe(false);
    expect(aliveAt(n, -6e7, {})).toBe(false);
    expect(timeOfNode(n, { picks: ['x#late'] }).start.best).toBe(-1e8);
    // What has no end has not ended.
    expect(aliveAt(NODES[0], 2000, {})).toBe(true);
  });

  it('works with thousands: fifty thousand taxa lay out in a moment, and fold to what fits', () => {
    const many: TreeNode[] = [node('root', -1, -1e9)];
    for (let i = 1; i < 50000; i++) many.push(node(`t${i}`, Math.floor((i - 1) / 4), -1e9 + i, null, i > 26));
    const t0 = performance.now();
    const ix = indexTree(many);
    const shut = layoutTree(many, ix, new Set());
    const open = layoutTree(many, ix, new Set(many.map((_, i) => i)));
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(open.length).toBe(50000);
    expect(shut.length).toBeLessThan(40);
    expect(ix.size[0]).toBe(49999);
  });
});
