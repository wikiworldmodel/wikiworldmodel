// Tile streaming: which tiles the view needs (frustum × time × LOD), loading them, keeping
// the coarse parent as a fallback, and prefetching neighbours in time.
//
// A tile carries every keyframe needed inside its time span, so scrubbing within the span
// needs nothing new; the neighbouring spans are fetched ahead of time.
import { decodeTile } from '../../core/container.ts';
import { unitVector } from '../../core/quat.ts';
import type { TileHeader, TileRef } from '../../core/tileset.ts';
import { getBytes, type Build } from './data.ts';

export interface LoadedTile {
  ref: TileRef;
  header: TileHeader;
  keyframes: { ageMa: number; elev: Int16Array; plate: Uint16Array }[];
  lastUsed: number;
}

/** Below this camera distance (Earth radii) the finer level is used for visible cells. */
export const LOD1_DISTANCE = 5;
const MAX_CONCURRENT = 4;
const CACHE_BYTES = 160e6;

export class TileManager {
  readonly loaded = new Map<string, LoadedTile>();
  private inflight = new Set<string>();
  private queue: TileRef[] = [];
  private frame = 0;
  private lastT = Number.NaN;
  onLoad: (t: LoadedTile) => void = () => {};
  onEvict: (t: LoadedTile) => void = () => {};

  constructor(private build: Build) {}

  get busy(): boolean {
    return this.inflight.size > 0 || this.queue.length > 0;
  }

  private spanOf(lod: number, t: number): TileRef[] {
    return this.build.tileset.tiles.filter((r) => r.lod === lod && r.time[0] <= t && t <= r.time[1]);
  }

  private bins(lod: number): [number, number][] {
    const spans = new Map<string, [number, number]>();
    for (const r of this.build.tileset.tiles) if (r.lod === lod) spans.set(`${r.time[0]}`, r.time);
    return [...spans.values()].sort((a, b) => a[0] - b[0]);
  }

  private visible(ref: TileRef, eye: [number, number, number]): boolean {
    const [w, s, e, n] = ref.bbox;
    const d = Math.hypot(...eye);
    const dir = eye.map((c) => c / d);
    // Cells move a few degrees between keyframes, so test with a margin past the horizon.
    const horizon = 1 / d - 0.15;
    for (const lat of [s, (s + n) / 2, n]) {
      for (const lon of [w, (w + e) / 2, e]) {
        const p = unitVector(Math.max(-89.9, Math.min(89.9, lat)), lon);
        if (p[0] * dir[0] + p[1] * dir[1] + p[2] * dir[2] > horizon) return true;
      }
    }
    return false;
  }

  /**
   * The tiles to draw for time `t` (astronomical year) and camera position `eye`, coarse
   * first. Missing tiles are requested; their loaded parents stand in meanwhile.
   */
  update(t: number, eye: [number, number, number]): LoadedTile[] {
    this.frame++;
    const want: TileRef[] = [];
    const lod0 = this.spanOf(0, t);
    want.push(...lod0);
    const dist = Math.hypot(...eye);
    if (dist < LOD1_DISTANCE) want.push(...this.spanOf(1, t).filter((r) => this.visible(r, eye)));
    // Prefetch: neighbouring spans in time, at the levels in use, nearest first.
    const dir = Number.isNaN(this.lastT) || t === this.lastT ? 0 : Math.sign(t - this.lastT);
    this.lastT = t;
    const prefetch: TileRef[] = [];
    for (const lod of dist < LOD1_DISTANCE ? [0, 1] : [0]) {
      const bins = this.bins(lod);
      const i = bins.findIndex((b) => b[0] <= t && t <= b[1]);
      const order = dir >= 0 ? [i + 1, i - 1] : [i - 1, i + 1];
      for (const j of order) {
        const b = bins[j];
        if (!b) continue;
        const mid = (b[0] + b[1]) / 2;
        for (const r of this.spanOf(lod, mid)) if (lod === 0 || this.visible(r, eye)) prefetch.push(r);
      }
    }
    for (const r of [...want, ...prefetch]) this.request(r);
    const out: LoadedTile[] = [];
    for (const r of want) {
      const l = this.loaded.get(r.id);
      if (l) {
        l.lastUsed = this.frame;
        out.push(l);
      }
    }
    for (const r of prefetch) {
      const l = this.loaded.get(r.id);
      if (l) l.lastUsed = this.frame;
    }
    this.evict();
    return out.sort((a, b) => a.ref.lod - b.ref.lod);
  }

  private request(r: TileRef): void {
    if (this.loaded.has(r.id) || this.inflight.has(r.id) || this.queue.some((q) => q.id === r.id)) return;
    this.queue.push(r);
    this.pump();
  }

  private pump(): void {
    while (this.inflight.size < MAX_CONCURRENT && this.queue.length) {
      const r = this.queue.shift()!;
      this.inflight.add(r.id);
      getBytes(this.build.base + r.url)
        .then((buf) => {
          const { header, arrays } = decodeTile<TileHeader>(buf);
          const keyframes = (header.field?.keyframes ?? []).map((k) => ({
            ageMa: k.ageMa,
            elev: arrays[k.elev] as Int16Array,
            plate: arrays[k.plate] as Uint16Array,
          }));
          const tile: LoadedTile = { ref: r, header, keyframes, lastUsed: this.frame };
          this.loaded.set(r.id, tile);
          this.onLoad(tile);
        })
        .catch((err) => console.error(`tile ${r.id}:`, err))
        .finally(() => {
          this.inflight.delete(r.id);
          this.pump();
        });
    }
  }

  private evict(): void {
    let total = 0;
    for (const l of this.loaded.values()) total += l.ref.bytes;
    if (total <= CACHE_BYTES) return;
    const old = [...this.loaded.values()].filter((l) => l.lastUsed < this.frame).sort((a, b) => a.lastUsed - b.lastUsed);
    for (const l of old) {
      if (total <= CACHE_BYTES) break;
      this.loaded.delete(l.ref.id);
      total -= l.ref.bytes;
      this.onEvict(l);
    }
  }
}
