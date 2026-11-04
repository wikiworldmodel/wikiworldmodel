// A living scene cut into the city's cells, so that what is near is drawn finely and what is far
// coarsely, and the generators can run a cell at a time. Each taxon is one entity, so that a click
// names it, its record opens and every one of it lights up; its time comes from its record.
import { isPlant, type SceneFile } from '../../../core/scene.ts';
import { cellOf, type WaterMesh } from '../city/cells.ts';
import { GroundSampler, type GroundGridData } from '../city/ground.ts';
import { Mesh } from '../city/kit.ts';
import { hashString } from '../city/math.ts';
import { animal, HIP_SHARE, plant, POSE, type Stance } from './organisms.ts';
import { Land, scenePlan, type SceneParams, type ScenePlan } from './scene/v1.ts';

const TIMELESS = 2e7;

export const taxonEntity = (i: number) => i + 1;

/** The time a scene's shader sees: years from its slice, which a 32-bit float can hold finely. */
export const sceneTime = (t: number, slice: number) => t - slice;

export interface SceneLabel {
  taxon: number;
  at: [number, number];
  base: number;
  top: number;
}

export class SceneBuilder {
  readonly ground: GroundSampler;
  readonly plan: ScenePlan;
  private items = new Map<number, number[]>();
  private toneOf: number[];

  constructor(readonly file: SceneFile, grounds: GroundGridData[], plan?: ScenePlan) {
    this.ground = new GroundSampler(grounds);
    this.plan = plan ?? scenePlan(file, this.ground);
    const p = this.plan;
    for (let i = 0; i < p.count; i++) {
      const k = cellOf(p.place[i * 6], p.place[i * 6 + 1]);
      if (k < 0) continue;
      const l = this.items.get(k);
      if (l) l.push(i);
      else this.items.set(k, [i]);
    }
    // Each taxon has its own colour, which is the generator's: nothing says what colour they were.
    this.toneOf = file.taxa.map((t) => hashString(t.id) & 255);
  }

  cells(): number[] {
    return [...this.items.keys()].sort((a, b) => a - b);
  }

  /** When each taxon lived and what it rests on, for the renderer: years from the slice, basis, ground. */
  entities(): Float32Array {
    const f = this.file;
    const out = new Float32Array((f.taxa.length + 1) * 4);
    const clamp = (x: number | null | undefined, d: number) => (x === null || x === undefined || !Number.isFinite(x) ? d : Math.max(-TIMELESS, Math.min(TIMELESS, sceneTime(x, f.site.slice))));
    f.taxa.forEach((t, i) => {
      const k = taxonEntity(i) * 4;
      out[k] = clamp(t.time.start.best, -TIMELESS);
      out[k + 1] = clamp(t.time.end.best, TIMELESS);
      out[k + 2] = 3;
      out[k + 3] = f.site.water_level;
    });
    return out;
  }

  /** The stance the plan gives one animal. */
  private stance(i: number, detail: number): Stance {
    const p = this.plan;
    const t = this.file.taxa[p.taxon[i]];
    const size = p.place[i * 6 + 5];
    const L = t.length! * size;
    const shade = p.shade[i];
    const phase = p.phase[i];
    return {
      L,
      H: (t.hip ?? t.length! * (HIP_SHARE[t.plan] ?? 0.25)) * size,
      pose: p.pose[i],
      phase: phase / 256,
      sway: (phase / 255 - 0.5) * 0.22,
      detail,
      tint: (this.toneOf[p.taxon[i]] + (shade >> 3)) & 255,
      biped: t.posture === 'biped' || (t.posture === 'facultative-quadruped' && p.pose[i] !== POSE.graze && p.pose[i] !== POSE.drink && (shade & 1) === 1),
    };
  }

  /** The mesh of one cell, at a level of detail: 0 from afar, 1 close by. */
  build(key: number, detail: number): Mesh {
    const m = new Mesh(detail ? 65536 : 16384);
    const p = this.plan;
    const taxa = this.file.taxa;
    for (const i of this.items.get(key) ?? []) {
      const t = taxa[p.taxon[i]];
      const f = i * 6;
      m.place(p.place[f], p.place[f + 1], p.place[f + 2], p.place[f + 3], p.place[f + 4]);
      m.entity = taxonEntity(p.taxon[i]);
      if (isPlant(t.plan)) {
        const h = t.posture === 'floating' ? (this.file.generator.params as unknown as SceneParams).plants.mat_radius * p.place[f + 5] : t.height! * p.place[f + 5];
        plant(m, t.plan, t.posture, h, Math.imul(i + 1, 0x9e3779b1) >>> 0, detail, (this.toneOf[p.taxon[i]] + (p.shade[i] >> 2)) & 255);
      } else {
        // From afar, what is smaller than a pixel is left to the eye.
        if (!detail && t.length! < 0.6) continue;
        animal(m, t.plan, this.stance(i, detail));
      }
    }
    return m;
  }

  /** Where to name the animals: one place per group, over its first animal. */
  labels(): SceneLabel[] {
    const p = this.plan;
    const out: SceneLabel[] = [];
    for (let g = 0; g < p.groupTaxon.length; g++) {
      const k = p.groupTaxon[g];
      const t = this.file.taxa[k];
      const hip = t.hip ?? (t.length ?? 1) * (HIP_SHARE[t.plan] ?? 0.25);
      out.push({ taxon: k, at: [p.groupAt[g * 3], p.groupAt[g * 3 + 1]], base: p.groupAt[g * 3 + 2], top: p.groupAt[g * 3 + 2] + hip * 1.5 });
    }
    return out;
  }

  /** What the plan says the ground is, as an image: R canopy, G low plants, B bare sediment, A water. */
  mask(size: number, half: number): { data: Uint8Array; box: [number, number, number, number] } {
    const data = new Uint8Array(size * size * 4);
    const land = new Land(this.file, this.file.generator.params as unknown as SceneParams, this.ground);
    const scale = (half * 2) / size;
    for (let j = 0; j < size; j++) {
      const y = -half + (j + 0.5) * scale;
      for (let i = 0; i < size; i++) {
        const x = -half + (i + 0.5) * scale;
        land.at(x, y);
        const at = (j * size + i) * 4;
        if (land.water) {
          data[at + 3] = 255;
          continue;
        }
        data[at] = (land.canopy * 255) | 0;
        data[at + 1] = ((1 - land.canopy) * (1 - land.bare) * 255) | 0;
        data[at + 2] = (land.bare * 255) | 0;
      }
    }
    return { data, box: [-half, -half, half, half] };
  }

  /**
   * The water, as a sheet at its level over the invented plain: the ground stands above it except
   * where it is cut. It stops short of where the plain gives way to the land the field reconstructs,
   * which may lie lower.
   */
  water(): WaterMesh {
    const z = this.file.site.water_level;
    const reach = (this.file.generator.params as unknown as SceneParams).ground.blend[0] * 0.92;
    const n = 96;
    const verts = new Float32Array((n + 1) * (n + 1) * 3);
    const step = (reach * 2) / n;
    const half = reach;
    const kept: number[] = [];
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const k = (j * (n + 1) + i) * 3;
        verts[k] = -half + i * step;
        verts[k + 1] = -half + j * step;
        verts[k + 2] = z;
      }
    }
    for (let j = 0; j < n; j++) {
      const y = -half + (j + 0.5) * step;
      for (let i = 0; i < n; i++) {
        const x = -half + (i + 0.5) * step;
        if (x * x + y * y > reach * reach) continue;
        const a = j * (n + 1) + i;
        kept.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
      }
    }
    return { vertices: verts, indices: Uint32Array.from(kept) };
  }
}

