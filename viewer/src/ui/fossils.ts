// The fossils of a chosen group, lit up on the globe: each place a dot where its plate has it at the
// time shown, bright if a fossil there could be from about this time, faint if not. A formation has
// thousands of rows and they are not records, so this draws on a canvas and needs no element for each.
import { rotate, unitVector, type Quat } from '../../../core/quat.ts';
import { fromMa, toMa } from '../../../core/time.ts';
import type { TreeFile } from '../../../core/tree.ts';
import type { Camera } from '../camera.ts';
import type { V3 } from '../mat.ts';

export class FossilLayer {
  readonly el: HTMLCanvasElement;
  /** what is lit: places, each with how many rows and when */
  private places: { lat: number; lon: number; plate: number; rows: [number, number][] }[] = [];

  constructor() {
    this.el = document.createElement('canvas');
    this.el.className = 'fossil-layer';
    this.el.hidden = true;
  }

  get count(): number {
    return this.places.reduce((n, p) => n + p.rows.length, 0);
  }

  /** The times of the rows lit, for the time control. */
  times(): number[] {
    const set = new Set<number>();
    for (const p of this.places) for (const [a, b] of p.rows) set.add(fromMa((a + b) / 2));
    return [...set].sort((x, y) => x - y);
  }

  /** Which nodes of the tree are lit. */
  set(file: TreeFile | null, nodes: ReadonlySet<number> | null): void {
    this.places = [];
    if (!file || !nodes) return;
    for (const f of file.fossils) {
      const by = new Map<number, [number, number][]>();
      for (const [taxon, coll, max, min] of f.rows) {
        if (!nodes.has(taxon)) continue;
        const l = by.get(coll);
        if (l) l.push([max, min]);
        else by.set(coll, [[max, min]]);
      }
      for (const [coll, rows] of by) this.places.push({ lat: f.collections[coll][0], lon: f.collections[coll][1], plate: f.plate, rows });
    }
  }

  update(camera: Camera, t: number, width: number, height: number, plateRotation: (plate: number) => Quat, placed: (plate: number) => boolean): void {
    this.el.hidden = !this.places.length;
    if (!this.places.length) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.el.width !== width * dpr || this.el.height !== height * dpr) {
      this.el.width = width * dpr;
      this.el.height = height * dpr;
    }
    const g = this.el.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const age = toMa(t);
    for (const p of this.places) {
      if (!placed(p.plate)) continue;
      const q = plateRotation(p.plate);
      const s = camera.project(rotate(q, unitVector(p.lat, p.lon)) as V3);
      if (!s.visible) continue;
      const now = p.rows.some(([max, min]) => age <= max && age >= min);
      g.fillStyle = now ? 'rgba(255, 196, 92, 0.95)' : 'rgba(255, 196, 92, 0.3)';
      g.beginPath();
      g.arc(s.x, s.y, now ? 2.5 + Math.min(2.5, Math.log2(p.rows.length) * 0.6) : 2, 0, 2 * Math.PI);
      g.fill();
    }
  }
}
