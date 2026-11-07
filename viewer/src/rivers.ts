// The rivers and lakes, as the viewer fetches them (core/rivers.ts): each set's network once, its keyframes a span at a
// time as the time shown comes to them, and the rivers Landsat saw a tile at a time, or thinned for the globe. Both
// the globe's layer and a scene read them from here, so each file comes once.
import { decodeTile } from '../../core/container.ts';
import { RiverNet, riverKeys, riverWidths, tileKey, type RiverKey, type RiversKeysHeader, type RiversNetworkHeader, type RiversSet, type RiverWidths, type RiverWidthsHeader } from '../../core/rivers.ts';
import { getBytes, type Build } from './data.ts';
import { keyFile, observedFiles } from '../../world/generators/life/water.ts';

export class Rivers {
  private nets = new Map<string, RiverNet>();
  private keys = new Map<string, RiverKey[]>();
  private widths = new Map<string, RiverWidths>();
  private loading = new Map<string, Promise<void>>();

  constructor(private build: Build, private changed: () => void = () => {}) {}

  get info() {
    return this.build.tileset.rivers;
  }

  /** Whether a file asked for is still on its way. */
  get busy(): boolean {
    return this.loading.size > 0;
  }

  private load(file: string, read: (data: ArrayBuffer) => void): Promise<void> {
    let p = this.loading.get(file);
    if (!p) {
      p = getBytes(this.build.base + file)
        .then((data) => {
          read(data);
          this.changed();
        })
        .catch((err) => console.error(`rivers ${file}:`, err))
        .finally(() => this.loading.delete(file));
      this.loading.set(file, p);
    }
    return p;
  }

  /** The set whose span holds a time, on the axis. */
  setAt(t: number): RiversSet | undefined {
    return this.info?.sets.find((s) => s.span[0] <= t && t < s.span[1]);
  }

  /** A set's network, if it has come; asked for if not. */
  net(set: RiversSet): RiverNet | undefined {
    const n = this.nets.get(set.network);
    if (!n) void this.load(set.network, (data) => {
      const { header, arrays } = decodeTile<RiversNetworkHeader>(data);
      this.nets.set(set.network, new RiverNet(header, arrays));
    });
    return n;
  }

  /** The keyframe of a set nearest an age, if its file has come; asked for if not. */
  key(set: RiversSet, ageMa: number): RiverKey | undefined {
    const best = keyFile(set, ageMa);
    if (!best) return undefined;
    const ks = this.keys.get(best.file);
    if (!ks) {
      void this.load(best.file, (data) => {
        const { header, arrays } = decodeTile<RiversKeysHeader>(data);
        this.keys.set(best!.file, riverKeys(header, arrays));
      });
      return undefined;
    }
    return ks[best.i];
  }

  private widthsOf(file: string): RiverWidths | undefined {
    const w = this.widths.get(file);
    if (!w) void this.load(file, (data) => {
      const { header, arrays } = decodeTile<RiverWidthsHeader>(data);
      this.widths.set(file, riverWidths(header, arrays));
    });
    return w;
  }

  /** The observed rivers, thinned for the globe. */
  observedGlobe(): RiverWidths | undefined {
    const o = this.info?.observed;
    return o ? this.widthsOf(o.globe) : undefined;
  }

  private seen?: Uint8Array;

  /** Whether Landsat saw a river in a place's 1° cell, as the build's coverage asks: false until the globe's file has come. */
  seenAt(lat: number, lon: number): boolean {
    if (!this.seen) {
      const w = this.observedGlobe();
      if (!w) return false;
      const seen = new Uint8Array(360 * 180);
      for (let i = 0; i + 1 < w.start.length; i++) {
        if (w.flag[i] === 1) continue;
        for (let k = w.start[i]; k < w.start[i + 1]; k++) seen[Math.min(179, Math.floor(90 - w.xy[k * 2 + 1])) * 360 + Math.min(359, Math.floor(w.xy[k * 2] + 180))] = 1;
      }
      this.seen = seen;
    }
    return !!this.seen[Math.min(179, Math.floor(90 - lat)) * 360 + Math.min(359, Math.floor(lon + 180))];
  }

  /** The observed rivers of the tile a place is in: undefined while it comes, null where the tile has none. */
  observedAt(lat: number, lon: number): RiverWidths | null | undefined {
    const o = this.info?.observed;
    if (!o) return null;
    const file = o.tiles[tileKey(lon, lat, o.step)];
    return file ? this.widthsOf(file) : null;
  }

  /** The observed rivers of every tile within `deg` of a place, once they have come. */
  async observedNear(lat: number, lon: number, deg?: number): Promise<RiverWidths[]> {
    const o = this.info?.observed;
    if (!o) return [];
    const files = observedFiles(o, lat, lon, deg);
    for (let i = 0; i < 50 && files.some((f) => !this.widthsOf(f)); i++) await Promise.all(this.loading.values());
    return files.map((f) => this.widths.get(f)).filter((w): w is RiverWidths => !!w);
  }

  /** Everything a place and time needs, once it has all come. */
  async ready(t: number, ageMa: number, lat: number, lon: number): Promise<void> {
    for (let i = 0; i < 50; i++) {
      const set = this.setAt(t);
      const net = set && this.net(set);
      const key = set && this.key(set, ageMa);
      const observed = this.observedAt(lat, lon);
      if ((!set || (net && key)) && observed !== undefined) return;
      await Promise.all(this.loading.values());
    }
  }
}
