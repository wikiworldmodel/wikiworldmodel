// A living scene's generators, off the main thread: the plan once, then a cell's mesh at a time.
// They are the same code as the build's, so what they make hashes the same.
import type { SceneFile } from '../../../core/scene.ts';
import { SceneBuilder, type SceneLabel } from '../../../world/generators/life/cells.ts';
import { planBytes } from '../../../world/generators/life/scene/v1.ts';
import type { CellMessage } from './cellscene.ts';

export type ToLifeWorker = { type: 'init'; file: SceneFile; heights: Int16Array[] } | { type: 'cell'; key: number; detail: number; serial: number };

export type FromLifeWorker =
  | { type: 'plan'; bytes: Uint8Array; cell: Uint8Array; cells: number[]; entities: Float32Array; mask: Uint8Array; maskSize: number; maskBox: [number, number, number, number]; water: { vertices: Float32Array; indices: Uint32Array }; labels: SceneLabel[]; count: number; counts: Uint32Array }
  | CellMessage;

let builder: SceneBuilder | null = null;
const post = (m: FromLifeWorker, transfer: Transferable[]) => (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(m, transfer);

const MASK_SIZE = 2048;
const MASK_HALF = 16000;

self.onmessage = (e: MessageEvent<ToLifeWorker>) => {
  const m = e.data;
  if (m.type === 'init') {
    builder = new SceneBuilder(m.file, m.file.ground.map((g, i) => ({ ...g, z: m.heights[i] })));
    const entities = builder.entities();
    const { data, box } = builder.mask(MASK_SIZE, MASK_HALF);
    const water = builder.water();
    const bytes = planBytes(builder.plan).slice();
    const { key, detail } = m.file.generator.cell;
    const sample = builder.build(key, detail).arrays();
    const cell = new Uint8Array(sample.vertices.byteLength + sample.indices.byteLength);
    cell.set(new Uint8Array(sample.vertices), 0);
    cell.set(new Uint8Array(sample.indices.buffer, sample.indices.byteOffset, sample.indices.byteLength), sample.vertices.byteLength);
    const counts = new Uint32Array(m.file.taxa.length);
    for (const t of builder.plan.taxon) counts[t]++;
    post(
      { type: 'plan', bytes, cell, cells: builder.cells(), entities, mask: data, maskSize: MASK_SIZE, maskBox: box, water, labels: builder.labels(), count: builder.plan.count, counts },
      [bytes.buffer as ArrayBuffer, cell.buffer as ArrayBuffer, entities.buffer as ArrayBuffer, data.buffer as ArrayBuffer, water.vertices.buffer as ArrayBuffer, water.indices.buffer as ArrayBuffer, counts.buffer as ArrayBuffer],
    );
    return;
  }
  if (!builder) return;
  const t0 = performance.now();
  const mesh = builder.build(m.key, m.detail);
  const { vertices, indices } = mesh.arrays();
  post({ type: 'cell', key: m.key, detail: m.detail, serial: m.serial, vertices, indices, ms: performance.now() - t0 }, [vertices, indices.buffer as ArrayBuffer]);
};
