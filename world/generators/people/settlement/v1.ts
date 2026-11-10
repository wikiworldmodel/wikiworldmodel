// The settlement generator, version 1 (docs/HUMAN-LANDSCAPE.md): the anonymous human landscape of a scene. From the
// people part of a scene's spec it lays out where people lived, how many houses, of what kind, and the fields and
// pastures around them, in the scene's local metres. Nobody recorded any of these houses: how many there are follows
// HYDE's people through the anthromes, and the lists of cities where they name one; what way of life, the anthromes and
// the archaeologists of the region; what the houses were like, the building tradition the world records for the region
// and the time, or where there is none, a generic house for the way of life and the climate, which says so.
//
// Everything is seeded by the world's 5′ cells and the anthromes' step, not by the scene, so two scenes that overlap put
// their settlements in the same places: only the ground they stand on, which is the scene's, can move one a little.
import { mid, traditionAt, within, type DwellingSpec, type FieldSpec, type SettlementSpec, type Tradition } from '../../../../core/dwelling.ts';
import { anthromeOf, lifewayOf, type FieldUse, type Lifeway, type Pattern } from '../../../../core/landscape.ts';
import type { ClimateClass } from '../../../../core/climate.ts';
import type { SceneSpec } from '../../../../core/scene.ts';
import { dcos, hash2, hash3, PI, TAU } from '../../city/math.ts';
import { fbm, noise } from '../../life/land.ts';

export const GENERATOR = 'gen:people/settlement';
export const VERSION = 1;

const EARTH = 6371000;
const DEG = PI / 180;

/** How a pattern of settlement is laid out where no tradition says: houses in one settlement, ground a house takes, fields. */
export interface PatternParams {
  /** houses in one settlement, least and most */
  houses: [number, number];
  /** square metres of ground one house and its yard take within its settlement */
  lot: number;
  /** the share of a settlement's land in fields (or pasture, for herders) */
  fields: number;
  /** how many storeys a house of the pattern has where its dwelling says none */
  storeys?: number;
}

export interface SettlementParams {
  /** people to a house where no tradition says */
  household: number;
  patterns: Record<Exclude<Pattern, 'none'>, PatternParams>;
  /** the houses drawn where no tradition holds: for foragers and herders, for towns and cities, and for farmers by climate */
  /** town and city change the farmer's house of the climate: more storeys, a rectangular plan */
  generic: { foragers: DwellingSpec; herders: DwellingSpec; town: DwellingSpec; city: DwellingSpec; farm: Record<ClimateClass, DwellingSpec> };
  /** the plots of each use of the land where no tradition says, and their size in hectares */
  plots: Record<Exclude<FieldUse, 'none'>, { kind: NonNullable<FieldSpec['kind']>; plot: number }>;
  site: {
    /** the steepest ground, as rise over run, a house stands on */
    steep: number;
    /** how far above the water a house stands at least, in metres */
    above_water: number;
    /** how many places near its spot a settlement tries before it is left out */
    tries: number;
  };
  cities: {
    /** how far from the scene's middle a city is looked for, km */
    reach_km: number;
    /** square metres a house of a city takes, streets and courts included; a town's */
    lot: number;
    town_lot: number;
    /** people in a house of a city */
    household: number;
    /** fewer people than this, and a city of the lists is drawn as a town */
    city_from: number;
    /** the most houses one city is drawn with: past it, each stands for several households, and is that much bigger */
    most_houses: number;
  };
  /** the most houses a scene draws: past it, each house stands for more people, and the plan says how many */
  most_houses: number;
}

/** A house: where it stands, which way it faces, which dwelling it is, and its rank for the view. */
export interface House {
  x: number;
  y: number;
  z: number;
  /** the way its front faces, radians clockwise from north */
  face: number;
  /** its dwelling, in the plan's list, and its settlement */
  form: number;
  settlement: number;
  /** a share of its dwelling's size, about 1 */
  size: number;
  /** 0–255: lower ones stay in view from further off */
  rank: number;
}

/** A dwelling the plan draws: from a tradition, with whose each part is, or the generator's generic one. */
export interface PlanForm {
  key: string;
  spec: DwellingSpec;
  from: 'tradition' | 'generic';
  tradition?: string;
  label: string;
  /** which tradition gave each part, where it is a tradition's */
  parts?: Record<string, string>;
}

export interface Settlement {
  x: number;
  y: number;
  /** how far its houses reach, and its fields, in metres */
  r: number;
  fieldR: number;
  pattern: Pattern;
  fields: FieldUse;
  houses: number;
  people: number;
  /** a city of the lists, by name; or the anthrome it stands for */
  city?: string;
  anthrome: number;
  region: number;
  form: number;
  tier: Lifeway['tier'];
}

export interface SettlementPlan {
  settlements: Settlement[];
  forms: PlanForm[];
  houses: House[];
  /** people the plan's houses hold, and the people the world puts in the land it covers */
  drawn: number;
  expected: number;
  /** people one house stands for, on average; more than a household where the scene would hold more houses than it may draw */
  perHouse: number;
  /** the field system of the place itself, which the ground's plots are drawn in */
  style: { kind: NonNullable<FieldSpec['kind']>; plot: number; from: 'tradition' | 'generic'; tradition?: string };
  /** the lifeway at the place */
  lifeway: Lifeway;
}

/** Local metres of a place, on the scene's grid. */
export function toLocal(origin: { lat: number; lon: number }, lat: number, lon: number): [number, number] {
  let dl = lon - origin.lon;
  dl -= 360 * Math.round(dl / 360);
  return [dl * EARTH * dcos(origin.lat * DEG) * DEG, (lat - origin.lat) * EARTH * DEG];
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** What the ground is, for a settlement: whether a house may stand at a place. */
export interface Ground {
  at(x: number, y: number): number;
}

/** The generic dwelling for a way of life and a climate. */
function genericFor(p: SettlementParams, pattern: Pattern, climate: ClimateClass): { key: string; spec: DwellingSpec; label: string } {
  if (pattern === 'foragers') return { key: 'generic:foragers', spec: p.generic.foragers, label: "A forager's shelter" };
  if (pattern === 'herders') return { key: 'generic:herders', spec: p.generic.herders, label: "A herder's tent" };
  const spec = p.generic.farm[climate] ?? p.generic.farm.temperate;
  const square = (d: DwellingSpec): DwellingSpec => (d.plan === 'round' || d.plan === 'oval' ? { ...d, plan: 'rectangular', diameter: undefined } : d);
  if (pattern === 'city') return { key: `generic:city:${climate}`, spec: { ...square(spec), ...p.generic.city }, label: 'A house of a city' };
  if (pattern === 'towns') return { key: `generic:town:${climate}`, spec: { ...square(spec), ...p.generic.town }, label: 'A house of a town' };
  return { key: `generic:farm:${climate}`, spec, label: "A farmer's house" };
}

/**
 * The plan of a scene's people. `ground` gives the height at a place and `water` the level of the water there, so that no
 * house stands in a river or on a cliff. The climate class picks the generic house where no tradition holds.
 */
export function makeSettlement(spec: SceneSpec, ground: Ground, water: (x: number, y: number) => number, extent: number): SettlementPlan {
  const P = spec.people!;
  const p = P.generator.params as unknown as SettlementParams;
  const origin = spec.site.origin;
  const climate = spec.biome.climate;
  const forms: PlanForm[] = [];
  const formIndex = new Map<string, number>();
  const formOf = (pattern: Pattern, t: Tradition | undefined): number => {
    const g = genericFor(p, pattern, climate);
    // A tradition's house for its farmers and villagers; a camp's shelter stays a camp's, as a tradition of houses says nothing of it.
    const use = t && pattern !== 'foragers' && pattern !== 'herders' && Object.keys(t.dwelling).length;
    const key = use ? `tradition:${t!.id}` : g.key;
    let k = formIndex.get(key);
    if (k === undefined) {
      k = forms.length;
      formIndex.set(key, k);
      forms.push(
        use
          ? { key, spec: { ...g.spec, ...t!.dwelling }, from: 'tradition', tradition: t!.id, label: t!.label, parts: Object.fromEntries(Object.entries(t!.from).filter(([k2]) => k2.startsWith('dwelling.')).map(([k2, v]) => [k2.slice(9), v])) }
          : { key, spec: g.spec, from: 'generic', label: g.label },
      );
    }
    return k;
  };
  const regionOf = (id: number) => P.regions.find((r) => r.id === id);
  const slope = (x: number, y: number) => {
    const d = 12;
    const zx = ground.at(x + d, y) - ground.at(x - d, y);
    const zy = ground.at(x, y + d) - ground.at(x, y - d);
    return Math.sqrt(zx * zx + zy * zy) / (2 * d);
  };
  // Whether the ground takes a house: above the water and not too steep. Where the scene ends is a separate question, so
  // that which spot a settlement takes does not depend on which scene is drawing it.
  const ok = (x: number, y: number) => ground.at(x, y) - water(x, y) > p.site.above_water && slope(x, y) < p.site.steep;
  const inScene = (x: number, y: number) => Math.abs(x) < extent && Math.abs(y) < extent;
  const fit = (x: number, y: number) => inScene(x, y) && ok(x, y);
  const settlements: Settlement[] = [];
  const houses: House[] = [];
  let expected = 0;
  // The cities of the lists first: each takes the land within its reach, and no settlement of the anthromes stands in it.
  const cityHere: { x: number; y: number; r: number }[] = [];
  for (const c of P.cities) {
    const [cx, cy] = toLocal(origin, c.lat, c.lon);
    if (Math.abs(cx) > extent + 4000 || Math.abs(cy) > extent + 4000) continue;
    const city = c.people >= p.cities.city_from;
    const pattern: Pattern = city ? 'city' : 'towns';
    const households = Math.max(1, Math.round(c.people / p.cities.household));
    const n = Math.min(households, p.cities.most_houses);
    // A house standing for several households takes their ground, so the city covers as much as its people would.
    const lot = ((city ? p.cities.lot : p.cities.town_lot) * households) / n;
    const r = Math.sqrt((n * lot) / PI);
    // Its houses, of the tradition of its region where there is one.
    const lat = c.lat;
    const lon = c.lon;
    const cell = cellAt(P.grid, lat, lon);
    const region = cell >= 0 ? P.grid.region[cell] : 0;
    const t = traditionAt(P.traditions, region, P.t);
    const form = formOf(pattern, t);
    const s = settlements.push({ x: cx, y: cy, r, fieldR: r * 1.6, pattern, fields: 'rainfed', houses: 0, people: c.people, city: c.name, anthrome: cell >= 0 ? P.grid.anthrome[cell] : 0, region, form, tier: 'evidence' }) - 1;
    cityHere.push({ x: cx, y: cy, r: r * 1.15 });
    layOut(settlements[s], s, n, lot, hash2(Math.round(lat * 1000), Math.round(lon * 1000), 0x51c1), t?.settlement ?? {}, Math.min(2.5, Math.sqrt(households / n)));
  }
  // Then each 5′ cell the scene reaches, as its anthrome and region say.
  const g = P.grid;
  const side = g.res * EARTH * DEG;
  for (let row = 0; row < g.ny; row++) {
    for (let col = 0; col < g.nx; col++) {
      const i = row * g.nx + col;
      const k = g.anthrome[i];
      const d = g.density[i];
      if (!k || d <= 0) continue;
      const north = g.north - row * g.res;
      const west = g.west + col * g.res;
      const [x0, y1] = toLocal(origin, north, west);
      const [x1, y0] = toLocal(origin, north - g.res, west + g.res);
      if (x1 < -extent || x0 > extent || y1 < -extent || y0 > extent) continue;
      const region = g.region[i];
      const a = regionOf(region)?.assessment;
      const life = lifewayOf(P.classes, k, d, a);
      if (life.pattern === 'none') continue;
      const t = traditionAt(P.traditions, region, P.t);
      const pp = p.patterns[life.pattern as Exclude<Pattern, 'none'>];
      const household = mid(t?.settlement.household, p.household);
      const area = side * side * dcos(((north - g.res / 2) * PI) / 180) * 1e-6;
      // The part of the cell inside the scene, for what the world expects of it.
      const inside = (Math.max(0, Math.min(x1, extent) - Math.max(x0, -extent)) * Math.max(0, Math.min(y1, extent) - Math.max(y0, -extent))) / ((x1 - x0) * (y1 - y0));
      expected += d * area * inside;
      const people = d * area;
      // The cell's place on the world's grid seeds everything in it.
      const gr = Math.round((90 - north) / g.res);
      const gc = Math.round((west + 180) / g.res);
      const seed = hash3(gr, gc, Math.round(P.step), 0x5e7);
      const perSettlement = Math.max(1, Math.round(within(t?.settlement.houses ?? { lo: pp.houses[0], hi: pp.houses[1] }, pp.houses[0], hash2(gr, gc, seed))));
      const housesInCell = people / household;
      const count = Math.floor(housesInCell / perSettlement + hash2(gc, gr, seed ^ 0x3a));
      if (!count) continue;
      const lot = mid(t?.settlement.spacing, 0) > 0 ? mid(t!.settlement.spacing, 0) ** 2 : pp.lot;
      const catchment = (area * 1e6) / count;
      const grid = Math.ceil(Math.sqrt(count));
      const form = formOf(life.pattern, t);
      for (let n = 0; n < count; n++) {
        // A jittered grid over the whole cell, so that the same settlement is in the same place whichever scene draws it.
        const gx = n % grid;
        const gy = Math.floor(n / grid);
        let placed = false;
        for (let tr = 0; tr < p.site.tries && !placed; tr++) {
          const u = (gx + 0.15 + 0.7 * hash3(n, tr, 1, seed)) / grid;
          const v = (gy + 0.15 + 0.7 * hash3(n, tr, 2, seed)) / grid;
          const x = x0 + (x1 - x0) * u;
          const y = y1 - (y1 - y0) * v;
          if (!ok(x, y)) continue;
          placed = true;
          // A settlement beyond the scene, or in a city's ground, is not drawn here; it has its spot all the same.
          if (!inScene(x, y) || cityHere.some((c) => (x - c.x) ** 2 + (y - c.y) ** 2 < c.r * c.r)) continue;
          const r = Math.sqrt((perSettlement * lot) / PI);
          const fieldR = Math.sqrt(r * r + (pp.fields * catchment) / PI);
          const s = settlements.push({ x, y, r, fieldR, pattern: life.pattern, fields: life.fields, houses: 0, people: perSettlement * household, anthrome: k, region, form, tier: life.tier }) - 1;
          layOut(settlements[s], s, perSettlement, lot, hash3(n, gr, gc, seed), t?.settlement ?? {}, 1);
        }
      }
    }
  }
  // Houses past the most a scene draws stand for more people each: the plan keeps the people, and says so.
  let perHouse = 0;
  let drawn = 0;
  for (const s of settlements) drawn += s.people;
  let kept = houses;
  if (houses.length > p.most_houses) {
    kept = houses.filter((h) => h.rank < (256 * p.most_houses) / houses.length);
    const counts = new Map<number, number>();
    for (const h of kept) counts.set(h.settlement, (counts.get(h.settlement) ?? 0) + 1);
    settlements.forEach((x, i) => (x.houses = counts.get(i) ?? 0));
  }
  perHouse = kept.length ? drawn / kept.length : 0;
  // The place's own field system: its tradition's, or the generic one for its use of the land.
  const centre = cellAt(g, origin.lat, origin.lon);
  const tc = centre >= 0 ? traditionAt(P.traditions, g.region[centre], P.t) : undefined;
  const use = P.lifeway.fields === 'none' ? 'rainfed' : P.lifeway.fields;
  const generic = p.plots[use];
  const style = tc?.fields.kind ? { kind: tc.fields.kind, plot: mid(tc.fields.plot, generic.plot), from: 'tradition' as const, tradition: tc.id } : { kind: generic.kind, plot: generic.plot, from: 'generic' as const };
  return { settlements, forms, houses: kept, drawn: Math.round(drawn), expected: Math.round(expected), perHouse: Math.round(perHouse * 10) / 10, style, lifeway: P.lifeway };

  /** Houses of a settlement, as its tradition's pattern sets them out: clustered, in a ring, along a line or apart. */
  function layOut(s: Settlement, si: number, n: number, lot: number, seed: number, st: SettlementSpec, scale: number): void {
    const pattern = st.pattern ?? (s.pattern === 'foragers' || s.pattern === 'herders' ? 'camp' : s.pattern === 'farmsteads' ? 'dispersed' : 'nucleated');
    const spacing = Math.sqrt(lot);
    const axis = hash2(si, 7, seed) * TAU;
    // A street grid for towns and cities and room blocks; a ring for camps; a line along a road or shore; else a cluster.
    const grid = s.pattern === 'city' || s.pattern === 'towns' || pattern === 'room-block';
    // A room block is the rectangle it was built as; a town fills the lots of its grid nearest its middle.
    const lots = grid && pattern !== 'room-block' ? roundLots(n, seed) : undefined;
    for (let h = 0; h < n; h++) {
      let dx: number;
      let dy: number;
      let face: number;
      if (pattern === 'camp') {
        const a = (TAU * h) / n + hash2(h, 1, seed) * 0.4;
        const rr = spacing * (0.4 + 0.25 * n ** 0.5) * (0.85 + 0.3 * hash2(h, 2, seed));
        dx = Math.sin(a) * rr;
        dy = Math.cos(a) * rr;
        face = a + PI;
      } else if (pattern === 'linear') {
        const along = (h - n / 2) * spacing * 1.1;
        const side = h % 2 ? 1 : -1;
        dx = Math.sin(axis) * along + Math.cos(axis) * side * spacing * 0.6;
        dy = Math.cos(axis) * along - Math.sin(axis) * side * spacing * 0.6;
        face = axis + (side > 0 ? PI / 2 : -PI / 2);
      } else if (grid) {
        // Blocks of four lots either side of lanes, on the settlement's axis.
        const w = Math.ceil(Math.sqrt(n));
        const gx = lots ? lots[h][0] : (h % w) - Math.floor(w / 2);
        const gy = lots ? lots[h][1] : Math.floor(h / w) - Math.floor(w / 2);
        const lx = (gx + 0.5) * spacing + Math.floor(gx / 4) * spacing * 0.35;
        const ly = (gy + 0.5) * spacing + Math.floor(gy / 2) * spacing * 0.35;
        dx = Math.cos(axis) * lx + Math.sin(axis) * ly;
        dy = -Math.sin(axis) * lx + Math.cos(axis) * ly;
        face = axis + (gy % 2 ? PI : 0);
      } else {
        // A sunflower's spiral, shaken: as dense at the edge as in the middle, and no two on one spot.
        const rr = spacing * Math.sqrt(h + 0.5) * (pattern === 'dispersed' ? 2.2 : pattern === 'compound' ? 0.8 : 0.62);
        const a = h * 2.399963 + axis;
        dx = Math.sin(a) * rr + (hash2(h, 3, seed) - 0.5) * spacing * 0.5;
        dy = Math.cos(a) * rr + (hash2(h, 4, seed) - 0.5) * spacing * 0.5;
        face = pattern === 'compound' ? a + PI : axis + (hash2(h, 5, seed) < 0.5 ? 0 : PI / 2) + (hash2(h, 6, seed) - 0.5) * 0.5;
      }
      const x = s.x + dx;
      const y = s.y + dy;
      if (!fit(x, y)) continue;
      houses.push({ x, y, z: ground.at(x, y), face, form: s.form, settlement: si, size: scale * (0.85 + 0.3 * hash2(h, 8, seed)), rank: Math.floor(hash2(h, 9, seed) * 256) });
      s.houses++;
    }
  }
}

/**
 * The `n` lots of a street grid nearest its middle, as [column, row] from it: a town round rather than square, its edge
 * wandering by the seed, as towns grew outward along no plan of their outline.
 */
export function roundLots(n: number, seed: number): [number, number][] {
  const w = Math.ceil(Math.sqrt(n)) + 3;
  const ph = [hash2(1, 11, seed) * TAU, hash2(2, 11, seed) * TAU, hash2(3, 11, seed) * TAU];
  const lots: { g: [number, number]; d: number }[] = [];
  for (let gy = -w; gy <= w; gy++) {
    for (let gx = -w; gx <= w; gx++) {
      const a = Math.atan2(gy, gx);
      const edge = 1 + 0.16 * Math.sin(2 * a + ph[0]) + 0.1 * Math.sin(3 * a + ph[1]) + 0.06 * Math.sin(5 * a + ph[2]);
      lots.push({ g: [gx, gy], d: Math.hypot(gx, gy) / edge + hash2(gx, gy, seed) * 0.8 });
    }
  }
  lots.sort((p, q) => p.d - q.d || p.g[1] - q.g[1] || p.g[0] - q.g[0]);
  return lots.slice(0, n).map((l) => l.g);
}

/** The cell of the people's grid a place is in, or -1. */
export function cellAt(g: { north: number; west: number; nx: number; ny: number; res: number }, lat: number, lon: number): number {
  const row = Math.floor((g.north - lat) / g.res + 1e-9);
  let dl = lon - g.west;
  dl -= 360 * Math.floor(dl / 360);
  const col = Math.floor(dl / g.res + 1e-9);
  return row < 0 || row >= g.ny || col < 0 || col >= g.nx ? -1 : row * g.nx + col;
}

/** What people made of the ground at a place: fields, pasture, yards and paddies, each 0–1. */
export interface LandUse {
  crop: number;
  pasture: number;
  yard: number;
  paddy: number;
}

/** A plan's settlements by where they are, so that the ground can ask which are near. */
export class LandUseMap {
  private buckets = new Map<number, number[]>();
  private size = 2000;
  constructor(private plan: SettlementPlan, private ground: Ground, private water: (x: number, y: number) => number, private seed: number) {
    plan.settlements.forEach((s, i) => {
      const reach = Math.max(s.fieldR, s.r);
      const b0 = Math.floor((s.x - reach) / this.size);
      const b1 = Math.floor((s.x + reach) / this.size);
      const c0 = Math.floor((s.y - reach) / this.size);
      const c1 = Math.floor((s.y + reach) / this.size);
      for (let b = b0; b <= b1; b++) for (let c = c0; c <= c1; c++) {
        const k = b * 65536 + c;
        let list = this.buckets.get(k);
        if (!list) this.buckets.set(k, (list = []));
        list.push(i);
      }
    });
  }
  /** What covers the ground at a place. */
  at(x: number, y: number, out: LandUse = { crop: 0, pasture: 0, yard: 0, paddy: 0 }): LandUse {
    out.crop = out.pasture = out.yard = out.paddy = 0;
    const list = this.buckets.get(Math.floor(x / this.size) * 65536 + Math.floor(y / this.size));
    if (!list) return out;
    const z = this.ground.at(x, y);
    const above = z - this.water(x, y);
    if (above < 0.5) return out;
    // Irregular edges, the same wherever they are asked for.
    const wob = fbm(x / 420, y / 420, this.seed + 401) - 0.5;
    for (const i of list) {
      const s = this.plan.settlements[i];
      const d = Math.sqrt((x - s.x) ** 2 + (y - s.y) ** 2);
      const yard = 1 - smooth(s.r * 0.75, s.r * 1.1, d + wob * s.r * 0.6);
      if (yard > out.yard) out.yard = yard;
      if (s.fields === 'none') continue;
      const edge = s.fieldR * (1 + wob * 0.45);
      const inField = 1 - smooth(edge * 0.92, edge * 1.05, d);
      if (inField <= 0) continue;
      if (s.fields === 'pasture') out.pasture = Math.max(out.pasture, inField);
      else if (s.fields === 'swidden') {
        // Only some plots are cleared at a time: the rest is growing back.
        const plot = noise(x / 160, y / 160, this.seed + 403);
        out.crop = Math.max(out.crop, inField * smooth(0.55, 0.62, plot));
      } else {
        out.crop = Math.max(out.crop, inField);
        if (s.fields === 'rice' || s.fields === 'irrigated') out.paddy = Math.max(out.paddy, inField * (s.fields === 'rice' ? 1 : 0.5) * (1 - smooth(4, 14, above)));
      }
    }
    out.crop *= 1 - out.yard * 0.8;
    return out;
  }
}

/** The plan's land use as an image: R crops, G pasture, B yards and lanes, A flooded paddies. */
export function landUseMask(map: LandUseMap, size: number, half: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  const scale = (half * 2) / size;
  const u: LandUse = { crop: 0, pasture: 0, yard: 0, paddy: 0 };
  for (let j = 0; j < size; j++) {
    const y = -half + (j + 0.5) * scale;
    for (let i = 0; i < size; i++) {
      const x = -half + (i + 0.5) * scale;
      map.at(x, y, u);
      const at = (j * size + i) * 4;
      data[at] = (u.crop * 255) | 0;
      data[at + 1] = (u.pasture * 255) | 0;
      data[at + 2] = (u.yard * 255) | 0;
      data[at + 3] = (u.paddy * 255) | 0;
    }
  }
  return data;
}

/** The anthrome classes a plan draws on, for a panel: its own name for what is there. */
export function anthromeLabel(spec: SceneSpec, k: number): string | undefined {
  return spec.people ? anthromeOf(spec.people.classes, k)?.label : undefined;
}
