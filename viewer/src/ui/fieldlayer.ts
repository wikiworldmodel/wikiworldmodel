// One renderer for every field of points, lines and areas over the globe (docs/STRUCTURE.md section 3.6). What it
// draws and how come from the field's record (core/fieldlayers.ts): its rows, binned by time, and its style. Nothing
// here knows which dataset it draws, so a new one needs no code. Rows are drawn on a canvas over the globe, as the
// other rows layers are; a click finds the nearest point or line drawn.
import { binsAt, byValue, hueOf, type LayerBin, type LayerInfo, type LayerRow } from '../../../core/fieldlayers.ts';
import { unitVector } from '../../../core/quat.ts';
import type { Camera } from '../camera.ts';
import { getJSON } from '../data.ts';
import type { V3 } from '../mat.ts';

const PICK = 9;

function fit(c: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) {
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
  }
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, width, height);
  return g;
}

/** The colour of a row, as its style says: one for all, or a hue for its group (or its own name, where it has none). */
function colorOf(info: LayerInfo, r: LayerRow, alpha: number): string {
  const c = info.style.color;
  if ('value' in c) {
    const n = parseInt(c.value.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  const name = r.group !== undefined ? info.groups[r.group] : (r.label ?? r.row);
  return `hsla(${hueOf(name)}, ${c.saturation}%, ${c.lightness}%, ${alpha})`;
}

export class FieldLayer {
  readonly el: HTMLCanvasElement;
  /** the rows of each bin that has loaded, by file */
  private loaded = new Map<string, LayerRow[]>();
  private loading = new Set<string>();
  private shown: { r: LayerRow; x: number; y: number; pts?: number[] }[] = [];
  onLoad: () => void = () => {};

  constructor(
    readonly info: LayerInfo,
    private base: string,
  ) {
    this.el = document.createElement('canvas');
    this.el.className = 'row-layer';
    this.el.hidden = true;
  }

  /** How many rows were drawn in the last frame. */
  get count(): number {
    return this.shown.length;
  }

  /** Whether its time holds. */
  holds(t: number): boolean {
    return t >= this.info.span[0] && t <= this.info.span[1];
  }

  /** Whether a file it asked for has yet to come: a layer that is not drawn asks for none. */
  get busy(): boolean {
    for (const f of this.loading) if (!this.loaded.has(f)) return true;
    return false;
  }

  private want(t: number): LayerRow[] {
    const out: LayerRow[] = [];
    for (const b of binsAt(this.info, t)) {
      const rows = this.loaded.get(b.file);
      if (rows) out.push(...rows);
      else if (!this.loading.has(b.file)) {
        this.loading.add(b.file);
        void getJSON<LayerBin>(this.base + b.file).then((f) => {
          this.loaded.set(b.file, f.rows);
          this.onLoad();
        });
      }
    }
    return out.filter((r) => r.from <= t && t < r.to);
  }

  update(camera: Camera, on: boolean, t: number, dist: number, width: number, height: number): void {
    this.shown = [];
    const rows = on && this.holds(t) ? this.want(t) : [];
    this.el.hidden = !rows.length;
    if (!rows.length) return;
    const g = fit(this.el, width, height);
    const s = this.info.style;
    const kind = this.info.kind;
    for (const r of rows) {
      const alpha = r.o ?? byValue(s.opacity, {}, 0.85);
      if (kind === 'points' && r.at) {
        const p = camera.project(unitVector(r.at[1], r.at[0]) as V3);
        if (!p.visible) continue;
        this.shown.push({ r, x: p.x, y: p.y });
        g.fillStyle = colorOf(this.info, r, alpha);
        g.beginPath();
        g.arc(p.x, p.y, s.size ? (dist < 1.3 ? s.size.near : s.size.far) : 2, 0, 2 * Math.PI);
        g.fill();
        continue;
      }
      // Lines and the outlines of areas: each run of visible points, broken where the far side hides one.
      let any = false;
      const pts: number[] = [];
      g.beginPath();
      for (const line of r.lines ?? []) {
        let open = false;
        for (let k = 0; k + 1 < line.length; k += 2) {
          const p = camera.project(unitVector(line[k + 1] / 100, line[k] / 100) as V3);
          if (!p.visible) {
            open = false;
            continue;
          }
          any = true;
          pts.push(p.x, p.y);
          if (open) g.lineTo(p.x, p.y);
          else g.moveTo(p.x, p.y);
          open = true;
        }
        if (kind === 'areas' && open) g.closePath();
      }
      if (!any) continue;
      this.shown.push({ r, x: pts[0], y: pts[1], pts });
      if (kind === 'areas') {
        g.fillStyle = colorOf(this.info, r, alpha * 0.35);
        g.fill('evenodd');
      }
      g.strokeStyle = colorOf(this.info, r, alpha);
      g.lineWidth = r.w ?? byValue(s.width, {}, 0.8);
      g.stroke();
    }
    // Close by there is room to name points, without one on another.
    if (kind !== 'points' || !s.labels || dist >= s.labels.near) return;
    const boxes: [number, number, number, number][] = [];
    g.font = '10.5px system-ui, sans-serif';
    g.textBaseline = 'middle';
    for (const { r, x, y } of this.shown) {
      if (boxes.length > s.labels.most || !r.label) continue;
      const w = g.measureText(r.label).width;
      const box: [number, number, number, number] = [x - 3, y - 7, x + 7 + w, y + 7];
      if (x < 0 || y < 0 || x > width || y > height || boxes.some((b) => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3])) continue;
      boxes.push(box);
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(8, 12, 20, 0.7)';
      g.strokeText(r.label, x + 5, y);
      g.fillStyle = 'rgba(255, 248, 232, 0.92)';
      g.fillText(r.label, x + 5, y);
    }
  }

  /** The row drawn nearest a screen position: a point, or a line passing near it. */
  pick(x: number, y: number): LayerRow | undefined {
    if (this.info.style.pick === false) return undefined;
    let best: LayerRow | undefined;
    let d = PICK * PICK;
    for (const s of this.shown) {
      const pts = s.pts ?? [s.x, s.y];
      for (let k = 0; k + 1 < pts.length; k += 2) {
        const v = (pts[k] - x) * (pts[k] - x) + (pts[k + 1] - y) * (pts[k + 1] - y);
        if (v < d) {
          d = v;
          best = s.r;
        }
      }
    }
    return best;
  }

  /** Where a row of this label is on the screen, for tests. */
  positionOf(label: string): { x: number; y: number } | undefined {
    const s = this.shown.find((q) => q.r.label === label);
    return s && { x: s.x, y: s.y };
  }
}
