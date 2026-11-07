// Which climate paints the land at the time shown, and its two keyframes there: the finest climate field that covers the
// time, once the file holding those keyframes has come, and the deep past's runs until then or where no finer one covers
// it. A finer field comes in files of a span of its keyframes each (core/tileset.ts ClimateInfo), fetched as the time
// comes to them, and each file's keyframes go to the GPU under keys of their field and age.
import { decodeTile } from '../../core/container.ts';
import type { ClimateHeader } from '../../core/climate.ts';
import type { ClimateInfo } from '../../core/tileset.ts';
import { getBytes, type Build } from './data.ts';
import type { FieldRenderer } from './gl/field.ts';

/** A keyframe of a climate field: its key on the GPU, its age, and the age whose coordinates its nodes are on. */
export interface ClimateKey {
  key: string;
  ageMa: number;
  frameMa: number;
}

export interface ClimateAt {
  field: string;
  title: string;
  k0: ClimateKey;
  k1: ClimateKey;
  mix: number;
}

const keyOf = (field: string, ageMa: number) => `${field}|${ageMa}`;

/** The two keyframes of a sorted list of ages around an age, holding the youngest past the present. */
function bracket(ages: number[], age: number): [number, number, number] | null {
  if (!ages.length) return null;
  const a = Math.max(age, ages[0]);
  if (a > ages[ages.length - 1]) return null;
  const k1 = ages.find((k) => k >= a)!;
  const k0 = [...ages].reverse().find((k) => k <= a)!;
  return [k0, k1, k1 === k0 ? 0 : (a - k0) / (k1 - k0)];
}

export class Climates {
  /** the deep past's runs, from climate.lwt, each on the coordinates of its own age */
  private deep: { field: string; title: string; ages: number[] } | null = null;
  private loading = new Set<string>();
  private loaded = new Set<string>();
  /** what each loaded file of a finer field holds, by file */
  private frames = new Map<string, number>();

  constructor(private build: Build, private field: FieldRenderer, private changed: () => void) {}

  /** The deep past's runs, once climate.lwt has come. */
  setDeep(field: string, title: string, header: ClimateHeader, arrays: ArrayLike<unknown>[]): void {
    this.field.addClimate(header.grid, header.keyframes.map((k) => ({ key: keyOf(field, k.ageMa), values: arrays[k.values] as Uint8Array, plate: arrays[k.plate] as Uint16Array })));
    this.deep = { field, title, ages: header.keyframes.map((k) => k.ageMa).sort((a, b) => a - b) };
  }

  /** Whether a file a time needs is still on its way. */
  get busy(): boolean {
    return this.loading.size > 0;
  }

  private fetch(info: ClimateInfo, file: string): void {
    if (this.loaded.has(file) || this.loading.has(file)) return;
    this.loading.add(file);
    void getBytes(this.build.base + file)
      .then((data) => {
        const { header, arrays } = decodeTile<ClimateHeader>(data);
        this.field.addClimate(header.grid, header.keyframes.map((k) => ({ key: keyOf(info.field, k.ageMa), values: arrays[k.values] as Uint8Array, plate: arrays[k.plate] as Uint16Array })));
        for (const k of header.keyframes) this.frames.set(keyOf(info.field, k.ageMa), k.frameMa ?? k.ageMa);
        this.loaded.add(file);
        this.changed();
      })
      .catch((err) => console.error(`climate ${file}:`, err))
      .finally(() => this.loading.delete(file));
  }

  /** The climate that paints the land at an age, and its keyframes there; null where none covers it. */
  at(ageMa: number): ClimateAt | null {
    for (const info of this.build.tileset.climates ?? []) {
      const chunk = info.chunks.find((c) => ageMa >= Math.min(...c.keyframesMa) && ageMa <= Math.max(...c.keyframesMa)) ?? (ageMa < Math.min(...info.chunks[0].keyframesMa) ? info.chunks[0] : undefined);
      if (!chunk) continue;
      this.fetch(info, chunk.file);
      if (!this.loaded.has(chunk.file)) continue;
      const b = bracket([...chunk.keyframesMa].sort((x, y) => x - y), ageMa);
      if (!b) continue;
      const key = (a: number): ClimateKey => ({ key: keyOf(info.field, a), ageMa: a, frameMa: this.frames.get(keyOf(info.field, a)) ?? a });
      return { field: info.field, title: info.title, k0: key(b[0]), k1: key(b[1]), mix: b[2] };
    }
    if (!this.deep) return null;
    const b = bracket(this.deep.ages, ageMa);
    if (!b) return null;
    const key = (a: number): ClimateKey => ({ key: keyOf(this.deep!.field, a), ageMa: a, frameMa: a });
    return { field: this.deep.field, title: this.deep.title, k0: key(b[0]), k1: key(b[1]), mix: b[2] };
  }

  /** The span every climate covers, [older, younger] in Ma, as resolve reads it; null until one has come. */
  spanMa(): [number, number] | null {
    const ages = [...(this.deep?.ages ?? []), ...(this.build.tileset.climates ?? []).flatMap((c) => c.chunks.flatMap((k) => k.keyframesMa))];
    return ages.length && this.deep ? [Math.max(...ages), Math.min(...ages)] : null;
  }
}
