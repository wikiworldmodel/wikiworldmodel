// The anonymous human landscape in the browser (docs/HUMAN-LANDSCAPE.md): the build's files, fetched as they are wanted,
// and put together into what a scene's people are and what the globe paints. The same core code as the build's, so what
// a scene draws rests on the same anthromes, assessments, cities and traditions.
import { decodeTile } from '../../../core/container.ts';
import { traditionAt, type Tradition } from '../../../core/dwelling.ts';
import { anthromeTile, classAtStep, nearestStep, sceneTiles, scenePeople, assessmentAt, lifewayOf, citiesNear, cellOf, tileKey, type AnthromeTile, type AnthromeTileHeader, type AssessmentsFile, type CitiesFile, type LandscapeData, type LandscapeIndex, type Lifeway, type TraditionsFile } from '../../../core/landscape.ts';
import { cellAt, stepsAround, type PeopleFile } from '../../../core/layers.ts';
import type { ResolveWorld } from '../../../core/resolve.ts';
import type { ScenePeople } from '../../../core/scene.ts';

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

async function getBytes(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.arrayBuffer();
}

/** What a place was, for a panel: its anthrome, the people HYDE gives it, how they lived, the region's word and the cities near. */
export interface PlaceLandscape {
  t: number;
  step: number;
  anthrome: number;
  density?: number;
  region?: { id: number; label: string; slice: string; assessment: ReturnType<typeof assessmentAt> };
  lifeway: Lifeway;
  cities: ReturnType<typeof citiesNear>;
  tradition?: Tradition;
}

export class LandscapeAtlas {
  index!: LandscapeIndex;
  assessments!: AssessmentsFile;
  traditions: Tradition[] = [];
  cities!: CitiesFile;
  globe?: AnthromeTile;
  private ready: Promise<void> | null = null;
  private tiles = new Map<string, Promise<AnthromeTile | undefined>>();
  private loaded = new Map<string, AnthromeTile | undefined>();

  /** `people` is HYDE's grid of people, once it has come; it is fetched for the scenes if no one has asked for it yet. */
  constructor(private base: string, private file: string, private people: () => Promise<PeopleFile | null>) {}

  /** The index, the assessments, the traditions and the cities: small, and fetched once. */
  load(): Promise<void> {
    this.ready ??= (async () => {
      this.index = await getJSON<LandscapeIndex>(this.base + this.file);
      const [a, tr, c] = await Promise.all([getJSON<AssessmentsFile>(this.base + this.index.assessments), getJSON<TraditionsFile>(this.base + this.index.traditions), getJSON<CitiesFile>(this.base + this.index.cities)]);
      this.assessments = a;
      this.traditions = tr.traditions;
      this.cities = c;
    })();
    return this.ready;
  }

  /** The globe's picture: every cell's classes through time at a quarter of a degree. */
  async loadGlobe(): Promise<AnthromeTile> {
    await this.load();
    if (this.globe) return this.globe;
    const { header, arrays } = decodeTile<AnthromeTileHeader>(await getBytes(this.base + this.index.globe.file));
    this.globe = anthromeTile(header, arrays[0] as Uint8Array, arrays[1] as Uint8Array, arrays[2] as Uint8Array);
    return this.globe;
  }

  /** The step of the anthromes nearest a time, as a scene is keyed by; null outside them. */
  stepAt(t: number): number | null {
    if (!this.index) return null;
    const i = nearestStep(this.index.steps, t);
    return i < 0 ? null : this.index.steps[i];
  }

  private tile(key: string): Promise<AnthromeTile | undefined> {
    let p = this.tiles.get(key);
    if (!p) {
      p = this.index.tiles.includes(key)
        ? getBytes(`${this.base}people/anthromes/${key}.lwt`).then((data) => {
            const { header, arrays } = decodeTile<AnthromeTileHeader>(data);
            const t = anthromeTile(header, arrays[0] as Uint8Array, arrays[1] as Uint8Array, arrays[2] as Uint8Array);
            this.loaded.set(key, t);
            return t;
          })
        : Promise.resolve(undefined);
      this.tiles.set(key, p);
    }
    return p;
  }

  private data(people: PeopleFile | null): LandscapeData {
    const ix = this.index;
    return {
      steps: ix.steps,
      res: ix.res,
      tileDeg: ix.tile_deg,
      classes: ix.classes,
      tile: (key) => this.loaded.get(key),
      assessments: this.assessments,
      traditions: this.traditions,
      cities: this.cities,
      people: (lat, lon, t) => {
        if (!people) return undefined;
        const c = cellAt(people, lon, lat);
        const s = stepsAround(people.steps, t);
        if (c.index < 0 || !s) return undefined;
        const n = people.cell.length;
        return people.people[s.a * n + c.index] + (people.people[s.b * n + c.index] - people.people[s.a * n + c.index]) * s.mix;
      },
      fields: { anthromes: ix.fields.anthromes, assessment: ix.fields.assessment, population: ix.fields.population, lifeways: ix.fields.lifeways },
      generator: ix.generator!,
      reach_deg: ix.reach_deg,
      reach_km: ix.reach_km,
    };
  }

  /** The people of a scene at a place and time, or undefined where the human landscape does not reach it. */
  async peopleFor(lat: number, lon: number, t: number): Promise<ScenePeople | undefined> {
    await this.load();
    if (!this.index.generator || nearestStep(this.index.steps, t) < 0) return undefined;
    const [people] = await Promise.all([this.people(), ...sceneTiles({ tileDeg: this.index.tile_deg, reach_deg: this.index.reach_deg }, lat, lon).map((k) => this.tile(k))]);
    // The 1° cells around the scene's 5′ cells may reach a tile further: fetch those too.
    const extra = sceneTiles({ tileDeg: this.index.tile_deg, reach_deg: this.index.reach_deg + 1 }, lat, lon);
    await Promise.all(extra.map((k) => this.tile(k)));
    return scenePeople(this.data(people), lat, lon, t);
  }

  /**
   * What the people layer of `resolve` asks (core/resolve.ts), as the build answers it: the lifeway at a place from its 5′
   * cell, and whether a city of the lists stands near. Undefined until the index has come; a place whose tile has not come
   * yet has no answer, and asking fetches it.
   */
  resolver(): ResolveWorld['landscape'] {
    if (!this.index || !this.assessments) return undefined;
    const ix = this.index;
    return {
      span: [ix.steps[0], ix.steps.at(-1)!],
      at: (lat, lon, t) => {
        const i = nearestStep(ix.steps, t);
        if (i < 0) return undefined;
        const key = tileKey(lat, lon, ix.tile_deg).key;
        const tile = this.loaded.get(key);
        if (!tile) {
          void this.tile(key);
          return undefined;
        }
        const cell = cellOf(tile, lat, lon);
        const anthrome = cell < 0 ? 0 : classAtStep(tile, cell, i);
        if (!anthrome) return undefined;
        const city = citiesNear(this.cities, lat, lon, t, ix.reach_km)[0];
        if (city) return { tier: 'evidence', pattern: 'city', city: city.city.name };
        const region = tile.region[cell];
        const l = lifewayOf(ix.classes, anthrome, 0, region ? assessmentAt(this.assessments, region, t)?.a : undefined);
        return { tier: l.tier, pattern: l.pattern };
      },
    };
  }

  /** What a place was at a time, for the panel, from its 5′ cell. */
  async placeAt(lat: number, lon: number, t: number): Promise<PlaceLandscape | undefined> {
    await this.load();
    const i = nearestStep(this.index.steps, t);
    if (i < 0) return undefined;
    const key = tileKey(lat, lon, this.index.tile_deg).key;
    const tile = await this.tile(key);
    if (!tile) return undefined;
    const cell = cellOf(tile, lat, lon);
    if (cell < 0) return undefined;
    const anthrome = classAtStep(tile, cell, i);
    if (!anthrome) return undefined;
    const region = tile.region[cell];
    const at = region ? assessmentAt(this.assessments, region, t) : undefined;
    const label = this.assessments.regions.find((r) => r.id === region)?.label;
    // How many people, as a scene would share them.
    const p = await this.peopleFor(lat, lon, t).catch(() => undefined);
    const density = p ? p.grid.density[(Math.floor((p.grid.north - lat) / p.grid.res)) * p.grid.nx + Math.floor((lon - p.grid.west) / p.grid.res)] : undefined;
    const lifeway = lifewayOf(this.index.classes, anthrome, density ?? 0, at?.a);
    const cities = citiesNear(this.cities, lat, lon, t, this.index.reach_km);
    const tradition = region ? traditionAt(this.traditions, region, t) : undefined;
    return { t, step: this.index.steps[i], anthrome, ...(density !== undefined ? { density } : {}), ...(region && label && at ? { region: { id: region, label, slice: this.assessments.slices[at.slice].label, assessment: at } } : {}), lifeway, cities, ...(tradition ? { tradition } : {}) };
  }
}
