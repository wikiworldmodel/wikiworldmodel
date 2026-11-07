// Rivers and lakes as the build writes them (tools/world/src/build/rivers.ts) and the globe and a scene read them: a
// network of reaches on a grid of nodes, and keyframes that say where the sea stood, how much each reach carried and
// where lakes stood. A reach is drawn up to the sea of its keyframe; under a lake it is the lake.

/** One keyframe: arrays by their index in its file. */
export interface RiversKeyframe {
  ageMa: number;
  /** the sea's level, in the grid's metres: a node at or under it is the sea's */
  seaLevel: number;
  /** each reach's flow where it ends, m³/s: 0 where its water never gets there */
  q: number;
  /** the lakes: their nodes, concatenated; where each starts; its level; whether it spills */
  lakeNodes: number;
  lakeStart: number;
  lakeLevel: number;
  lakeSpills: number;
}

/** A network: its reaches, once, as nodes of a grid. */
export interface RiversNetworkHeader {
  format: 'lightworld-rivers-network@1';
  /** nodes `step` degrees apart from 90°N and 180°W, wrapping east */
  grid: { nx: number; ny: number; step: number };
  /** the age whose coordinates the nodes are on: 0 for today's ground */
  frameMa: number;
  reaches: number;
  /** each reach's nodes, upstream first, concatenated; where each starts */
  nodes: number;
  start: number;
  /** at each of those nodes: the area that drains through it, km², and its height, m */
  km2: number;
  z: number;
  /** each reach's Strahler order, and the reach it flows into (-1 for none) */
  order: number;
  into: number;
  /** each reach's plate, where the nodes ride plates */
  plate?: number;
}

/** A span of a network's keyframes. */
export interface RiversKeysHeader {
  format: 'lightworld-rivers-keys@1';
  keyframes: RiversKeyframe[];
}

/** A network and its keyframes, as the tile set lists them. */
export interface RiversSet {
  network: string;
  /** whether its ground is today's, held through its span: where the rivers Landsat saw may be held back with it */
  today?: boolean;
  chunks: { file: string; keyframesMa: number[] }[];
  frameMa: number;
  /** the span of the axis its keyframes answer for */
  span: [number, number];
  reaches: number;
}

/** Rivers as observed: segments of centreline, each with one width, in a box of longitude and latitude. */
export interface RiverWidthsHeader {
  format: 'lightworld-river-widths@1';
  /** west, south, east, north */
  box: [number, number, number, number];
  segments: number;
  /** where each segment's points start; the points, flat [lon, lat, …]; each one's width, m (NaN where none); its flag */
  start: number;
  xy: number;
  width: number;
  flag: number;
}

/** Observed rivers, read. */
export interface RiverWidths {
  start: Uint32Array;
  xy: Float32Array;
  width: Float32Array;
  /** 0 river, 1 lake or reservoir, 2 tidal river, 3 canal */
  flag: Uint8Array;
}

export const riverWidths = (h: RiverWidthsHeader, a: ArrayLike<unknown>[]): RiverWidths => ({ start: a[h.start] as Uint32Array, xy: a[h.xy] as Float32Array, width: a[h.width] as Float32Array, flag: a[h.flag] as Uint8Array });

/** Observed rivers, as the tile set lists them: tiles of `step` degrees by key (core/rivers.ts tileKey), and a thinned file for the globe. */
export interface ObservedRivers {
  field: string;
  title: string;
  source: string;
  credit?: string;
  /** the span of the axis it is evidence for; a scene may hold it back further, as a model, on today's ground */
  span: [number, number];
  step: number;
  tiles: Record<string, string>;
  globe: string;
}

/** The key of the tile of `step` degrees a point falls in. */
export const tileKey = (lon: number, lat: number, step: number) => `${Math.floor((Math.min(179.999, lon) + 180) / step)}_${Math.floor((90 - Math.max(-89.999, lat)) / step)}`;

/** The rivers and lakes, as the tile set lists them. */
export interface RiversInfo {
  field: string;
  title: string;
  description?: string;
  lakes: { field: string; title: string };
  model: string;
  /** the rivers field's parameters: how much must drain to a river, and the laws its channels are drawn by */
  params: Record<string, unknown>;
  sets: RiversSet[];
  /** rivers wider than 30 m as Landsat saw them, where a dataset has them */
  observed?: ObservedRivers;
}

/** A keyframe, read. */
export interface RiverKey {
  ageMa: number;
  seaLevel: number;
  q: Float32Array;
  lakeNodes: Int32Array;
  lakeStart: Uint32Array;
  lakeLevel: Float32Array;
  lakeSpills: Uint8Array;
}

/** A file of keyframes, read. */
export function riverKeys(h: RiversKeysHeader, a: ArrayLike<unknown>[]): RiverKey[] {
  return h.keyframes.map((k) => ({
    ageMa: k.ageMa,
    seaLevel: k.seaLevel,
    q: a[k.q] as Float32Array,
    lakeNodes: a[k.lakeNodes] as Int32Array,
    lakeStart: a[k.lakeStart] as Uint32Array,
    lakeLevel: a[k.lakeLevel] as Float32Array,
    lakeSpills: a[k.lakeSpills] as Uint8Array,
  }));
}

/** A network, read: its reaches, and what a keyframe says of them. */
export class RiverNet {
  readonly grid: RiversNetworkHeader['grid'];
  readonly frameMa: number;
  readonly count: number;
  readonly nodes: Int32Array;
  readonly start: Uint32Array;
  readonly km2: Float32Array;
  readonly z: Int16Array;
  readonly order: Uint8Array;
  readonly into: Int32Array;
  readonly plate?: Uint32Array;
  private lakeOf = new WeakMap<RiverKey, Map<number, number>>();

  constructor(h: RiversNetworkHeader, a: ArrayLike<unknown>[]) {
    this.grid = h.grid;
    this.frameMa = h.frameMa;
    this.count = h.reaches;
    this.nodes = a[h.nodes] as Int32Array;
    this.start = a[h.start] as Uint32Array;
    this.km2 = a[h.km2] as Float32Array;
    this.z = a[h.z] as Int16Array;
    this.order = a[h.order] as Uint8Array;
    this.into = a[h.into] as Int32Array;
    this.plate = h.plate !== undefined ? (a[h.plate] as Uint32Array) : undefined;
  }

  /** A node's latitude and longitude. */
  latLon(k: number): [number, number] {
    const g = this.grid;
    return [90 - Math.floor(k / g.nx) * g.step, -180 + (k % g.nx) * g.step];
  }

  /** The lake each node of a keyframe lies under. */
  lakes(key: RiverKey): Map<number, number> {
    let m = this.lakeOf.get(key);
    if (!m) {
      m = new Map();
      for (let l = 0; l + 1 < key.lakeStart.length; l++) for (let i = key.lakeStart[l]; i < key.lakeStart[l + 1]; i++) m.set(key.lakeNodes[i], l);
      this.lakeOf.set(key, m);
    }
    return m;
  }

  /** Whether the `j`th of all the reaches' nodes is a river's in a keyframe: above the sea, and under no lake. */
  wet(j: number, key: RiverKey): boolean {
    return this.z[j] > key.seaLevel && !this.lakes(key).has(this.nodes[j]);
  }

  /**
   * The flow at the `j`th of all the reaches' nodes, which is reach `i`'s, in a keyframe, m³/s: its end's flow, shared
   * out by the area each node drains, as if every part of its basin gave the same.
   */
  q(i: number, j: number, key: RiverKey): number {
    const end = key.q[i];
    if (!end) return 0;
    let last = this.start[i + 1] - 1;
    while (last > j && !this.wet(last, key)) last--;
    return (end * this.km2[j]) / Math.max(1e-6, this.km2[last]);
  }
}
