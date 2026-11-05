// The atlas of who lived where: the land's fossils, reduced to a list for each patch of land in each stage
// (life/atlas.json, life/bins/<i>.json). A taxon reaches a place by its rows: within a few hundred km it
// is recorded here; within reach overland, in a like climate, in the region; and where nothing is near, the
// nearest kind of thing stands in, as a clade, and says so. The sea costs far more than the land, so that
// a dinosaur of Mongolia does not walk into the Hell Creek.
import { TIER, type AtlasBin, type AtlasBinRef, type AtlasGrid, type AtlasIndex, type AtlasSize, type AtlasTaxon, type AtlasWhere } from '../../../../core/atlas.ts';
import { canonicalForm, type Form } from '../../../../core/form.ts';
import type { PeriodRecord } from '../../../../core/records.ts';
import { rotate, toLatLon, conj, unitVector } from '../../../../core/quat.ts';
import { climateClass, type ClimateClass, type ClimateNode, type ClimateRule } from '../../../../core/climate.ts';
import { fromMa, toMa } from '../../../../core/time.ts';
import { FormTree } from '../forms.ts';
import { pbdbNumber, type LandSnapshot } from '../pbdb.ts';
import { sha256, stableStringify } from '../util.ts';
import type { World } from '../world.ts';
import type { ClimateKeyframe } from './climate.ts';
import { SRC_W, type Snapshot } from './fields.ts';
import { sourceRecord, type Solved } from './records.ts';

export interface AtlasParams {
  /** the grid of the lists, and of the distances, in degrees */
  grid_deg: number;
  graph_deg: number;
  /** how far a row counts as here, and as in the region, in km over land */
  here_km: number;
  region_km: number;
  /** how quickly a row's weight falls off with distance, in km */
  kernel_km: number;
  /** how much further a km of shallow sea and of deep sea counts */
  shallow_cost: number;
  deep_cost: number;
  /** how deep the shallow sea goes, in m below the coast */
  shallow_m: number;
  /** a row dated to a span longer than this says too little of any stage, in Myr */
  longest_span: number;
  /** and one longer than this is left out for a taxon that has rows dated better than it, which say more */
  tight_span: number;
  /** a stage is cut if it is longer than this, and joined to the next if shorter, in Myr */
  longest_bin: number;
  shortest_bin: number;
  /** how many of each kind of thing a list holds */
  quotas: Record<string, number>;
  /** how many stand-ins a kind of thing gets when nothing nearer is known */
  standins: Record<string, number>;
  /** what counts as a big, a small and a tiny animal, by length in metres */
  big_m: number;
  small_m: number;
  tiny_m: number;
}

/** What a taxon of the snapshot is, to the atlas: how it is drawn, and which kind of thing on a list it is. */
interface Known {
  no: number;
  /** its form's node, adopted by a record: the node a stand-in is drawn as */
  node: string;
  nodeNo: number;
  bucket: string;
  taxon: Omit<AtlasTaxon, 'rows' | 'span' | 'standin'>;
}

/** The kind of thing on a list: so that what is many and small does not crowd out what is few and large. */
export function bucketOf(form: Form, lengthM: number | undefined, p: Pick<AtlasParams, 'big_m' | 'small_m' | 'tiny_m'>): string {
  if (form.kind === 'plant') return form.behave?.layer ?? 'canopy';
  if (form.behave?.habitat === 'water') return 'water';
  const l = lengthM ?? 1;
  if (l < p.tiny_m) return 'tiny';
  if (form.behave?.habitat === 'air') return 'air';
  return l >= p.big_m ? 'big' : l >= p.small_m ? 'middle' : 'small';
}

/** Min-heap of [cost, node], for walking the land. */
class Heap {
  private c: number[] = [];
  private n: number[] = [];
  get size(): number {
    return this.c.length;
  }
  push(cost: number, node: number): void {
    const { c, n } = this;
    let i = c.length;
    c.push(cost);
    n.push(node);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (c[p] <= cost) break;
      c[i] = c[p];
      n[i] = n[p];
      i = p;
    }
    c[i] = cost;
    n[i] = node;
  }
  pop(): [number, number] {
    const { c, n } = this;
    const top: [number, number] = [c[0], n[0]];
    const lc = c.pop()!;
    const ln = n.pop()!;
    const size = c.length;
    if (size) {
      let i = 0;
      for (;;) {
        let k = i * 2 + 1;
        if (k >= size) break;
        if (k + 1 < size && c[k + 1] < c[k]) k++;
        if (c[k] >= lc) break;
        c[i] = c[k];
        n[i] = n[k];
        i = k;
      }
      c[i] = lc;
      n[i] = ln;
    }
    return top;
  }
}

/** The land of a moment as a graph: each node's cost per km to cross, on a lat/lon grid. */
class LandGraph {
  readonly nx: number;
  readonly ny: number;
  readonly cost: Float32Array;
  readonly land: Uint8Array;
  private cosines: Float64Array;
  constructor(readonly step: number, snap: Snapshot, isoline: number, p: AtlasParams) {
    this.nx = Math.round(360 / step);
    this.ny = Math.round(180 / step) + 1;
    const n = this.nx * this.ny;
    this.cost = new Float32Array(n);
    this.land = new Uint8Array(n);
    this.cosines = new Float64Array(this.ny);
    for (let j = 0; j < this.ny; j++) {
      const lat = 90 - j * step;
      this.cosines[j] = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
      for (let i = 0; i < this.nx; i++) {
        const lon = -180 + i * step;
        const e = snap.elev[(90 - lat) * SRC_W + (lon + 180)];
        const k = j * this.nx + i;
        this.land[k] = e >= isoline ? 1 : 0;
        this.cost[k] = e >= isoline ? 1 : e >= isoline - p.shallow_m ? p.shallow_cost : p.deep_cost;
      }
    }
  }
  nodeAt(lat: number, lon: number): number {
    const j = Math.max(0, Math.min(this.ny - 1, Math.round((90 - lat) / this.step)));
    const i = ((Math.round((lon + 180) / this.step) % this.nx) + this.nx) % this.nx;
    return j * this.nx + i;
  }
  /** Cost in km over land from some nodes, out to a limit. */
  walk(sources: number[], limit: number, out: Float32Array): void {
    out.fill(Infinity);
    const heap = new Heap();
    for (const s of sources) {
      out[s] = 0;
      heap.push(0, s);
    }
    const { nx, ny, step, cost, cosines } = this;
    const km = step * 111.2;
    // Each node is settled once: many paths over a grid cost the same to within rounding.
    const done = new Uint8Array(out.length);
    while (heap.size) {
      const [d, k] = heap.pop();
      if (done[k]) continue;
      done[k] = 1;
      const j = Math.floor(k / nx);
      const i = k - j * nx;
      for (let dj = -1; dj <= 1; dj++) {
        const v = j + dj;
        if (v < 0 || v >= ny) continue;
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const u = (i + di + nx) % nx;
          const m = v * nx + u;
          const ex = di * km * cosines[j];
          const ey = dj * km;
          const step2 = Math.sqrt(ex * ex + ey * ey) * (cost[k] + cost[m]) * 0.5;
          const nd = d + step2;
          if (nd < out[m] && nd <= limit) {
            out[m] = nd;
            heap.push(nd, m);
          }
        }
      }
    }
  }
}

/** Stages from the world's chart, cut or joined to a usable length. Youngest last. */
export function atlasBins(periods: Pick<PeriodRecord, 'rank' | 'start' | 'end' | 'name'>[], longest: number, shortest: number, oldest = 541): { from: number; to: number; name: string }[] {
  const stages = periods
    .filter((p) => p.rank === 'stage')
    .map((p) => ({ older: toMa(p.start), younger: Math.max(0, toMa(p.end)), name: p.name }))
    .filter((p) => p.older <= oldest + 0.5)
    .sort((a, b) => a.younger - b.younger);
  const out: { older: number; younger: number; name: string }[] = [];
  for (const s of stages) {
    // The shortest are the youngest: joined to the next, up the chart, until they are long enough.
    const prev = out[out.length - 1];
    if (prev && prev.older - prev.younger < shortest) {
      prev.older = s.older;
      prev.name = `${s.name} to ${prev.name}`;
      continue;
    }
    out.push({ ...s });
  }
  const cut: { from: number; to: number; name: string }[] = [];
  for (const s of out) {
    const n = Math.max(1, Math.ceil((s.older - s.younger) / longest - 1e-9));
    for (let k = 0; k < n; k++) {
      const a = s.older - ((s.older - s.younger) * k) / n;
      const b = s.older - ((s.older - s.younger) * (k + 1)) / n;
      cut.push({ from: fromMa(a), to: fromMa(b), name: n === 1 ? s.name : `${s.name}, part ${k + 1} of ${n}` });
    }
  }
  return cut.sort((a, b) => a.from - b.from);
}

const round = (x: number, k = 1000) => Math.round(x * k) / k;

export interface AtlasOut {
  index: AtlasIndex;
  files: Map<string, string>;
  /** what most wants a form, by the rows of the world it would draw */
  wanted: { no: number; name: string; rows: number; node: string | null }[];
}

export function buildAtlas(s: Solved, periods: PeriodRecord[], elevation: Snapshot[], climate: ClimateKeyframe[], climateGridInfo: { step: number; nx: number; lon0: number; lat0: number }, rule: ClimateRule, log: (m: string) => void): AtlasOut | undefined {
  const w = s.world;
  const field = w.fields.find((f) => f.data?.as === 'community');
  if (!field) return undefined;
  const dataset = field.data!.from as string;
  const snap = w.landFossils.get(dataset);
  if (!snap) {
    log(`atlas   not built: no snapshot ${dataset} yet`);
    return undefined;
  }
  const p = field.params as unknown as AtlasParams;
  const isoline = (w.fields.find((f) => f.id === 'field:earth/coastline') as unknown as { isoline_m?: number } | undefined)?.isoline_m ?? 20;
  const known = classify(w, snap, p);

  // Where each site was: its plate, from the plates of today's land.
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
  const adoptedAt = new Map<number, string>();
  for (const e of w.entities) {
    const no = e.kind === 'taxon' ? pbdbNumber(e) : undefined;
    if (no !== undefined) adoptedAt.set(no, e.id);
  }
  const byNo = new Map(snap.taxa.map((t) => [t[0], t]));
  // A species is on a list as its genus, unless someone has written something of the species itself: two names for the
  // same animal should not take up two places on a list.
  const SPECIES = new Set(['species', 'subspecies', 'subgenus']);
  const rolled = new Map<number, number>();
  const rollup = (no: number): number => {
    const seen = rolled.get(no);
    if (seen !== undefined) return seen;
    let x = no;
    for (let g = 0; g < 8; g++) {
      const t = byNo.get(x);
      if (!t || adoptedAt.has(x) || !SPECIES.has(snap.words[t[2]]) || !known.has(t[3])) break;
      x = t[3];
    }
    rolled.set(no, x);
    return x;
  };
  const rowsBySite: number[][] = snap.sites.map(() => []);
  // Which taxa have a row dated well enough that a loose one has nothing to add.
  const tight = new Set<number>();
  for (const [, site, taxon] of snap.rows) {
    if (!known.has(taxon)) continue;
    const t = rollup(taxon);
    rowsBySite[site].push(t);
    if (snap.sites[site][3] - snap.sites[site][4] <= p.tight_span) tight.add(t);
  }

  const bins = atlasBins(periods, p.longest_bin, p.shortest_bin);
  const grid: AtlasGrid = { step: p.grid_deg, nx: Math.round(360 / p.grid_deg), ny: Math.round(180 / p.grid_deg) };
  const files = new Map<string, string>();
  const refs: AtlasBinRef[] = [];
  const exampleOf = new Map<string, Known>();
  for (const kn of known.values()) if (!exampleOf.has(kn.node)) exampleOf.set(kn.node, kn);
  // Where to go to see a record's taxon: the place and stage with the most rows of it or anything below it.
  const recordsOf = new Map<number, string[]>();
  const recordsAbove = (no: number): string[] => {
    const known0 = recordsOf.get(no);
    if (known0) return known0;
    const out: string[] = [];
    for (let x = no, g = 0; x && byNo.has(x) && g < 200; x = byNo.get(x)![3], g++) {
      const id = adoptedAt.get(x);
      if (id) out.push(id);
    }
    recordsOf.set(no, out);
    return out;
  };
  const where: Record<string, AtlasWhere> = {};
  bins.forEach((bin, binIndex) => {
    const olderMa = toMa(bin.from);
    const youngerMa = toMa(bin.to);
    const midMa = (olderMa + youngerMa) / 2;
    const slice = fromMa(midMa);
    const key = [...elevation].sort((a, b) => Math.abs(a.ageMa - midMa) - Math.abs(b.ageMa - midMa))[0];
    if (Math.abs(key.ageMa - midMa) > 12) return;
    const graph = new LandGraph(p.graph_deg, key, isoline, p);
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
    // The most of each record's taxon in one place in this stage.
    for (const node of [...atNode.keys()].sort((a, b) => a - b)) {
      const count = new Map<string, number>();
      for (const [t, e] of atNode.get(node)!) for (const id of recordsAbove(t)) count.set(id, (count.get(id) ?? 0) + e.w);
      const lat = 90 - Math.floor(node / graph.nx) * graph.step;
      const lon = -180 + (node % graph.nx) * graph.step;
      for (const [id, rows] of count) if (!where[id] || rows > where[id].rows) where[id] = { t: slice, lat, lon, rows: round(rows) };
    }
    // Their climates, for how like a place each is.
    const ck = [...climate].sort((a, b) => Math.abs(a.ageMa - midMa) - Math.abs(b.ageMa - midMa))[0];
    const climateAt = (lat: number, lon: number): ClimateNode | undefined => {
      if (!ck) return undefined;
      const { step, nx, lon0, lat0 } = climateGridInfo;
      const row = Math.round((lat0 - lat) / step);
      const col = ((Math.round((lon - lon0) / step) % nx) + nx) % nx;
      const k = (row * nx + col) * 4;
      const c = { hot: ck.nodes[k], cold: ck.nodes[k + 1], aridity: ck.nodes[k + 2], margin: ck.nodes[k + 3] };
      return Number.isNaN(c.hot) ? undefined : c;
    };
    const nodeLat = (k: number) => 90 - Math.floor(k / graph.nx) * graph.step;
    const nodeLon = (k: number) => -180 + (k % graph.nx) * graph.step;
    const occupied = [...atNode.keys()].sort((a, b) => a - b);
    const occClimate = new Map(occupied.map((k) => [k, climateAt(nodeLat(k), nodeLon(k))]));

    // The patches: each is read at its land node nearest its middle, if it has any land.
    const patchOf = new Map<number, number>();
    for (let row = 0; row < grid.ny; row++) {
      for (let col = 0; col < grid.nx; col++) {
        const lat = 90 - (row + 0.5) * grid.step;
        const lon = -180 + (col + 0.5) * grid.step;
        let best = -1;
        let bestD = Infinity;
        const span = Math.ceil(grid.step / graph.step / 2) + 1;
        const c0 = graph.nodeAt(lat, lon);
        const cj = Math.floor(c0 / graph.nx);
        const ci = c0 - cj * graph.nx;
        for (let dj = -span; dj <= span; dj++) {
          const j = cj + dj;
          if (j < 0 || j >= graph.ny) continue;
          for (let di = -span; di <= span; di++) {
            const i = (ci + di + graph.nx) % graph.nx;
            const k = j * graph.nx + i;
            if (!graph.land[k]) continue;
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
    const reach = p.region_km * 1.6;
    const dist = new Float32Array(graph.nx * graph.ny);
    // For each patch: every occupied node it can reach, and how far.
    const reachOf = new Map<number, { node: number; km: number }[]>();
    const patches = [...patchOf.entries()];
    for (const o of occupied) {
      graph.walk([o], reach, dist);
      for (const [patch, k] of patches) {
        const d = dist[k];
        if (d === Infinity) continue;
        const l = reachOf.get(patch);
        if (l) l.push({ node: o, km: d });
        else reachOf.set(patch, [{ node: o, km: d }]);
      }
    }
    // The nearest of anything, however far, for what a stand-in says.
    const nearest = new Float32Array(graph.nx * graph.ny);
    graph.walk(occupied, Infinity, nearest);
    // What is known of the stage, by kind and by climate: what stand-ins are drawn from.
    const worldwide = new Map<string, Map<string, { w: number; node: string; nodeNo: number }>>();
    const classAt = new Map<number, ClimateClass | null>();
    for (const o of occupied) {
      const c = occClimate.get(o);
      const cls = c ? climateClass(c, rule) : null;
      classAt.set(o, cls);
      for (const [t, e] of atNode.get(o)!) {
        const kn = known.get(t)!;
        for (const key of [`${kn.bucket}|${cls ?? 'any'}`, `${kn.bucket}|any`]) {
          let m = worldwide.get(key);
          if (!m) {
            m = new Map();
            worldwide.set(key, m);
          }
          const q = m.get(kn.node);
          if (q) q.w += e.w;
          else m.set(kn.node, { w: e.w, node: kn.node, nodeNo: kn.nodeNo });
        }
      }
    }
    const taxa: AtlasTaxon[] = [];
    const taxonIndex = new Map<string, number>();
    const nodes: Record<string, number[]> = {};
    const entry = (keyOf: string, make: () => AtlasTaxon) => {
      let i = taxonIndex.get(keyOf);
      if (i === undefined) {
        i = taxa.length;
        taxa.push(make());
        taxonIndex.set(keyOf, i);
      }
      return i;
    };
    // The whole span of each taxon's rows in the stage.
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
    for (const [patch, k] of patches.sort((a, b) => a[0] - b[0])) {
      const c = climateAt(nodeLat(k), nodeLon(k));
      const cls = c ? climateClass(c, rule) : null;
      const score = new Map<number, { s: number; km: number }>();
      for (const { node, km } of reachOf.get(patch) ?? []) {
        const oc = occClimate.get(node);
        let like = 1;
        if (c && oc) {
          const ratio = Math.log(Math.max(c.aridity, 0.05) / Math.max(oc.aridity, 0.05));
          like = Math.exp(-(Math.abs(c.hot - oc.hot) / 15 + Math.abs(c.cold - oc.cold) / 20 + Math.abs(ratio) / 1.5));
        }
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
      // Heaviest first in each kind of thing, up to its quota: only what is near enough.
      const byBucket = new Map<string, { t: number; s: number; km: number }[]>();
      for (const [t, { s: sc, km }] of score) {
        if (km > p.region_km) continue;
        const b = known.get(t)!.bucket;
        const l = byBucket.get(b);
        if (l) l.push({ t, s: sc, km });
        else byBucket.set(b, [{ t, s: sc, km }]);
      }
      const flat: number[] = [];
      const far = Math.round(Math.min(65535, (nearest[k] === Infinity ? 20000 : nearest[k]) / 10));
      for (const bucket of Object.keys(p.quotas).sort()) {
        const list = (byBucket.get(bucket) ?? []).sort((a, b) => b.s - a.s || a.t - b.t).slice(0, p.quotas[bucket]);
        if (list.length) {
          const top = list[0].s;
          for (const { t, s: sc, km } of list) {
            const i = entry(`t${t}`, () => {
              const q = spanOf.get(t)!;
              const kn = known.get(t)!;
              return { ...kn.taxon, rows: q[2], span: [round(q[0]), round(q[1])] };
            });
            flat.push(i, Math.max(1, Math.round((sc / top) * 255)), km <= p.here_km ? TIER.here : TIER.region, Math.round(Math.min(65535, km / 10)));
          }
          continue;
        }
        // Nothing of this kind within reach: the nearest kind of thing stands in, as its clade.
        const n = p.standins[bucket] ?? 0;
        if (!n) continue;
        const pool = worldwide.get(`${bucket}|${cls ?? 'any'}`) ?? worldwide.get(`${bucket}|any`);
        if (!pool) continue;
        // A stage with no fossils of a kind has nothing to draw for it, here or anywhere.
        const best = [...pool.values()].sort((a, b) => b.w - a.w || (a.node < b.node ? -1 : 1)).slice(0, n);
        const top = best.length ? best[0].w : 1;
        for (const b of best) {
          const example = exampleOf.get(b.node)!;
          const i = entry(`n${b.node}`, () => {
            // Drawn as the clade: its span is the stage's, as all that is known is that its kind was somewhere.
            const label = example.taxon.form_label;
            return { ...example.taxon, label, no: b.nodeNo, id: b.node, rank: '', own: true, rows: 0, span: [round(olderMa), round(youngerMa)], standin: true };
          });
          flat.push(i, Math.max(1, Math.round((b.w / top) * 255)), TIER.standin, far);
        }
      }
      // An empty list is a land with no record of life on it: it still has a scene, of bare ground.
      nodes[String(patch)] = flat;
    }
    const file = `life/bins/${binIndex}.json`;
    const out: AtlasBin = { format: 'lightworld-atlas-bin@1', from: bin.from, to: bin.to, slice, name: bin.name, taxa, nodes };
    files.set(file, stableStringify(out));
    refs.push({ from: bin.from, to: bin.to, slice, name: bin.name, file, rows: rowsHere, nodes: Object.keys(nodes).length });
    if (binIndex % 20 === 0) log(`atlas   ${bin.name}: ${rowsHere} rows, ${atNode.size} places, ${taxa.length} taxa on ${Object.keys(nodes).length} lists`);
  });
  // The forms the lists use, whole.
  const forms: Record<string, Form> = {};
  for (const kn of known.values()) forms[kn.taxon.form] ??= known.forms.get(kn.taxon.form)!;
  files.set('life/forms.json', stableStringify(forms));
  files.set('life/where.json', stableStringify(where));
  const allRows = new Map<number, number>();
  for (const [, , t] of snap.rows) allRows.set(t, (allRows.get(t) ?? 0) + 1);
  let own = 0;
  let inherited = 0;
  let none = 0;
  let drawable = 0;
  const wanted = new Map<number, { no: number; name: string; rows: number; node: string | null }>();
  for (const t of snap.taxa) {
    const rows = allRows.get(t[0]) ?? 0;
    if (!rows) continue;
    const kn = known.get(t[0]);
    if (!kn) none++;
    else if (kn.taxon.own) own++;
    else inherited++;
    if (kn) drawable += rows;
    if (!kn?.taxon.own) wanted.set(t[0], { no: t[0], name: t[1], rows, node: kn?.node ?? null });
  }
  const totalRows = snap.rows.length;
  const index: AtlasIndex = {
    format: 'lightworld-atlas@1',
    title: field.title,
    description: field.description,
    source: dataset,
    sourceRecord: w.source.get(dataset) ? sourceRecord(w.source.get(dataset)!) : undefined,
    grid,
    here_km: p.here_km,
    region_km: p.region_km,
    forms: 'life/forms.json',
    where: 'life/where.json',
    generator: (() => {
      const gen = w.generators.find((g) => g.id === 'gen:life/scene')!;
      const { site: _site, ...rest } = gen.params as unknown as { site: unknown };
      return { id: gen.id, version: gen.version, params: rest as Record<string, unknown> };
    })(),
    bins: refs,
    coverage: { taxa: own + inherited + none, own_form: own, inherited_form: inherited, no_form: none, rows_drawable: drawable, rows_total: totalRows },
  };
  files.set('life/atlas.json', stableStringify(index));
  log(`atlas   ${refs.length} stages; of ${own + inherited + none} taxa with rows ${own} have their own form, ${inherited} inherit one and ${none} have none, which is ${Math.round((drawable / totalRows) * 100)}% of the rows drawable; ${Object.keys(forms).length} whole forms`);
  return { index, files, wanted: [...wanted.values()].sort((a, b) => b.rows - a.rows || a.no - b.no) };
}

/** What the snapshot's taxa are, to the atlas: only those that can be drawn, because some node above them has a plan. */
export function classify(w: World, snap: LandSnapshot, p: Pick<AtlasParams, 'big_m' | 'small_m' | 'tiny_m'>): Map<number, Known> & { forms: Map<string, Form> } {
  const tree = new FormTree(w);
  const adopted = new Map<number, string>();
  for (const e of w.entities) {
    if (e.kind !== 'taxon') continue;
    const no = pbdbNumber(e);
    if (no !== undefined) adopted.set(no, e.id);
  }
  const byNo = new Map(snap.taxa.map((t) => [t[0], t]));
  const word = (n: number) => snap.words[n] || undefined;
  const out = new Map<number, Known>() as Map<number, Known> & { forms: Map<string, Form> };
  out.forms = new Map();
  const labelOf = (id: string) => {
    const e = w.entity.get(id);
    const name = e?.claims.find((c) => c.prop === 'name')?.value as { en?: string; la?: string } | undefined;
    return name?.en ?? name?.la ?? id;
  };
  const size = (id: string, prop: 'body_length' | 'hip_height' | 'plant_height' | 'body_mass', ownTaxon: boolean): AtlasSize | undefined => {
    const q = tree.size(id, prop);
    return q ? { lo: q.lo, hi: q.hi, from: labelOf(q.from), own: q.own && ownTaxon } : undefined;
  };
  const results = new Map<number, Known | null>();
  const resolve = (no: number): Known | null => {
    const known = results.get(no);
    if (known !== undefined) return known;
    const t = byNo.get(no);
    if (!t) {
      results.set(no, null);
      return null;
    }
    // Up the database's own tree to the first taxon a record adopts.
    let node: string | undefined;
    let nodeNo = no;
    for (let x = no, guard = 0; x && byNo.has(x) && guard < 200; x = byNo.get(x)![3], guard++) {
      const id = adopted.get(x);
      if (id) {
        node = id;
        nodeNo = x;
        break;
      }
    }
    const source = node ? tree.source(node) : undefined;
    const form = node ? tree.form(node) : undefined;
    if (!node || !source || !form) {
      results.set(no, null);
      return null;
    }
    // Something on land or in fresh water: this atlas holds no seas yet. Its rows are all from the land, so what the
    // database calls marine only counts against what would have to swim: a pterosaur over the coast or a crocodile at the
    // water's edge is not left out for it.
    const env = word(t[9]);
    const habitat = form.behave?.habitat;
    if (env === 'marine' && habitat !== 'air' && habitat !== 'edge' && habitat !== 'wet') {
      results.set(no, null);
      return null;
    }
    const fromNode = source.from;
    const canon = canonicalForm(form);
    const text = stableStringify(canon);
    const key = sha256(text).slice(0, 16);
    out.forms.set(key, canon);
    const isNode = nodeNo === no;
    const length = form.kind === 'animal' ? size(node, 'body_length', isNode) : undefined;
    const height = form.kind === 'plant' ? size(node, 'plant_height', isNode) : undefined;
    const mass = form.kind === 'animal' ? size(node, 'body_mass', isNode) : undefined;
    const hip = form.kind === 'animal' ? size(node, 'hip_height', isNode) : undefined;
    // A size is inherited, never guessed: a kind with no size anywhere above it is not drawn.
    if (form.kind === 'animal' ? !length && !mass : !height && form.behave?.layer !== 'float') {
      results.set(no, null);
      return null;
    }
    const posture = tree.posture(node);
    const kn: Known = {
      no,
      node,
      nodeNo,
      // By its length, or what its mass says of it.
      bucket: bucketOf(form, length ? Math.sqrt(length.lo * length.hi) : mass ? Math.cbrt(Math.sqrt(mass.lo * mass.hi) / (form.mass_length ?? 20)) : undefined, p),
      taxon: {
        no,
        ...(adopted.get(no) ? { id: adopted.get(no) } : {}),
        label: t[1],
        rank: word(t[2]) ?? '',
        form: key,
        form_from: fromNode,
        form_label: labelOf(fromNode),
        own: adopted.get(no) === fromNode,
        ...(length ? { length } : {}),
        ...(hip ? { hip } : {}),
        ...(height ? { height } : {}),
        ...(mass ? { mass } : {}),
        ...(posture ? { posture } : {}),
        ...(word(t[10]) ? { diet: word(t[10]) } : {}),
        ...(word(t[11]) ? { habit: word(t[11]) } : {}),
      },
    };
    results.set(no, kn);
    out.set(no, kn);
    return kn;
  };
  for (const t of snap.taxa) resolve(t[0]);
  return out;
}
