// Feature tiles: every marker on the globe, stored once, by time, place and prominence. See
// core/featuretiles.ts for how they are addressed, and docs/FEATURE-TILES.md for why.
import { createHash } from 'node:crypto';
import { binOf, childOf, cellOf, FEATURE_INDEX, FEATURE_VARIANTS, featureTileUrl, lifeOf, timeNodeOf, type FeatureIndex, type FeatureTileRef, type FeatureVariants } from '../../../../core/featuretiles.ts';
import { cityKind, type Feature } from '../../../../core/tileset.ts';
import { stableStringify } from '../util.ts';
import type { Entity, ProminenceRule } from '../world.ts';

/** How deep the quadtree goes: at this depth a cell is under a kilometre, and keeps whatever is left. */
const MAX_DEPTH = 16;

/** A kind's score and domain under the rule: its own, or else its nearest parent's. */
export function kindScore(rule: ProminenceRule, kind: string): { domain: string; score: number } | undefined {
  for (let k: string | undefined = kind; k; k = k.includes('/') ? k.slice(0, k.lastIndexOf('/')) : undefined) {
    for (const [domain, d] of Object.entries(rule.domains)) if (d.kinds[k] !== undefined) return { domain, score: d.kinds[k] };
  }
  return undefined;
}

/** The largest a quantity's value says. */
function largest(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v !== 'object' || v === null) return undefined;
  const q = v as { mean?: number; lo?: number; hi?: number };
  return q.hi ?? q.mean ?? q.lo;
}

/** A record's prominence: its kind's score, and what its largest measured size adds. */
export function prominenceOf(rule: ProminenceRule, e: Pick<Entity, 'kind' | 'claims'>): number {
  let score = kindScore(rule, e.kind)?.score ?? 0;
  let add = 0;
  for (const c of e.claims) {
    const steps = rule.scale[c.prop];
    if (!steps || c.rank === 'deprecated') continue;
    const v = largest(c.value);
    if (v === undefined) continue;
    for (const s of steps) if (v >= s.at) add = Math.max(add, s.add);
  }
  score += add;
  return score;
}

/** Most prominent first; among equals an order that favours nothing and does not change. */
const hashOf = (id: string) => createHash('sha256').update(id).digest('hex');

export interface Tiled {
  index: FeatureIndex;
  /** path → content */
  files: Map<string, string>;
}

/** Put features in tiles. Those that are drawn by a site, not on the globe, are left out. */
export function tileFeatures(all: Feature[], rule: ProminenceRule, prominence: (f: Feature) => number): Tiled {
  const files = new Map<string, string>();
  const tiles: FeatureTileRef[] = [];
  const where: Record<string, number> = {};
  const variants: Record<string, FeatureVariants> = {};

  const nodes = new Map<number, { f: Feature; p: number; hash: string; domain: string }[]>();
  for (const f of all) {
    if (cityKind(f.kind)) continue;
    const [a, b] = lifeOf(f);
    const { node } = timeNodeOf(binOf(a), binOf(b));
    const list = nodes.get(node) ?? [];
    list.push({ f, p: prominence(f), hash: hashOf(f.id), domain: kindScore(rule, f.kind)?.domain ?? '' });
    nodes.set(node, list);
  }

  type Item = NonNullable<ReturnType<typeof nodes.get>>[number];
  const budget = rule.budget;
  /** What a cell keeps: each domain's reserve first, then the most prominent of the rest. */
  const choose = (items: Item[]): { keep: Item[]; rest: Item[] } => {
    if (items.length <= budget) return { keep: items, rest: [] };
    const kept = new Set<Item>();
    for (const [domain, d] of Object.entries(rule.domains)) {
      let n = 0;
      for (const x of items) {
        if (n >= d.reserve) break;
        if (x.domain === domain) {
          kept.add(x);
          n++;
        }
      }
    }
    for (const x of items) {
      if (kept.size >= budget) break;
      kept.add(x);
    }
    return { keep: items.filter((x) => kept.has(x)), rest: items.filter((x) => !kept.has(x)) };
  };

  /** Writes a cell and those below it, and gives the plates they hold. */
  const write = (t: number, q: string, items: Item[], extra: Item[]): number[] => {
    const { keep, rest } = q.length >= MAX_DEPTH ? { keep: items, rest: [] } : choose(items);
    const rows = [...extra, ...keep];
    const plates = new Set<number>(rows.map((x) => x.f.plate ?? 0));
    const ref: FeatureTileRef = { t, q, n: rows.length, plates: [] };
    const at = tiles.length;
    tiles.push(ref);
    if (rest.length) {
      const cell = cellOf(q);
      const parts: Item[][] = [[], [], [], []];
      for (const x of rest) parts[childOf(cell, x.f.location.lat, x.f.location.lon)].push(x);
      parts.forEach((part, d) => {
        if (part.length) for (const p of write(t, `${q}${d}`, part, [])) plates.add(p);
      });
    }
    ref.plates = [...plates].sort((a, b) => a - b);
    const out: Feature[] = [];
    for (const { f } of rows) {
      where[f.id] = at;
      const moved = f.moves?.some((m) => m.variants) ? f.moves.map((m) => m.variants ?? null) : undefined;
      if (f.variants || moved) variants[f.id] = { time: f.variants, moves: moved };
      const { variants: _, moves, ...row } = f;
      out.push({ ...row, ...(moves ? { moves: moves.map(({ variants: _v, ...m }) => m) } : {}), prominence: prominence(f) });
    }
    files.set(featureTileUrl(ref), stableStringify(out));
    return ref.plates;
  };

  for (const t of [...nodes.keys()].sort((a, b) => a - b)) {
    const items = nodes.get(t)!.sort((a, b) => b.p - a.p || (a.hash < b.hash ? -1 : 1));
    // A thing that moved has no one place: it stays in the root cell, wherever it was.
    write(t, '', items.filter((x) => !x.f.moves?.length), items.filter((x) => x.f.moves?.length));
  }
  const index: FeatureIndex = { format: 'lightworld-features@1', tiles, where };
  files.set(FEATURE_INDEX, stableStringify(index));
  files.set(FEATURE_VARIANTS, stableStringify(variants));
  return { index, files };
}
