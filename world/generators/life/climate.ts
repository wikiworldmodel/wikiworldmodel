// What a scene's climate does at its heights and in its month, apart from the generator that draws it, so the page can
// light and paint a scene without loading the generator: where snow lies (field:earth/climate-at-height).
import { monthsKeyframe, nearestNode, snowLine, type MonthsInfo, type MonthsSet, type MonthsTile } from '../../../core/months.ts';
import type { SceneSpec } from '../../../core/scene.ts';
import { latticeOf, type PlaceWorld } from './spec.ts';

/** How the climate is brought to a scene's heights: the generator's choices. */
export interface ClimateChoices {
  /** how far, in °C, the edge between two classes wanders: as height, this over the lapse rate */
  band_c: number;
  /** the least snow drawn, mm of water; the height over which it thickens to cover the ground; the slope it slips off */
  snow_mm: number;
  snow_band_m: number;
  snow_slope: number;
  /** how finely the heights are read, m */
  step_m: number;
}

/**
 * Where snow lies in a scene's month, in metres above the coast: from `line`, thickening over `band` of height, and
 * none on slopes steeper than `slope`. The line is Infinity where no snow lies in the scene's heights, or where the world
 * gives no climate at a height.
 */
export function snowOf(spec: SceneSpec): { line: number; band: number; slope: number } {
  const p = (spec.generator.params as { climate?: ClimateChoices }).climate;
  const c = spec.climate;
  if (!c || !p) return { line: Infinity, band: 1, slope: 1 };
  let lo = Infinity;
  let hi = -Infinity;
  for (const z of spec.relief.z) {
    if (z < lo) lo = z;
    if (z > hi) hi = z;
  }
  // The hills a scene adds stand above the field's heights: look a kilometre higher.
  const line = snowLine(c.months, c.month, c.lat, c.coast + c.height, c.water, c.lapse, p.snow_mm, Math.max(0, lo) - c.height, hi + 1000 - c.height, p.step_m * 2.5);
  return { line: line === Infinity ? Infinity : Math.round(line + c.height), band: p.snow_band_m, slope: p.snow_slope };
}

/** Where a place's months are: the set and keyframe of the finest climate that covers its time, and the place then. */
export interface MonthsPlace {
  set: MonthsSet;
  ageMa: number;
  frameMa: number;
  lat: number;
  lon: number;
}

/** Which months a place at a time reads, and where it stood in their coordinates: one answer for a browser and the build. */
export function monthsPlace(info: MonthsInfo, w: Pick<PlaceWorld, 'plate' | 'carry'>, lat: number, lon: number, ageMa: number): MonthsPlace | undefined {
  const mk = monthsKeyframe(info, ageMa);
  if (!mk) return undefined;
  const frameMa = mk.set.frameMa ?? mk.ageMa;
  const origin = latticeOf(lat, lon);
  const plate = w.plate(origin.lat, origin.lon);
  const [ml, mo] = plate ? w.carry(plate, origin.lat, origin.lon, ageMa, frameMa) : [origin.lat, origin.lon];
  return { set: mk.set, ageMa: mk.ageMa, frameMa, lat: ml, lon: mo };
}

/** What a place's spec reads of its months, once the tiles near it (core/months.ts tilesNear) have come. */
export function placeMonths(info: MonthsInfo, at: MonthsPlace, tiles: MonthsTile[], month?: number): NonNullable<PlaceWorld['months']> {
  return { field: at.set.field, ageMa: at.ageMa, frameMa: at.frameMa, at: (la, lo) => nearestNode(tiles, at.ageMa, la, lo), lapse: info.lapse, water: info.water, ...(month ? { month } : {}) };
}
