// The time control: a strip that zooms like a map. Across the whole range it is close to
// logarithmic in distance from the present, on both sides of it, so the deep past and the far
// future both fit; zoomed in, it becomes linear. Bands show the named periods, and a track
// below them shows the world's dated records.
import type { PeriodRecord, SearchEntry } from '../../../core/records.ts';
import { lookup, type Scenario } from '../../../core/scenario.ts';
import { formatTime, PRESENT_YEAR } from '../../../core/time.ts';

type Win = [number, number];

const age = (t: number) => PRESENT_YEAR - t;

/**
 * The warp's offset: log(1 + |age| / c), with c an eighth of the window's span, so a narrow
 * window is close to linear. It is capped, so a window of billions of years stays
 * logarithmic near the present.
 */
const MAX_OFFSET = 5e7;
const offsetFor = (span: number) => Math.max(Math.min(span / 8, MAX_OFFSET), 1);
const offset = (win: Win) => offsetFor(age(win[0]) - age(win[1]));

/** Signed log distance from the present: positive in the past, negative in the future. */
const warp = (a: number, c: number) => Math.sign(a) * Math.log1p(Math.abs(a) / c);
const unwarp = (v: number, c: number) => Math.sign(v) * c * Math.expm1(Math.abs(v));

export function xOf(t: number, win: Win, width: number): number {
  const c = offset(win);
  const uo = warp(age(win[0]), c);
  const un = warp(age(win[1]), c);
  return (width * (uo - warp(age(t), c))) / (uo - un);
}

export function tOf(x: number, win: Win, width: number): number {
  const c = offset(win);
  const uo = warp(age(win[0]), c);
  const un = warp(age(win[1]), c);
  return PRESENT_YEAR - unwarp(uo - (x / width) * (uo - un), c);
}

/** Zoom by `factor` (>1 zooms in) keeping time `tp` at screen fraction `s`; keep within `limits`. */
export function zoomAround(win: Win, tp: number, s: number, factor: number, limits: Win, minSpan = 1e4): Win {
  const fullSpan = age(limits[0]) - age(limits[1]);
  const span = Math.min(fullSpan, Math.max(minSpan, (age(win[0]) - age(win[1])) / factor));
  const c = offsetFor(span);
  const ap = age(tp);
  const frac = (an: number) => {
    const uo = warp(an + span, c);
    return (uo - warp(ap, c)) / (uo - warp(an, c));
  };
  let lo = ap - span;
  let hi = ap;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (frac(mid) < s) lo = mid;
    else hi = mid;
  }
  return clampWindow([PRESENT_YEAR - (lo + span), PRESENT_YEAR - lo], limits);
}

export function clampWindow(win: Win, limits: Win): Win {
  let [o, n] = win;
  const span = n - o;
  const full = limits[1] - limits[0];
  if (span >= full) return [limits[0], limits[1]];
  if (o < limits[0]) [o, n] = [limits[0], limits[0] + span];
  if (n > limits[1]) [o, n] = [limits[1] - span, limits[1]];
  return [o, n];
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

/** Ages worth a tick: 1, 2 and 5 times a power of ten, from a thousand years to 10 Gyr. */
const NICE: number[] = [];
for (let e = 10; e >= 3; e--) for (const m of [5, 2, 1]) NICE.push(m * 10 ** e);

function tickLabel(a: number, step: number): string {
  if (a === 0) return '0';
  const v = Math.abs(a) / 1e6;
  const digits = step >= 1e6 ? 0 : Math.min(4, Math.max(1, 6 - Math.floor(Math.log10(step))));
  return `${a < 0 ? '+' : ''}${+v.toFixed(digits)}`;
}

const TRACK_COLORS: Record<string, string> = {
  event: '#ff7a59',
  occurrence: '#9be38a',
  sample: '#c8a2ff',
  taxon: '#5fd4c4',
  development: '#ffd36b',
  'large-igneous-province': '#ff9f43',
  landform: '#c8a2ff',
};

/** A dated record on the track: where it starts, and where it ends if it ended. */
interface TrackItem {
  entry: SearchEntry;
  start: number;
  end: number | null;
}

export interface TimebarCallbacks {
  onTime(t: number): void;
  onWindow(w: Win): void;
  onPlay(): void;
  /** a record on the track was chosen */
  onRecord(id: string): void;
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
  private hovered: TrackItem | null = null;

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

  /** The track item under a point of the strip, if any. */
  private itemAt(x: number, y: number): TrackItem | null {
    const top = this.height() - PAD - TRACK;
    if (y < top - 2 || y > top + TRACK + 2) return null;
    let best: TrackItem | null = null;
    let bestD = 7;
    for (const it of this.track) {
      const d = Math.abs(xOf(it.start, this.win, this.width()) - x);
      if (d < bestD) (best = it), (bestD = d);
    }
    return best;
  }

  private hover(it: TrackItem | null): void {
    if (it === this.hovered) return;
    this.hovered = it;
    this.canvas.style.cursor = it ? 'pointer' : '';
    if (!it) {
      this.tip.hidden = true;
    } else {
      const when = it.end !== null && it.end !== it.start ? `${formatTime(it.start)} – ${formatTime(it.end)}` : formatTime(it.start);
      this.tip.textContent = `${it.entry.label} · ${when}`;
      this.tip.hidden = false;
      const x = xOf(it.start, this.win, this.width());
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
    this.canvas.setPointerCapture(e.pointerId);
    const mode = e.offsetY < RULER || e.shiftKey ? 'pan' : 'scrub';
    this.drag = { mode, x: e.offsetX, win: this.win };
    if (mode === 'scrub') this.scrubTo(e.offsetX);
  }

  private move(e: PointerEvent): void {
    if (!this.drag) {
      this.hover(this.itemAt(e.offsetX, e.offsetY));
      return;
    }
    if (this.drag.mode === 'scrub') this.scrubTo(e.offsetX);
    else {
      const w = this.width();
      const a0 = tOf(this.drag.x, this.drag.win, w);
      const a1 = tOf(e.offsetX, this.drag.win, w);
      const d = a0 - a1;
      this.cb.onWindow(clampWindow([this.drag.win[0] + d, this.drag.win[1] + d], this.limits));
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
    const pad = (p.end - p.start) * 0.06;
    this.cb.onWindow(clampWindow([p.start - pad, p.end + pad], this.limits));
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
      if (x0 < -4 || x0 > w + 4) continue;
      const color = TRACK_COLORS[it.entry.kind.split('/')[0]] ?? '#9aa6bd';
      g.fillStyle = color;
      g.globalAlpha = it === this.hovered ? 1 : 0.85;
      if (it.end !== null && it.end > it.start) g.fillRect(x0, ty - 1, Math.max(1, Math.min(w, x(it.end)) - x0), 2);
      g.beginPath();
      g.arc(x0, ty, it === this.hovered ? 4.5 : 3, 0, 2 * Math.PI);
      g.fill();
    }
    g.globalAlpha = 1;

    // Outside the data range: dim it.
    g.fillStyle = 'rgba(8, 10, 16, 0.65)';
    if (this.win[0] < this.dataRange[0]) g.fillRect(0, RULER, Math.max(0, x(this.dataRange[0])), h - RULER);
    if (this.win[1] > this.dataRange[1]) {
      const x1 = Math.min(w, x(this.dataRange[1]));
      g.fillRect(x1, RULER, w - x1, h - RULER);
    }

    // Ruler: keyframes, then ticks at round ages, chosen along the strip so they space
    // evenly whatever the warp.
    g.fillStyle = 'rgba(255,255,255,0.35)';
    const kx = this.keyframes.map(x).filter((v) => v >= 0 && v <= w);
    if (kx.length < 2 || kx.every((v, i) => i === 0 || Math.abs(v - kx[i - 1]) > 4)) for (const v of kx) g.fillRect(v - 0.5, RULER - 5, 1, 4);
    const placed: number[] = [];
    g.fillStyle = '#cfd6e6';
    for (let px = 24; px < w; px += 64) {
      const a = age(tOf(px, this.win, w));
      for (const step of NICE) {
        const r = Math.round(a / step) * step;
        const rx = x(PRESENT_YEAR - r);
        if (Math.abs(rx - px) > 28) continue;
        if (rx >= 24 && rx <= w && !placed.some((q) => Math.abs(q - rx) < 58)) {
          placed.push(rx);
          g.fillRect(rx, RULER - 7, 1, 7);
          const label = tickLabel(r, step);
          const tw = g.measureText(label).width;
          g.fillText(label, Math.min(w - tw - 2, Math.max(2, rx - tw / 2)), 8);
        }
        break;
      }
    }
    g.fillStyle = 'rgba(207,214,230,0.6)';
    g.fillText('Ma', 4, RULER - 8);

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
