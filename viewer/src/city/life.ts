// A living scene on the GPU. A worker makes the ground once, and for each view which cells it needs and who to
// draw; each kind of mesh goes up once, and everyone drawn with it is a few numbers. What it costs depends on the
// screen. Each taxon is one entity, dated by its rows or its record, so that a taxon the time on the slider does
// not reach is not drawn; and the ground, one cell and one mesh are hashed here, to match the build's where it has one.
import type { CityStructure } from '../../../core/city.ts';
import { printCheck, settlePrint, type Fingerprint, type PrintCheck } from '../../../core/fingerprint.ts';
import { lookup, type Scenario } from '../../../core/scenario.ts';
import type { LivingTaxon, SceneSpec } from '../../../core/scene.ts';
import { GroundSampler } from '../../../world/generators/city/ground.ts';
import { placeLook, type LivingParams } from '../../../world/generators/life/scene/v5.ts';
import { snowOf } from '../../../world/generators/life/climate.ts';
import { declination, MID_DAY } from '../../../core/water.ts';
import { protoParts } from '../../../world/generators/life/stream.ts';
import { CityRenderer, type CityFrame } from '../gl/city.ts';
import type { GL } from '../gl/context.ts';
import type { V3 } from '../mat.ts';
import type { FromLifeWorker, ToLifeWorker } from './lifeworker.ts';
import { Skyline } from './skyline.ts';
import type { LocalView } from './view.ts';

const TIMELESS = 2e7;

/** One renderer for all of a viewer's living scenes: a new place should not compile its shaders again. */
const renderers = new WeakMap<GL, CityRenderer>();
/** Which scene has the renderer now. */
const owners = new WeakMap<CityRenderer, LifeScene>();
function rendererFor(gl: GL, fast: boolean): CityRenderer {
  let r = renderers.get(gl);
  if (!r) {
    r = new CityRenderer(gl, { fast });
    r.wild = true;
    renderers.set(gl, r);
  }
  return r;
}

/** What a camera or a name stands on on land: the ground, or the top of the sea over it. In a scene of the sea, the ground. */
class SurfaceSampler extends GroundSampler {
  override at(x: number, y: number): number {
    const z = super.at(x, y);
    return z > 0 ? z : 0;
  }
}

export class LifeScene {
  readonly renderer: CityRenderer;
  ground!: GroundSampler;
  ready = false;
  /** the ground, a cell and a mesh, as fingerprints made here and by the build if it was there */
  plan: PrintCheck = printCheck();
  skyline = new Skyline();
  tops: Float32Array = new Float32Array(0);
  private names: CityStructure[] = [];
  /** which names are new: labels are remade only when they change */
  labelSerial = 0;
  spec!: SceneSpec;
  /** the sun's declination in the scene's month, radians, where it has one */
  get declination(): number | undefined {
    const c = this.spec?.climate;
    return c ? declination(MID_DAY[c.month - 1], c.water) : undefined;
  }
  focus: [number, number] = [0, 0];
  toRiver: [number, number] = [0, 1];
  waterLevel = 0;
  onChange: () => void = () => {};
  /** what the last view drew */
  last = { instances: 0, triangles: 0, meshes: 0, pending: 0, ms: 0 };
  /** how long the ground took, in ms */
  groundMs = 0;
  private worker: Worker | null = null;
  private selected = 0;
  private waiting = false;
  private lastSent: LocalView | null = null;
  private serial = 0;
  private want: LocalView | null = null;
  private active = false;
  private wasActive = false;

  /**
   * Whether the scene is of the sea, as its generator says of its place: then its floor is drawn at its depth under the
   * water, and a visitor may go down to it.
   */
  readonly sea: boolean;

  constructor(gl: GL, source: SceneSpec, expected: Fingerprint | null, private opts: { fast?: boolean } = {}) {
    this.spec = source;
    this.plan.expected = expected;
    this.renderer = rendererFor(gl, !!opts.fast);
    this.sea = placeLook(source).sea;
  }

  get named(): CityStructure[] {
    return this.names;
  }

  get settled(): boolean {
    return this.ready && !this.waiting && this.last.pending === 0 && !this.moved();
  }

  /** Make the ground, and be ready to take over the renderer. */
  async load(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.worker = new Worker(new URL('./lifeworker.ts', import.meta.url), { type: 'module' });
      this.worker.onerror = (e) => reject(new Error(`the scene's generators failed: ${e.message} (${e.filename}:${e.lineno})`));
      this.worker.onmessage = (e: MessageEvent<FromLifeWorker>) => {
        const m = e.data;
        if (m.type === 'ground') {
          this.groundData = m;
          this.groundMs = m.ms;
          this.ground = this.sea ? new GroundSampler(m.levels) : new SurfaceSampler(m.levels);
          this.focus = m.focus;
          this.toRiver = m.toRiver;
          this.waterLevel = m.waterLevel;
          const problems = settlePrint(this.plan, m.print);
          if (problems.length) console.error(`the scene's generator made something different from the build: ${problems.join('; ')}`);
          this.ready = true;
          resolve();
          this.onChange();
        } else if (m.type === 'mask') {
          this.maskData = m;
          if (this.active) this.renderer.setMask(m.mask, m.maskSize, m.maskBox);
          this.onChange();
        } else this.selection(m);
      };
      const msg: ToLifeWorker = { type: 'init', spec: this.spec, fast: !!this.opts.fast };
      this.worker.postMessage(msg);
    });
  }

  private groundData: Extract<FromLifeWorker, { type: 'ground' }> | null = null;
  private maskData: Extract<FromLifeWorker, { type: 'mask' }> | null = null;
  private held: Extract<FromLifeWorker, { type: 'selection' }>[] = [];

  /** This scene takes over the renderer: its ground, its colours and whatever has been made for it. */
  activate(): void {
    if (this.active || !this.groundData) return;
    const r = this.renderer;
    const before = owners.get(r);
    if (before && before !== this) before.active = false;
    owners.set(r, this);
    // Whatever meshes it handed over before have gone with the last scene: it must hand them over again.
    if (this.wasActive) {
      const reset: ToLifeWorker = { type: 'reset' };
      this.worker?.postMessage(reset);
      this.lastSent = null;
    }
    this.wasActive = true;
    this.active = true;
    const g = this.groundData;
    r.sea = this.sea;
    r.clearGround();
    r.clearInstanced();
    r.setGround(g.levels.map((l) => ({ ...l, url: '' })), g.levels.map((l) => l.z));
    const mask = this.maskData ?? g;
    r.setMask(mask.mask, mask.maskSize, mask.maskBox);
    const params = this.spec.generator.params as unknown as LivingParams;
    const clim = params.cover.climates[this.spec.biome.climate];
    const cover = this.spec.biome.cover;
    // A land before plants has none of its climate's colours: only rock.
    const tones = params.cover.tones[cover.plants > 0 ? clim?.tones ?? 'plain' : 'barren'] ?? params.cover.tones.plain;
    // Where the world gives the rivers their water falls downstream, and no one level bands the banks.
    r.setWater(g.water.vertices, g.water.indices, this.spec.water ? -1e4 : g.waterLevel, g.water.flow, tones.water);
    r.setLand(Float32Array.from(['soil', 'herb', 'bare', 'canopy', 'distant'].flatMap((k) => tones[k])), [Math.min(clim?.forest ?? 0, cover.forests), Math.min(clim?.herb ?? 0, cover.plants), 1 - cover.plants * (1 - (clim?.bare ?? 1))], snowOf(this.spec));
    const out = new Float32Array((this.spec.taxa.length + 1) * 4);
    const clamp = (x: number | null | undefined, d: number) => (x === null || x === undefined || !Number.isFinite(x) ? d : Math.max(-TIMELESS, Math.min(TIMELESS, x - this.spec.site.slice)));
    this.spec.taxa.forEach((t, i) => {
      const k = (i + 1) * 4;
      out[k] = clamp(t.time.start.best, -TIMELESS);
      out[k + 1] = clamp(t.time.end.best, TIMELESS);
      out[k + 2] = 3;
      out[k + 3] = g.waterLevel;
    });
    r.setEntities(out);
    this.selected = 0;
    for (const s of this.held) this.apply(s);
    this.held = [];
  }

  private selection(m: Extract<FromLifeWorker, { type: 'selection' }>): void {
    this.waiting = false;
    this.last = { instances: m.instances, triangles: m.triangles, meshes: m.batches.length, pending: m.pending, ms: m.ms };
    if (this.active) this.apply(m);
    else this.held = [m];
    const taxa = this.spec.taxa;
    this.names = m.groups.map((g) => {
      const t = taxa[g.taxon];
      return { id: t.id, label: t.label, kind: 'taxon', form: { type: 'generic' }, rings: [], at: g.at, base: g.base, time: t.time, basis: 'procedural', curated: true, rank: (t.length ?? 0) >= 2 ? 2 : 3 } as CityStructure;
    });
    this.tops = Float32Array.from(m.groups, (g) => g.top);
    this.labelSerial++;
    this.onChange();
    this.send();
  }

  private apply(m: Extract<FromLifeWorker, { type: 'selection' }>): void {
    for (const p of m.protos) this.renderer.addInstanced(p.proto, p.vertices, p.indices, protoParts(p.proto).detail >= 1);
    this.renderer.setInstances(m.batches);
  }

  /** Whether the view has moved enough since the last was sent to need another. */
  private moved(): boolean {
    const a = this.want;
    const b = this.lastSent;
    if (!a) return false;
    if (!b) return true;
    const dx = a.eye[0] - b.eye[0];
    const dy = a.eye[1] - b.eye[1];
    const dz = a.eye[2] - b.eye[2];
    const far = Math.max(3, a.clearance * 0.03);
    if (dx * dx + dy * dy + dz * dz > far * far) return true;
    const turn = a.forward[0] * b.forward[0] + a.forward[1] * b.forward[1] + a.forward[2] * b.forward[2];
    return turn < 0.9995 || a.height !== b.height || a.fov !== b.fov;
  }

  private send(): void {
    if (this.waiting || !this.worker || !this.want) return;
    if (!this.moved() && !this.last.pending) return;
    const v = this.want;
    this.lastSent = v;
    this.waiting = true;
    const msg: ToLifeWorker = { type: 'view', serial: ++this.serial, view: { eye: [v.eye[0], v.eye[1], v.eye[2]], forward: [v.forward[0], v.forward[1], v.forward[2]], right: [v.right[0], v.right[1], v.right[2]], up: [v.up[0], v.up[1], v.up[2]], fov: v.fov, aspect: v.aspect, height: v.height, clearance: v.clearance } };
    this.worker.postMessage(msg);
  }

  /** Draw a frame. */
  render(v: LocalView, sun: V3, time: number, evidence: boolean, alpha: number, solid: boolean, outW: number, outH: number): void {
    if (!this.ready) return;
    this.activate();
    this.want = v;
    this.send();
    const f: CityFrame = {
      eye: v.gpuEye,
      focus: v.clearance > 3000 ? [v.target[0], v.target[1], v.target[2]] : [v.eye[0] + v.forward[0] * Math.min(v.range, 700), v.eye[1] + v.forward[1] * Math.min(v.range, 700), Math.min(v.target[2], v.eye[2])],
      view: v.view,
      proj: v.proj,
      farProj: v.farProj,
      fov: v.fov,
      aspect: v.aspect,
      near: v.near,
      far: v.far,
      sun,
      time: time - this.spec.site.slice,
      evidence,
      alpha,
      solid,
      clearance: v.clearance,
      width: outW,
      height: outH,
    };
    this.renderer.render(f, [], outW, outH);
  }

  /** What is at a screen position: a taxon, or nothing. */
  pick(x: number, y: number): { taxon?: LivingTaxon } {
    const e = this.renderer.pick(x, y);
    return e ? { taxon: this.spec.taxa[e - 1] } : {};
  }

  /** Date the taxa as a scenario does: a competing claim for a first appearance moves them. */
  setScenario(s: Scenario): void {
    if (!this.active) return;
    const clamp = (x: number | null, d: number) => (x === null || !Number.isFinite(x) ? d : Math.max(-TIMELESS, Math.min(TIMELESS, x - this.spec.site.slice)));
    this.spec.taxa.forEach((t, i) => {
      if (!t.variants) return;
      const v = lookup(t.variants, s, t.time);
      this.renderer.setEntityTime(i + 1, clamp(v.start.best, -TIMELESS), clamp(v.end.best, TIMELESS));
    });
  }

  /** Light up every one of the taxon whose record is open. */
  select(id: string | null): void {
    if (!this.active) return;
    if (this.selected) this.renderer.setEntityFlags(this.selected, 3);
    this.selected = 0;
    if (!id) return;
    const i = this.spec.taxa.findIndex((t) => t.id === id);
    if (i >= 0) {
      this.selected = i + 1;
      this.renderer.setEntityFlags(this.selected, 3 + 8);
    }
  }

  /** The scene's taxon of a record, if it is drawn here. */
  taxonOf(id: string): LivingTaxon | undefined {
    return this.spec.taxa.find((t) => t.id === id);
  }

  stats(): { cells: number; coarse: number; fine: number; megabytes: number; instances: number; triangles: number; meshes: number } {
    const s = this.renderer.instancedStats();
    return { cells: 0, coarse: s.meshes, fine: 0, megabytes: 0, instances: s.instances, triangles: s.triangles, meshes: s.meshes };
  }

  /** The scene is no longer wanted. */
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.active = false;
  }
}
