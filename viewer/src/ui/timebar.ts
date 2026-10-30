// The time control: a strip that zooms like a map. Across the whole range it is close to
// logarithmic in age; zoomed in, it becomes linear. Bands show the named periods.
import type { PeriodRecord } from '../../../core/records.ts';
import { lookup, type Scenario } from '../../../core/scenario.ts';
import { formatTime, PRESENT_YEAR } from '../../../core/time.ts';

type Win = [number, number];

const age = (t: number) => PRESENT_YEAR - t;

/** The warp's offset: log(age + c) with c a fraction of the window's span. */
function offset(win: Win): number {
  return Math.max((age(win[0]) - age(win[1])) / 8, 1);
}

export function xOf(t: number, win: Win, width: number): number {
  const c = offset(win);
  const uo = Math.log(age(win[0]) + c);
  const un = Math.log(age(win[1]) + c);
  return (width * (uo - Math.log(Math.max(age(t), -c * 0.999) + c))) / (uo - un);
}

export function tOf(x: number, win: Win, width: number): number {
  const c = offset(win);
  const uo = Math.log(age(win[0]) + c);
  const un = Math.log(age(win[1]) + c);
  const u = uo - (x / width) * (uo - un);
  return PRESENT_YEAR - (Math.exp(u) - c);
}

/** Zoom by `factor` (>1 zooms in) keeping time `tp` at screen fraction `s`; keep within `limits`. */
export function zoomAround(win: Win, tp: number, s: number, factor: number, limits: Win, minSpan = 1e4): Win {
  const fullSpan = age(limits[0]) - age(limits[1]);
  const span = Math.min(fullSpan, Math.max(minSpan, (age(win[0]) - age(win[1])) / factor));
  const ap = age(tp);
  const frac = (an: number) => {
    const c = Math.max(span / 8, 1);
    const ao = an + span;
    const uo = Math.log(ao + c);
    return (uo - Math.log(ap + c)) / (uo - Math.log(an + c));
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
  { rank: 'era', h: 15 },
  { rank: 'period', h: 18 },
  { rank: 'epoch', h: 15 },
  { rank: 'stage', h: 13 },
];
const RULER = 22;
const PAD = 4;

function niceSteps(): number[] {
  const out: number[] = [];
  for (let e = 3; e <= 9; e++) for (const m of [1, 2, 5]) out.push(m * 10 ** e);
  return out;
}

function tickLabel(a: number, step: number): string {
  if (a === 0) return '0';
  if (step >= 1e6) return `${+(a / 1e6).toFixed(Math.max(0, -Math.floor(Math.log10(step / 1e6))))}`;
  return `${+(a / 1e6).toFixed(Math.min(4, Math.max(1, 6 - Math.floor(Math.log10(step)))))}`;
}

export interface TimebarCallbacks {
  onTime(t: number): void;
  onWindow(w: Win): void;
  onPlay(): void;
}

export class Timebar {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private readout: HTMLElement;
  private playBtn: HTMLButtonElement;
  private t = 0;
  private win: Win;
  private drag: { mode: 'scrub' | 'pan'; x: number; win: Win } | null = null;
  private keyframes: number[] = [];

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
      <canvas class="tb-canvas" aria-label="Time control: drag to move through time, scroll to zoom, drag the ruler to pan"></canvas>`;
    this.canvas = this.el.querySelector('canvas')!;
    this.readout = this.el.querySelector('.tb-readout')!;
    this.playBtn = this.el.querySelector('.tb-play')!;
    this.playBtn.onclick = () => this.cb.onPlay();
    this.el.querySelector<HTMLButtonElement>('.tb-zoom-in')!.onclick = () => this.zoom(2, this.t);
    this.el.querySelector<HTMLButtonElement>('.tb-zoom-out')!.onclick = () => this.zoom(0.5, this.t);
    this.el.querySelector<HTMLButtonElement>('.tb-reset')!.onclick = () => this.cb.onWindow(this.limits);
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointercancel', (e) => this.up(e));
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

  /** Date the periods as a scenario's alternatives do (period boundaries are claims too). */
  setScenario(s: Scenario): void {
    this.periods = this.all.map((p) => ({ ...p, ...lookup(p.variants, { alts: s.alts }, { start: p.start, end: p.end }) }));
  }

  private width(): number {
    return this.canvas.clientWidth || 1;
  }

  private zoom(factor: number, tp: number, s?: number): void {
    const frac = s ?? Math.min(1, Math.max(0, xOf(tp, this.win, this.width()) / this.width()));
    this.cb.onWindow(zoomAround(this.win, tp, frac, factor, this.limits));
  }

  private down(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    const mode = e.offsetY < RULER || e.shiftKey ? 'pan' : 'scrub';
    this.drag = { mode, x: e.offsetX, win: this.win };
    if (mode === 'scrub') this.scrubTo(e.offsetX);
  }

  private move(e: PointerEvent): void {
    if (!this.drag) return;
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
    const res = (age(win[0]) - age(win[1])) / 2000;
    const stage = this.periodAt(t, 'stage');
    const period = this.periodAt(t, 'period');
    const where = [stage?.name, period && period.name !== stage?.name ? period.name : undefined].filter(Boolean).join(', ');
    const label = t >= PRESENT_YEAR ? 'Today' : formatTime(t, res);
    this.readout.innerHTML = `<strong>${label}</strong>${where ? ` <span>${where}</span>` : ''}`;
    this.draw();
  }

  draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.width();
    const h = RULER + ROWS.reduce((s, r) => s + r.h, 0) + PAD;
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
        const x1 = Math.min(w, x(p.end));
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

    // Outside the data range: dim it.
    g.fillStyle = 'rgba(8, 10, 16, 0.65)';
    if (this.win[0] < this.dataRange[0]) g.fillRect(0, RULER, Math.max(0, x(this.dataRange[0])), h - RULER);

    // Ruler: keyframes and ticks, placed greedily from the roundest values down.
    g.fillStyle = 'rgba(255,255,255,0.35)';
    const kx = this.keyframes.map(x).filter((v) => v >= 0 && v <= w);
    if (kx.length < 2 || kx.every((v, i) => i === 0 || Math.abs(v - kx[i - 1]) > 4)) for (const v of kx) g.fillRect(v - 0.5, RULER - 5, 1, 4);
    const placed: number[] = [];
    const steps = niceSteps().reverse();
    const ao = age(this.win[0]);
    const an = age(this.win[1]);
    g.fillStyle = '#cfd6e6';
    g.font = '11px system-ui, -apple-system, Segoe UI, sans-serif';
    for (const step of steps) {
      if ((ao - an) / step > 400) break;
      for (let a = Math.ceil(an / step) * step; a <= ao; a += step) {
        const px = x(PRESENT_YEAR - a);
        if (px < 24 || px > w || placed.some((q) => Math.abs(q - px) < 58)) continue;
        placed.push(px);
        g.fillRect(px, RULER - 7, 1, 7);
        const label = tickLabel(a, step);
        const tw = g.measureText(label).width;
        g.fillText(label, Math.min(w - tw - 2, Math.max(2, px - tw / 2)), 8);
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
