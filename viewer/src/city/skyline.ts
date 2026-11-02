// What stands in the way of an eye: every building's outline, as walls of its height, in buckets.
// A line of sight is blocked where it crosses a wall below the top of it, so a name can be shown
// only for what can be seen. Courts stay open: a line inside one crosses none of its walls.

import type { CityStructure } from '../../../core/city.ts';

const BUCKET = 64;
const FIELDS = 7;

/** How high a structure stands: as raised, or for one drawn along a line, as it is recorded or a guess. */
export const structureTop = (s: CityStructure, raised: number): number => raised || s.base + (s.height ?? (s.rank <= 1 ? 22 : 10));

/** Whether a structure stops the eye: not an open space, and not a road. */
const opaque = (s: CityStructure): boolean => !s.kind.startsWith('open/') && s.kind !== 'works/road';

export class Skyline {
  /** The city's structures, and the lots of its generated fabric for the years it is drawn. */
  static of(structures: CityStructure[], tops: ArrayLike<number>, lots: { offset: Int32Array; points: Float32Array; top: Float32Array; valid: [number, number] }): Skyline {
    const sky = new Skyline();
    structures.forEach((s, i) => {
      if (!opaque(s)) return;
      for (const r of s.rings) sky.add(r, structureTop(s, tops[i]), s.time.start.best ?? -Infinity, s.time.end.best ?? Infinity, i);
    });
    for (let i = 0; i < lots.top.length; i++) sky.add(lots.points.subarray(lots.offset[i], lots.offset[i + 1]), lots.top[i], lots.valid[0], lots.valid[1], -1);
    return sky;
  }

  /** x0, y0, x1, y1, top, start, end of each wall */
  private walls: number[] = [];
  private owners: number[] = [];
  private buckets = new Map<number, number[]>();
  private tallest = -Infinity;

  /** A closed ring of walls up to height `top`, standing from `start` to `end`. */
  add(ring: ArrayLike<number>, top: number, start: number, end: number, owner: number): void {
    const n = ring.length >> 1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x0 = ring[i * 2];
      const y0 = ring[i * 2 + 1];
      const x1 = ring[j * 2];
      const y1 = ring[j * 2 + 1];
      const w = this.owners.length;
      this.walls.push(x0, y0, x1, y1, top, start, end);
      this.owners.push(owner);
      const cx0 = Math.floor(Math.min(x0, x1) / BUCKET);
      const cx1 = Math.floor(Math.max(x0, x1) / BUCKET);
      const cy0 = Math.floor(Math.min(y0, y1) / BUCKET);
      const cy1 = Math.floor(Math.max(y0, y1) / BUCKET);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const key = cy * 65536 + cx;
          const b = this.buckets.get(key);
          if (b) b.push(w);
          else this.buckets.set(key, [w]);
        }
      }
    }
    if (top > this.tallest) this.tallest = top;
  }

  /** Whether something standing at time `t` cuts the line from the eye to a point, other than `owner` itself. */
  blocked(ex: number, ey: number, ez: number, tx: number, ty: number, tz: number, t: number, owner: number): boolean {
    // Only the part of the line lower than the tallest wall can be cut.
    let u0 = 0;
    let u1 = 1;
    if (ez > this.tallest && tz > this.tallest) return false;
    if (ez > this.tallest) u0 = (ez - this.tallest) / (ez - tz);
    else if (tz > this.tallest) u1 = (this.tallest - ez) / (tz - ez);
    const dx = tx - ex;
    const dy = ty - ey;
    const dz = tz - ez;
    const walls = this.walls;
    const hits = (bucket: number[]): boolean => {
      for (const w of bucket) {
        if (this.owners[w] === owner) continue;
        const f = w * FIELDS;
        if (walls[f + 5] > t || t > walls[f + 6]) continue;
        const ax = walls[f];
        const ay = walls[f + 1];
        const wx = walls[f + 2] - ax;
        const wy = walls[f + 3] - ay;
        const den = dx * wy - dy * wx;
        if (den === 0) continue;
        const u = ((ax - ex) * wy - (ay - ey) * wx) / den;
        if (u < u0 || u > u1) continue;
        const v = ((ax - ex) * dy - (ay - ey) * dx) / den;
        if (v < 0 || v > 1) continue;
        if (ez + dz * u < walls[f + 4]) return true;
      }
      return false;
    };
    // Bucket by bucket along the line.
    const x0 = ex + dx * u0;
    const y0 = ey + dy * u0;
    const lx = dx * (u1 - u0);
    const ly = dy * (u1 - u0);
    let cx = Math.floor(x0 / BUCKET);
    let cy = Math.floor(y0 / BUCKET);
    const endX = Math.floor((x0 + lx) / BUCKET);
    const endY = Math.floor((y0 + ly) / BUCKET);
    const sx = lx > 0 ? 1 : -1;
    const sy = ly > 0 ? 1 : -1;
    const stepX = lx !== 0 ? BUCKET / Math.abs(lx) : Infinity;
    const stepY = ly !== 0 ? BUCKET / Math.abs(ly) : Infinity;
    let nextX = lx !== 0 ? ((cx + (lx > 0 ? 1 : 0)) * BUCKET - x0) / lx : Infinity;
    let nextY = ly !== 0 ? ((cy + (ly > 0 ? 1 : 0)) * BUCKET - y0) / ly : Infinity;
    for (let guard = 0; guard < 4096; guard++) {
      const b = this.buckets.get(cy * 65536 + cx);
      if (b && hits(b)) return true;
      if (cx === endX && cy === endY) break;
      if (nextX < nextY) {
        cx += sx;
        nextX += stepX;
      } else {
        cy += sy;
        nextY += stepY;
      }
    }
    return false;
  }
}
