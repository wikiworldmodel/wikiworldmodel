// The atlas of who lived in the sea (life/sea.json, life/sea/<i>.json): the sea's fossils, reduced to a list for each
// patch of sea in each stage, as the land's are (atlas.ts), and over the sea. A genus reaches a place by its rows: within
// a few hundred km by sea it is recorded here; within reach by sea, in a like belt of latitude, in the region; and where
// nothing is near, the stage's commonest genera of that belt stand in, and say so. The land costs far more than the sea,
// and the deep sea more than the shelf, so that a shelf's animals do not cross an ocean or a continent. It lists genera,
// not forms: the sea's great groups have no form in the world yet, so these lists say what lived where and draw nothing.
import { TIER, type AtlasBinRef, type AtlasGrid, type SeaBin, type SeaIndex, type SeaTaxon } from '../../../../core/atlas.ts';
import { conj, rotate, toLatLon, unitVector } from '../../../../core/quat.ts';
import type { PeriodRecord } from '../../../../core/records.ts';
import { fromMa, toMa } from '../../../../core/time.ts';
import type { LandSnapshot } from '../pbdb.ts';
import { stableStringify } from '../util.ts';
import { atlasBins, classify, LandGraph, type AtlasParams } from './atlas.ts';
import { SRC_W, type Snapshot } from './fields.ts';
import { sourceRecord, type Solved } from './records.ts';

export interface SeaParams {
  /** the grid of the lists, and of the distances, in degrees */
  grid_deg: number;
  graph_deg: number;
  /** how far a row counts as here, and as in the region, in km over the sea */
  here_km: number;
  region_km: number;
  /** how quickly a row's weight falls off with distance, in km */
  kernel_km: number;
  /** how much further a km of land, and of deep sea, counts than a km of shelf */
  land_cost: number;
  deep_cost: number;
  /** how deep the shelf goes, in m below the coast */
  shallow_m: number;
  /** a row dated to a span longer than this says too little of any stage, in Myr; and one longer than the next is left out for a genus with better-dated rows */
  longest_span: number;
  tight_span: number;
  /** a stage is cut if it is longer than this, and joined to the next if shorter, in Myr: the land's, so their lists cover the same spans */
  longest_bin: number;
  shortest_bin: number;
  /** how many genera a list holds, and how many stand in where nothing is near */
  list_size: number;
  standins: number;
  /** besides those, how many of the genera a scene can draw a list keeps, the most recorded first; and at most how many of one class */
  drawn_size: number;
  per_class: number;
  /** the edges of the belts of latitude, in degrees from the equator; and how much a row of another belt counts */
  belts: number[];
  other_belt: number;
}

export interface SeaOut {
  index: SeaIndex;
  files: Map<string, string>;
  /** in memory, for the build's own questions: each stage's lists, as written, in the order of the index's bins */
  bins: SeaBin[];
}

const round = (x: number, k = 1000) => Math.round(x * k) / k;

/** Which belt of latitude a latitude is in: 0 at the equator, and one more past each edge. */
export function beltOf(lat: number, edges: number[]): number {
  const a = Math.abs(lat);
  let b = 0;
  while (b < edges.length && a >= edges[b]) b++;
  return b;
}

/** The genus a row's taxon is, or the taxon itself where it is a genus or above. */
function genusOf(snap: LandSnapshot, byNo: Map<number, LandSnapshot['taxa'][number]>): (no: number) => number {
  const below = new Set(['species', 'subspecies', 'subgenus']);
  const memo = new Map<number, number>();
  return (no) => {
    const seen = memo.get(no);
    if (seen !== undefined) return seen;
    let x = no;
    for (let g = 0; g < 8; g++) {
      const t = byNo.get(x);
      if (!t || !below.has(snap.words[t[2]]) || !byNo.has(t[3])) break;
      x = t[3];
    }
    memo.set(no, x);
    return x;
  };
}

/** The class a taxon is in by the database's classification, or else its phylum: what kind of thing it is, in a word. */
function groupOf(snap: LandSnapshot, byNo: Map<number, LandSnapshot['taxa'][number]>, no: number): string {
  let phylum = '';
  for (let x = no, g = 0; x && byNo.has(x) && g < 60; x = byNo.get(x)![3], g++) {
    const t = byNo.get(x)!;
    const rank = snap.words[t[2]];
    if (rank === 'class') return t[1];
    if (rank === 'phylum' && !phylum) phylum = t[1];
  }
  return phylum;
}

export function buildSeaAtlas(s: Solved, periods: PeriodRecord[], elevation: Snapshot[], snap: LandSnapshot, dataset: string, p: SeaParams, isoline: number, log: (m: string) => void): SeaOut {
  const w = s.world;
  const field = w.fields.find((f) => f.data?.from === dataset)!;
  const byNo = new Map(snap.taxa.map((t) => [t[0], t]));
  const genus = genusOf(snap, byNo);
  // How each genus is drawn, where a node above it has a body for the sea: the land's atlas's classification, in the sea.
  const sizes = w.fields.find((f) => f.data?.as === 'community')?.params as unknown as Pick<AtlasParams, 'big_m' | 'small_m' | 'tiny_m'> | undefined;
  const known = classify(w, snap, sizes ?? { big_m: 3, small_m: 0.5, tiny_m: 0.1 }, 'sea');
  const usedForms = new Set<string>();
  let drawnRows = 0;

  // Where each site was: its plate, from the plates of today's land, as the land's atlas finds it.
  const now = [...elevation].sort((a, b) => a.ageMa - b.ageMa)[0];
  const plateNear = (lat: number, lon: number): number => {
    const j0 = Math.round(90 - lat);
    const i0 = Math.round(lon + 180);
    for (let r = 0; r <= 3; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(dj), Math.abs(di)) !== r) continue;
          const j = Math.max(0, Math.min(180, j0 + dj));
          const i = ((i0 + di) % SRC_W + SRC_W) % SRC_W;
          const q = now.plate[j * SRC_W + i];
          if (q) return q;
        }
      }
    }
    return 0;
  };
  const sitePlate = snap.sites.map(([, lat, lng]) => plateNear(lat, lng));
  const rowsBySite: number[][] = snap.sites.map(() => []);
  const tight = new Set<number>();
  for (const [, site, taxon] of snap.rows) {
    if (!byNo.has(taxon)) continue;
    const g = genus(taxon);
    rowsBySite[site].push(g);
    if (snap.sites[site][3] - snap.sites[site][4] <= p.tight_span) tight.add(g);
  }

  const grid: AtlasGrid = { step: p.grid_deg, nx: Math.round(360 / p.grid_deg), ny: Math.round(180 / p.grid_deg) };
  const files = new Map<string, string>();
  const refs: AtlasBinRef[] = [];
  const out: SeaBin[] = [];
  atlasBins(periods, p.longest_bin, p.shortest_bin).forEach((bin, binIndex) => {
    const olderMa = toMa(bin.from);
    const youngerMa = toMa(bin.to);
    const midMa = (olderMa + youngerMa) / 2;
    const slice = fromMa(midMa);
    const key = [...elevation].sort((a, b) => Math.abs(a.ageMa - midMa) - Math.abs(b.ageMa - midMa))[0];
    if (Math.abs(key.ageMa - midMa) > 12) return;
    // The sea of the time: the shelf for a km a km, the deep sea and the land dearer.
    const graph = new LandGraph(p.graph_deg, key, isoline, { shallow_m: p.shallow_m, shallow_cost: 1, deep_cost: p.deep_cost }, (e) => (e >= isoline ? p.land_cost : e >= isoline - p.shallow_m ? 1 : p.deep_cost));
    const nodeLat = (k: number) => 90 - Math.floor(k / graph.nx) * graph.step;
    const nodeLon = (k: number) => -180 + (k % graph.nx) * graph.step;
    // Each site in the stage, where it was, on the graph.
    const atNode = new Map<number, Map<number, { w: number; rows: number; older: number; younger: number }>>();
    let rowsHere = 0;
    snap.sites.forEach((site, i) => {
      const [, lat, lng, max, min] = site;
      if (max <= youngerMa || min >= olderMa) return;
      if (max - min > p.longest_span) return;
      const plate = sitePlate[i];
      if (!plate || !s.model.reaches(plate, midMa) || !s.model.reaches(plate, 0)) return;
      const list = rowsBySite[i];
      if (!list.length) return;
      const [la, lo] = toLatLon(rotate(s.model.total(plate, midMa), rotate(conj(s.model.total(plate, 0)), unitVector(lat, lng))));
      const node = graph.nodeAt(la, lo);
      const share = (Math.min(max, olderMa) - Math.max(min, youngerMa)) / Math.max(max - min, 1e-3);
      let here = atNode.get(node);
      if (!here) {
        here = new Map();
        atNode.set(node, here);
      }
      for (const t of list) {
        if (max - min > p.tight_span && tight.has(t)) continue;
        rowsHere++;
        const e = here.get(t);
        if (e) {
          e.w += share;
          e.rows++;
          e.older = Math.max(e.older, max);
          e.younger = Math.min(e.younger, min);
        } else here.set(t, { w: share, rows: 1, older: max, younger: min });
      }
    });
    const occupied = [...atNode.keys()].sort((a, b) => a - b);
    // The patches: each is read at its sea node nearest its middle, if it has any sea.
    const patchOf = new Map<number, number>();
    for (let row = 0; row < grid.ny; row++) {
      for (let col = 0; col < grid.nx; col++) {
        const lat = 90 - (row + 0.5) * grid.step;
        const lon = -180 + (col + 0.5) * grid.step;
        const span = Math.ceil(grid.step / graph.step / 2) + 1;
        const c0 = graph.nodeAt(lat, lon);
        const cj = Math.floor(c0 / graph.nx);
        const ci = c0 - cj * graph.nx;
        let best = -1;
        let bestD = Infinity;
        for (let dj = -span; dj <= span; dj++) {
          const j = cj + dj;
          if (j < 0 || j >= graph.ny) continue;
          for (let di = -span; di <= span; di++) {
            const k = j * graph.nx + ((ci + di + graph.nx) % graph.nx);
            if (graph.land[k]) continue;
            const la = nodeLat(k);
            const lo = nodeLon(k);
            if (la > 90 - row * grid.step + 1e-9 || la < 90 - (row + 1) * grid.step - 1e-9) continue;
            const dLon = Math.abs(((lo - lon + 540) % 360) - 180);
            if (dLon > grid.step / 2 + 1e-9) continue;
            const d = (la - lat) * (la - lat) + dLon * dLon;
            if (d < bestD) {
              bestD = d;
              best = k;
            }
          }
        }
        if (best >= 0) patchOf.set(row * grid.nx + col, best);
      }
    }
    const patches = [...patchOf.entries()].sort((a, b) => a[0] - b[0]);
    const patchAt = new Map(patches.map(([patch, k]) => [k, patch]));
    // For each patch: every occupied node it can reach, and how far.
    const reachOf = new Map<number, { node: number; km: number }[]>();
    const dist = new Float32Array(graph.nx * graph.ny);
    for (const o of occupied) {
      const reached: number[] = [];
      graph.walk([o], p.region_km, dist, reached);
      for (const k of reached) {
        const patch = patchAt.get(k);
        if (patch === undefined) continue;
        const l = reachOf.get(patch);
        if (l) l.push({ node: o, km: dist[k] });
        else reachOf.set(patch, [{ node: o, km: dist[k] }]);
      }
    }
    const nearest = new Float32Array(graph.nx * graph.ny);
    if (occupied.length) graph.walk(occupied, Infinity, nearest);
    else nearest.fill(Infinity);
    // What stands in where nothing is near: the genera found at the most places of the stage, belt by belt.
    const widespread = new Map<number, Map<number, number>>();
    for (const o of occupied) {
      const b = beltOf(nodeLat(o), p.belts);
      let m = widespread.get(b);
      if (!m) widespread.set(b, (m = new Map()));
      for (const t of atNode.get(o)!.keys()) m.set(t, (m.get(t) ?? 0) + 1);
    }
    const spanOf = new Map<number, [number, number, number]>();
    for (const here of atNode.values()) {
      for (const [t, e] of here) {
        const q = spanOf.get(t);
        if (q) {
          q[0] = Math.max(q[0], e.older);
          q[1] = Math.min(q[1], e.younger);
          q[2] += e.rows;
        } else spanOf.set(t, [e.older, e.younger, e.rows]);
      }
    }
    const taxa: SeaTaxon[] = [];
    const taxonIndex = new Map<string, number>();
    const entry = (k: string, make: () => SeaTaxon) => {
      let i = taxonIndex.get(k);
      if (i === undefined) {
        i = taxa.length;
        taxa.push(make());
        taxonIndex.set(k, i);
      }
      return i;
    };
    const taxonOf = (t: number): SeaTaxon => {
      const x = byNo.get(t)!;
      const q = spanOf.get(t)!;
      const k = known.get(t);
      if (k) usedForms.add(k.taxon.form);
      // Its label, number and rank are the database's, as on any list; the rest is how it is drawn.
      const draw = k ? (({ no: _no, label: _label, rank: _rank, ...rest }) => rest)(k.taxon) : undefined;
      return { no: t, label: x[1], rank: snap.words[x[2]] ?? '', group: groupOf(snap, byNo, t), rows: q[2], span: [round(q[0]), round(q[1])], ...(draw ? { draw } : {}) };
    };
    /**
     * After the most recorded, the genera a scene can draw: the most recorded of those first, and no more than `per_class`
     * of one class among all a list draws, so that a scene shows the variety of a sea and not its commonest class many times.
     */
    const drawable = <T extends { t: number }>(ranked: T[], kept: T[]): T[] => {
      const perClass = new Map<string, number>();
      const count = (t: number) => {
        const g = groupOf(snap, byNo, t);
        perClass.set(g, (perClass.get(g) ?? 0) + 1);
      };
      for (const e of kept) if (known.has(e.t)) count(e.t);
      const have = new Set(kept.map((e) => e.t));
      const out: T[] = [];
      let drawn = kept.filter((e) => known.has(e.t)).length;
      for (const e of ranked) {
        if (drawn >= p.drawn_size) break;
        if (have.has(e.t) || !known.has(e.t)) continue;
        if ((perClass.get(groupOf(snap, byNo, e.t)) ?? 0) >= p.per_class) continue;
        count(e.t);
        out.push(e);
        drawn++;
      }
      return out;
    };
    const nodes: Record<string, number[]> = {};
    for (const [patch, k] of patches) {
      const belt = beltOf(nodeLat(k), p.belts);
      const score = new Map<number, { s: number; km: number }>();
      for (const { node, km } of reachOf.get(patch) ?? []) {
        const like = beltOf(nodeLat(node), p.belts) === belt ? 1 : p.other_belt;
        const fall = Math.exp(-km / p.kernel_km);
        for (const [t, e] of atNode.get(node)!) {
          const q = score.get(t);
          const add = e.w * fall * like;
          if (q) {
            q.s += add;
            if (km < q.km) q.km = km;
          } else score.set(t, { s: add, km });
        }
      }
      const flat: number[] = [];
      const ranked = [...score].map(([t, v]) => ({ t, ...v })).sort((a, b) => b.s - a.s || a.t - b.t);
      const most = ranked.slice(0, p.list_size);
      const list = [...most, ...drawable(ranked, most)];
      if (list.length) {
        const top = list[0].s;
        for (const { t, s: sc, km } of list) flat.push(entry(`t${t}`, () => taxonOf(t)), Math.max(1, Math.round((sc / top) * 255)), km <= p.here_km ? TIER.here : TIER.region, Math.round(Math.min(65535, km / 10)));
      } else {
        // Nothing within reach: the stage's commonest genera of this belt, or of any, stand in.
        const pool = widespread.get(belt) ?? [...widespread.values()][0];
        if (pool) {
          const pooled = [...pool].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([t, n]) => ({ t, n }));
          const most = pooled.slice(0, p.standins);
          const best = [...most, ...drawable(pooled, most)].map((e) => [e.t, e.n] as [number, number]);
          const top = best.length ? best[0][1] : 1;
          const far = Math.round(Math.min(65535, (nearest[k] === Infinity ? 20000 : nearest[k]) / 10));
          for (const [t, n] of best) flat.push(entry(`s${t}`, () => ({ ...taxonOf(t), standin: true })), Math.max(1, Math.round((n / top) * 255)), TIER.standin, far);
        }
      }
      // An empty list is a sea with no record of life in the stage, anywhere.
      nodes[String(patch)] = flat;
    }
    for (const t of taxa) if (t.draw) drawnRows += t.rows;
    const file = `life/sea/${binIndex}.json`;
    const b: SeaBin = { format: 'lightworld-sea-bin@1', from: bin.from, to: bin.to, slice, name: bin.name, taxa, nodes };
    files.set(file, stableStringify(b));
    out.push(b);
    refs.push({ from: bin.from, to: bin.to, slice, name: bin.name, file, rows: rowsHere, nodes: Object.keys(nodes).length });
    if (binIndex % 20 === 0) log(`sea     ${bin.name}: ${rowsHere} rows, ${atNode.size} places, ${taxa.length} genera on ${Object.keys(nodes).length} lists`);
  });
  const index: SeaIndex = {
    format: 'lightworld-sea-atlas@1',
    title: field.title,
    description: field.description,
    source: dataset,
    sourceRecord: w.source.get(dataset) ? sourceRecord(w.source.get(dataset)!) : undefined,
    grid,
    here_km: p.here_km,
    region_km: p.region_km,
    bins: refs,
    forms: 'life/sea-forms.json',
  };
  files.set('life/sea.json', stableStringify(index));
  // The whole forms the sea's lists draw with, by key, as the land's atlas writes its own.
  files.set('life/sea-forms.json', stableStringify(Object.fromEntries([...usedForms].sort().map((k) => [k, known.forms.get(k)!]))));
  log(`sea     ${refs.length} stages, from ${snap.rows.length} rows of ${dataset}; ${usedForms.size} forms draw the genera listed, which have ${drawnRows} of the stages' rows`);
  return { index, files, bins: out };
}
