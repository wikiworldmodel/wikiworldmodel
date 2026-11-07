// The coverage page: how much of the world each layer knows, across the globe and the whole span of time, in tiers
// (docs/STRUCTURE.md section 3.3). Each layer is a strip along the time control's own scale, its height the share of
// the globe each tier answers; under it, what answers it when. Below the layers come the fields drawn over the globe
// that answer no layer yet, the whole-planet series, and the records, by kind. Picking a cell maps it.
//
// It reads the build's coverage.json, which the build makes with the same resolve the viewer asks (core/coverage.ts).
import { decodeRuns, type CoverageMatrix, type CoverageSource, type Span } from '../../../core/coverage.ts';
import type { CoverageFile, PeriodsFile, SearchEntry, SearchFile, SeriesFile } from '../../../core/records.ts';
import { LAYERS, TIERS, type LayerId, type Tier } from '../../../core/resolve.ts';
import { formatDuration, formatTime, PRESENT_YEAR, timeToParam } from '../../../core/time.ts';
import { positionOf, timeAt } from '../../../core/timescale.ts';
import type { Tileset } from '../../../core/tileset.ts';
import { getJSON, latestBuild } from '../data.ts';
import { rulerTicks } from '../ui/timebar.ts';
import './coverage.css';

const LAYER_LABEL: Record<LayerId, string> = { planet: 'The planet', geography: 'Land and sea', climate: 'Climate', ice: 'Ice', water: 'Rivers and lakes', life: 'Life', people: 'People', polity: 'States' };
const TIER_LABEL: Record<Tier, string> = { evidence: 'Evidence', model: 'Model', generic: 'Generic', unknown: 'Unknown' };
const TIER_SAY: Record<Tier, string> = {
  evidence: 'records or rows put it there',
  model: 'a field or a model covers it',
  generic: 'a generic stand-in is drawn, and says so',
  unknown: 'nothing is known, and nothing stands in',
};
const LANE_LABEL: Record<string, string> = { phases: "The planet's phases", glaciations: 'Glaciations', 'generic-land': 'Generic land' };

/** The grain of a grid, in classes from coarse to fine, by the size of a cell at the equator. */
const GRAIN: { label: string; maxKm: number }[] = [
  { label: '≥ 200 km', maxKm: Infinity },
  { label: '50–200 km', maxKm: 200 },
  { label: '10–50 km', maxKm: 50 },
  { label: '1–10 km', maxKm: 10 },
  { label: '< 1 km', maxKm: 1 },
];
const KM_PER_DEG = 111.32;

const ROOT = './';
const app = document.getElementById('cov')!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const pct = (x: number) => (x === 0 ? '0%' : x < 0.001 ? '<0.1%' : x < 0.1 ? `${(x * 100).toFixed(1)}%` : `${Math.round(x * 100)}%`);
const count = (n: number) => n.toLocaleString('en');

async function main() {
  const params = new URLSearchParams(location.search);
  const id = params.get('b') ?? (await latestBuild(ROOT));
  const base = `${ROOT}builds/${id}/`;
  const ts = await getJSON<Tileset>(`${base}tileset.json`);
  const [cov, search, periods, series, info] = await Promise.all([
    getJSON<CoverageFile>(base + ts.files.coverage),
    getJSON<SearchFile>(base + ts.files.search),
    getJSON<PeriodsFile>(base + ts.files.periods),
    getJSON<SeriesFile>(base + ts.files.series),
    getJSON<{ data?: { commit: string; dirty: boolean } }>(`${base}build.json`).catch(() => undefined),
  ]);
  const m = cov.matrix;
  if (!m) throw new Error(`Build ${id} has no coverage matrix: it was made before the coverage chart. Build the world again.`);
  new Page(id, ts, cov, m, search, periods, series, info?.data).mount();
}

/** A dated record, as the chart reads it: where it starts and ends on the axis. */
interface Dated {
  entry: SearchEntry;
  start: number;
  end: number;
}

type Pick = { kind: 'cell'; layer: LayerId; col: number } | { kind: 'records'; group: string; col: number } | { kind: 'source'; source: CoverageSource } | { kind: 'bar'; title: string; sub: string; span: Span; id?: string };

class Page {
  readonly n: number;
  readonly range: Span;
  private p0: number;
  private p1: number;
  private colors: Record<Tier, string>;
  private grainColors: string[];
  private noGrain: string;
  private mode: 'tier' | 'grain' = 'tier';
  private chart!: HTMLDivElement;
  private crosshair!: HTMLDivElement;
  private picked!: HTMLDivElement;
  private tip!: HTMLDivElement;
  private detail!: HTMLElement;
  private ruler!: HTMLDivElement;
  private strips: { layer: LayerId; track: HTMLDivElement; canvas: HTMLCanvasElement }[] = [];
  private recordStrips: { group: string; track: HTMLDivElement; canvas: HTMLCanvasElement; counts: number[] }[] = [];
  private dated: Dated[];
  private groups: { key: string; label: string; items: Dated[] }[];
  private pick: Pick | null = null;
  private grains: Record<LayerId, number[]>;

  constructor(
    readonly id: string,
    readonly ts: Tileset,
    readonly cov: CoverageFile,
    readonly m: CoverageMatrix,
    readonly search: SearchFile,
    readonly periods: PeriodsFile,
    readonly series: SeriesFile,
    readonly data: { commit: string; dirty: boolean } | undefined,
  ) {
    this.n = m.columns.length;
    this.range = [m.columns[0][0], m.columns[this.n - 1][1]];
    this.p0 = positionOf(this.range[0]);
    this.p1 = positionOf(this.range[1]);
    const css = getComputedStyle(document.documentElement);
    this.colors = Object.fromEntries(TIERS.map((t) => [t, css.getPropertyValue(`--tier-${t}`).trim()])) as Record<Tier, string>;
    // One hue, evenly stepped in lightness: a finer grid is brighter.
    this.grainColors = ['#184735', '#207053', '#359b75', '#58c69b', '#96edc7'];
    this.noGrain = this.colors.unknown;
    this.dated = search.entities.map((entry) => {
      const t = entry.time;
      const start = t.start.best ?? t.start.lo ?? t.start.hi ?? PRESENT_YEAR;
      // An end nobody knows is not the present: such a record counts only where it starts.
      const end = t.end.best ?? start;
      return { entry, start, end: Math.max(start, end) };
    });
    this.groups = this.recordGroups();
    this.grains = Object.fromEntries(LAYERS.map((l) => [l, this.grainOf(l)])) as Record<LayerId, number[]>;
  }

  /** Where a time falls across the chart, from 0 at its oldest to 1 at its youngest. */
  frac(t: number): number {
    const c = Math.max(this.range[0], Math.min(this.range[1], t));
    return (positionOf(c) - this.p0) / (this.p1 - this.p0);
  }

  /** The column a time falls in. */
  colOf(t: number): number {
    const cols = this.m.columns;
    let lo = 0;
    let hi = cols.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cols[mid][0] <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** The middle of a column along the scale: the time its map is drawn at. */
  middle(col: number): number {
    const [a, b] = this.m.columns[col];
    return timeAt((positionOf(a) + positionOf(b)) / 2);
  }

  spanLabel([a, b]: Span): string {
    const x = formatTime(a);
    const y = formatTime(b);
    return x === y ? x : `${x} – ${y}`;
  }

  /** The records, grouped by the first word of their kind; the smallest groups go under one row. */
  recordGroups(): { key: string; label: string; items: Dated[] }[] {
    const by = new Map<string, Dated[]>();
    for (const d of this.dated) {
      const k = d.entry.kind.split('/')[0];
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(d);
    }
    const sorted = [...by.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
    const KEEP = 14;
    const out = sorted.slice(0, KEEP).map(([key, items]) => ({ key, label: this.ts.kinds[key] ?? key, items }));
    const rest = sorted.slice(KEEP).flatMap(([, items]) => items);
    if (rest.length) out.push({ key: '*', label: `${sorted.length - KEEP} other kinds`, items: rest });
    return out;
  }

  /** For each column, the finest grid that answers the layer then, as a class of GRAIN; -1 where none has a grid. */
  grainOf(layer: LayerId): number[] {
    const srcs = this.m.sources.filter((s) => s.layer === layer && s.res_deg !== undefined);
    return this.m.columns.map(([a, b]) => {
      const covering = srcs.filter((s) => s.span[0] < b && s.span[1] > a);
      if (!covering.length) return -1;
      const km = Math.min(...covering.map((s) => s.res_deg! * KM_PER_DEG));
      let k = 0;
      while (k + 1 < GRAIN.length && km <= GRAIN[k + 1].maxKm) k++;
      return k;
    });
  }

  /** The share of the whole world each tier answers: every layer and every column alike, as the time control weighs eras. */
  overall(): Record<Tier, number> {
    const out = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
    for (const l of this.m.layers) for (const c of l.cells) TIERS.forEach((t, i) => (out[t] += c.share[i] / (this.n * this.m.layers.length)));
    return out;
  }

  layerShares(layer: LayerId): Record<Tier, number> {
    const cells = this.m.layers.find((l) => l.layer === layer)!.cells;
    const out = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
    for (const c of cells) TIERS.forEach((t, i) => (out[t] += c.share[i] / this.n));
    return out;
  }

  mount() {
    app.replaceChildren();
    const page = el('div', 'cov-page');
    page.append(this.header(), this.stats(), this.controls());
    const main = el('div', 'cov-main');
    this.chart = el('div', 'cov-chart');
    this.detail = el('aside', 'cov-detail');
    this.detail.setAttribute('aria-live', 'polite');
    main.append(this.chart, this.detail);
    page.append(main, this.table());
    app.append(page);
    this.tip = el('div', 'tip');
    this.tip.hidden = true;
    document.body.append(this.tip);

    this.chart.append(this.axis());
    this.chart.append(this.layerGroup(), this.overlayGroup(), this.seriesGroup(), this.recordsGroup());
    this.crosshair = el('div', 'crosshair');
    this.crosshair.hidden = true;
    this.picked = el('div', 'picked');
    this.picked.hidden = true;
    this.chart.append(this.crosshair, this.picked);
    this.chart.addEventListener('pointerleave', () => this.hover(null));

    new ResizeObserver(() => this.draw()).observe(this.chart);
    this.draw();
    const first = this.m.layers.find((l) => l.layer === 'life') ? 'life' : LAYERS[0];
    this.select({ kind: 'cell', layer: first, col: this.colOf(fromAge(66e6)) });
  }

  header(): HTMLElement {
    const head = el('header', 'cov-head');
    const h1 = el('h1');
    h1.append('WikiWorldModel ', el('span', undefined, '· coverage'));
    const meta = el('div', 'meta');
    const commit = this.data ? ` · commit ${this.data.commit.slice(0, 7)}${this.data.dirty ? ' (with changes)' : ''}` : '';
    meta.append(`build ${this.id}${commit} · `);
    const globe = el('a', undefined, 'Open the globe');
    globe.href = `./?b=${encodeURIComponent(this.id)}`;
    meta.append(globe);
    head.append(h1, meta);
    const wrap = el('div');
    const lede = el(
      'p',
      'cov-lede',
      `Every layer of the world is asked at ${count((180 / this.m.step) * (360 / this.m.step))} places on a ${this.m.step}° grid, ${this.m.samples} times in each of ${this.n} steps of the time control's scale, and says which tier answered: evidence, a model, a generic stand-in, or nothing known. A strip's height is the share of the globe's area each tier holds. Eras take the room here that they take on the time control. Pick a cell to map it.`,
    );
    wrap.append(head, lede);
    return wrap;
  }

  stats(): HTMLElement {
    const box = el('section', 'cov-stats');
    // What the world rests on, as a whole.
    const all = this.overall();
    const a = el('div', 'stat');
    a.append(el('h3', undefined, 'The whole world, by tier'));
    const big = el('div', 'big', pct(all.evidence + all.model));
    const bigSub = el('div', 'sub', 'of every layer, across the globe, rests on evidence or a model: each layer alike, and each era as much as it has on the time strip');
    const bar = el('div', 'shares');
    for (const t of TIERS) {
      const i = el('i');
      i.style.width = `${all[t] * 100}%`;
      i.style.background = this.colors[t];
      i.title = `${TIER_LABEL[t]}: ${pct(all[t])}`;
      bar.append(i);
    }
    const dl = el('dl');
    for (const t of TIERS) dl.append(el('dt', undefined, pct(all[t])), el('dd', undefined, `${TIER_LABEL[t].toLowerCase()}: ${TIER_SAY[t]}`));
    a.append(big, bigSub, bar, dl);

    const c = this.cov.claims;
    const b = el('div', 'stat');
    b.append(el('h3', undefined, 'Claims'));
    b.append(el('div', 'big', count(c.total)));
    const checked = c.total - (c.ladder.unchecked ?? 0);
    const dl2 = el('dl');
    const rows: [string, string][] = [
      [count(c.total - c.unsourced.length), 'with a source'],
      [count(c.unsourced.length), 'unsourced, saying why'],
      [count(checked), 'checked a step or more against their source'],
      [count(c.ladder.accepted ?? 0), 'accepted by a person'],
      [count(c.disputed.length), 'disputed'],
    ];
    for (const [n, s] of rows) dl2.append(el('dt', undefined, n), el('dd', undefined, s));
    b.append(dl2);

    const r = el('div', 'stat');
    r.append(el('h3', undefined, 'Records'));
    r.append(el('div', 'big', count(this.search.entities.length)));
    const dl3 = el('dl');
    const located = this.search.entities.filter((e) => e.located).length;
    const rows3: [string, string][] = [
      [count(located), 'placed on the globe'],
      [count(this.cov.wanted.length), 'wanted: named, not yet written'],
      [count(this.m.sources.length), 'fields, datasets and phases answering layers'],
      [count(this.series.series.length), 'whole-planet series'],
    ];
    if (this.cov.forms) rows3.push([`${count(this.cov.forms.own_form)} / ${count(this.cov.forms.taxa)}`, 'taxa with a form of their own']);
    for (const [n, s] of rows3) dl3.append(el('dt', undefined, n), el('dd', undefined, s));
    r.append(dl3);

    box.append(a, b, r);
    return box;
  }

  controls(): HTMLElement {
    const box = el('div', 'cov-controls');
    const seg = el('div', 'seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Colour the layers by');
    const legend = el('div', 'legend');
    const setLegend = () => {
      legend.replaceChildren();
      const item = (color: string, text: string, cls = '') => {
        const s = el('span');
        const sw = el('i', `sw ${cls}`);
        if (color) sw.style.background = color;
        s.append(sw, text);
        legend.append(s);
      };
      if (this.mode === 'tier') for (const t of TIERS) item('', TIER_LABEL[t], t);
      else {
        item(this.noGrain, 'no grid: one value, rows or records', 'unknown');
        GRAIN.forEach((g, i) => item(this.grainColors[i], g.label));
      }
    };
    for (const [mode, label] of [['tier', 'What answers'], ['grain', 'Finest grid']] as const) {
      const b = el('button', undefined, label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(this.mode === mode));
      b.addEventListener('click', () => {
        this.mode = mode;
        for (const x of seg.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
        setLegend();
        this.draw();
      });
      seg.append(b);
    }
    const expand = el('button', 'plain', 'Expand all');
    expand.type = 'button';
    expand.addEventListener('click', () => {
      const labels = [...this.chart.querySelectorAll<HTMLButtonElement>('.row.layer .label')];
      const open = labels.some((l) => l.getAttribute('aria-expanded') !== 'true');
      for (const l of labels) if ((l.getAttribute('aria-expanded') === 'true') !== open) l.click();
      expand.textContent = open ? 'Collapse all' : 'Expand all';
    });
    setLegend();
    box.append(seg, expand, legend);
    return box;
  }

  axis(): HTMLElement {
    const axis = el('div', 'axis');
    axis.append(el('div'));
    this.ruler = el('div', 'ruler');
    const eras = el('div', 'eras');
    // The eons, and the eras of the Phanerozoic, in the chart's own colours.
    const bands = this.periods.periods.filter((p) => p.rank === 'eon' && p.name !== 'Phanerozoic').concat(this.periods.periods.filter((p) => p.rank === 'era' && p.start >= fromAge(541.1e6)));
    for (const p of bands) {
      const a = this.frac(p.start);
      const b = this.frac(p.end ?? PRESENT_YEAR);
      if (b <= a) continue;
      const e = el('div', 'era', p.name);
      e.style.left = `${a * 100}%`;
      e.style.width = `${(b - a) * 100}%`;
      e.style.background = p.color ?? '#555';
      e.title = `${p.name}: ${this.spanLabel([p.start, p.end ?? PRESENT_YEAR])}`;
      eras.append(e);
    }
    const now = el('div', 'now');
    now.style.left = `${this.frac(PRESENT_YEAR) * 100}%`;
    now.append(el('span', undefined, 'the future →'));
    this.ruler.append(eras, now);
    axis.append(this.ruler);
    return axis;
  }

  /** A track's column under the pointer. */
  colAt(track: HTMLElement, clientX: number): number {
    const r = track.getBoundingClientRect();
    return Math.max(0, Math.min(this.n - 1, Math.floor(((clientX - r.left) / r.width) * this.n)));
  }

  /** Where a column of a track sits within the chart, in pixels. */
  colBox(track: HTMLElement, col: number): { left: number; width: number; top: number; height: number } {
    const r = track.getBoundingClientRect();
    const c = this.chart.getBoundingClientRect();
    const x0 = r.left + (r.width * col) / this.n;
    const x1 = r.left + (r.width * (col + 1)) / this.n;
    return { left: x0 - c.left, width: x1 - x0, top: r.top - c.top, height: r.height };
  }

  layerGroup(): HTMLElement {
    const g = el('div', 'group');
    g.append(el('h2', undefined, 'Layers'));
    for (const { layer } of this.m.layers) {
      const row = el('div', 'row layer');
      row.dataset.layer = layer;
      const label = el('button', 'label');
      label.type = 'button';
      label.setAttribute('aria-expanded', 'false');
      const sh = this.layerShares(layer);
      label.append(el('span', 'name', LAYER_LABEL[layer]), el('small', undefined, `${pct(sh.evidence)} evidence · ${pct(sh.model)} model · ${pct(sh.generic)} generic`));
      const track = el('div', 'track');
      track.tabIndex = 0;
      track.setAttribute('role', 'img');
      track.setAttribute('aria-label', `${LAYER_LABEL[layer]} across time: ${TIERS.map((t) => `${pct(sh[t])} ${TIER_LABEL[t].toLowerCase()}`).join(', ')}. Arrow keys move along it.`);
      const canvas = el('canvas');
      track.append(canvas);
      row.append(label, track);
      this.strips.push({ layer, track, canvas });
      track.addEventListener('pointermove', (e) => this.hover({ kind: 'cell', layer, col: this.colAt(track, e.clientX) }, track, e));
      track.addEventListener('click', (e) => this.select({ kind: 'cell', layer, col: this.colAt(track, e.clientX) }));
      track.addEventListener('keydown', (e) => {
        const cur = this.pick?.kind === 'cell' && this.pick.layer === layer ? this.pick.col : this.colOf(fromAge(66e6));
        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowRight') this.select({ kind: 'cell', layer, col: Math.min(this.n - 1, cur + step) });
        else if (e.key === 'ArrowLeft') this.select({ kind: 'cell', layer, col: Math.max(0, cur - step) });
        else return;
        e.preventDefault();
      });
      const lanes = this.lanes(layer);
      lanes.hidden = true;
      label.addEventListener('click', () => {
        const open = label.getAttribute('aria-expanded') !== 'true';
        label.setAttribute('aria-expanded', String(open));
        lanes.hidden = !open;
        this.redrawPicked();
      });
      g.append(row, lanes);
    }
    return g;
  }

  /** What answers a layer, a line each, with the planet's phases and the like on one line together. */
  lanes(layer: LayerId): HTMLElement {
    const box = el('div', 'lanes');
    const srcs = this.m.sources.filter((s) => s.layer === layer);
    const lines = new Map<string, CoverageSource[]>();
    for (const s of srcs) {
      const k = s.lane ?? s.id;
      if (!lines.has(k)) lines.set(k, []);
      lines.get(k)!.push(s);
    }
    if (!lines.size) {
      const row = el('div', 'row lane');
      row.append(el('div', 'label', 'Nothing answers this layer yet'), el('div', 'track lane-track'));
      box.append(row);
    }
    for (const list of lines.values()) {
      const first = list[0];
      const title = first.lane ? (LANE_LABEL[first.lane] ?? first.lane) : first.title;
      const sub = first.lane ? `${list.length} ${list.length === 1 ? 'record' : 'records'}` : grainText(first) || TIER_LABEL[first.tier].toLowerCase();
      box.append(
        this.laneRow(
          title,
          sub,
          list.map((s) => ({ span: s.span, tier: s.tier, text: first.lane ? s.title : `${s.title}${grainText(s) ? ` · ${grainText(s)}` : ''}`, pick: { kind: 'source', source: s } as Pick })),
        ),
      );
    }
    return box;
  }

  laneRow(title: string, sub: string, bars: { span: Span; tier: Tier | 'site'; text: string; pick: Pick }[]): HTMLElement {
    const row = el('div', 'row lane');
    const label = el('div', 'label');
    label.append(el('span', 'name', title), el('small', undefined, sub));
    label.title = title;
    const track = el('div', 'track lane-track');
    for (const b of bars) {
      const a = this.frac(b.span[0]);
      const z = this.frac(b.span[1]);
      const bar = el('div', `bar ${b.tier}`);
      bar.style.left = `${a * 100}%`;
      bar.style.width = `max(2px, ${(z - a) * 100}%)`;
      bar.dataset.text = b.text;
      bar.textContent = b.text;
      bar.addEventListener('pointermove', (e) => {
        e.stopPropagation();
        this.showTip(e, b.text, [], `${this.spanLabel(b.span)}${b.tier === 'site' ? '' : ` · ${TIER_LABEL[b.tier]}`}`);
        this.crosshair.hidden = true;
      });
      bar.addEventListener('pointerleave', () => (this.tip.hidden = true));
      bar.addEventListener('click', () => this.select(b.pick));
      track.append(bar);
    }
    row.append(label, track);
    return row;
  }

  overlayGroup(): HTMLElement {
    const g = el('div', 'group');
    g.append(el('h2', undefined, 'Drawn over the globe, in no layer yet'));
    g.append(el('p', undefined, 'Fields of points and lines, and places drawn in detail. Resolve does not ask them yet, so they have no tiers of their own.'));
    for (const l of this.ts.layers ?? []) {
      const span: Span = [Math.min(...l.bins.map((b) => b.from)), Math.max(...l.bins.map((b) => b.to))];
      g.append(this.laneRow(l.title, `${l.kind} · ${count(l.bins.reduce((a, b) => a + b.rows, 0))} rows`, [{ span, tier: 'evidence', text: l.title, pick: { kind: 'bar', title: l.title, sub: l.description ?? '', span, id: l.field } }]));
    }
    for (const s of this.ts.sites ?? []) {
      const what = s.kind === 'city' ? 'a city, drawn building by building' : 'a living scene, drawn plant by plant';
      g.append(this.laneRow(s.label, what, [{ span: s.span, tier: 'site', text: s.label, pick: { kind: 'bar', title: s.label, sub: `Drawn in detail at ${s.origin.lat.toFixed(2)}°, ${s.origin.lon.toFixed(2)}°: ${what}.`, span: s.span, id: s.place } }]));
    }
    return g;
  }

  seriesGroup(): HTMLElement {
    const g = el('div', 'group');
    g.append(el('h2', undefined, 'Whole-planet series'));
    g.append(el('p', undefined, 'One value for the whole planet at each time: they say nothing of a place.'));
    for (const s of [...this.series.series].sort((a, b) => a.points[0][0] - b.points[0][0])) {
      const span: Span = [s.points[0][0], s.points.at(-1)![0]];
      const tier: Tier = s.basis === 'evidence' ? 'evidence' : 'model';
      g.append(this.laneRow(s.title, `${count(s.points.length)} points · ${s.basis}`, [{ span, tier, text: s.title, pick: { kind: 'bar', title: s.title, sub: s.quantity ?? '', span, id: s.id } }]));
    }
    return g;
  }

  recordsGroup(): HTMLElement {
    const g = el('div', 'group');
    g.append(el('h2', undefined, 'Records, by kind'));
    g.append(el('p', undefined, 'How many records hold in each step of time, from their start to their end; one whose end is unknown counts only where it starts. Brighter is more, on a log scale.'));
    for (const grp of this.groups) {
      const counts = new Array<number>(this.n).fill(0);
      for (const d of grp.items) {
        const a = this.colOf(d.start);
        const b = this.colOf(d.end);
        for (let i = a; i <= b; i++) counts[i]++;
      }
      const row = el('div', 'row records');
      const label = el('div', 'label');
      label.append(el('span', 'name', `${grp.label} · ${count(grp.items.length)}`));
      const track = el('div', 'track');
      const canvas = el('canvas');
      track.append(canvas);
      row.append(label, track);
      this.recordStrips.push({ group: grp.key, track, canvas, counts });
      track.addEventListener('pointermove', (e) => this.hover({ kind: 'records', group: grp.key, col: this.colAt(track, e.clientX) }, track, e));
      track.addEventListener('click', (e) => this.select({ kind: 'records', group: grp.key, col: this.colAt(track, e.clientX) }));
      g.append(row);
    }
    return g;
  }

  /** Draws every strip at the size it now has, and the ruler's ticks. */
  draw() {
    const dpr = window.devicePixelRatio || 1;
    const size = (c: HTMLCanvasElement, t: HTMLElement) => {
      const w = Math.max(1, Math.round(t.clientWidth * dpr));
      const h = Math.max(1, Math.round(t.clientHeight * dpr));
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      return { w, h, g: c.getContext('2d')! };
    };
    for (const s of this.strips) {
      const { w, h, g } = size(s.canvas, s.track);
      const cells = this.m.layers.find((l) => l.layer === s.layer)!.cells;
      g.clearRect(0, 0, w, h);
      const grains = this.grains[s.layer];
      for (let i = 0; i < this.n; i++) {
        const x0 = Math.round((i * w) / this.n);
        const x1 = Math.round(((i + 1) * w) / this.n);
        if (this.mode === 'grain') {
          g.fillStyle = grains[i] < 0 ? this.noGrain : this.grainColors[grains[i]];
          g.fillRect(x0, 0, x1 - x0, h);
          continue;
        }
        // Evidence on the baseline, then models, then generic stand-ins; the unknown fills what is left above.
        let y = h;
        TIERS.forEach((t, k) => {
          const dh = cells[i].share[k] * h;
          g.fillStyle = this.colors[t];
          const top = k === TIERS.length - 1 ? 0 : Math.round(y - dh);
          g.fillRect(x0, top, x1 - x0, Math.round(y) - top);
          y -= dh;
        });
      }
    }
    const max = Math.max(1, ...this.recordStrips.flatMap((s) => s.counts));
    for (const s of this.recordStrips) {
      const { w, h, g } = size(s.canvas, s.track);
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#121826';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < this.n; i++) {
        if (!s.counts[i]) continue;
        const x0 = Math.round((i * w) / this.n);
        const x1 = Math.round(((i + 1) * w) / this.n);
        const v = Math.log1p(s.counts[i]) / Math.log1p(max);
        g.fillStyle = sequential(v);
        g.fillRect(x0, 1, x1 - x0, h - 2);
      }
    }
    // The ruler: the time control's own ticks, spaced along this chart's width.
    for (const t of this.ruler.querySelectorAll('.tick')) t.remove();
    const width = this.ruler.clientWidth;
    if (width > 0) {
      const x = (t: number) => this.frac(t) * width;
      const at = (px: number) => timeAt(this.p0 + (px / width) * (this.p1 - this.p0));
      for (const tk of rulerTicks(this.range, x, at, 76)) {
        const e = el('div', 'tick', tk.label);
        e.style.left = `${x(tk.t)}px`;
        this.ruler.append(e);
        // A label at an edge stays inside the ruler, rather than be cut in half.
        const half = e.offsetWidth / 2;
        if (x(tk.t) < half) e.classList.add('first');
        else if (x(tk.t) > width - half) e.classList.add('last');
      }
    }
    this.redrawPicked();
  }

  hover(p: Pick | null, track?: HTMLElement, e?: PointerEvent) {
    if (!p || !track || !e || (p.kind !== 'cell' && p.kind !== 'records')) {
      this.crosshair.hidden = true;
      this.tip.hidden = true;
      return;
    }
    const box = this.colBox(track, p.col);
    this.crosshair.hidden = false;
    this.crosshair.style.left = `${box.left + box.width / 2}px`;
    const col = this.m.columns[p.col];
    if (p.kind === 'cell') {
      const cell = this.m.layers.find((l) => l.layer === p.layer)!.cells[p.col];
      const vals = TIERS.map((t, k) => ({ color: this.colors[t], value: pct(cell.share[k]), label: TIER_LABEL[t] })).filter((_, k) => cell.share[k] > 0);
      const g = this.grains[p.layer][p.col];
      const note = this.mode === 'grain' ? (g < 0 ? 'No gridded field answers it then.' : `Finest grid: ${GRAIN[g].label}.`) : this.m.whys[cell.why[0][0]];
      this.showTip(e, `${LAYER_LABEL[p.layer]} · ${this.spanLabel(col)}`, vals, note);
    } else {
      const grp = this.groups.find((x) => x.key === p.group)!;
      const items = this.inColumn(grp.items, p.col);
      const names = items.slice(0, 5).map((d) => d.entry.label).join('; ');
      this.showTip(e, `${grp.label} · ${this.spanLabel(col)}`, [{ color: sequential(1), value: count(items.length), label: items.length === 1 ? 'record' : 'records' }], names ? `${names}${items.length > 5 ? '…' : ''}` : 'None.');
    }
  }

  showTip(e: PointerEvent, title: string, vals: { color: string; value: string; label: string }[], note: string) {
    const tip = this.tip;
    tip.replaceChildren();
    tip.append(el('h4', undefined, title));
    if (vals.length) {
      const grid = el('div', 'vals');
      for (const v of vals) {
        const key = el('i', 'key');
        key.style.background = v.color;
        grid.append(key, el('b', undefined, v.value), el('span', undefined, v.label));
      }
      tip.append(grid);
    }
    if (note) tip.append(el('p', undefined, note));
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    const x = e.clientX + 14 + r.width > innerWidth ? e.clientX - 14 - r.width : e.clientX + 14;
    const y = Math.min(innerHeight - r.height - 8, e.clientY + 14);
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  }

  inColumn(items: Dated[], col: number): Dated[] {
    const [a, b] = this.m.columns[col];
    return items.filter((d) => d.start <= b && d.end >= a);
  }

  /** The outline of what was picked, where its track now is. */
  redrawPicked() {
    const p = this.pick;
    const track = p?.kind === 'cell' ? this.strips.find((s) => s.layer === p.layer)?.track : p?.kind === 'records' ? this.recordStrips.find((s) => s.group === p.group)?.track : undefined;
    if (!p || !track || (p.kind !== 'cell' && p.kind !== 'records')) {
      if (this.picked) this.picked.hidden = true;
      return;
    }
    const box = this.colBox(track, p.col);
    Object.assign(this.picked.style, { left: `${box.left}px`, width: `${Math.max(3, box.width)}px`, top: `${box.top}px`, height: `${box.height}px` });
    this.picked.hidden = false;
  }

  select(p: Pick) {
    this.pick = p;
    this.redrawPicked();
    const d = this.detail;
    d.replaceChildren();
    if (p.kind === 'cell') this.cellDetail(p.layer, p.col);
    else if (p.kind === 'records') this.recordsDetail(p.group, p.col);
    else if (p.kind === 'source') this.barDetail(p.source.title, `${TIER_LABEL[p.source.tier]}${grainText(p.source) ? ` · ${grainText(p.source)}` : ''}`, p.source.span, p.source.id);
    else this.barDetail(p.title, p.sub, p.span, p.id);
  }

  globeLink(t: number, at?: { lat: number; lon: number }, sel?: string): string {
    const q = new URLSearchParams({ b: this.id, t: timeToParam(t) });
    if (at) {
      q.set('lat', at.lat.toFixed(1));
      q.set('lon', at.lon.toFixed(1));
    }
    if (sel) q.set('sel', sel);
    return `./?${q.toString()}`;
  }

  cellDetail(layer: LayerId, col: number) {
    const d = this.detail;
    const cell = this.m.layers.find((l) => l.layer === layer)!.cells[col];
    const t = this.middle(col);
    d.append(el('h3', undefined, LAYER_LABEL[layer]), el('div', 'when', `${this.spanLabel(this.m.columns[col])} · mapped at ${formatTime(t)}`));

    // The map: the tier at each place of the grid, at the column's middle time.
    const rows = Math.round(180 / this.m.step);
    const cols = Math.round(360 / this.m.step);
    const canvas = el('canvas', 'map');
    canvas.width = cols;
    canvas.height = rows;
    const g = canvas.getContext('2d')!;
    const tiers = decodeRuns(cell.map);
    const img = g.createImageData(cols, rows);
    const rgb = Object.fromEntries(TIERS.map((x) => [x, hexRgb(this.colors[x])])) as Record<Tier, [number, number, number]>;
    tiers.forEach((x, i) => {
      const [r, gg, b] = rgb[x];
      img.data.set([r, gg, b, 255], i * 4);
    });
    g.putImageData(img, 0, 0);
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `A map of the tier ${LAYER_LABEL[layer].toLowerCase()} answers in at each place, at ${formatTime(t)}. Click a place to open the globe there.`);
    const hint = el('div', 'maphint', 'Click a place to open the globe there and then.');
    const placeAt = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      const lon = -180 + ((e.clientX - r.left) / r.width) * 360;
      const lat = 90 - ((e.clientY - r.top) / r.height) * 180;
      const i = Math.min(rows - 1, Math.floor(((90 - lat) / 180) * rows)) * cols + Math.min(cols - 1, Math.floor(((lon + 180) / 360) * cols));
      return { lat, lon, tier: tiers[i] };
    };
    canvas.addEventListener('pointermove', (e) => {
      const p = placeAt(e);
      hint.textContent = `${Math.abs(p.lat).toFixed(0)}° ${p.lat >= 0 ? 'N' : 'S'}, ${Math.abs(p.lon).toFixed(0)}° ${p.lon >= 0 ? 'E' : 'W'}: ${TIER_LABEL[p.tier].toLowerCase()}`;
    });
    canvas.addEventListener('pointerleave', () => (hint.textContent = 'Click a place to open the globe there and then.'));
    canvas.addEventListener('click', (e) => {
      const p = placeAt(e);
      location.href = this.globeLink(t, p);
    });
    d.append(canvas, hint);

    d.append(el('h4', undefined, 'Share of the globe'));
    const ul = el('ul');
    TIERS.forEach((x, k) => {
      const li = el('li');
      li.append(el('i', `sw ${x}`), el('span', 'n', pct(cell.share[k])), el('span', undefined, TIER_LABEL[x]));
      ul.append(li);
    });
    d.append(ul);

    d.append(el('h4', undefined, 'Why'));
    const whys = el('ul');
    for (const [k, share] of cell.why) {
      const li = el('li');
      li.append(el('span', 'n', pct(share)), el('span', 's', this.m.whys[k]));
      whys.append(li);
    }
    d.append(whys);

    const [a, b] = this.m.columns[col];
    const srcs = this.m.sources.filter((s) => s.layer === layer && s.span[0] < b && s.span[1] > a);
    d.append(el('h4', undefined, 'What answers it then'));
    if (!srcs.length) d.append(el('div', 'empty', 'Nothing: no field, dataset or record answers this layer then.'));
    else {
      const list = el('ul');
      for (const s of srcs) {
        const li = el('li');
        li.append(el('i', `sw ${s.tier}`), el('span', undefined, `${s.title}${grainText(s) ? ` · ${grainText(s)}` : ''}`));
        list.append(li);
      }
      d.append(list);
    }

    const recs = this.inColumn(this.dated, col);
    d.append(el('h4', undefined, `Records then · ${count(recs.length)}`));
    this.recordList(recs);
    const open = el('a', 'open', `Open the globe at ${formatTime(t)} →`);
    open.href = this.globeLink(t);
    d.append(open);
  }

  recordsDetail(group: string, col: number) {
    const d = this.detail;
    const grp = this.groups.find((x) => x.key === group)!;
    const items = this.inColumn(grp.items, col);
    d.append(el('h3', undefined, grp.label), el('div', 'when', this.spanLabel(this.m.columns[col])));
    d.append(el('h4', undefined, `${count(items.length)} ${items.length === 1 ? 'record' : 'records'}`));
    this.recordList(items);
  }

  recordList(items: Dated[]) {
    const d = this.detail;
    if (!items.length) {
      d.append(el('div', 'empty', 'None.'));
      return;
    }
    // The shortest-lived first: they are what this step of time holds most of its own.
    const sorted = [...items].sort((x, y) => x.end - x.start - (y.end - y.start) || (x.entry.label < y.entry.label ? -1 : 1));
    const ul = el('ul');
    const SHOW = 40;
    for (const it of sorted.slice(0, SHOW)) {
      const li = el('li');
      const a = el('a', undefined, it.entry.label);
      a.href = this.globeLink(it.start, undefined, it.entry.id);
      a.title = it.entry.id;
      li.append(a, el('span', 's', `${this.ts.kinds[it.entry.kind] ?? it.entry.kind} · ${this.spanLabel([it.start, it.end])}`));
      ul.append(li);
    }
    d.append(ul);
    if (sorted.length > SHOW) d.append(el('div', 'more', `and ${count(sorted.length - SHOW)} more`));
  }

  barDetail(title: string, sub: string, span: Span, id?: string) {
    const d = this.detail;
    d.append(el('h3', undefined, title), el('div', 'when', `${this.spanLabel(span)} · ${formatDuration(span[1] - span[0])}`));
    if (sub) d.append(el('p', undefined, sub));
    if (id) d.append(el('div', 'more', id));
    const open = el('a', 'open', 'Open the globe at its start →');
    open.href = this.globeLink(Math.max(span[0], this.range[0]), undefined, id && !id.includes(':') ? id : undefined);
    d.append(open);
  }

  /** The numbers behind the strips, for reading without colour: each layer's share in each tier, and in each era. */
  table(): HTMLElement {
    const det = el('details', 'cov-table');
    det.append(el('summary', undefined, 'The numbers, as a table'));
    const eras: { label: string; span: Span }[] = [
      { label: 'before 2.5 Ga', span: [-Infinity, fromAge(2500e6)] },
      { label: '2.5 Ga – 541 Ma', span: [fromAge(2500e6), fromAge(541e6)] },
      { label: '541–66 Ma', span: [fromAge(541e6), fromAge(66e6)] },
      { label: '66 Ma – 12 ka', span: [fromAge(66e6), fromAge(11.7e3)] },
      { label: '12 ka – today', span: [fromAge(11.7e3), PRESENT_YEAR + 76] },
      { label: 'the future', span: [PRESENT_YEAR + 76, Infinity] },
    ];
    const table = el('table');
    const head = el('tr');
    head.append(el('th', undefined, 'Layer'), ...TIERS.map((t) => el('th', undefined, TIER_LABEL[t])), ...eras.map((e) => el('th', undefined, `${e.label}: evidence + model`)));
    table.append(head);
    for (const { layer, cells } of this.m.layers) {
      const tr = el('tr');
      const sh = this.layerShares(layer);
      tr.append(el('td', undefined, LAYER_LABEL[layer]), ...TIERS.map((t) => el('td', undefined, pct(sh[t]))));
      for (const e of eras) {
        const idx = this.m.columns.map((c, i) => [c, i] as const).filter(([c]) => c[0] >= e.span[0] && c[1] <= e.span[1]).map(([, i]) => i);
        const v = idx.length ? idx.reduce((s, i) => s + cells[i].share[0] + cells[i].share[1], 0) / idx.length : NaN;
        tr.append(el('td', undefined, Number.isNaN(v) ? '–' : pct(v)));
      }
      table.append(tr);
    }
    const scroll = el('div', 'scroll');
    scroll.append(table);
    det.append(scroll);
    return det;
  }
}

/** A time from its age before the present, in years. */
const fromAge = (years: number) => PRESENT_YEAR - years;

/** A source's grid and keyframes, in words. */
function grainText(s: CoverageSource): string {
  const parts: string[] = [];
  if (s.res_deg !== undefined) parts.push(`${s.res_deg}° grid`);
  if (s.step_yr !== undefined) parts.push(`every ${formatDuration(s.step_yr)}`);
  return parts.join(', ');
}

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** One hue from dim to bright, for counts on the dark chart: more is brighter. */
function sequential(v: number): string {
  const a = [28, 52, 78];
  const b = [140, 205, 245];
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * Math.max(0, Math.min(1, v))));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

main().catch((e: unknown) => {
  app.replaceChildren();
  const box = el('div', 'cov-fatal');
  box.append(el('h1', undefined, 'The coverage could not be shown'), el('p', undefined, e instanceof Error ? e.message : String(e)));
  app.append(box);
  console.error(e);
});
