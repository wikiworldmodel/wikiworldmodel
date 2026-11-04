// A city on the GPU: it loads the build's city file and ground, starts the generators in a worker,
// and keeps each cell's mesh at the detail its distance calls for, nearest first.
import { type CityFile, type CityStructure } from '../../../core/city.ts';
import { lookup, type Scenario } from '../../../core/scenario.ts';
import { cellBox, structureEntity } from '../../../world/generators/city/cells.ts';
import { GroundSampler } from '../../../world/generators/city/ground.ts';
import { getBytes, getJSON, type Build } from '../data.ts';
import type { GL } from '../gl/context.ts';
import { CellScene, sha256Hex } from './cellscene.ts';
import { Skyline } from './skyline.ts';
import type { FromWorker, ToWorker } from './worker.ts';

export class CityScene extends CellScene {
  file!: CityFile;
  lots = 0;
  lotEntity = 0;
  treeEntity = 0;
  crowdEntity = 0;
  lotRegion: Uint8Array = new Uint8Array(0);
  lotType: Uint8Array = new Uint8Array(0);
  private selected = 0;

  constructor(gl: GL, private build: Build, private path: string, opts: { fast?: boolean } = {}) {
    super(gl, opts);
  }

  /** What the labels name. */
  get named(): CityStructure[] {
    return this.file.structures;
  }

  async load(): Promise<void> {
    const b = this.build;
    this.file = await getJSON<CityFile>(b.base + this.path);
    this.plan.expected = this.file.fabric.outputSha256;
    const heights = await Promise.all(this.file.ground.map(async (g) => new Int16Array(await getBytes(b.base + g.url))));
    this.ground = new GroundSampler(this.file.ground.map((g, i) => ({ ...g, z: heights[i] })));
    this.renderer.setGround(this.file.ground, heights);
    await new Promise<void>((resolve, reject) => {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker.onerror = (e) => reject(new Error(`the city's generators failed: ${e.message}`));
      this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data;
        if (m.type === 'plan') {
          this.renderer.setEntities(m.entities);
          this.renderer.setMask(m.mask, m.maskSize, m.maskBox);
          this.renderer.setWater(m.water.vertices, m.water.indices, this.file.site.water_level);
          this.lots = m.lots;
          this.lotEntity = m.lotEntity;
          this.treeEntity = m.treeEntity;
          this.crowdEntity = m.crowdEntity;
          this.lotRegion = m.lotRegion;
          this.lotType = m.lotType;
          const valid = (this.file.fabric.params as { valid?: [number, number] }).valid ?? [-Infinity, Infinity];
          this.tops = m.tops;
          this.skyline = Skyline.of(this.file.structures, m.tops, { offset: m.lotOffset, points: m.lotPoints, top: m.lotTop, valid });
          for (const key of m.cells) this.cells.set(key, { key, box: cellBox(key), asked: [false, false], usedAt: 0 });
          void sha256Hex(m.bytes).then((h) => {
            this.plan.actual = h;
            if (h !== this.plan.expected) console.error(`the fabric generator's plan differs from the build's: ${h} vs ${this.plan.expected}`);
          });
          this.ready = true;
          resolve();
          this.onChange();
        } else this.received(m);
      };
      const msg: ToWorker = { type: 'init', city: this.file, levels: this.file.ground, heights };
      this.worker.postMessage(msg);
    });
  }

  /** What is at a screen position: a structure, a generated building, a tree, or nothing. */
  pick(x: number, y: number): { structure?: CityStructure; lot?: number; tree?: boolean; crowd?: boolean } {
    const e = this.renderer.pick(x, y);
    if (!e) return {};
    if (e === this.crowdEntity) return { crowd: true };
    if (e === this.treeEntity) return { tree: true };
    if (e >= this.lotEntity) return { lot: e - this.lotEntity };
    return { structure: this.file.structures[e - 1] };
  }

  /** Date the structures as a scenario does: a competing claim for a date moves the building. */
  setScenario(s: Scenario): void {
    if (!this.ready) return;
    const clamp = (x: number | null, d: number) => (x === null || !Number.isFinite(x) ? d : Math.max(-1e5, Math.min(1e5, x)));
    this.file.structures.forEach((st, i) => {
      if (!st.variants) return;
      const t = lookup(st.variants, s, st.time);
      this.renderer.setEntityTime(structureEntity(i), clamp(t.start.best, -1e5), clamp(t.end.best, 1e5));
    });
  }

  /** Mark the structure whose record is open. */
  select(id: string | null): void {
    if (!this.ready) return;
    const flagsOf = (i: number) => ({ evidence: 0, reconstruction: 1, projection: 2, procedural: 3 })[this.file.structures[i].basis] ?? 1;
    if (this.selected) this.renderer.setEntityFlags(this.selected, flagsOf(this.selected - 1));
    this.selected = 0;
    if (!id) return;
    const i = this.file.structures.findIndex((s) => s.id === id);
    if (i >= 0) {
      this.selected = structureEntity(i);
      this.renderer.setEntityFlags(this.selected, flagsOf(i) + 8);
    }
  }
}

