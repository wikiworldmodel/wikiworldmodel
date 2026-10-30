// The planet at the time shown: each global series' value there, with its band, or a dash
// where the series has no value. Clicking one opens how it is known.
import type { SeriesRecord } from '../../../core/records.ts';
import { fmtValue, type SeriesValue } from './inspect.ts';

/** A series' value at time t, interpolated between its points; null outside its span. */
export function valueAt(s: SeriesRecord, t: number): SeriesValue | null {
  const p = s.points;
  if (!p.length || t < p[0][0] || t > p[p.length - 1][0]) return null;
  let lo = 0;
  let hi = p.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (p[m][0] <= t) lo = m;
    else hi = m;
  }
  const [a, b] = [p[lo], p[hi]];
  if (s.interpolation === 'step' || a[0] === b[0] || t <= a[0]) return { value: a[1], lo: a[2], hi: a[3] };
  const f = (t - a[0]) / (b[0] - a[0]);
  const lerp = (x: number | null, y: number | null) => (x === null || y === null ? null : x + (y - x) * f);
  return { value: a[1] + (b[1] - a[1]) * f, lo: lerp(a[2], b[2]), hi: lerp(a[3], b[3]) };
}

export class PlanetPanel {
  readonly el: HTMLElement;
  private rows = new Map<string, { value: HTMLElement; row: HTMLElement }>();
  onOpen: (id: string) => void = () => {};

  constructor(private series: SeriesRecord[]) {
    this.el = document.createElement('section');
    this.el.className = 'planet';
    this.el.hidden = series.length === 0;
    this.el.setAttribute('aria-label', 'The planet at this time');
    for (const s of series) {
      const row = document.createElement('button');
      row.className = 'planet-row';
      row.dataset.series = s.id;
      row.innerHTML = `<span class="planet-title"></span><span class="planet-value"></span>`;
      row.querySelector('.planet-title')!.textContent = s.title;
      row.onclick = () => this.onOpen(s.id);
      this.el.appendChild(row);
      this.rows.set(s.id, { value: row.querySelector('.planet-value')!, row });
    }
  }

  update(t: number): void {
    for (const s of this.series) {
      const r = this.rows.get(s.id)!;
      const v = valueAt(s, t);
      const text = v ? `${fmtValue(v.value)}${s.unit ? ` ${s.unit}` : ''}` : '—';
      if (r.value.textContent !== text) r.value.textContent = text;
      r.row.classList.toggle('projection', !!v && s.projectedAfter !== undefined && t > s.projectedAfter);
      r.row.classList.toggle('empty', !v);
    }
  }
}
