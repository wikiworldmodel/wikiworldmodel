// The planet at the time shown: its state (the phase of its record, and any ice), then each
// global series' value there, or a dash where the series has no value. Clicking a row opens
// how it is known.
import type { Look } from '../../../core/planet.ts';
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
  private phase: { row: HTMLButtonElement; value: HTMLElement } | null = null;
  private ice: { row: HTMLButtonElement; title: HTMLElement; value: HTMLElement } | null = null;
  /** the records the state rows open */
  private open = { phase: '', ice: '' };
  /** a series was chosen */
  onOpen: (id: string) => void = () => {};
  /** a record was chosen: the planet's, or a glaciation's */
  onRecord: (id: string) => void = () => {};

  constructor(private series: SeriesRecord[], planetLabel?: string) {
    this.el = document.createElement('section');
    this.el.className = 'planet';
    this.el.hidden = series.length === 0 && !planetLabel;
    this.el.setAttribute('aria-label', 'The planet at this time');
    const stateRow = (cls: string, title: string, which: 'phase' | 'ice') => {
      const row = document.createElement('button');
      row.className = `planet-row ${cls}`;
      row.innerHTML = `<span class="planet-title"></span><span class="planet-value"></span>`;
      row.querySelector('.planet-title')!.textContent = title;
      row.onclick = () => this.open[which] && this.onRecord(this.open[which]);
      this.el.appendChild(row);
      return { row, title: row.querySelector<HTMLElement>('.planet-title')!, value: row.querySelector<HTMLElement>('.planet-value')! };
    };
    if (planetLabel) {
      this.phase = stateRow('planet-phase', planetLabel, 'phase');
      this.ice = stateRow('planet-ice', 'Ice', 'ice');
    }
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

  update(t: number, look?: Look): void {
    if (this.phase && this.ice) {
      const phase = look && !look.formed ? 'not formed yet' : (look?.phase?.label ?? '—');
      if (this.phase.value.textContent !== phase) this.phase.value.textContent = phase;
      this.phase.row.classList.toggle('empty', !look?.phase);
      this.open.phase = look?.phase ? look.phase.subject.split('@')[0] : '';
      const ice = look?.ice;
      this.ice.row.hidden = !ice;
      this.open.ice = ice?.subject ?? '';
      if (ice) {
        const reach = look!.iceReach <= 0 ? 'to the equator' : `to ${look!.iceReach}°`;
        if (this.ice.value.textContent !== reach) this.ice.value.textContent = reach;
        if (this.ice.title.textContent !== ice.label) this.ice.title.textContent = ice.label;
      }
    }
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
