// A living scene's generators, off the main thread: the ground once, and then for each view which cells it
// needs and who to draw at what detail. They are the same code as the build's, so what they make agrees with it
// within the tolerance of core/fingerprint.ts.
import type { Fingerprint } from '../../../core/fingerprint.ts';
import type { SceneSpec } from '../../../core/scene.ts';
import { FAST_BUDGET, FULL_BUDGET, SceneStream, type Batch, type LifeView, type ProtoMesh } from '../../../world/generators/life/stream.ts';
import type { PlanForm, SettlementPlan } from '../../../world/generators/people/settlement/v1.ts';

/** What a scene's people are, for its panel: the plan without its houses. */
export interface PeopleSummary {
  forms: PlanForm[];
  settlements: { pattern: string; houses: number; people: number; city?: string; tier: string; form: number; x: number; y: number }[];
  houses: number;
  drawn: number;
  expected: number;
  perHouse: number;
  style: SettlementPlan['style'];
  lifeway: SettlementPlan['lifeway'];
}

/** How a field system's plots are drawn: their side in metres, how much longer than wide, and the shader's code for their kind. */
export function fieldStyle(s: SettlementPlan['style']): { plot: number; aspect: number; kind: number } {
  const KIND: Record<string, [number, number]> = { blocks: [0, 1.5], strips: [1, 6], irregular: [2, 1.2], terraces: [3, 4], paddies: [4, 1.3], basins: [5, 2], raised: [6, 3], swidden: [7, 1.2], gardens: [8, 1.2], none: [0, 1] };
  const [kind, aspect] = KIND[s.kind] ?? [0, 1.5];
  return { plot: Math.sqrt(s.plot * 10000), aspect, kind };
}

export type ToLifeWorker = { type: 'init'; spec: SceneSpec; fast: boolean } | { type: 'view'; view: LifeView; serial: number } | { type: 'reset' };

export type FromLifeWorker =
  | { type: 'ground'; levels: { nx: number; ny: number; x0: number; y0: number; cell: number; z: Int16Array }[]; focus: [number, number]; toRiver: [number, number]; water: { vertices: Float32Array; indices: Uint32Array; flow: Float32Array }; waterLevel: number; mask: Uint8Array; maskSize: number; maskBox: [number, number, number, number]; print: Fingerprint; ms: number; people?: PeopleSummary; fields?: Uint8Array }
  | { type: 'mask'; mask: Uint8Array; maskSize: number; maskBox: [number, number, number, number]; fields?: Uint8Array }
  | { type: 'selection'; serial: number; batches: Batch[]; protos: ProtoMesh[]; instances: number; triangles: number; pending: number; groups: { taxon: number; at: [number, number]; base: number; top: number }[]; ms: number };

let stream: SceneStream | null = null;
const sent = new Set<number>();
const post = (m: FromLifeWorker, transfer: Transferable[]) => (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(m, transfer);

self.onmessage = (e: MessageEvent<ToLifeWorker>) => {
  const m = e.data;
  if (m.type === 'init') {
    const t0 = performance.now();
    stream = new SceneStream(m.spec, m.fast ? FAST_BUDGET : FULL_BUDGET);
    sent.clear();
    const print = stream.print();
    const { data, box } = stream.mask(512);
    const water = stream.water();
    const levels = stream.levels.map((l) => ({ nx: l.nx, ny: l.ny, x0: l.x0, y0: l.y0, cell: l.cell, z: (l.z as Int16Array).slice() }));
    const fields = stream.fields(512)?.data;
    const pl = stream.people;
    const people: PeopleSummary | undefined = pl && {
      forms: pl.forms,
      settlements: pl.settlements.map((x) => ({ pattern: x.pattern, houses: x.houses, people: Math.round(x.people), ...(x.city ? { city: x.city } : {}), tier: x.tier, form: x.form, x: Math.round(x.x), y: Math.round(x.y) })),
      houses: pl.houses.length,
      drawn: pl.drawn,
      expected: pl.expected,
      perHouse: pl.perHouse,
      style: pl.style,
      lifeway: pl.lifeway,
    };
    post({ type: 'ground', levels, focus: stream.plan.focus, toRiver: stream.plan.toRiver, water, waterLevel: stream.look.water, mask: data, maskSize: 512, maskBox: box, print, ms: performance.now() - t0, ...(people ? { people } : {}), ...(fields ? { fields } : {}) }, [data.buffer as ArrayBuffer, water.vertices.buffer as ArrayBuffer, water.indices.buffer as ArrayBuffer, water.flow.buffer as ArrayBuffer, ...levels.map((l) => l.z.buffer as ArrayBuffer), ...(fields ? [fields.buffer as ArrayBuffer] : [])]);
    // A finer picture of the ground, once there is something to look at.
    setTimeout(() => {
      if (!stream) return;
      const size = m.fast ? 1024 : 2048;
      const fine = stream.mask(size);
      const fineFields = stream.fields(size)?.data;
      post({ type: 'mask', mask: fine.data, maskSize: size, maskBox: fine.box, ...(fineFields ? { fields: fineFields } : {}) }, [fine.data.buffer as ArrayBuffer, ...(fineFields ? [fineFields.buffer as ArrayBuffer] : [])]);
    }, 0);
    return;
  }
  if (m.type === 'reset') {
    sent.clear();
    return;
  }
  if (!stream) return;
  const t0 = performance.now();
  const s = stream.select(m.view, sent, () => performance.now() - t0 < 28);
  const buffers: ArrayBuffer[] = [...s.batches.map((b) => b.data), ...s.protos.flatMap((p) => [p.vertices, p.indices.buffer as ArrayBuffer])];
  post({ type: 'selection', serial: m.serial, batches: s.batches, protos: s.protos, instances: s.instances, triangles: s.triangles, pending: s.pending, groups: s.groups, ms: performance.now() - t0 }, buffers);
};
