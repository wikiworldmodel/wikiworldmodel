// Today's borders and cities, and the hazards of the time shown, over the globe. They are rows of a
// dataset, thousands of them, so they are drawn on a canvas and need no element each; a click finds
// the nearest one drawn. At these times the plates have not moved enough to matter.
import { cellAt, gridSize, hazardsNear, insideRow, levelOf, peopleAt, politiesAt, rangeAt, stepsAround, type HazardFile, type HazardRow, type PeopleFile, type PolitiesFile, type PolityRow, type PresentFile, type PresentPlace } from '../../../core/layers.ts';
import { hueOf } from '../../../core/fieldlayers.ts';
import { unitVector } from '../../../core/quat.ts';
import { PRESENT_YEAR } from '../../../core/time.ts';
import type { Camera } from '../camera.ts';
import type { V3 } from '../mat.ts';
import { short, stepName, type PeopleHere } from './inspect.ts';

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

export class PresentLayer {
  readonly el: HTMLCanvasElement;
  file: PresentFile | null = null;
  private shown: { p: PresentPlace; x: number; y: number }[] = [];
  /** how many lines and names were drawn in the last frame */
  stats = { lines: 0, names: 0 };

  constructor() {
    this.el = document.createElement('canvas');
    this.el.className = 'row-layer';
    this.el.hidden = true;
  }

  holds(t: number): boolean {
    return !!this.file && t >= this.file.since && t <= this.file.until;
  }

  update(camera: Camera, t: number, dist: number, width: number, height: number): void {
    this.shown = [];
    this.stats = { lines: 0, names: 0 };
    const on = this.holds(t);
    this.el.hidden = !on;
    if (!on) return;
    const f = this.file!;
    const g = fit(this.el, width, height);
    const disputed = new Set(f.disputed);
    const trace = (line: number[]) => {
      let open = false;
      g.beginPath();
      for (let k = 0; k + 1 < line.length; k += 2) {
        const s = camera.project(unitVector(line[k + 1] / 100, line[k] / 100) as V3);
        if (!s.visible) {
          open = false;
          continue;
        }
        if (open) g.lineTo(s.x, s.y);
        else g.moveTo(s.x, s.y);
        open = true;
      }
      g.stroke();
    };
    g.lineWidth = 0.8;
    f.borders.forEach((line, i) => {
      const dis = disputed.has(i);
      g.strokeStyle = dis ? 'rgba(255, 244, 214, 0.34)' : 'rgba(255, 244, 214, 0.5)';
      g.setLineDash(dis ? [3, 3] : []);
      trace(line);
      this.stats.lines++;
    });
    g.setLineDash([]);
    // The larger the view, the fewer names: the biggest cities first, and none on top of another.
    const room = dist < 1.25 ? 140 : dist < 1.6 ? 70 : dist < 2.4 ? 34 : 14;
    const boxes: [number, number, number, number][] = [];
    g.font = '11px system-ui, sans-serif';
    g.textBaseline = 'middle';
    let named = 0;
    for (const p of f.places) {
      if (named >= room) break;
      const s = camera.project(unitVector(p.lat, p.lon) as V3);
      if (!s.visible) continue;
      const w = g.measureText(p.name).width;
      const box: [number, number, number, number] = [s.x - 4, s.y - 7, s.x + 8 + w, s.y + 7];
      if (boxes.some((b) => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3])) continue;
      boxes.push(box);
      named++;
      this.shown.push({ p, x: s.x, y: s.y });
      g.fillStyle = p.capital ? 'rgba(255, 236, 190, 1)' : 'rgba(255, 244, 224, 0.9)';
      g.beginPath();
      g.arc(s.x, s.y, p.capital ? 2.6 : 1.9, 0, 2 * Math.PI);
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(8, 12, 20, 0.72)';
      g.strokeText(p.name, s.x + 6, s.y);
      g.fillStyle = 'rgba(255, 248, 232, 0.94)';
      g.fillText(p.name, s.x + 6, s.y);
    }
    this.stats.names = named;
  }

  pick(x: number, y: number): PresentPlace | undefined {
    let best: PresentPlace | undefined;
    let d = PICK * PICK;
    for (const s of this.shown) {
      const v = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y);
      if (v < d) {
        d = v;
        best = s.p;
      }
    }
    return best;
  }

  /** Where a place's dot is on the screen, for tests. */
  placeAt(name: string): { x: number; y: number } | undefined {
    const s = this.shown.find((q) => q.p.name === name);
    return s && { x: s.x, y: s.y };
  }
}

const COLOURS: Record<HazardRow['kind'], string> = { eruption: '255, 112, 64', earthquake: '255, 214, 92', tsunami: '96, 196, 255' };

export class HazardLayer {
  readonly el: HTMLCanvasElement;
  file: HazardFile | null = null;
  private shown: { r: HazardRow; x: number; y: number }[] = [];

  constructor() {
    this.el = document.createElement('canvas');
    this.el.className = 'row-layer';
    this.el.hidden = true;
  }

  /** How many rows are drawn now. */
  get count(): number {
    return this.shown.length;
  }

  /** Draw what happened within `halo` years of the time shown, fading with how far from it. */
  update(camera: Camera, t: number, halo: number, width: number, height: number): void {
    this.shown = [];
    const near = this.file ? hazardsNear(this.file, t, halo) : [];
    this.el.hidden = !near.length;
    if (!near.length) return;
    const g = fit(this.el, width, height);
    for (const r of near) {
      const s = camera.project(unitVector(r.lat, r.lon) as V3);
      if (!s.visible) continue;
      this.shown.push({ r, x: s.x, y: s.y });
      const fade = 1 - (0.75 * Math.abs(r.t - t)) / Math.max(halo, 1e-6);
      const size = r.kind === 'earthquake' ? Math.max(0, (r.size ?? 6) - 5) * 1.5 : r.kind === 'eruption' ? (r.size ?? 2) * 0.9 : (r.size ?? 1) * 0.5;
      const radius = 2.2 + Math.min(6, size) + (r.deaths ? Math.min(3, Math.log10(r.deaths) * 0.6) : 0);
      g.fillStyle = `rgba(${COLOURS[r.kind]}, ${0.3 * fade})`;
      g.strokeStyle = `rgba(${COLOURS[r.kind]}, ${0.95 * fade})`;
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(s.x, s.y, radius, 0, 2 * Math.PI);
      g.fill();
      g.stroke();
    }
  }

  pick(x: number, y: number): HazardRow | undefined {
    let best: HazardRow | undefined;
    let d = PICK * PICK;
    for (const s of this.shown) {
      const v = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y);
      if (v < d) {
        d = v;
        best = s.r;
      }
    }
    return best;
  }

  /** The screen position of each row drawn, for tests. */
  positions(): { name: string; x: number; y: number }[] {
    return this.shown.map((s) => ({ name: s.r.name, x: s.x, y: s.y }));
  }
}


/** The states of the world at the time shown, from a borders dataset, tinted and outlined, the largest named. */
export class PolityLayer {
  readonly el: HTMLCanvasElement;
  file: PolitiesFile | null = null;
  private key = '';
  private now: PolityRow[] = [];
  stats = { rows: 0, names: 0 };

  constructor() {
    this.el = document.createElement('canvas');
    this.el.className = 'row-layer polity-layer';
    this.el.hidden = true;
  }

  /** `tint`: fill each state as well as outlining it, which hides what else is drawn on the land. */
  update(camera: Camera, t: number, dist: number, width: number, height: number, tint = true): void {
    this.stats = { rows: 0, names: 0 };
    if (this.file && this.key !== String(t)) {
      // At the present and after, today's map takes over.
      this.now = t < PRESENT_YEAR ? politiesAt(this.file, t).sort((a, b) => b.area - a.area) : [];
      this.key = String(t);
    }
    const on = !!this.file && this.now.length > 0;
    this.el.hidden = !on;
    if (!on) return;
    const g = fit(this.el, width, height);
    const labels: { r: PolityRow; x: number; y: number }[] = [];
    for (const r of this.now) {
      const hue = hueOf(r.name);
      g.beginPath();
      let whole = true;
      let any = false;
      for (const ring of r.rings) {
        let open = false;
        for (let k = 0; k + 1 < ring.length; k += 2) {
          const s = camera.project(unitVector(ring[k + 1] / 100, ring[k] / 100) as V3);
          if (!s.visible) {
            whole = false;
            open = false;
            continue;
          }
          any = true;
          if (open) g.lineTo(s.x, s.y);
          else g.moveTo(s.x, s.y);
          open = true;
        }
        if (open && whole) g.closePath();
      }
      if (!any) continue;
      this.stats.rows++;
      // A ring cut by the edge of the globe has no inside to fill.
      if (whole && tint) {
        g.fillStyle = `hsla(${hue}, 62%, 58%, 0.15)`;
        g.fill('evenodd');
      }
      g.strokeStyle = `hsla(${hue}, 72%, 78%, 0.55)`;
      g.lineWidth = 0.8;
      g.stroke();
      const c = camera.project(unitVector(r.at[1], r.at[0]) as V3);
      if (c.visible) labels.push({ r, x: c.x, y: c.y });
    }
    // The largest named, none on top of another, and fewer the further off.
    const room = dist < 1.25 ? 60 : dist < 1.6 ? 36 : dist < 2.4 ? 20 : 12;
    const boxes: [number, number, number, number][] = [];
    g.font = 'italic 11.5px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const l of labels) {
      if (this.stats.names >= room) break;
      const w = g.measureText(l.r.name).width;
      const box: [number, number, number, number] = [l.x - w / 2 - 2, l.y - 8, l.x + w / 2 + 2, l.y + 8];
      if (boxes.some((b) => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3])) continue;
      boxes.push(box);
      this.stats.names++;
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(8, 12, 20, 0.7)';
      g.strokeText(l.r.name, l.x, l.y);
      g.fillStyle = 'rgba(255, 246, 228, 0.92)';
      g.fillText(l.r.name, l.x, l.y);
    }
    g.textAlign = 'start';
  }

  /** The smallest row that holds at a point, at the time last drawn: what ruled there most narrowly. */
  at(lon: number, lat: number): PolityRow | undefined {
    let best: PolityRow | undefined;
    for (const r of this.now) if ((!best || r.area < best.area) && insideRow(r, lon, lat)) best = r;
    return best;
  }
}

/**
 * Where people lived at the time shown. A grid is a picture of the surface rather than rows at places, so
 * this one goes through the globe's shader, as a polity's territory does: its coasts are the field's, and it
 * costs nothing while the globe turns. What is here are the numbers, the map the shader reads, and the legend.
 */
export class PeopleLayer {
  /** the legend */
  readonly el: HTMLElement;
  file: PeopleFile | null = null;
  nx = 1;
  ny = 1;
  /** where each cell of the grid falls on the viewer's scale, 0 to 255, row 0 at the north: the shader's map */
  levels = new Uint8Array(1);
  /** how many people the cells hold at the time last worked out, and how many cells show on the scale */
  stats = { total: 0, lit: 0 };
  private now = new Float64Array(0);
  private drawnAt: number | null = null;
  private note: HTMLElement;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'people-legend';
    this.el.hidden = true;
    this.el.innerHTML = '<div class="pl-title"><span></span> <span class="badge basis-reconstruction">reconstruction</span></div><div class="pl-bar"></div><div class="pl-ticks"></div><div class="pl-note"></div>';
    this.note = this.el.querySelector('.pl-note')!;
  }

  setFile(f: PeopleFile): void {
    this.file = f;
    ({ nx: this.nx, ny: this.ny } = gridSize(f.res));
    this.levels = new Uint8Array(this.nx * this.ny);
    this.now = new Float64Array(f.cell.length);
    this.drawnAt = null;
    this.el.querySelector('.pl-title span')!.textContent = f.title;
    const ticks: string[] = [];
    for (let v = f.scale.lo; v <= f.scale.hi * 1.001; v *= 10) ticks.push(Number(v.toPrecision(3)).toLocaleString('en-US'));
    this.el.querySelector('.pl-ticks')!.innerHTML = ticks.map((t) => `<span>${t}</span>`).join('');
  }

  /** Is a time one of the grid's? */
  holds(t: number): boolean {
    return !!this.file && !!stepsAround(this.file.steps, t);
  }

  /** Work the cells out for a time, if it is a new one of the grid's: says whether the shader's map has changed. */
  update(t: number): boolean {
    const f = this.file;
    if (!f || t === this.drawnAt || !peopleAt(f, t, this.now)) return false;
    this.drawnAt = t;
    let total = 0;
    let lit = 0;
    for (let i = 0; i < this.now.length; i++) {
      const p = this.now[i];
      total += p;
      const level = f.land[i] > 0 ? levelOf(p / f.land[i], f.scale) : 0;
      if (level > 0) lit++;
      this.levels[f.cell[i]] = Math.round(level * 255);
    }
    this.stats = { total, lit };
    return true;
  }

  /** The legend, saying what it shows, or why nothing is drawn at this time. */
  legend(t: number): void {
    const f = this.file;
    if (!f) return;
    const text = this.holds(t)
      ? `People per km² of land, on today's land, from ${short(f.sourceRecord, f.source)}. Not a count: click a place for what it gives there.`
      : `Its grids run from ${stepName(f.steps[0])} to ${stepName(f.steps[f.steps.length - 1])}, so nothing is drawn at this time.`;
    if (this.note.textContent !== text) this.note.textContent = text;
  }

  /** What the grid gives for the cell at a point, at a time of the grid's. */
  here(lon: number, lat: number, t: number): PeopleHere | undefined {
    const f = this.file;
    const s = f && stepsAround(f.steps, t);
    if (!f || !s) return undefined;
    const c = cellAt(f, lon, lat);
    const n = f.cell.length;
    const at = (step: number) => (c.index < 0 ? 0 : f.people[step * n + c.index]);
    const [a, b] = [at(s.a), at(s.b)];
    return {
      t,
      south: 90 - (c.row + 1) * f.res,
      west: -180 + c.col * f.res,
      res: f.res,
      people: a + (b - a) * s.mix,
      land: c.index < 0 ? 0 : f.land[c.index],
      from: { step: f.steps[s.a], people: a },
      to: { step: f.steps[s.b], people: b },
      range: rangeAt(f.range, t),
      description: f.description,
      source: f.sourceRecord,
    };
  }
}
