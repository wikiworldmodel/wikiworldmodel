// A living scene on the GPU: the build's scene file and ground, with the generators in a worker as
// a city's are. Each taxon is one entity, dated by its record, so a taxon the time on the slider
// does not reach is not drawn; and the plan and one cell's mesh are hashed here to match the build's.
import type { CityStructure } from '../../../core/city.ts';
import { lookup, type Scenario } from '../../../core/scenario.ts';
import type { SceneFile, SceneTaxon } from '../../../core/scene.ts';
import type { SiteInfo } from '../../../core/tileset.ts';
import { cellBox } from '../../../world/generators/city/cells.ts';
import { GroundSampler } from '../../../world/generators/city/ground.ts';
import { sceneTime, taxonEntity } from '../../../world/generators/life/cells.ts';
import { getBytes, getJSON, type Build } from '../data.ts';
import type { GL } from '../gl/context.ts';
import { CellScene, sha256Hex } from './cellscene.ts';
import type { FromLifeWorker, ToLifeWorker } from './lifeworker.ts';

const TIMELESS = 2e7;

export class LifeScene extends CellScene {
  file!: SceneFile;
  /** one name per group of animals: labels show the nearest of each */
  private names: CityStructure[] = [];
  /** the mesh of one cell, hashed here and in the build, to the byte */
  cell = { expected: '', actual: null as string | null };
  /** how many organisms of each taxon the plan has */
  counts: Uint32Array = new Uint32Array(0);
  count = 0;
  private selected = 0;

  constructor(gl: GL, private build: Build, private info: SiteInfo, opts: { fast?: boolean } = {}) {
    super(gl, opts);
    this.renderer.wild = true;
  }

  get named(): CityStructure[] {
    return this.names;
  }

  protected override shaderTime(t: number): number {
    return sceneTime(t, this.file.site.slice);
  }

  async load(): Promise<void> {
    const b = this.build;
    this.file = await getJSON<SceneFile>(b.base + this.info.file);
    this.plan.expected = this.file.generator.outputSha256;
    this.cell.expected = this.file.generator.cell.sha256;
    const heights = await Promise.all(this.file.ground.map(async (g) => new Int16Array(await getBytes(b.base + g.url))));
    this.ground = new GroundSampler(this.file.ground.map((g, i) => ({ ...g, z: heights[i] })));
    this.renderer.setGround(this.file.ground, heights);
    await new Promise<void>((resolve, reject) => {
      this.worker = new Worker(new URL('./lifeworker.ts', import.meta.url), { type: 'module' });
      this.worker.onerror = (e) => reject(new Error(`the scene's generators failed: ${e.message}`));
      this.worker.onmessage = (e: MessageEvent<FromLifeWorker>) => {
        const m = e.data;
        if (m.type === 'plan') {
          this.renderer.setEntities(m.entities);
          this.renderer.setMask(m.mask, m.maskSize, m.maskBox);
          this.renderer.setWater(m.water.vertices, m.water.indices, this.file.site.water_level);
          this.count = m.count;
          this.counts = m.counts;
          const taxa = this.file.taxa;
          this.names = m.labels.map((l) => {
            const t = taxa[l.taxon];
            return { id: t.id, label: t.label, kind: 'taxon', form: { type: 'generic' }, rings: [], at: l.at, base: l.base, time: t.time, basis: 'procedural', curated: true, rank: (t.length ?? 0) >= 2 ? 2 : 3 };
          });
          this.tops = Float32Array.from(m.labels, (l) => l.top);
          for (const key of m.cells) this.cells.set(key, { key, box: cellBox(key), asked: [false, false], usedAt: 0 });
          void sha256Hex(m.bytes).then((h) => {
            this.plan.actual = h;
            if (h !== this.plan.expected) console.error(`the scene generator's plan differs from the build's: ${h} vs ${this.plan.expected}`);
            this.onChange();
          });
          void sha256Hex(m.cell).then((h) => {
            this.cell.actual = h;
            if (h !== this.cell.expected) console.error(`the scene generator's mesh differs from the build's: ${h} vs ${this.cell.expected}`);
            this.onChange();
          });
          this.ready = true;
          resolve();
          this.onChange();
        } else this.received(m);
      };
      const msg: ToLifeWorker = { type: 'init', file: this.file, heights };
      this.worker.postMessage(msg);
    });
  }

  /** What is at a screen position: a taxon, or nothing. */
  pick(x: number, y: number): { taxon?: SceneTaxon } {
    const e = this.renderer.pick(x, y);
    return e ? { taxon: this.file.taxa[e - 1] } : {};
  }

  /** Date the taxa as a scenario does: a competing claim for a first appearance moves them. */
  setScenario(s: Scenario): void {
    if (!this.ready) return;
    const clamp = (x: number | null, d: number) => (x === null || !Number.isFinite(x) ? d : Math.max(-TIMELESS, Math.min(TIMELESS, sceneTime(x, this.file.site.slice))));
    this.file.taxa.forEach((t, i) => {
      if (!t.variants) return;
      const v = lookup(t.variants, s, t.time);
      this.renderer.setEntityTime(taxonEntity(i), clamp(v.start.best, -TIMELESS), clamp(v.end.best, TIMELESS));
    });
  }

  /** Light up every one of the taxon whose record is open. */
  select(id: string | null): void {
    if (!this.ready) return;
    if (this.selected) this.renderer.setEntityFlags(this.selected, 3);
    this.selected = 0;
    if (!id) return;
    const i = this.file.taxa.findIndex((t) => t.id === id);
    if (i >= 0) {
      this.selected = taxonEntity(i);
      this.renderer.setEntityFlags(this.selected, 3 + 8);
    }
  }

  /** The scene's taxon of a record, if it is drawn here. */
  taxonOf(id: string): SceneTaxon | undefined {
    return this.file.taxa.find((t) => t.id === id);
  }
}
