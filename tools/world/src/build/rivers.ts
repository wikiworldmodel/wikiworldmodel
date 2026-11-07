// The rivers and lakes of every time (field:earth/rivers, model:earth/drainage; docs/EIGHTH-SLICE.md): the water
// balance of each climate routed over the land of its time. For the glacial cycles that land is today's ground on the
// relief's grid, routed once down to the lowest sea of the span; each keyframe then has its own sea, which ends the
// rivers where it stands, and its own climate, which sets how much they carry and where lakes stand. Before them it is
// each PaleoDEM, routed on its own, with the climate run of its age.
//
// What is written is a network and its keyframes: the reaches once, as nodes of the grid, with the area each node drains,
// its height and its plate; then for each keyframe the sea level, each reach's flow and the lakes. A viewer draws a
// reach up to the sea of its keyframe, and a scene reads the reaches near a place.
import { encodeTile } from '../../../../core/container.ts';
import type { RiversKeyframe, RiversKeysHeader, RiversNetworkHeader, RiversSet } from '../../../../core/rivers.ts';
import { seaLevelAt, type SeaLevelRows } from '../../../../core/sealevel.ts';
import { fromMa } from '../../../../core/time.ts';
import { stableStringify } from '../util.ts';
import { flow, hollowsOf, reaches, route, seaAt, type Flow, type Hollows, type Lake, type NodeGrid, type Reach, type Routing } from './drainage.ts';

/** How the drainage model draws its rivers and lakes: the model's choices, from its record. */
export interface DrainageParams {
  /** a river is kept where at least this much drains through it, km²: on the relief's grid, and on the PaleoDEMs' */
  min_km2: number;
  deep_min_km2: number;
  /** a lake is kept where it covers at least this much, km² */
  min_lake_km2: number;
  /** a lake that spills is kept only where today's lakes cover at least this share of it */
  spill_overlap: number;
  /** before the climate of the last 120,000 years begins, a keyframe every this many years */
  older_step_yr: number;
}

/** The water a climate keyframe gives, on its own grid of nodes: runoff and a lake's net loss, mm in a year. */
export interface Water {
  ageMa: number;
  grid: { lon0: number; lat0: number; step: number; nx: number; ny: number };
  runoff: Float32Array;
  loss: Float32Array;
}

/** A climate grid's values at each node of another grid: straight between its four nodes, wrapping east. */
export function regrid(src: Float32Array, sg: Water['grid'], g: NodeGrid): Float32Array {
  const out = new Float32Array(g.nx * g.ny);
  for (let r = 0; r < g.ny; r++) {
    const lat = 90 - r * g.step;
    const fy = Math.min(sg.ny - 1.0001, Math.max(0, (sg.lat0 - lat) / sg.step));
    const j = Math.floor(fy);
    const v = fy - j;
    for (let c = 0; c < g.nx; c++) {
      const lon = -180 + c * g.step;
      const fx = (((lon - sg.lon0) / sg.step) % sg.nx + sg.nx) % sg.nx;
      const i = Math.floor(fx);
      const u = fx - i;
      const i1 = (i + 1) % sg.nx;
      const a = src[j * sg.nx + i];
      const b = src[j * sg.nx + i1];
      const d = src[(j + 1) * sg.nx + i];
      const e = src[(j + 1) * sg.nx + i1];
      out[r * g.nx + c] = (a * (1 - u) + b * u) * (1 - v) + (d * (1 - u) + e * u) * v;
    }
  }
  return out;
}

/** One network and the keyframes that share it. */
export interface RiverNetwork {
  grid: NodeGrid;
  frameMa: number;
  reaches: Reach[];
  /** per node of the grid: the area it drains, km², and its height, m */
  km2: Float32Array;
  z: ArrayLike<number>;
  plate?: (k: number) => number;
  /** today's lakes, as nodes, where the network is today's ground: a lake that spills is drawn only where they are */
  today?: Uint8Array;
  keyframes: { ageMa: number; seaLevel: number; flow: Flow }[];
}

const zeros = (n: number) => new Float32Array(n);

/** The network of a routed grid: every river node it has, with no lake and the lowest sea. */
function networkOf(z: ArrayLike<number>, g: NodeGrid, r: Routing, h: Hollows, minKm2: number): { reaches: Reach[]; km2: Float32Array } {
  const n = g.nx * g.ny;
  const dry = flow(z, g, r, h, zeros(n), zeros(n));
  return { reaches: reaches(r, dry, minKm2), km2: dry.km2 };
}

/**
 * The glacial cycles: today's ground routed down to the lowest sea of the stack, and a keyframe at each time given,
 * with the sea of that time and its water. `ocean` is today's ocean, from which the sea of each time floods.
 */
export function recentRivers(z: Float32Array, ocean: Uint8Array, g: NodeGrid, stack: SeaLevelRows, times: { ageMa: number; water: Water }[], p: DrainageParams, plate: (k: number) => number, today?: Uint8Array): RiverNetwork {
  const lowest = Math.min(...stack.map((row) => row[1]));
  const r = route(z, g, seaAt(z, g, ocean, lowest));
  const h = hollowsOf(z, g, r);
  const { reaches: rs, km2 } = networkOf(z, g, r, h, p.min_km2);
  const keyframes = times.map(({ ageMa, water }) => {
    const seaLevel = seaLevelAt(stack, fromMa(ageMa));
    const sea = seaAt(z, g, ocean, seaLevel);
    const f = flow(z, g, r, h, regrid(water.runoff, water.grid, g), regrid(water.loss, water.grid, g), sea);
    return { ageMa, seaLevel, flow: f };
  });
  return { grid: g, frameMa: 0, reaches: rs, km2, z, plate, today, keyframes };
}

/** A time of the deep past: its own ground, routed to its own sea, with the water of its climate. */
export function deepRivers(z: ArrayLike<number>, g: NodeGrid, isoline: number, ageMa: number, water: Water, p: DrainageParams, plate?: (k: number) => number): RiverNetwork {
  const n = g.nx * g.ny;
  const ocean = new Uint8Array(n);
  for (let k = 0; k < n; k++) ocean[k] = z[k] < isoline ? 1 : 0;
  const sea = seaAt(z, g, ocean, isoline);
  const r = route(z, g, sea);
  const h = hollowsOf(z, g, r);
  const { reaches: rs, km2 } = networkOf(z, g, r, h, p.deep_min_km2);
  const f = flow(z, g, r, h, regrid(water.runoff, water.grid, g), regrid(water.loss, water.grid, g), sea);
  return { grid: g, frameMa: ageMa, reaches: rs, km2, z, plate, keyframes: [{ ageMa, seaLevel: isoline, flow: f }] };
}

/**
 * The lakes a keyframe draws: those big enough, and of those that spill only the ones today's lakes lie in. A grid's
 * averages dam a narrow gorge, and would otherwise hold a lake behind it that never stood there; a lake that does not
 * spill is the climate's, and is drawn wherever it stands.
 */
function drawn(net: RiverNetwork, f: Flow, p: DrainageParams): Lake[] {
  return f.lakes.filter((l) => {
    if (l.km2 < p.min_lake_km2) return false;
    if (!l.spills) return true;
    if (!net.today) return false;
    let n = 0;
    for (const k of l.nodes) if (net.today[k]) n++;
    return n >= p.spill_overlap * l.nodes.length;
  });
}

/** Where a reach's water is when it ends: its last node that neither the sea nor a lake drawn covers. */
function lastDry(reach: Reach, f: Flow, under: Set<number>): number {
  for (let i = reach.nodes.length - 1; i >= 0; i--) {
    const k = reach.nodes[i];
    if (!f.sea[k] && !under.has(k)) return k;
  }
  return -1;
}

type Arr = Int32Array | Uint32Array | Float32Array | Int16Array | Uint8Array;

/** A network's reaches as one file (core/rivers.ts). */
export function encodeNetwork(net: RiverNetwork): Uint8Array {
  const arrays: Arr[] = [];
  const add = (a: Arr) => arrays.push(a) - 1;
  const index = new Map(net.reaches.map((x, i) => [x.id, i]));
  const start = new Uint32Array(net.reaches.length + 1);
  net.reaches.forEach((x, i) => (start[i + 1] = start[i] + x.nodes.length));
  const nodes = new Int32Array(start[net.reaches.length]);
  const km2 = new Float32Array(nodes.length);
  const z = new Int16Array(nodes.length);
  net.reaches.forEach((x, i) => {
    x.nodes.forEach((k, j) => {
      nodes[start[i] + j] = k;
      km2[start[i] + j] = net.km2[k];
      z[start[i] + j] = Math.max(-32768, Math.min(32767, Math.round(net.z[k])));
    });
  });
  const order = Uint8Array.from(net.reaches, (x) => x.order);
  const into = Int32Array.from(net.reaches, (x) => (x.into !== undefined ? index.get(x.into) ?? -1 : -1));
  const plate = net.plate ? Uint32Array.from(net.reaches, (x) => net.plate!(x.nodes[0])) : undefined;
  const header: RiversNetworkHeader = {
    format: 'lightworld-rivers-network@1',
    grid: net.grid,
    frameMa: net.frameMa,
    reaches: net.reaches.length,
    nodes: add(nodes),
    start: add(start),
    km2: add(km2),
    z: add(z),
    order: add(order),
    into: add(into),
    ...(plate ? { plate: add(plate) } : {}),
  };
  return encodeTile(header as unknown as Record<string, unknown>, arrays, stableStringify);
}

/** A span of a network's keyframes as one file: each reach's flow, and the lakes drawn. */
export function encodeKeyframes(net: RiverNetwork, keys: RiverNetwork['keyframes'], p: DrainageParams): Uint8Array {
  const arrays: Arr[] = [];
  const add = (a: Arr) => arrays.push(a) - 1;
  const keyframes: RiversKeyframe[] = keys.map((kf) => {
    const lakes = drawn(net, kf.flow, p);
    const under = new Set<number>();
    for (const l of lakes) for (const k of l.nodes) under.add(k);
    const q = Float32Array.from(net.reaches, (x) => {
      const k = lastDry(x, kf.flow, under);
      return k < 0 ? 0 : kf.flow.q[k];
    });
    const lakeStart = new Uint32Array(lakes.length + 1);
    lakes.forEach((l, i) => (lakeStart[i + 1] = lakeStart[i] + l.nodes.length));
    const lakeNodes = new Int32Array(lakeStart[lakes.length]);
    lakes.forEach((l, i) => lakeNodes.set(l.nodes, lakeStart[i]));
    return {
      ageMa: kf.ageMa,
      seaLevel: Math.round(kf.seaLevel * 10) / 10,
      q: add(q),
      lakeNodes: add(lakeNodes),
      lakeStart: add(lakeStart),
      lakeLevel: add(Float32Array.from(lakes, (l) => Math.round(l.level * 10) / 10)),
      lakeSpills: add(Uint8Array.from(lakes, (l) => (l.spills ? 1 : 0))),
    };
  });
  const header: RiversKeysHeader = { format: 'lightworld-rivers-keys@1', keyframes };
  return encodeTile(header as unknown as Record<string, unknown>, arrays, stableStringify);
}

/** A network's files: the network, then its keyframes a span at a time. */
export function riverFiles(net: RiverNetwork, base: string, p: DrainageParams, span: [number, number], today = false, chunk = 12): { files: Map<string, Uint8Array>; set: RiversSet } {
  const files = new Map<string, Uint8Array>();
  files.set(`${base}/network.lwt`, encodeNetwork(net));
  const chunks: RiversSet['chunks'] = [];
  for (let i = 0; i < net.keyframes.length; i += chunk) {
    const part = net.keyframes.slice(i, i + chunk);
    const file = `${base}/${chunks.length}.lwt`;
    files.set(file, encodeKeyframes(net, part, p));
    chunks.push({ file, keyframesMa: part.map((k) => k.ageMa) });
  }
  return { files, set: { network: `${base}/network.lwt`, ...(today ? { today } : {}), chunks, frameMa: net.frameMa, span, reaches: net.reaches.length } };
}
