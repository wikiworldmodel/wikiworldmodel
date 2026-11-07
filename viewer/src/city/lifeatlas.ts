// Who lived where, in the browser: the atlas's index and forms, a stage's lists as they are wanted, and what a
// place's spec needs from the climate and the land the viewer already has. A descent fetches a stage's lists
// and the tiles of the land under it, and no ground or plant or animal: those it makes.
import { atlasHasLand, atlasList, type AtlasBin, type AtlasIndex } from '../../../core/atlas.ts';
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
  private fields = new Map<string, Promise<LoadedField | undefined>>();

  constructor(private build: Build, readonly index: AtlasIndex, private climate: () => { data: ClimateData; rule: ClimateRule } | null, private generator: { id: string; version: number; params: Record<string, unknown> }, private planet: PlanetFile, private model: RotationModel, private coastAt: (field: FieldInfo, t: number) => number) {}

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

  /** Could a scene be drawn here and now? Yes if the stage's lists say so, or until they have come. */
  canDraw(t: number, lat: number, lon: number): boolean {
    const ref = this.binAt(t);
    if (!ref) return false;
    const bin = this.loadedBins.get(ref.file);
    if (!bin) {
      void this.load(ref.file);
      return true;
    }
    return atlasHasLand(bin, this.index.grid, lat, lon);
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
  async spec(lat: number, lon: number, t: number, s: Scenario): Promise<SceneSpec | null> {
    const ref = this.binAt(t);
    const clim = this.climate();
    if (!ref || !clim) return null;
    const [bin, forms] = await Promise.all([this.load(ref.file), (this.forms ??= getJSON<Record<string, Form>>(this.build.base + this.index.forms))]);
    const ageMa = toMa(bin.slice);
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
    // The tiles of the stage's time, which carry the keyframes on either side of it.
    const inTime = this.build.tileset.tiles.filter((r) => r.lod === 1 && r.time[0] <= bin.slice && bin.slice <= r.time[1]);
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
    const norm = (lo: number) => ((Math.round(lo) + 540) % 360) - 180;
    const pw: PlaceWorld = {
      atlas: this.index,
      bin,
      list: (la, lo) => (atlasHasLand(bin, this.index.grid, la, lo) ? atlasList(bin, this.index.grid, la, lo) : undefined),
      forms,
      keyAge,
      elevation: (la, lo) => {
        const q = norm(lo);
        const r = Math.round(la);
        const f = at(r, q);
        return f ? read(f, f.elev, r, q) : -4000;
      },
      plate: (la, lo) => {
        const q = norm(lo);
        const r = Math.round(la);
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
      isoline: this.coastAt(field, bin.slice),
      generator: this.generator,
    };
    return placeSpec(pw, lat, lon, ageMa) ?? null;
  }
}
