// A living scene's generators, off the main thread: the ground once, and then for each view which cells it
// needs and who to draw at what detail. They are the same code as the build's, so what they make agrees with it
// within the tolerance of core/fingerprint.ts.
import type { Fingerprint } from '../../../core/fingerprint.ts';
import type { SceneSpec } from '../../../core/scene.ts';
import { FAST_BUDGET, FULL_BUDGET, SceneStream, type Batch, type LifeView, type ProtoMesh } from '../../../world/generators/life/stream.ts';

export type ToLifeWorker = { type: 'init'; spec: SceneSpec; fast: boolean } | { type: 'view'; view: LifeView; serial: number } | { type: 'reset' };

export type FromLifeWorker =
  | { type: 'ground'; levels: { nx: number; ny: number; x0: number; y0: number; cell: number; z: Int16Array }[]; focus: [number, number]; toRiver: [number, number]; water: { vertices: Float32Array; indices: Uint32Array; flow: Float32Array }; waterLevel: number; mask: Uint8Array; maskSize: number; maskBox: [number, number, number, number]; print: Fingerprint; ms: number }
  | { type: 'mask'; mask: Uint8Array; maskSize: number; maskBox: [number, number, number, number] }
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
    post({ type: 'ground', levels, focus: stream.plan.focus, toRiver: stream.plan.toRiver, water, waterLevel: stream.look.water, mask: data, maskSize: 512, maskBox: box, print, ms: performance.now() - t0 }, [data.buffer as ArrayBuffer, water.vertices.buffer as ArrayBuffer, water.indices.buffer as ArrayBuffer, water.flow.buffer as ArrayBuffer, ...levels.map((l) => l.z.buffer as ArrayBuffer)]);
    // A finer picture of the ground, once there is something to look at.
    setTimeout(() => {
      if (!stream) return;
      const size = m.fast ? 1024 : 2048;
      const fine = stream.mask(size);
      post({ type: 'mask', mask: fine.data, maskSize: size, maskBox: fine.box }, [fine.data.buffer as ArrayBuffer]);
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
