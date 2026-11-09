// Who lived where, in the browser: the atlas's index and forms, a stage's lists as they are wanted, and what a
// place's spec needs from the climate and the land the viewer already has. A descent fetches a stage's lists
// and the tiles of the land under it, and no ground or plant or animal: those it makes.
import { atlasHasLand, atlasList, seaDrawList, seaList, type AtlasBin, type AtlasIndex, type SeaBin } from '../../../core/atlas.ts';
import { decodeTile } from '../../../core/container.ts';
import { decodeNode, type ClimateHeader, type ClimateRule } from '../../../core/climate.ts';
import type { Form } from '../../../core/form.ts';
import type { PlanetFile } from '../../../core/planet.ts';
import { coverAt } from '../../../core/planet.ts';
import { conj, rotate, toLatLon, unitVector } from '../../../core/quat.ts';
import type { RotationModel } from '../../../core/rotation-model.ts';
import type { Scenario } from '../../../core/scenario.ts';
import type { SceneSpec } from '../../../core/scene.ts';
import { toMa } from '../../../core/time.ts';
import type { FieldInfo, TileHeader, TileRef } from '../../../core/tileset.ts';
import { latticeOf, placeSpec, reliefBox, type PlaceWorld } from '../../../world/generators/life/spec.ts';
import { getBytes, getJSON, type Build } from '../data.ts';
import { Rivers } from '../rivers.ts';
import { MonthTiles } from '../months.ts';
import { monthsPlace, placeMonths } from '../../../world/generators/life/climate.ts';
import type { SceneWater } from '../../../core/scene.ts';
import { sceneWater } from '../../../world/generators/life/water.ts';

interface LoadedField {
  grid: { lon0: number; lat0: number; step: number; nx: number; ny: number };
  bbox: [number, number, number, number];
  elev: Int16Array;
  plate: Uint16Array;
}

export interface ClimateData {
  header: ClimateHeader;
  arrays: ArrayLike<unknown>[];
}

export class LifeAtlas {
  private bins = new Map<string, Promise<AtlasBin>>();
  private loadedBins = new Map<string, AtlasBin>();
  private forms: Promise<Record<string, Form>> | null = null;
  /** the sea's lists, by file, and its forms */
  private seaBins = new Map<string, Promise<SeaBin>>();
  private loadedSea = new Map<string, SeaBin>();
  private seaForms: Promise<Record<string, Form>> | null = null;
  /** the specs whose taxa are the sea's list */
  private ofSea = new WeakSet<SceneSpec>();
  private fields = new Map<string, Promise<LoadedField | undefined>>();
  /** the rivers a place's scene is given: its own loader, as the globe's layer has its own */
  private rivers: Rivers;
  /** the climate's months at a height, for the place a scene is of */
  private months: MonthTiles;

  constructor(private build: Build, readonly index: AtlasIndex, private climate: () => { data: ClimateData; rule: ClimateRule } | null, private generator: { id: string; version: number; params: Record<string, unknown> }, private planet: PlanetFile, private model: RotationModel, private coastAt: (field: FieldInfo, t: number) => number) {
    this.rivers = new Rivers(build);
    this.months = new MonthTiles(build);
  }

  /** The stage a time is in, if the atlas covers it. */
  binAt(t: number) {
    return this.index.bins.find((b) => t >= b.from && t <= b.to);
  }

  private load(file: string): Promise<AtlasBin> {
    let p = this.bins.get(file);
    if (!p) {
      p = getJSON<AtlasBin>(this.build.base + file).then((b) => {
        this.loadedBins.set(file, b);
        return b;
      });
      this.bins.set(file, p);
    }
    return p;
  }

  /** The sea's stage at a time, the same stage as the land's, if the sea's atlas covers it. */
  private seaRefAt(t: number) {
    return this.build.sea?.bins.find((b) => t >= b.from && t <= b.to);
  }

  private loadSea(file: string): Promise<SeaBin> {
    let p = this.seaBins.get(file);
    if (!p) {
      p = getJSON<SeaBin>(this.build.base + file).then((b) => {
        this.loadedSea.set(file, b);
        return b;
      });
      this.seaBins.set(file, p);
    }
    return p;
  }

  /** Could a scene be drawn here and now? Yes if the stage's lists say so, the land's or the sea's, or until they have come. */
  canDraw(t: number, lat: number, lon: number): boolean {
    const ref = this.binAt(t);
    if (!ref) return false;
    const bin = this.loadedBins.get(ref.file);
    if (!bin) {
      void this.load(ref.file);
      return true;
    }
    if (atlasHasLand(bin, this.index.grid, lat, lon)) return true;
    const sea = this.seaRefAt(t);
    if (!sea || !this.build.sea) return false;
    const sb = this.loadedSea.get(sea.file);
    if (!sb) {
      void this.loadSea(sea.file);
      return true;
    }
    return seaList(sb, this.build.sea.grid, lat, lon) !== undefined;
  }


  /** The tile of the land that holds a place at a keyframe: the finer level, as the tiles are the land's only copy. */
  private fieldOf(ref: TileRef, ageMa: number): Promise<LoadedField | undefined> {
    const key = `${ref.id}|${ageMa}`;
    let p = this.fields.get(key);
    if (!p) {
      p = getBytes(this.build.base + ref.url).then((buf) => {
        const { header, arrays } = decodeTile<TileHeader>(buf);
        const k = header.field?.keyframes.find((x) => x.ageMa === ageMa);
        return k ? { grid: header.field!.grid, bbox: ref.bbox, elev: arrays[k.elev] as Int16Array, plate: arrays[k.plate] as Uint16Array } : undefined;
      });
      this.fields.set(key, p);
    }
    return p;
  }

  /** A scene's spec for a place and time: nothing if there is no land there, or no list. */
  async spec(lat: number, lon: number, t: number, s: Scenario, month?: number): Promise<SceneSpec | null> {
    const ref = this.binAt(t);
    const clim = this.climate();
    if (!ref || !clim) return null;
    const seaRef = this.seaRefAt(t);
    const sea = this.build.sea;
    const [bin, landForms, seaBin, seaForms] = await Promise.all([
      this.load(ref.file),
      (this.forms ??= getJSON<Record<string, Form>>(this.build.base + this.index.forms)),
      seaRef && sea ? this.loadSea(seaRef.file) : Promise.resolve(undefined),
      sea?.forms ? (this.seaForms ??= getJSON<Record<string, Form>>(this.build.base + sea.forms)) : Promise.resolve({} as Record<string, Form>),
    ]);
    // The forms are keyed by what they are, so the land's and the sea's never clash.
    const forms = { ...seaForms, ...landForms };
    // Its taxa are its stage's; its ground, its sea and its rivers are those of the time shown, within the stage.
    const when = Math.min(bin.to, Math.max(bin.from, t));
    const ageMa = toMa(when);
    // The elevation of the stage's time: today's ground for a stage of the glacial cycles, the deep past's grids before.
    const elevations = this.build.tileset.fields.filter((f) => f.mode === 'elevation');
    const field = elevations.find((f) => f.coverage[0] <= bin.slice && bin.slice <= f.coverage[1]) ?? elevations[0];
    if (!field) return null;
    const keyAge = [...field.keyframesMa].sort((a, b) => Math.abs(a - ageMa) - Math.abs(b - ageMa))[0];
    const ck = [...clim.data.header.keyframes].sort((a, b) => Math.abs(a.ageMa - ageMa) - Math.abs(b.ageMa - ageMa))[0];
    const values = clim.data.arrays[ck.values] as Uint8Array;
    const g = clim.data.header.grid;
    // The land's tiles around it, at the finer level.
    const origin = latticeOf(lat, lon);
    const box = reliefBox(origin.lat, origin.lon);
    // The finest tiles of the time, which carry the keyframes on either side of it: a tenth of a degree where the
    // field has them, a degree before.
    const finest = (field.res_deg ?? 1) < 1 && this.build.tileset.tiles.some((r) => r.lod === 3 && r.time[0] <= when && when <= r.time[1]);
    const lod = finest ? 3 : 1;
    const step = finest ? field.res_deg! : 1;
    const inTime = this.build.tileset.tiles.filter((r) => r.lod === lod && r.time[0] <= when && when <= r.time[1]);
    // Every tile any point of the patch could fall in, with a margin for how far its plate has carried it.
    const wanted = new Set<TileRef>();
    for (let la = Math.max(-90, box.lat1 - 6); ; la = Math.min(90, la + 5)) {
      for (let lo = box.lon0 - 6; ; lo = Math.min(box.lon1 + 6, lo + 5)) {
        const q = ((lo + 540) % 360) - 180;
        for (const r of inTime) if (la >= r.bbox[1] && la <= r.bbox[3] && q >= r.bbox[0] && q <= r.bbox[2]) wanted.add(r);
        if (lo >= box.lon1 + 6) break;
      }
      if (la >= Math.min(90, box.lat0 + 6)) break;
    }
    const fields = (await Promise.all([...wanted].map((r) => this.fieldOf(r, keyAge)))).filter((f): f is LoadedField => !!f);
    const at = (la: number, lo: number): LoadedField | undefined => fields.find((f) => la >= f.bbox[1] && la <= f.bbox[3] && lo >= f.bbox[0] && lo <= f.bbox[2]);
    const read = (f: LoadedField, arr: ArrayLike<number>, la: number, lo: number) => {
      const j = Math.round((f.grid.lat0 - la) / f.grid.step);
      const i = Math.round((lo - f.grid.lon0) / f.grid.step);
      return arr[j * f.grid.nx + i];
    };
    const snap = (v: number) => Math.round(Math.round(v / step) * step * 1e6) / 1e6;
    const norm = (lo: number) => ((snap(lo) + 540) % 360) - 180;
    const pw: PlaceWorld = {
      atlas: this.index,
      bin,
      list: (la, lo) => (atlasHasLand(bin, this.index.grid, la, lo) ? atlasList(bin, this.index.grid, la, lo) : undefined),
      seaList: seaBin && sea ? (la, lo) => seaDrawList(seaBin, sea.grid, la, lo) : undefined,
      forms,
      keyAge,
      step,
      elevation: (la, lo) => {
        const q = norm(lo);
        const r = snap(la);
        const f = at(r, q);
        return f ? read(f, f.elev, r, q) : -4000;
      },
      plate: (la, lo) => {
        const q = norm(lo);
        const r = snap(la);
        const f = at(r, q);
        return f ? this.build.frames.plateIndex[read(f, f.plate, r, q)] ?? 0 : 0;
      },
      carry: (plate, la, lo, a, b) => {
        if (!this.model.reaches(plate, a) || !this.model.reaches(plate, b)) return [la, lo];
        const [x, y] = toLatLon(rotate(this.model.total(plate, b), rotate(conj(this.model.total(plate, a)), unitVector(la, lo))));
        return [x, y];
      },
      climateAge: ck.ageMa,
      climate: (la, lo) => {
        const row = Math.round((g.lat0 - la) / g.step);
        const col = ((Math.round((lo - g.lon0) / g.step) % g.nx) + g.nx) % g.nx;
        const k = (row * g.nx + col) * 4;
        return decodeNode([values[k] / 255, values[k + 1] / 255, values[k + 2] / 255, values[k + 3] / 255]);
      },
      rule: clim.rule,
      climateField: this.build.tileset.climate?.field ?? 'field:earth/climate',
      cover: (() => {
        const c = coverAt(this.planet, bin.slice, s);
        return { plants: c.plants, forests: c.forests, grasses: c.grasses };
      })(),
      isoline: this.coastAt(field, when),
      generator: this.generator,
    };
    // The months of the finest climate that covers the time, at the node the place stood on then.
    const mInfo = this.months.info;
    const where = mInfo && monthsPlace(mInfo, pw, lat, lon, ageMa);
    const tiles = where ? await this.months.near(where.set, where.lat, where.lon) : [];
    if (mInfo && where && tiles.length) pw.months = placeMonths(mInfo, where, tiles, month);
    const spec = placeSpec(pw, lat, lon, ageMa);
    if (!spec) return null;
    // Its list is the sea's where the land's atlas has none for its place, as placeSpec chooses.
    if (!atlasHasLand(bin, this.index.grid, origin.lat, origin.lon)) this.ofSea.add(spec);
    const water = await this.waterOf(spec, when, ageMa, pw.isoline);
    if (water) spec.water = water;
    return spec;
  }

  /** Whether a scene's taxa are the sea's list, which says what is near by sea, and not the land's. */
  fromSea(spec: SceneSpec): boolean {
    return this.ofSea.has(spec);
  }

  /**
   * The rivers the world gives a place at a time (world/generators/life/water.ts), once their files have come.
   * Undefined where the world has no rivers for the time, and a scene invents its own.
   */
  private async waterOf(spec: SceneSpec, t: number, ageMa: number, isoline: number): Promise<SceneWater | undefined> {
    const info = this.rivers.info;
    const set = this.rivers.setAt(t);
    if (!info || !set) return undefined;
    const at = spec.site.relief_at ?? spec.site.origin;
    await this.rivers.ready(t, ageMa, at.lat, at.lon);
    const net = this.rivers.net(set);
    const key = this.rivers.key(set, ageMa);
    if (!net || !key) return undefined;
    const observed = set.today && info.observed ? await this.rivers.observedNear(at.lat, at.lon) : [];
    return sceneWater(info, set, net, key, observed, at, isoline);
  }
}
