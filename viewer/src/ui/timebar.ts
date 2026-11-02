// The time control: a strip that zooms like a map, along a scale that gives the recent past far
// more room than the deep past (see timescale.ts). A window is a stretch of that scale, so
// zooming and panning are even along it, and a narrow window is close to linear. Bands show the
// named periods, and a track below them shows the world's dated records.
import type { PeriodRecord, SearchEntry } from '../../../core/records.ts';
import { lookup, type Scenario } from '../../../core/scenario.ts';
import { formatTime, historical, PRESENT_YEAR } from '../../../core/time.ts';
import { positionOf, timeAt } from './timescale.ts';

type Win = [number, number];

export function xOf(t: number, win: Win, width: number): number {
  const p0 = positionOf(win[0]);
  return (width * (positionOf(t) - p0)) / (positionOf(win[1]) - p0);
}

export function tOf(x: number, win: Win, width: number): number {
  const p0 = positionOf(win[0]);
  return timeAt(p0 + (x / width) * (positionOf(win[1]) - p0));
}

/** The narrowest window the time control zooms to, in years: a few years, so days can be told apart. */
export const MIN_SPAN = 4;

/** The window of `span` along the scale that starts at `p0`, moved along it if it runs over `limits`. */
function windowAlong(p0: number, span: number, limits: Win): Win {
  const lo = positionOf(limits[0]);
  const hi = positionOf(limits[1]);
  if (span >= hi - lo) return [limits[0], limits[1]];
  if (p0 <= lo) return [limits[0], timeAt(lo + span)];
  if (p0 + span >= hi) return [timeAt(hi - span), limits[1]];
  return [timeAt(p0), timeAt(p0 + span)];
}

/** Zoom by `factor` (>1 zooms in) keeping time `tp` at screen fraction `s`; keep within `limits`. */
export function zoomAround(win: Win, tp: number, s: number, factor: number, limits: Win, minSpan = MIN_SPAN): Win {
  const span = (positionOf(win[1]) - positionOf(win[0])) / factor;
  const next = windowAlong(positionOf(tp) - s * span, span, limits);
  // At a few years the scale is as good as linear.
  return next[1] - next[0] < minSpan ? clampWindow([tp - s * minSpan, tp + (1 - s) * minSpan], limits) : next;
}

/** Move a window by `dx` pixels of a strip `width` wide, as a drag does. */
export function panWindow(win: Win, dx: number, width: number, limits: Win, minSpan = MIN_SPAN): Win {
  const p0 = positionOf(win[0]);
  const span = positionOf(win[1]) - p0;
  const [o, n] = windowAlong(p0 - (dx / width) * span, span, limits);
  // Moved toward the present, the same stretch of the scale holds fewer years.
  return n - o < minSpan ? clampWindow([(o + n - minSpan) / 2, (o + n + minSpan) / 2], limits) : [o, n];
}

/** Keep a window within `limits`, moving it along the scale if it runs over. */
export function clampWindow(win: Win, limits: Win): Win {
  const p0 = positionOf(win[0]);
  const span = positionOf(win[1]) - p0;
  if (p0 >= positionOf(limits[0]) && p0 + span <= positionOf(limits[1])) return win;
  return windowAlong(p0, span, limits);
}

/** A window that shows a stretch of time with a margin either side, a share of its length along the scale. */
export function fitWindow(a: number, b: number, limits: Win, margin = 0.06): Win {
  const p0 = positionOf(a);
  const span = positionOf(b) - p0;
  return windowAlong(p0 - span * margin, span * (1 + 2 * margin), limits);
}

const ROWS: { rank: string; h: number }[] = [
  { rank: 'eon', h: 13 },
  { rank: 'era', h: 15 },
  { rank: 'period', h: 18 },
  { rank: 'epoch', h: 15 },
  { rank: 'stage', h: 13 },
];
const RULER = 22;
const TRACK = 16;
const PAD = 4;

/** Steps worth a tick, finest first: 1, 2 and 5 times a power of ten, from a year to 5 Gyr. */
const STEPS: number[] = [];
for (let e = 0; e <= 9; e++) for (const m of [1, 2, 5]) STEPS.push(m * 10 ** e);

/** How far from the present the calendar's years are used. Beyond it, round ages. */
const CALENDAR = 1e4;

/**
 * The first round time after t for a step. Within reach of the calendar these are years that
 * are multiples of the step, BCE and CE counted apart (there is no year 0), with 1 CE between
 * them; beyond it, multiples of the step away from the present.
 */
function roundAfter(t: number, step: number): number {
  const age = PRESENT_YEAR - t;
  if (age > CALENDAR) {
    const a = (Math.ceil(age / step) - 1) * step;
    if (a >= CALENDAR) return PRESENT_YEAR - a;
    t = PRESENT_YEAR - CALENDAR;
  }
  if (t < 1) {
    const k = Math.ceil((1 - t) / step) - 1;
    return k > 0 ? 1 - k * step : 1;
  }
  const year = (Math.floor(t / step) + 1) * step;
  if (year - PRESENT_YEAR < CALENDAR) return year;
  return PRESENT_YEAR + Math.max(1, Math.floor((t - PRESENT_YEAR) / step) + 1) * step;
}

/**
 * A tick's label. The strip runs through several scales, so each names its own: the calendar's
 * years, then ages in ka, Ma and Ga, and times from now.
 */
function tickLabel(t: number, step: number): string {
  if (historical(t)) return formatTime(t);
  const d = Math.abs(PRESENT_YEAR - t);
  const div = d >= 1e9 ? 1e9 : d >= 1e6 ? 1e6 : 1e3;
  const v = +(d / div).toFixed(Math.max(0, Math.ceil(Math.log10(div / step))));
  return t > PRESENT_YEAR ? `+${v} ${div === 1e9 ? 'Gyr' : div === 1e6 ? 'Myr' : 'kyr'}` : `${v} ${div === 1e9 ? 'Ga' : div === 1e6 ? 'Ma' : 'ka'}`;
}

/**
 * The ruler's ticks. Walking along the strip, each is the first round time at least `gap` pixels
 * past the last, in the finest step whose ticks fall that far apart there, so they stay evenly
 * spaced and the step changes along the strip as the scale does. Where the scale runs so fast
 * that no step will do, as across billions of years, it is the roundest time within reach.
 */
export function rulerTicks(win: Win, x: (t: number) => number, at: (x: number) => number, gap: number): { t: number; label: string }[] {
  const ticks: { t: number; label: string }[] = [];
  let last = -gap;
  for (;;) {
    const from = at(last + gap);
    const past = (s: number) => x(roundAfter(from, s)) - x(from);
    const even = (s: number) => {
      const a = roundAfter(from, s);
      return past(s) <= 3 * gap && x(roundAfter(a, s)) - x(a) >= gap;
    };
    const step = STEPS.find(even) ?? STEPS.filter((s) => past(s) <= gap).pop() ?? STEPS[0];
    const t = roundAfter(from, step);
    if (t > win[1]) return ticks;
    ticks.push({ t, label: tickLabel(t, step) });
    last = x(t);
  }
}

const TRACK_COLORS: Record<string, string> = {
  event: '#ff7a59',
  polity: '#e05d8a',
  settlement: '#f2e6c9',
  occurrence: '#9be38a',
  sample: '#c8a2ff',
  taxon: '#5fd4c4',
  development: '#ffd36b',
  'large-igneous-province': '#ff9f43',
  landform: '#c8a2ff',
  body: '#8fb8ff',
};

/** A dated record on the track: where it starts, and where it ends if it ended. */
interface TrackItem {
  entry: SearchEntry;
  start: number;
  end: number | null;
}

/**
 * A state of the planet along the time control, drawn as a thin band under the track: a
 * phase of the planet's record, or an episode such as a glaciation drawn over the phases.
 */
export interface StateBand {
  /** the record it opens */
  id: string;
  label: string;
  start: number;
  end: number;
  color: string;
  /** an episode, drawn over the phases */
  over: boolean;
}

export interface TimebarCallbacks {
  onTime(t: number): void;
  onWindow(w: Win): void;
  onPlay(): void;
  /** a record on the track was chosen */
  onRecord(id: string): void;
  /** a state of the planet was chosen, on the band under the track */
  onState(b: StateBand): void;
}

export class Timebar {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private readout: HTMLElement;
  private playBtn: HTMLButtonElement;
  private tip: HTMLElement;
  private t = 0;
  private win: Win;
  private drag: { mode: 'scrub' | 'pan'; x: number; win: Win } | null = null;
  private keyframes: number[] = [];
  private track: TrackItem[] = [];
  private states: StateBand[] = [];
  private hovered: TrackItem | StateBand | null = null;

  /** the periods as the current scenario dates them */
  private periods: PeriodRecord[];

  constructor(
    private all: PeriodRecord[],
    private limits: Win,
    /** the time span the build has data for */
    private dataRange: Win,
    private cb: TimebarCallbacks,
  ) {
    this.win = limits;
    this.periods = all;
    this.el = document.createElement('div');
    this.el.className = 'timebar';
    this.el.innerHTML = `
      <div class="timebar-controls">
        <button class="tb-play" aria-label="Play">▶</button>
        <div class="tb-readout" aria-live="polite"></div>
        <div class="tb-spacer"></div>
        <button class="tb-zoom-in" aria-label="Zoom in on time" title="Zoom in (or scroll on the strip)">+</button>
        <button class="tb-zoom-out" aria-label="Zoom out on time" title="Zoom out">−</button>
        <button class="tb-reset" aria-label="Show the whole time range" title="Whole range">⤢</button>
      </div>
      <div class="tb-strip">
        <canvas class="tb-canvas" aria-label="Time control: drag to move through time, scroll to zoom, drag the ruler to pan; the bottom track lists dated records"></canvas>
        <div class="tb-tip" hidden></div>
      </div>`;
    this.canvas = this.el.querySelector('canvas')!;
    this.readout = this.el.querySelector('.tb-readout')!;
    this.playBtn = this.el.querySelector('.tb-play')!;
    this.tip = this.el.querySelector('.tb-tip')!;
    this.playBtn.onclick = () => this.cb.onPlay();
    this.el.querySelector<HTMLButtonElement>('.tb-zoom-in')!.onclick = () => this.zoom(2, this.t);
    this.el.querySelector<HTMLButtonElement>('.tb-zoom-out')!.onclick = () => this.zoom(0.5, this.t);
    this.el.querySelector<HTMLButtonElement>('.tb-reset')!.onclick = () => this.cb.onWindow(this.limits);
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointercancel', (e) => this.up(e));
    this.canvas.addEventListener('pointerleave', () => this.hover(null));
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const x = e.offsetX;
      this.zoom(Math.exp(-e.deltaY * 0.0015), tOf(x, this.win, this.width()), x / this.width());
    }, { passive: false });
    this.canvas.addEventListener('dblclick', (e) => this.dbl(e));
  }

  setKeyframes(years: number[]): void {
    this.keyframes = years;
  }

  /** The records on the track, each at its start in the default picture. */
  setRecords(entries: SearchEntry[]): void {
    this.track = entries
      .filter((e) => e.time.start.best !== null && Number.isFinite(e.time.start.best))
      .map((e) => ({ entry: e, start: e.time.start.best!, end: e.time.instant ? null : e.time.end.best }))
      .sort((a, b) => a.start - b.start);
  }

  /** The planet's states, under the track. */
  setStates(bands: StateBand[]): void {
    this.states = bands;
    this.draw();
  }

  /** Date the periods as a scenario's alternatives do (period boundaries are claims too). */
  setScenario(s: Scenario): void {
    this.periods = this.all.map((p) => ({ ...p, ...lookup(p.variants, { alts: s.alts }, { start: p.start, end: p.end }) }));
  }

  /** How many years `px` pixels of the strip span at time t. */
  yearsPerPixels(t: number, px: number): number {
    const w = this.width();
    return Math.abs(tOf(Math.min(w, xOf(t, this.win, w) + px), this.win, w) - t) || Math.abs(t - tOf(Math.max(0, xOf(t, this.win, w) - px), this.win, w));
  }

  /** The time a fraction of the strip's width after t (before it, if negative), within the data. */
  stepFrom(t: number, fraction: number): number {
    const w = this.width();
    const next = tOf(xOf(t, this.win, w) + fraction * w, this.win, w);
    return Math.max(this.dataRange[0], Math.min(this.dataRange[1], next));
  }

  private width(): number {
    return this.canvas.clientWidth || 1;
  }

  private height(): number {
    return RULER + ROWS.reduce((s, r) => s + r.h, 0) + TRACK + PAD;
  }

  private zoom(factor: number, tp: number, s?: number): void {
    const frac = s ?? Math.min(1, Math.max(0, xOf(tp, this.win, this.width()) / this.width()));
    this.cb.onWindow(zoomAround(this.win, tp, frac, factor, this.limits));
  }

  /** The track item under a point of the strip, if any: above the band of the planet's states. */
  private itemAt(x: number, y: number): TrackItem | null {
    const top = this.height() - PAD - TRACK;
    if (y < top - 2 || y >= top + TRACK - 5) return null;
    let best: TrackItem | null = null;
    let bestD = 7;
    for (const it of this.track) {
      const d = Math.abs(xOf(it.start, this.win, this.width()) - x);
      if (d < bestD) (best = it), (bestD = d);
    }
    return best;
  }

  /** The planet's state under a point of its band, if any: an episode before the phase it is in. */
  private stateAt(x: number, y: number): StateBand | null {
    const top = this.height() - PAD - TRACK;
    if (y < top + TRACK - 5 || y > top + TRACK + PAD) return null;
    const t = tOf(x, this.win, this.width());
    const here = this.states.filter((b) => b.start <= t && t < b.end);
    return here.find((b) => b.over) ?? here[0] ?? null;
  }

  private hover(it: TrackItem | StateBand | null, px = 0): void {
    if (it === this.hovered) return;
    this.hovered = it;
    this.canvas.style.cursor = it ? 'pointer' : '';
    if (!it) {
      this.tip.hidden = true;
    } else {
      let x = px;
      if ('entry' in it) {
        const when = it.end !== null && it.end !== it.start ? `${formatTime(it.start)} – ${formatTime(it.end)}` : formatTime(it.start);
        this.tip.textContent = `${it.entry.label} · ${when}`;
        x = xOf(it.start, this.win, this.width());
      } else {
        const when = Number.isFinite(it.end) ? `${formatTime(it.start)} – ${formatTime(it.end)}` : `from ${formatTime(it.start)}`;
        this.tip.textContent = `${it.label} · ${when}`;
      }
      this.tip.hidden = false;
      this.tip.style.left = `${Math.max(4, Math.min(this.width() - 220, x - 40))}px`;
    }
    this.draw();
  }

  private down(e: PointerEvent): void {
    const it = this.itemAt(e.offsetX, e.offsetY);
    if (it) {
      this.cb.onRecord(it.entry.id);
      return;
    }
    const st = this.stateAt(e.offsetX, e.offsetY);
    if (st) {
      this.cb.onState(st);
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    const mode = e.offsetY < RULER || e.shiftKey ? 'pan' : 'scrub';
    this.drag = { mode, x: e.offsetX, win: this.win };
    if (mode === 'scrub') this.scrubTo(e.offsetX);
  }

  private move(e: PointerEvent): void {
    if (!this.drag) {
      this.hover(this.itemAt(e.offsetX, e.offsetY) ?? this.stateAt(e.offsetX, e.offsetY), e.offsetX);
      return;
    }
    if (this.drag.mode === 'scrub') this.scrubTo(e.offsetX);
    else {
      this.cb.onWindow(panWindow(this.drag.win, e.offsetX - this.drag.x, this.width(), this.limits));
    }
  }

  private up(e: PointerEvent): void {
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.drag = null;
  }

  private scrubTo(x: number): void {
    const t = tOf(Math.max(0, Math.min(this.width(), x)), this.win, this.width());
    this.cb.onTime(Math.max(this.dataRange[0], Math.min(this.dataRange[1], t)));
  }

  private bandAt(x: number, y: number): PeriodRecord | undefined {
    let top = RULER;
    for (const row of ROWS) {
      if (y >= top && y < top + row.h) {
        const t = tOf(x, this.win, this.width());
        return this.periods.find((p) => p.rank === row.rank && p.start <= t && t <= p.end);
      }
      top += row.h;
    }
    return undefined;
  }

  private dbl(e: MouseEvent): void {
    const p = this.bandAt(e.offsetX, e.offsetY);
    if (!p) return;
    this.cb.onWindow(fitWindow(p.start, p.end, this.limits));
    if (this.t < p.start || this.t > p.end) this.cb.onTime(Math.max(this.dataRange[0], Math.min(this.dataRange[1], (p.start + p.end) / 2)));
  }

  /** The named period of a rank at time t. */
  periodAt(t: number, rank: string): PeriodRecord | undefined {
    return this.periods.find((p) => p.rank === rank && p.start <= t && t <= p.end);
  }

  set(t: number, win: Win, playing: boolean): void {
    this.t = t;
    this.win = win;
    this.playBtn.textContent = playing ? '❚❚' : '▶';
    this.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    const res = this.yearsPerPixels(t, 1);
    const stage = this.periodAt(t, 'stage');
    const named = stage ?? this.periodAt(t, 'period') ?? this.periodAt(t, 'era') ?? this.periodAt(t, 'eon');
    const period = this.periodAt(t, 'period');
    const where = [named?.name, period && period.name !== named?.name ? period.name : undefined].filter(Boolean).join(', ');
    const label = t === PRESENT_YEAR ? 'Today' : formatTime(t, res);
    this.readout.innerHTML = `<strong>${label}</strong>${where ? ` <span>${where}</span>` : ''}`;
    this.draw();
  }

  draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.width();
    const h = this.height();
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.height = `${h}px`;
    }
    const g = this.canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(12, 16, 26, 0.92)';
    g.fillRect(0, 0, w, h);
    const x = (t: number) => xOf(t, this.win, w);

    // Bands.
    let top = RULER;
    g.font = '11px system-ui, -apple-system, Segoe UI, sans-serif';
    g.textBaseline = 'middle';
    for (const row of ROWS) {
      for (const p of this.periods) {
        if (p.rank !== row.rank || p.end < this.win[0] || p.start > this.win[1]) continue;
        const x0 = Math.max(0, x(p.start));
        const x1 = Math.min(w, x(Math.min(p.end, PRESENT_YEAR)));
        if (x1 - x0 < 0.5) continue;
        g.fillStyle = p.color ?? '#888';
        g.fillRect(x0, top, x1 - x0, row.h - 1);
        const label = p.name;
        const tw = g.measureText(label).width;
        if (x1 - x0 > tw + 8) {
          const [r, gg, b] = [1, 3, 5].map((i) => parseInt((p.color ?? '#888888').slice(i, i + 2), 16));
          g.fillStyle = 0.299 * r + 0.587 * gg + 0.114 * b > 140 ? '#111' : '#fff';
          g.fillText(label, (x0 + x1) / 2 - tw / 2, top + row.h / 2);
        }
      }
      top += row.h;
    }

    // The track: dated records, a dot at each start and a line to the end of what has ended.
    const ty = top + TRACK / 2;
    for (const it of this.track) {
      const x0 = x(it.start);
      const x1 = it.end !== null && it.end > it.start ? Math.min(w, x(it.end)) : x0;
      if (x1 < -4 || x0 > w + 4) continue;
      const color = TRACK_COLORS[it.entry.kind.split('/')[0]] ?? '#9aa6bd';
      g.fillStyle = color;
      g.globalAlpha = it === this.hovered ? 1 : 0.85;
      if (x1 > x0) g.fillRect(Math.max(0, x0), ty - 1, Math.max(1, x1 - Math.max(0, x0)), 2);
      g.beginPath();
      g.arc(x0, ty, it === this.hovered ? 4.5 : 3, 0, 2 * Math.PI);
      g.fill();
    }
    g.globalAlpha = 1;

    // The planet's states, a thin band under the track: its phases, then episodes over them.
    for (const b of [...this.states.filter((x) => !x.over), ...this.states.filter((x) => x.over)]) {
      if (b.end < this.win[0] || b.start > this.win[1]) continue;
      const x0 = Math.max(0, x(b.start));
      const x1 = Math.min(w, Number.isFinite(b.end) ? x(b.end) : w);
      if (x1 - x0 < 0.5) continue;
      g.fillStyle = b.color;
      g.globalAlpha = b === this.hovered ? 1 : 0.8;
      g.fillRect(x0, top + TRACK - 4, Math.max(1, x1 - x0), 3);
    }
    g.globalAlpha = 1;

    // Outside the data range: dim it.
    g.fillStyle = 'rgba(8, 10, 16, 0.65)';
    if (this.win[0] < this.dataRange[0]) g.fillRect(0, RULER, Math.max(0, x(this.dataRange[0])), h - RULER);
    if (this.win[1] > this.dataRange[1]) {
      const x1 = Math.min(w, x(this.dataRange[1]));
      g.fillRect(x1, RULER, w - x1, h - RULER);
    }

    // Ruler: keyframes, then ticks.
    g.fillStyle = 'rgba(255,255,255,0.35)';
    const kx = this.keyframes.map(x).filter((v) => v >= 0 && v <= w);
    if (kx.length < 2 || kx.every((v, i) => i === 0 || Math.abs(v - kx[i - 1]) > 4)) for (const v of kx) g.fillRect(v - 0.5, RULER - 5, 1, 4);
    g.fillStyle = '#cfd6e6';
    for (const { t, label } of rulerTicks(this.win, x, (v) => tOf(v, this.win, w), 72)) {
      const rx = x(t);
      g.fillRect(rx, RULER - 7, 1, 7);
      const tw = g.measureText(label).width;
      g.fillText(label, Math.min(w - tw - 2, Math.max(2, rx - tw / 2)), 8);
    }

    // Cursor.
    const cx = x(this.t);
    if (cx >= -1 && cx <= w + 1) {
      g.fillStyle = '#ffd36b';
      g.fillRect(cx - 1, 0, 2, h);
      g.beginPath();
      g.moveTo(cx - 6, 0);
      g.lineTo(cx + 6, 0);
      g.lineTo(cx, 7);
      g.fill();
    }
  }
}
