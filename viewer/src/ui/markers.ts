// Entity markers: HTML elements placed over the globe. Each carries its entity id, so a
// click resolves to the entity's record. Positions come from the frames: a marker rides its
// plate, so at 250 Ma it is where its locality was then.
import { rotate, unitVector, type Quat } from '../../../core/quat.ts';
import type { Feature, FeatureTime } from '../../../core/tileset.ts';
import type { Camera } from '../camera.ts';
import type { V3 } from '../mat.ts';

export interface MarkerContext {
  t: number;
  /** the time control's window span, years: sets how long instants stay visible */
  windowSpan: number;
  evidence: boolean;
  alts: Record<string, string>;
  selected: string | null;
  plateRotation: (plate: number) => Quat;
}

const KIND_CLASS: Record<string, string> = {
  'life/occurrence': 'fossil',
  'earth/event/impact': 'event',
  'earth/event/collision': 'event',
  'earth/large-igneous-province': 'lip',
  'earth/structure/impact-crater': 'structure',
  'earth/mountain-range': 'range',
};

/** The interval a feature has under the chosen claims. */
export function timeFor(f: Feature, alts: Record<string, string>): FeatureTime {
  for (const [group, claim] of Object.entries(alts)) {
    const t = f.alternatives?.[`${group}=${claim}`];
    if (t) return t;
  }
  return f.time;
}

/**
 * How visible a feature is at time t, 0–1. Intervals show from start to end (or now);
 * instants show within a halo that scales with the time window, so they can be found while
 * scrubbing at any zoom. In evidence mode, uncertain edges fade across their bounds.
 */
export function visibility(time: FeatureTime, t: number, windowSpan: number, evidence: boolean): number {
  const halo = Math.max(windowSpan * 0.012, 2e4);
  if (time.instant) {
    const lo = Number.isFinite(time.start.lo) ? time.start.lo : time.start.best!;
    const hi = Number.isFinite(time.start.hi) ? time.start.hi : time.start.best!;
    if (t >= lo && t <= hi) return 1;
    const d = t < lo ? lo - t : t - hi;
    return d > halo ? 0 : 1 - d / halo;
  }
  const s = time.start;
  const e = time.end;
  const start = s.best ?? -Infinity;
  const end = e.best ?? Infinity;
  if (!evidence) return t >= start && t <= end ? 1 : 0;
  // Fade in across the start's bounds, out across the end's.
  const fade = (x: number, lo: number, hi: number) => {
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return x >= (Number.isFinite(lo) ? lo : -Infinity) ? 1 : 0;
    return Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  };
  const a = Number.isFinite(s.lo) && Number.isFinite(s.hi) ? fade(t, s.lo, s.hi) : t >= start ? 1 : 0;
  const b = e.best === null ? 1 : Number.isFinite(e.lo) && Number.isFinite(e.hi) ? 1 - fade(t, e.lo, e.hi) : t <= end ? 1 : 0;
  return Math.min(a, b);
}

export class Markers {
  readonly el: HTMLElement;
  private nodes = new Map<string, HTMLButtonElement>();
  onSelect: (id: string) => void = () => {};

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'markers';
  }

  update(features: Feature[], camera: Camera, ctx: MarkerContext): void {
    const seen = new Set<string>();
    const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const placed: { f: Feature; x: number; y: number; vis: number; t: FeatureTime }[] = [];
    for (const f of features) {
      const time = timeFor(f, ctx.alts);
      const vis = visibility(time, ctx.t, ctx.windowSpan, ctx.evidence);
      if (vis <= 0.01) continue;
      const q = f.plate ? ctx.plateRotation(f.plate) : ([1, 0, 0, 0] as Quat);
      const p = rotate(q, unitVector(f.location.lat, f.location.lon)) as V3;
      const s = camera.project(p);
      if (!s.visible) continue;
      placed.push({ f, x: s.x, y: s.y, vis, t: time });
    }
    // Dots that land on top of each other (an event and the structure it made) fan out
    // downwards; labels go right of the dot, nudged down until they don't overlap.
    placed.sort((a, b) => a.y - b.y || a.x - b.x || (a.f.id < b.f.id ? -1 : 1));
    const dots: { x: number; y: number }[] = [];
    for (const m of placed) {
      while (dots.some((d) => Math.abs(d.x - m.x) < 13 && Math.abs(d.y - m.y) < 13)) m.y += 17;
      dots.push({ x: m.x, y: m.y });
    }
    for (const m of placed) {
      seen.add(m.f.id);
      let node = this.nodes.get(m.f.id);
      if (!node) {
        node = document.createElement('button');
        node.className = `marker ${KIND_CLASS[m.f.kind] ?? 'other'}`;
        node.dataset.entity = m.f.id;
        node.innerHTML = `<span class="dot"></span><span class="label"></span>`;
        node.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onSelect(m.f.id);
        });
        node.addEventListener('pointerdown', (e) => e.stopPropagation());
        this.el.appendChild(node);
        this.nodes.set(m.f.id, node);
      }
      const label = node.querySelector<HTMLElement>('.label')!;
      if (label.textContent !== m.f.label) label.textContent = m.f.label;
      node.setAttribute('aria-label', `${m.f.label} (${m.f.kind})`);
      const w = 8 + m.f.label.length * 6.6;
      let dy = 0;
      for (let i = 0; i < 6; i++) {
        const box = { x0: m.x, y0: m.y - 9 + dy, x1: m.x + 14 + w, y1: m.y + 9 + dy };
        if (!boxes.some((b) => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1)) {
          boxes.push(box);
          break;
        }
        dy += 16;
      }
      label.style.transform = dy ? `translateY(${dy}px)` : '';
      node.style.transform = `translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px)`;
      node.style.opacity = String(Math.max(0.15, m.vis));
      node.classList.toggle('selected', ctx.selected === m.f.id);
      node.classList.toggle('derived', ctx.evidence && (m.t.start.derived || m.t.end.derived));
      node.classList.toggle('proposed', ctx.evidence && m.f.status === 'proposed');
      node.style.display = '';
    }
    for (const [id, node] of this.nodes) if (!seen.has(id)) node.style.display = 'none';
  }
}
