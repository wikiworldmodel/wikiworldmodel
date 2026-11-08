// The build: validate the world, solve its chronology, and compile it into a versioned 4D
// tile set plus the records, search index, periods, series, frames and coverage the viewer
// reads.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ClimateRule } from '../../../../core/climate.ts';
import { decodeTile, encodeTile } from '../../../../core/container.ts';
import { bytesPrint } from '../../../../core/fingerprint.ts';
import { ladderCounts } from '../../../../core/ladder.ts';
import type { CoverageFile, OverlaysFile, PeriodRecord, PeriodsFile, SearchFile, SeriesFile } from '../../../../core/records.ts';
import { bakeRotationModel, parseRot, PLATE_OFFSET, RotationModel } from '../../../../core/rotation-model.ts';
import { fromMa, parseDuration, parsePoint, PRESENT_YEAR, toMa, type TimePointInput } from '../../../../core/time.ts';
import type { Basis, Feature, FieldInfo, FieldKeyframe, FramesFile, GeneratorConstraint, SiteInfo, TileHeader, TileRef, Tileset } from '../../../../core/tileset.ts';
import { GENERATOR as BIOME_TEXTURE, VERSION as BIOME_TEXTURE_VERSION, generateBiomeTexture, type BiomeTextureParams } from '../../../../world/generators/earth/biome/v1.ts';
import { GENERATOR as CLOUDS, VERSION as CLOUDS_VERSION, generateClouds, type CloudParams } from '../../../../world/generators/earth/clouds/v1.ts';
import { GENERATOR as SURFACE, VERSION as SURFACE_VERSION, generateSurface, type SurfaceParams } from '../../../../world/generators/earth/surface/v1.ts';
import { GENERATOR as GENERIC_LAND, VERSION as GENERIC_LAND_VERSION, generateGenericLand, genericLandAt, type GenericLandParams } from '../../../../world/generators/earth/generic-land/v1.ts';
import { claimGroups, solveScenario, solveVariants } from '../chronology.ts';
import { fieldAgesMa, fieldSource, importBlocks, importElevation, importMonths, importReliefPlates, PLATE_MODEL, tiledField } from '../importer.ts';
import { meanGrid } from '../tiff.ts';
import { fillFromOcean, WATER, waterMask, type Areas } from './relief.ts';
import { deepRivers, recentRivers, riverFiles, type DrainageParams, type Water } from './rivers.ts';
import { encodeSegments, grwlSegments, thin, tiles as segmentTiles } from './grwl.ts';
import { RiverNet, riverKeys, riverWidths, type RiverKey, type RiversInfo, type RiversKeysHeader, type RiversNetworkHeader, type RiversSet, type RiverWidths, type RiverWidthsHeader } from '../../../../core/rivers.ts';
import type { SceneWater } from '../../../../core/scene.ts';
import { keyFile, observedFiles, sceneWater } from '../../../../world/generators/life/water.ts';
import { seaLevelAt } from '../../../../core/sealevel.ts';
import { datasetFile } from '../manifest.ts';
import { BUILDS, REPO } from '../paths.ts';
import { sha256, stableStringify } from '../util.ts';
import { formatIssue, validateWorld } from '../validate/index.ts';
import { loadWorld, type Field, type World } from '../world.ts';
import { attributionMarkdown, credits } from '../attribution.ts';
import { ClaimIndex } from '../claimindex.ts';
import { correctLand } from '../tables.ts';
import { gridPlaces, lifeTierOf, seaTierOf, tierCounts, TIER_SPANS, type ResolveWorld } from '../../../../core/resolve.ts';
import { coverageMatrix, type CoverageSource } from '../../../../core/coverage.ts';
import { spanOf, type PlanetFile } from '../../../../core/planet.ts';
import { insideRow, politiesAt, type PolitiesFile } from '../../../../core/layers.ts';
import type { AtlasBin } from '../../../../core/atlas.ts';
import { fieldFor, fieldLods, loadBlocks, loadRelief, loadSnapshots, paleoElevation, sliceField, tileGrid, timeBins, type GridField } from './fields.ts';
import { buildCity } from './city.ts';
import { climateGrid, climateKeyframes, encodeClimate, forestChecks, heightOn, monthsFiles, monthsKeyframes, waterParamsOf, type ClimateKeyframe, type WaterOptions } from './climate.ts';
import { MonthsTile, tilesNear, type MonthsInfo, type MonthsSet, type MonthsTileHeader } from '../../../../core/months.ts';
import { monthsPlace, placeMonths } from '../../../../world/generators/life/climate.ts';
import type { PlaceWorld } from '../../../../world/generators/life/spec.ts';
import { FEATURE_INDEX } from '../../../../core/featuretiles.ts';
import { prominenceOf, tileFeatures } from './featuretiles.ts';
import { buildIce, type IceBuilt } from './ice.ts';
import { hazardLayer, peopleLayer, polityLayer, presentLayer } from './layers.ts';
import { fieldLayers } from './fieldlayers.ts';
import { buildAtlas } from './atlas.ts';
import { buildSeaAtlas, type SeaOut, type SeaParams } from './sea.ts';
import type { LandSnapshot } from '../pbdb.ts';
import { buildScene, witnesses } from './scene.ts';
import { features as buildFeatures, periods as buildPeriods, records as buildRecords, search as buildSearch, sourceRecord, type Solved } from './records.ts';
import { planet as buildPlanet } from './planet.ts';
import { series as buildSeries } from './series.ts';
import { energyBalanceReport, RULES as ENERGY_BALANCE, seriesAt } from './energybalance.ts';
import { territory as buildTerritory } from './territory.ts';
import { tree as buildTree } from './tree.ts';

// Share of PaleoDEM land that must fall inside the plate model's polygons at every snapshot,
// a coarse check that field and frames come from the same model. This pair scores 0.85–1.00
// (mean 0.93); the score drops when the grid is shifted against the polygons.
const MIN_ALIGNMENT = 0.8;

function git(args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function dataCommit(): { commit: string; dirty: boolean } {
  const commit = git(['rev-parse', 'HEAD']) || 'unknown';
  const dirty = git(['status', '--porcelain', '--', 'world', 'core', 'tools']) !== '';
  return { commit, dirty };
}

/** Does a feature's interval (in any scenario) come near a tile's time span? */
/** The alternatives this build shows: a steward decision recorded in each group. */
function shownAlternatives(world: World): Tileset['alternatives'] {
  return world.alternatives
    .filter((g) => g.type === 'group' && g.show?.length)
    .map((g) => ({
      id: g.id,
      title: g.title,
      description: g.description,
      default: g.default ?? null,
      members: g.show!.map((id) => world.alternative.get(id)!).map((a) => ({ id: a.id, title: a.title, description: a.description, kind: a.kind })),
    }));
}

/**
 * The span of the world, in astronomical years: from the oldest time any record, period,
 * field or series reaches to the furthest projection, and at least to the present.
 */
function worldSpan(periods: PeriodRecord[], found: SearchFile, grids: GridField[], series: SeriesFile['series']): [number, number] {
  const times: number[] = [PRESENT_YEAR];
  for (const p of periods) times.push(p.start, ...(Number.isFinite(p.end) ? [p.end] : []));
  for (const e of found.entities) for (const x of [e.time.start.best, e.time.end.best]) if (x !== null && Number.isFinite(x)) times.push(x);
  for (const g of grids) times.push(fromMa(g.coverMa[0]), fromMa(g.coverMa[1]));
  for (const s of series) times.push(s.points[0][0], s.points.at(-1)![0]);
  return [Math.min(...times), Math.max(...times)];
}

/** How many keyframes a file of a climate finer in time holds: each file shares its last with the next file's first. */
const CLIMATE_CHUNK = 12;
/** How many degrees a tile of the months (field:earth/climate-at-height) is square: one a scene fetches. */
const MONTHS_TILE_DEG = 10;

/** How finely the coverage chart asks the layers: columns along the time control's scale, the grid in degrees, and times per column. */
const COVERAGE = { columns: 160, step: 5, samples: 3 };

/** What resolve reads, from what the build has made (core/resolve.ts). */
export function resolveWorldOf(
  world: World,
  solved: Solved,
  grids: GridField[],
  climateKeys: ClimateKeyframe[],
  ice: IceBuilt | undefined,
  people: { header: { steps: number[] } } | undefined,
  polities: PolitiesFile | undefined,
  atlas: ReturnType<typeof buildAtlas>,
  sea?: SeaOut,
  rivers?: { info: RiversInfo; seen?: Uint8Array },
  series: SeriesFile['series'] = [],
): ResolveWorld {
  const land = world.generators.find((g) => g.id === GENERIC_LAND);
  const landParams = land?.params as unknown as GenericLandParams | undefined;
  const mask = land ? generateGenericLand(land.slots.globe.seed, landParams!) : undefined;
  const bins = new Map<number, AtlasBin>();
  const ages = climateKeys.map((k) => k.ageMa);
  // The states of the last time asked: a grid of places is asked at one time after another.
  let rowsT = NaN;
  let rows: ReturnType<typeof politiesAt> = [];
  const rowsAt = (t: number) => {
    if (t !== rowsT && polities) {
      rows = politiesAt(polities, t);
      rowsT = t;
    }
    return rows;
  };
  return {
    planet: buildPlanet(solved),
    geography: grids.map((g) => ({ title: g.field.title, mode: g.mode, coverage: [fromMa(g.coverMa[0]), fromMa(g.coverMa[1])] })),
    climate: ages.length ? [fromMa(Math.max(...ages)), fromMa(Math.min(...ages))] : undefined,
    climateModel: energyBalanceOf(world, series),
    ice: ice?.coverage,
    people: people ? [people.header.steps[0], people.header.steps.at(-1)!] : undefined,
    polities: polities?.rows.length ? [Math.min(...polities.rows.map((r) => r.from)), Math.max(...polities.rows.map((r) => r.to))] : undefined,
    polity: polities ? (lat, lon, t) => rowsAt(t).find((r) => insideRow(r, lon, lat))?.name : undefined,
    life: atlas
      ? (lat, lon, t) => {
          const land = lifeTierOf(atlas.index.bins, atlas.index.grid, (i) => {
            if (!bins.has(i)) bins.set(i, JSON.parse(atlas.files.get(atlas.index.bins[i].file)!) as AtlasBin);
            return bins.get(i);
          }, lat, lon, t);
          // Where the land's atlas has no land, the sea's list.
          if (land !== 'sea' || !sea) return land;
          return seaTierOf(sea.index.bins, sea.index.grid, (i) => sea.bins[i], lat, lon, t) ?? land;
        }
      : undefined,
    genericLand: mask && landParams ? (lat, lon) => genericLandAt(mask, landParams, lat, lon) : undefined,
    water: rivers
      ? {
          observed: rivers.info.observed && rivers.seen ? { span: rivers.info.observed.span, at: (lat, lon) => !!rivers.seen![seenCell(lat, lon)] } : undefined,
          model: rivers.info.sets.map((x) => x.span),
        }
      : undefined,
  };
}

/** The energy-balance model's answer for the climate (core/resolve.ts): the span of its freezing threshold, and its value. */
export function energyBalanceOf(world: World, series: SeriesFile['series']): ResolveWorld['climateModel'] {
  const field = world.fields.find((f) => f.rule === ENERGY_BALANCE.freeze);
  const freeze = field && series.find((x) => x.id === field.id);
  if (!freeze?.points.length) return undefined;
  return { span: [freeze.points[0][0], freeze.points.at(-1)![0]], freezeBelow: (t) => seriesAt(freeze.points, t) };
}

/** The 1° cell of a grid of where rivers were seen that a place falls in. */
const seenCell = (lat: number, lon: number) => Math.min(179, Math.floor(90 - lat)) * 360 + Math.min(359, Math.floor(lon + 180));

/**
 * What answers each layer, and when (core/coverage.ts): the same things resolveWorldOf hands to resolve, each with its
 * span, its tier, and the grain of its grid and its keyframes where it has them. The coverage chart draws them under
 * their layer's row.
 */
export function coverageSources(
  world: World,
  range: [number, number],
  planet: PlanetFile,
  grids: GridField[],
  climate: { field: Field; keys: ClimateKeyframe[] }[],
  ice: { field: Field; built: IceBuilt } | undefined,
  people: { header: { steps: number[]; res: number; source: string; title: string } } | undefined,
  polities: { field: Field; file: PolitiesFile } | undefined,
  atlas: ReturnType<typeof buildAtlas>,
  series: SeriesFile['series'] = [],
  sea?: SeaOut,
  rivers?: RiversInfo,
): CoverageSource[] {
  const out: CoverageSource[] = [];
  // A span that runs on to the end of time stops where the world does: JSON has no infinity.
  const clip = ([a, b]: [number, number]): [number, number] => [Math.max(a, range[0]), Math.min(b, range[1])];
  const grain = (f: Field) => ({
    ...(f.grid?.kind === 'lonlat' ? { res_deg: f.grid.res_deg } : {}),
    ...(f.time?.step ? { step_yr: parseDuration(f.time.step) } : {}),
  });
  for (const ph of planet.planet?.phases ?? []) out.push({ layer: 'planet', id: ph.subject, title: ph.label, tier: 'evidence', span: clip(spanOf(ph, {})), lane: 'phases' });
  for (const g of grids) {
    // A coast drawn at the sea level of each time moves as often as that series has a row.
    const level = g.seaLevel ? series.find((x) => x.id === g.seaLevel) : undefined;
    const steps = level ? level.points.slice(1).map((p, i) => p[0] - level.points[i][0]).sort((a, b) => a - b) : [];
    out.push({ layer: 'geography', id: g.field.id, title: g.field.title, tier: 'model', span: [fromMa(g.coverMa[0]), fromMa(g.coverMa[1])], ...grain(g.field), ...(steps.length ? { step_yr: steps[steps.length >> 1] } : {}) });
  }
  // Generic land stands in wherever no grid covers the time and the planet has oceans.
  const land = world.generators.find((g) => g.id === GENERIC_LAND);
  if (land && planet.planet) {
    const covered = grids.map((g) => [fromMa(g.coverMa[0]), fromMa(g.coverMa[1])] as [number, number]).sort((a, b) => a[0] - b[0]);
    const [born, gone] = spanOf(planet.planet, {});
    let from = Math.max(born, range[0]);
    for (const [a, b] of [...covered, [Math.min(gone, range[1]), Math.min(gone, range[1])] as [number, number]]) {
      if (a > from) out.push({ layer: 'geography', id: land.id, title: land.title, tier: 'generic', span: [from, a], lane: 'generic-land' });
      from = Math.max(from, b);
    }
  }
  for (const c of climate) {
    if (!c.keys.length) continue;
    const ages = c.keys.map((k) => k.ageMa).sort((a, b) => a - b);
    // A step from the field where it gives one, else the commonest between its keyframes.
    const steps = ages.slice(1).map((a, i) => Math.round((a - ages[i]) * 1e6)).sort((a, b) => a - b);
    out.push({ layer: 'climate', id: c.field.id, title: c.field.title, tier: 'model', span: [fromMa(ages.at(-1)!), fromMa(ages[0])], ...(steps.length ? { step_yr: steps[steps.length >> 1] } : {}), ...grain(c.field) });
  }
  // The energy-balance model answers the climate where no climate model's run does, as the CO₂ it would take to freeze.
  const ebm = world.fields.find((f) => f.rule === ENERGY_BALANCE.freeze);
  const ebmSeries = ebm && series.find((x) => x.id === ebm.id);
  if (ebm && ebmSeries?.points.length) out.push({ layer: 'climate', id: ebm.id, title: ebm.title, tier: 'model', span: [ebmSeries.points[0][0], ebmSeries.points.at(-1)![0]], lane: 'energy-balance', ...grain(ebm) });
  if (ice) out.push({ layer: 'ice', id: ice.field.id, title: ice.field.title, tier: 'model', span: ice.built.coverage, ...grain(ice.field) });
  for (const ep of planet.episodes) out.push({ layer: 'ice', id: ep.subject, title: ep.label, tier: 'evidence', span: clip(spanOf(ep, {})), lane: 'glaciations' });
  if (rivers) {
    // The drainage on today's ground for the glacial cycles, and on each PaleoDEM before; the rivers Landsat saw today.
    for (const today of [true, false]) {
      const sets = rivers.sets.filter((x) => (x.frameMa === 0) === today);
      if (!sets.length) continue;
      const keys = sets.flatMap((x) => x.chunks.flatMap((c) => c.keyframesMa)).sort((a, b) => a - b);
      const steps = keys.slice(1).map((a, i) => Math.round((a - keys[i]) * 1e6)).sort((a, b) => a - b);
      out.push({ layer: 'water', id: rivers.field, title: rivers.title, tier: 'model', span: [Math.min(...sets.map((x) => x.span[0])), Math.max(...sets.map((x) => x.span[1]))], res_deg: today ? 0.1 : 1, ...(steps.length ? { step_yr: steps[steps.length >> 1] } : {}) });
    }
    if (rivers.observed) out.push({ layer: 'water', id: rivers.observed.field, title: rivers.observed.title, tier: 'evidence', span: rivers.observed.span });
  }
  if (atlas) {
    const bins = atlas.index.bins;
    const span: [number, number] = [Math.min(...bins.map((b) => b.from)), Math.max(...bins.map((b) => b.to))];
    const field = world.fields.find((f) => f.data?.as === 'community');
    out.push({ layer: 'life', id: atlas.index.source, title: world.source.get(atlas.index.source)?.title ?? atlas.index.source, tier: 'evidence', span });
    if (field) out.push({ layer: 'life', id: field.id, title: field.title, tier: 'model', span, res_deg: atlas.index.grid.step });
  }
  if (sea) {
    const bins = sea.index.bins;
    const span: [number, number] = [Math.min(...bins.map((b) => b.from)), Math.max(...bins.map((b) => b.to))];
    const field = world.fields.find((f) => f.data?.as === 'community-sea');
    out.push({ layer: 'life', id: sea.index.source, title: world.source.get(sea.index.source)?.title ?? sea.index.source, tier: 'evidence', span });
    if (field) out.push({ layer: 'life', id: field.id, title: field.title, tier: 'model', span, res_deg: sea.index.grid.step });
  }
  if (people) {
    const field = world.fields.find((f) => f.data?.as === 'people');
    out.push({ layer: 'people', id: field?.id ?? people.header.source, title: people.header.title, tier: 'model', span: [people.header.steps[0], people.header.steps.at(-1)!], res_deg: people.header.res });
  }
  if (polities?.file.rows.length) {
    const rows = polities.file.rows;
    out.push({ layer: 'polity', id: polities.field.id, title: polities.field.title, tier: 'evidence', span: [Math.min(...rows.map((r) => r.from)), Math.max(...rows.map((r) => r.to))] });
  }
  return out.map((s) => ({ ...s, span: clip(s.span) })).filter((s) => s.span[1] > s.span[0]);
}

/** What the overlays say of each row they name, with what the row itself says, as the inspect panel shows it. */
function overlayFile(world: World, index: ClaimIndex): OverlaysFile | undefined {
  if (!world.overlays.length) return undefined;
  const rows: OverlaysFile['rows'] = {};
  for (const o of [...world.overlays].sort((a, b) => (a.row < b.row ? -1 : 1))) {
    rows[o.row] = {
      dataset: o.dataset,
      key: o.key,
      same_as: o.same_as,
      note: o.note,
      claims: index.of(o.row).map((c) => ({ prop: c.prop, value: c.value, origin: c.origin, rank: c.rank, status: c.status, level: c.level, author: c.author, sources: c.sources, note: c.note })),
    };
  }
  return { format: 'lightworld-overlays@1', rows };
}

/** Claims and wanted records, and how much of each tile's area and era rests on each basis. */
function coverage(world: World, wanted: { ref: string; from: { file: string; where: string }[] }[], feats: Feature[], tiles: TileRef[]): CoverageFile {
  const all = [...world.entities.flatMap((e) => [...e.claims, ...e.relations]), ...world.overlays.flatMap((o) => o.claims)];
  const byBasis: Record<string, number> = {};
  for (const c of all) byBasis[c.basis] = (byBasis[c.basis] ?? 0) + 1;
  const visible = (f: Feature, span: [number, number]) => {
    const lo = Number.isFinite(f.time.start.lo) ? f.time.start.lo : f.time.start.best ?? -Infinity;
    const hi = f.time.end.best === null ? Infinity : Number.isFinite(f.time.end.hi) ? f.time.end.hi : f.time.end.best;
    return lo <= span[1] && hi >= span[0];
  };
  return {
    claims: {
      total: all.length,
      byBasis,
      unsourced: all.filter((c) => c.unsourced).map((c) => c.ref),
      disputed: all.filter((c) => c.status === 'disputed').map((c) => c.ref),
      proposed: all.filter((c) => c.status === 'proposed').length,
      withoutLocator: all.filter((c) => c.sources.some((s) => !s.loc)).length,
      ladder: ladderCounts(all),
    },
    wanted: wanted.map((w) => ({ ref: w.ref, from: w.from.map((f) => `${f.file} ${f.where}`) })),
    tiles: tiles.map((t) => {
      const counts: Partial<Record<Basis, number>> = {};
      for (const f of feats) {
        const [w, s, e, n] = t.bbox;
        const inside = f.location.lon >= w && f.location.lon < e && f.location.lat >= s && f.location.lat <= n;
        if (!visible(f, t.time) || (t.lod > 0 && !inside)) continue;
        counts[f.basis.place] = (counts[f.basis.place] ?? 0) + 1;
      }
      return { tile: t.id, bbox: t.bbox, time: t.time, features: counts };
    }),
  };
}

/** What the viewer needs to know of a gridded field: what it is, and when it covers. */
function fieldInfo(world: World, g: GridField): FieldInfo {
  const f = g.field;
  const src = world.source.get(f.data!.from);
  const coastline = world.fields.find((c) => c.derived && c.rule === 'isoline' && c.from?.[0] === f.id);
  return {
    id: f.id,
    title: f.title,
    mode: g.mode,
    description: f.description,
    units: f.unit,
    datum: f.datum,
    basis: f.basis!,
    interpolation: f.interp!,
    source: f.data!.from,
    sourceRecord: src ? sourceRecord(src) : undefined,
    coverage: [fromMa(g.coverMa[0]), fromMa(g.coverMa[1])],
    keyframesMa: g.snapshots.map((s) => s.ageMa),
    projection: f.projection ? { method: f.projection.method, until: parsePoint(f.projection.until as TimePointInput).t, note: f.projection.note } : undefined,
    coastline: coastline ? { id: coastline.id, title: coastline.title, isolineM: coastline.isoline_m ?? 0, ...(g.seaLevel ? { seaLevel: g.seaLevel } : {}) } : undefined,
    spread: f.spread,
    res_deg: g.res,
  };
}

export async function runBuild(args: string[]): Promise<number> {
  const log = (s: string) => console.log(s);
  const out = new Map<string, Uint8Array | string>(); // path → content
  const put = (path: string, content: Uint8Array | string) => out.set(path, content);

  // 1. Validate.
  const world = await loadWorld();
  const { issues, wanted } = await validateWorld(world);
  for (const i of issues) if (i.level !== 'info') log(formatIssue(i));
  if (issues.some((i) => i.level === 'error')) {
    log('build: the world does not validate');
    return 1;
  }

  // 2. Frames: the plate model's rotations, baked for the client.
  const pm = world.manifest.datasets[PLATE_MODEL];
  const rot = await readFile(datasetFile(PLATE_MODEL, pm, 'rotations'), 'latin1');
  const baked = bakeRotationModel(parseRot(rot));
  const model = new RotationModel(baked);

  // Rows are claims (docs/STRUCTURE.md section 3.1): the overlays' corrections of the rows they name, which the
  // layers and the atlas read the rows with. The land's fossils are corrected here, before anything reads them.
  const claims = await ClaimIndex.of(world, world.overlays.map((o) => o.dataset));
  const fixesOf = (as: string) => {
    const f = world.fields.find((x) => x.data?.as === as);
    return f ? claims.corrections(f.data!.from) : new Map();
  };
  for (const f of world.fields.filter((x) => x.data?.as === 'community' && x.rows)) {
    const snap = world.landFossils.get(f.data!.from);
    if (!snap) continue;
    const { snap: corrected, unapplied } = correctLand(snap, f.rows!, claims.corrections(f.data!.from));
    world.landFossils.set(f.data!.from, corrected);
    for (const u of unapplied) log(`warning rows        ${f.data!.from} ${u}`);
  }

  // 3. Chronology: the default picture, the alternatives the build shows, and each picture
  // with one competing claim picked.
  const sol = solveScenario(world);
  if (!sol.ok) throw new Error('unreachable: validated world has no solution');
  const alternatives = shownAlternatives(world);
  const solved: Solved = {
    world,
    sol,
    centres: solveScenario(world, {}, true),
    // An alternative that no claim names, such as one that changes only a field, moves no record.
    variants: solveVariants(world, alternatives.flatMap((g) => g.members.map((m) => m.id)).filter((id) => world.entities.some((e) => [...e.claims, ...e.relations].some((c) => c.alt === id)))),
    groups: claimGroups(world),
    model,
  };

  // 4. Gridded fields: elevation grids, and before them the plate model's blocks.
  const grids: GridField[] = [];
  const imports: Record<string, string> = {};
  let pygplates = '';
  for (const f of world.fields.filter(tiledField)) {
    if (fieldSource(f) === 'relief') {
      // Today's relief, averaged onto the field's grid, and the plates under it: one snapshot, which its coastline
      // reads at the sea level of each time the field covers.
      const dir = await importReliefPlates(f, log);
      imports[f.id] = dir.split('/').pop()!;
      const d = world.manifest.datasets[f.data!.from];
      const res = (f.grid as { res_deg: number }).res_deg;
      const started = Date.now();
      const relief = await meanGrid(datasetFile(d.id, d), res);
      // Hollows today's ocean does not reach are held at the pass they would spill over, so that only the ocean floods.
      const water = f.data!.water;
      const areas = async (id: string) => JSON.parse(await readFile(datasetFile(id, world.manifest.datasets[id]), 'utf8')) as Areas;
      const mask = water ? waterMask(await areas(water.ocean), await areas(water.lakes), relief.nx, relief.ny, res) : undefined;
      const ground = mask ? fillFromOcean(relief.data, mask, relief.nx, relief.ny) : Int16Array.from(relief.data, (v) => Math.max(-32768, Math.min(32767, Math.round(v))));
      const snap = await loadRelief(dir, relief, ground);
      const coast = world.fields.find((c) => c.derived && c.rule === 'isoline' && c.from?.[0] === f.id);
      const oldest = toMa(parsePoint(f.time!.lo as TimePointInput).t);
      const until = f.projection ? toMa(parsePoint(f.projection.until as TimePointInput).t) : 0;
      // The drainage routes over each cell's lowest ground, so that a gorge narrower than a cell stays open.
      const drain = mask ? { z: relief.low, ocean: Uint8Array.from(mask, (v) => (v === WATER.ocean ? 1 : 0)), lakes: Uint8Array.from(mask, (v) => (v === WATER.lake ? 1 : 0)) } : undefined;
      grids.push({ field: f, mode: 'elevation', snapshots: [snap], coverMa: [oldest, until], res, seaLevel: coast?.from?.[1], drain });
      log(`relief  ${f.id}: ${snap.src!.width} × ${snap.src!.height} nodes at ${res}° from ${d.id} in ${((Date.now() - started) / 1000).toFixed(1)} s${coast?.from?.[1] ? `; its coast at the sea level of ${coast.from[1]}` : ''}`);
      continue;
    }
    const mode = fieldSource(f) as 'elevation' | 'blocks';
    const dir = mode === 'elevation' ? await importElevation(f, log) : await importBlocks(f, log);
    imports[f.id] = dir.split('/').pop()!;
    const { meta, snapshots } = mode === 'elevation' ? await loadSnapshots(dir) : await loadBlocks(dir);
    pygplates = meta.pygplates;
    if (mode === 'elevation') {
      for (const s of (meta as Awaited<ReturnType<typeof loadSnapshots>>['meta']).snapshots) {
        if (s.alignment.land_inside_polygons < MIN_ALIGNMENT) {
          log(`error   fields      ${f.id} ${s.ageMa} Ma: only ${s.alignment.land_inside_polygons} of its land lies inside the plate model's polygons (min ${MIN_ALIGNMENT}); field and frames disagree`);
          return 1;
        }
      }
    }
    const { maxAgeMa } = fieldAgesMa(f);
    const oldest = Math.min(maxAgeMa, Math.max(...snapshots.map((s) => s.ageMa)));
    const youngest = Math.min(...snapshots.map((s) => s.ageMa));
    const until = f.projection ? toMa(parsePoint(f.projection.until as TimePointInput).t) : youngest;
    grids.push({ field: f, mode, snapshots, coverMa: [oldest, Math.min(youngest, until)], res: (f.grid as { res_deg: number }).res_deg });
  }
  // A plate model other than the first writes its plates in a range of their own, and its rotations go with the frames.
  const otherModels = [...new Set(grids.map((g) => g.field.moves_with).filter((m): m is string => !!m && m !== PLATE_MODEL))].sort();
  for (const g of grids) {
    const i = otherModels.indexOf(g.field.moves_with ?? '');
    if (i >= 0) g.plateOffset = (i + 1) * PLATE_OFFSET;
  }
  // Where two fields meet, the younger one is preferred at the shared age, and of two that end together the one that
  // covers less, which is the finer.
  grids.sort((a, b) => a.coverMa[1] - b.coverMa[1] || a.coverMa[0] - a.coverMa[1] - (b.coverMa[0] - b.coverMa[1]));
  const plateIds = new Set<number>();
  for (const g of grids) for (const s of g.snapshots) for (const p of s.plate) if (p) plateIds.add(p + (g.plateOffset ?? 0));
  const plateIndexList = [0, ...[...plateIds].sort((a, b) => a - b)];
  const plateIndex = new Map(plateIndexList.map((p, i) => [p, i]));
  // Each other model's rotations, kept to the sequences that reach the ages its fields cover.
  const models = await Promise.all(
    otherModels.map(async (id, i) => {
      const d = world.manifest.datasets[id];
      const texts = await Promise.all(['rotations', 'rotations_deep'].filter((n) => d.fetch.files?.[n]).map((n) => readFile(datasetFile(id, d, n), 'latin1')));
      const youngest = Math.min(...grids.filter((g) => g.field.moves_with === id).map((g) => Math.min(...g.snapshots.map((s) => s.ageMa))));
      const all = bakeRotationModel(parseRot(texts.join('\n')));
      return { source: id, offset: (i + 1) * PLATE_OFFSET, rotations: { ...all, sequences: all.sequences.filter((q) => q.ages[q.ages.length - 1] >= youngest) } };
    }),
  );
  const frames: FramesFile = {
    rotations: baked,
    ...(models.length ? { models } : {}),
    plateIndex: plateIndexList,
    frames: world.frames.map((f) => ({ id: f.id, title: f.title, kind: f.kind, plate: f.kind === 'plate' ? f.transform?.plate : undefined, entity: f.entity })),
  };
  put('frames.json', stableStringify(frames));

  // 5. Generators: run each slot from its record's seed and parameters.
  const code = [
    { id: CLOUDS, version: CLOUDS_VERSION, run: (seed: string, p: unknown) => generateClouds(seed, p as CloudParams) },
    { id: SURFACE, version: SURFACE_VERSION, run: (seed: string, p: unknown) => generateSurface(seed, p as SurfaceParams) },
    { id: BIOME_TEXTURE, version: BIOME_TEXTURE_VERSION, run: (seed: string, p: unknown) => generateBiomeTexture(seed, p as BiomeTextureParams) },
    { id: GENERIC_LAND, version: GENERIC_LAND_VERSION, run: (seed: string, p: unknown) => generateGenericLand(seed, p as GenericLandParams) },
  ];
  const generators: GeneratorConstraint[] = [];
  for (const c of code) {
    const gen = world.generators.find((g) => g.id === c.id);
    if (!gen || gen.version !== c.version) {
      log(`error   generators  ${c.id}: the record is version ${gen?.version ?? 'missing'}, the code version ${c.version}`);
      return 1;
    }
    for (const [slot, s] of Object.entries(gen.slots)) {
      generators.push({
        generator: gen.id,
        version: gen.version,
        slot,
        seed: s.seed,
        basis: gen.outputs.basis as 'procedural',
        params: gen.params,
        output: bytesPrint('pixels', c.run(s.seed, gen.params)),
      });
    }
  }

  // 6. Records, periods, search and series, whose times set the span of the tile set.
  const allFeatures = buildFeatures(solved);
  const periodList = buildPeriods(solved);
  const found = buildSearch(solved, allFeatures);
  const seriesList = await buildSeries(world);
  const span = worldSpan(periodList, found, grids, seriesList);

  // The markers, tiled apart from the terrain: by time, place and prominence.
  const rule = world.vocab.prominence;
  const prominent = new Map(world.entities.map((e) => [e.id, prominenceOf(rule, e)]));
  const tiledFeatures = tileFeatures(allFeatures, rule, (f) => prominent.get(f.id) ?? 0);
  for (const [path, content] of tiledFeatures.files) put(path, content);
  log(`features ${tiledFeatures.index.tiles.length} tiles, ${Object.keys(tiledFeatures.index.where).length} features`);

  // 7. Tiles: every span of time has LOD 0 tiles (its generator constraints, and
  // the field that covers it, if any); spans with a field also have finer LOD 1 tiles.
  const cuts = grids.flatMap((g) => [g.snapshots[0].ageMa, g.snapshots.at(-1)!.ageMa, g.coverMa[0]]);
  const lods = fieldLods(timeBins(toMa(span[0]), toMa(span[1]), cuts), grids);
  const tiles: TileRef[] = [];
  for (const lod of lods) {
    lod.cells.forEach((cell, ci) => {
      const grid = tileGrid(lod, cell);
      const x = ci % lod.across;
      const y = Math.floor(ci / lod.across);
      lod.binsMa.forEach(([older, younger], bi) => {
        const g = fieldFor(grids, [older, younger]);
        const arrays: (Int16Array | Uint16Array)[] = [];
        let field: TileHeader['field'] = null;
        if (g) {
          // Every keyframe inside the span, and the ones on either side of it, which the times inside it blend between.
          const ages = g.snapshots.map((s) => s.ageMa);
          const below = ages.filter((a) => a <= younger);
          const above = ages.filter((a) => a >= older);
          const lo = below.length ? Math.max(...below) : Math.min(...ages);
          const hi = above.length ? Math.min(...above) : Math.max(...ages);
          const keys = g.snapshots.filter((s) => s.ageMa >= lo && s.ageMa <= hi);
          const keyframes: FieldKeyframe[] = sliceField(keys, grid, plateIndex, g.plateOffset).map((k) => {
            arrays.push(k.elev, k.plate);
            return { t: fromMa(k.ageMa), ageMa: k.ageMa, elev: arrays.length - 2, plate: arrays.length - 1 };
          });
          field = { id: g.field.id, grid, keyframes };
        }
        const time: [number, number] = [fromMa(older), fromMa(younger)];
        const id = `${lod.lod}/${x}-${y}/b${bi}`;
        const parentBin = lods[0].binsMa.findIndex(([o, yy]) => younger >= yy && older <= o);
        const header: TileHeader = {
          format: 'lightworld-tile@4',
          id,
          lod: lod.lod,
          bbox: cell,
          time,
          field,
          generators: lod.lod === 0 ? generators : [],
        };
        const bytes = encodeTile(header as unknown as Record<string, unknown>, arrays, stableStringify);
        const url = `tiles/${lod.lod}/${x}-${y}/b${bi}.lwt`;
        put(url, bytes);
        tiles.push({ id, lod: lod.lod, bbox: cell, time, url, bytes: bytes.length, sha256: sha256(bytes), parent: lod.lod === 0 ? null : `0/0-0/b${parentBin}` });
      });
    });
  }

  // 8. Records, periods, search, series, coverage.
  const recs = buildRecords(solved);
  for (const r of recs) put(`records/${r.id}.json`, stableStringify(r));
  const periods: PeriodsFile = {
    periods: periodList,
    sources: Object.fromEntries(
      [...new Set(world.entities.filter((e) => e.kind.startsWith('period/')).flatMap((e) => e.claims.flatMap((c) => c.sources.map((s) => s.ref))))]
        .sort()
        .map((id) => [id, sourceRecord(world.source.get(id)!)]),
    ),
  };
  put('periods.json', stableStringify(periods));
  put('search.json', stableStringify(found));
  put('series.json', stableStringify({ series: seriesList } satisfies SeriesFile));
  put('planet.json', stableStringify(buildPlanet(solved)));
  const territoryFile = await buildTerritory(solved, log);
  put('territory.json', stableStringify(territoryFile));
  put('tree.json', stableStringify(buildTree(solved)));
  // The climate field, on the plates of the elevation's snapshots, and the rule the biomes follow.
  const climateField = world.fields.find((f) => fieldSource(f) === 'climate' && !f.data?.variables);
  const biomeField = world.fields.find((f) => f.rule === 'biome-from-climate');
  let climateKeys: ClimateKeyframe[] = [];
  // The water balance of each climate's months (field:earth/runoff), which the rivers are routed from.
  const runoffField = world.fields.find((f) => f.rule === 'water-balance');
  const paleo = paleoElevation(grids);
  const nearestSnapshot = (ageMa: number) => paleo!.snapshots.reduce((a, b) => (Math.abs(b.ageMa - ageMa) < Math.abs(a.ageMa - ageMa) ? b : a));
  const waterOptions: WaterOptions | undefined = runoffField && paleo ? { params: waterParamsOf(runoffField.params ?? {}), height: (ageMa) => heightOn(nearestSnapshot(ageMa)) } : undefined;
  // Each climate's months at a height (field:earth/climate-at-height), which a scene brings to its own ground.
  const heightField = world.fields.find((f) => f.rule === 'lapse-rate');
  const heightParams = heightField?.params as { lapse_c_per_km: number; g0: number } | undefined;
  // The land of a cell of the last 120,000 years' climate at a time: the mean of today's ground on the relief's grid
  // within it, none of it below the sea of the time.
  const cellHeight = (() => {
    const relief = grids.find((g) => g.drain && g.seaLevel);
    if (!relief) return undefined;
    const snap = relief.snapshots[0];
    const { width, height, step } = snap.src!;
    const stack = seriesList.find((x) => x.id === relief.seaLevel)?.points as unknown as [number, number][] | undefined;
    if (!stack) return undefined;
    return (ageMa: number) => {
      const sea = seaLevelAt(stack, fromMa(ageMa));
      return (lat: number, lon: number, half: number) => {
        const j0 = Math.max(0, Math.ceil((90 - lat - half) / step - 1e-9));
        const j1 = Math.min(height - 1, Math.floor((90 - lat + half) / step - 1e-9));
        const i0 = Math.ceil((lon + 180 - half) / step - 1e-9);
        const i1 = Math.floor((lon + 180 + half) / step - 1e-9);
        let sum = 0;
        let n = 0;
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const z = snap.elev[j * width + (((i % width) + width) % width)];
            sum += z > sea ? z : sea;
            n++;
          }
        }
        return n ? sum / n : sea;
      };
    };
  })();
  const monthsSets: MonthsSet[] = [];
  // The months' files as written, which a witness scene reads as a browser would.
  const monthBytes = new Map<string, Uint8Array>();
  const putMonth = (path: string, bytes: Uint8Array) => {
    monthBytes.set(path, bytes);
    put(path, bytes);
  };
  const putMonths = (f: Field, keys: ClimateKeyframe[]) => {
    const grid = climateGrid((f.grid as { res_deg: number }).res_deg);
    const slug = f.id.replace(/^field:/, '').replace(/\//g, '-');
    const out = monthsFiles(f.id, `months/${slug}`, grid, keys, MONTHS_TILE_DEG);
    for (const [path, bytes] of out.files) putMonth(path, bytes);
    const frames = new Set(keys.map((k) => k.frameMa ?? k.ageMa));
    monthsSets.push({ field: f.id, title: f.title, keyframesMa: keys.map((k) => k.ageMa).sort((a, b) => a - b), ...(frames.size === 1 ? { frameMa: [...frames][0] } : {}), step: grid.step, tile_deg: MONTHS_TILE_DEG, tiles: out.tiles });
    // What is written is all a scene needs of them; the rest of the build reads only the nodes and the water.
    for (const k of keys) delete k.months;
  };
  if (climateField && biomeField) {
    const elevation = paleoElevation(grids)!;
    climateKeys = await climateKeyframes(world, climateField, elevation.snapshots, plateIndex, log, waterOptions, heightParams ? { g0: heightParams.g0 } : undefined);
    put('climate.lwt', encodeClimate(climateGrid((climateField.grid as { res_deg: number }).res_deg), climateKeys, biomeField.params as unknown as ClimateRule));
  }
  // Climates finer in time than the deep past's runs, read as months, on today's coordinates and the plates under them
  // today: in files of a span of their keyframes, which the viewer loads as the time shown comes to them.
  const recentClimates: { field: Field; keys: ClimateKeyframe[]; chunks: { file: string; keyframesMa: number[] }[] }[] = [];
  if (biomeField) {
    for (const f of world.fields.filter((x) => fieldSource(x) === 'climate' && x.data?.variables)) {
      const dir = await importMonths(f, f.data!.variables!, log);
      imports[f.id] = dir.split('/').pop()!;
      const keys = await monthsKeyframes(f, dir, paleoElevation(grids)!.snapshots.find((x) => x.ageMa === 0)!, plateIndex, log, waterOptions, heightParams && cellHeight ? { height: cellHeight } : undefined);
      const grid = climateGrid((f.grid as { res_deg: number }).res_deg);
      const slug = f.id.replace(/^field:/, '').replace(/\//g, '-');
      const chunks: { file: string; keyframesMa: number[] }[] = [];
      for (let i = 0; ; i += CLIMATE_CHUNK - 1) {
        const part = keys.slice(i, i + CLIMATE_CHUNK);
        const file = `climate/${slug}/${chunks.length}.lwt`;
        put(file, encodeClimate(grid, part, biomeField.params as unknown as ClimateRule));
        chunks.push({ file, keyframesMa: part.map((k) => k.ageMa) });
        if (i + CLIMATE_CHUNK >= keys.length) break;
      }
      recentClimates.push({ field: f, keys, chunks });
      if (heightParams) putMonths(f, keys);
    }
  }
  if (heightParams && climateField && climateKeys.length) putMonths(climateField, climateKeys);
  const monthsInfo: MonthsInfo | undefined = heightField && heightParams && monthsSets.length && waterOptions ? { water: waterOptions.params, field: heightField.id, title: heightField.title, model: 'model:earth/lapse-rate', lapse: heightParams.lapse_c_per_km, sets: monthsSets } : undefined;
  if (monthsInfo) log(`months  ${monthsSets.map((x) => `${x.field}: ${x.keyframesMa.length} keyframes in ${Object.keys(x.tiles).length} tiles`).join('; ')}`);
  // The rivers and lakes of every time (model:earth/drainage): today's ground at the sea of each time for the glacial
  // cycles, with the water of the climate of the last 120,000 years, and before that each PaleoDEM with its run's.
  const riversField = world.fields.find((f) => f.rule === 'drainage' && f.kind === 'lines');
  const lakesField = world.fields.find((f) => f.rule === 'drainage' && f.kind === 'areas');
  let riversInfo: RiversInfo | undefined;
  let riversSeen: Uint8Array | undefined;
  // The rivers' files as written, which a witness scene reads as a browser would.
  const riverBytes = new Map<string, Uint8Array>();
  const putRiver = (path: string, bytes: Uint8Array) => {
    riverBytes.set(path, bytes);
    put(path, bytes);
  };
  if (riversField && lakesField && waterOptions) {
    const started = Date.now();
    const p = { ...(riversField.params as unknown as DrainageParams), ...(lakesField.params as { min_lake_km2: number; spill_overlap: number }) };
    const sets: RiversSet[] = [];
    const relief = grids.find((g) => g.drain && g.seaLevel);
    const recent = recentClimates.find((c) => c.keys.every((k) => k.water));
    let recentFrom = Infinity;
    if (relief && recent) {
      const stack = seriesList.find((x) => x.id === relief.seaLevel)!.points as unknown as [number, number][];
      const rg = climateGrid((recent.field.grid as { res_deg: number }).res_deg);
      const waterOf = (k: ClimateKeyframe): Water => ({ ageMa: k.ageMa, grid: rg, runoff: k.water!.runoff, loss: k.water!.loss });
      const times = recent.keys.map((k) => ({ ageMa: k.ageMa, water: waterOf(k) }));
      // Before the climate begins, the keyframe of it whose sea stood nearest: a glacial for a glacial, an interglacial for an interglacial.
      const levelOf = (ageMa: number) => seaLevelAt(stack, fromMa(ageMa));
      const step = p.older_step_yr / 1e6;
      const youngest = Math.max(...recent.keys.map((k) => k.ageMa));
      for (let a = Math.ceil(youngest / step) * step + step; a <= relief.coverMa[0] + 1e-9; a += step) {
        const s = levelOf(a);
        const like = recent.keys.reduce((x, y) => (Math.abs(levelOf(y.ageMa) - s) < Math.abs(levelOf(x.ageMa) - s) ? y : x));
        times.push({ ageMa: Math.round(a * 1e6) / 1e6, water: waterOf(like) });
      }
      const snap = relief.snapshots[0];
      const g = { nx: snap.src!.width, ny: snap.src!.height, step: relief.res };
      const net = recentRivers(relief.drain!.z, relief.drain!.ocean, g, stack, times, p, (k) => snap.plate[k], relief.drain!.lakes);
      recentFrom = fromMa(relief.coverMa[0]);
      const out = riverFiles(net, 'rivers/recent', [recentFrom, fromMa(relief.coverMa[1])], true);
      for (const [path, bytes] of out.files) putRiver(path, bytes);
      sets.push(out.set);
      log(`rivers  ${net.reaches.length} reaches of today's ground, ${net.keyframes.length} keyframes back to ${relief.coverMa[0]} Ma`);
    }
    const coast = world.fields.find((f) => f.id === 'field:earth/coastline')?.isoline_m ?? 20;
    const deep = climateKeys.filter((k) => k.water).sort((a, b) => a.ageMa - b.ageMa);
    const half = deep.length > 1 ? (deep[1].ageMa - deep[0].ageMa) / 2 : 5;
    const cg = climateField ? climateGrid((climateField.grid as { res_deg: number }).res_deg) : undefined;
    for (const k of deep) {
      const snap = paleo!.snapshots.find((x) => x.ageMa === k.ageMa);
      if (!snap || !cg) continue;
      const span: [number, number] = [fromMa(k.ageMa + half), Math.min(fromMa(Math.max(0, k.ageMa - half)), recentFrom)];
      if (span[1] <= span[0]) continue;
      const net = deepRivers(snap.elev, { nx: 360, ny: 181, step: 1 }, coast, k.ageMa, { ageMa: k.ageMa, grid: cg, runoff: k.water!.runoff, loss: k.water!.loss }, p, (n) => snap.plate[n]);
      const out = riverFiles(net, `rivers/deep/${k.ageMa}`, span);
      for (const [path, bytes] of out.files) putRiver(path, bytes);
      sets.push(out.set);
    }
    // Rivers wider than 30 m as Landsat saw them: tiles of 10° for scenes, and one thinned file for the globe.
    const widthsField = world.fields.find((f) => f.data?.as === 'river-widths');
    let observed: RiversInfo['observed'];
    if (widthsField) {
      const id = widthsField.data!.from;
      const d = world.manifest.datasets[id];
      const segs = grwlSegments(await readFile(datasetFile(id, d, 'shp')), await readFile(datasetFile(id, d, 'dbf')));
      riversSeen = new Uint8Array(360 * 180);
      for (const x of segs) if (x.flag !== 1) for (let i = 0; i < x.xy.length; i += 2) riversSeen[seenCell(x.xy[i + 1], x.xy[i])] = 1;
      const step = 10;
      const byTile: Record<string, string> = {};
      for (const [key, part] of [...segmentTiles(segs, step)].sort(([a], [b]) => a.localeCompare(b))) {
        const [i, j] = key.split('_').map(Number);
        const file = `rivers/observed/${key}.lwt`;
        putRiver(file, encodeSegments(part, [-180 + i * step, 90 - (j + 1) * step, -180 + (i + 1) * step, 90 - j * step]));
        byTile[key] = file;
      }
      put('rivers/observed/globe.lwt', encodeSegments(segs.map((x) => ({ ...x, xy: thin(x.xy, 0.02) })), [-180, -90, 180, 90]));
      const t = widthsField.time!;
      observed = { field: widthsField.id, title: widthsField.title, source: id, credit: d.credit, span: [parsePoint(t.lo as TimePointInput).t, parsePoint(t.hi as TimePointInput).t], step, tiles: byTile, globe: 'rivers/observed/globe.lwt' };
      log(`rivers  ${segs.length} observed segments in ${Object.keys(byTile).length} tiles of ${step}°`);
    }
    riversInfo = { field: riversField.id, title: riversField.title, description: riversField.description, lakes: { field: lakesField.id, title: lakesField.title }, model: 'model:earth/drainage', params: riversField.params ?? {}, sets, ...(observed ? { observed } : {}) };
    log(`rivers  ${sets.length} sets in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
  // A scene's water, from the rivers' files as written, as a browser reads them (world/generators/life/water.ts).
  const decoded = <H>(f: string) => {
    const b = riverBytes.get(f)!;
    return decodeTile<H>(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  };
  const nets = new Map<string, RiverNet>();
  const keySets = new Map<string, RiverKey[]>();
  const tilesRead = new Map<string, RiverWidths>();
  const waterAt = riversInfo
    ? (t: number, ageMa: number, at: { lat: number; lon: number }, isoline: number): SceneWater | undefined => {
        const info = riversInfo!;
        const set = info.sets.find((x) => x.span[0] <= t && t < x.span[1]);
        const kf = set && keyFile(set, ageMa);
        if (!set || !kf) return undefined;
        if (!nets.has(set.network)) {
          const { header, arrays } = decoded<RiversNetworkHeader>(set.network);
          nets.set(set.network, new RiverNet(header, arrays));
        }
        if (!keySets.has(kf.file)) {
          const { header, arrays } = decoded<RiversKeysHeader>(kf.file);
          keySets.set(kf.file, riverKeys(header, arrays));
        }
        const observed =
          set.today && info.observed
            ? observedFiles(info.observed, at.lat, at.lon).map((f) => {
                if (!tilesRead.has(f)) {
                  const { header, arrays } = decoded<RiverWidthsHeader>(f);
                  tilesRead.set(f, riverWidths(header, arrays));
                }
                return tilesRead.get(f)!;
              })
            : [];
        return sceneWater(info, set, nets.get(set.network)!, keySets.get(kf.file)![kf.i], observed, at, isoline);
      }
    : undefined;
  // The ice sheets, on the plates of the present.
  const iceField = world.fields.find((f) => fieldSource(f) === 'ice');
  let ice: IceBuilt | undefined;
  if (iceField) {
    const present = paleoElevation(grids)!.snapshots.find((s) => s.ageMa === 0)!;
    ice = await buildIce(world, iceField, present, plateIndex, log);
    put('ice.lwt', ice.bytes);
  }
  const city = await buildCity(solved, log);
  if (city) {
    for (const [path, bytes] of city.blobs) put(path, bytes);
    put(`city/${city.file.site.id}.json`, stableStringify(city.file));
  }
  // The outline's check of the biomes, and how much of the world rests on what.
  const coverageFile = coverage(world, wanted, allFeatures, tiles);
  // The energy-balance model against the evidence it does not read: soils, Snowballs, today, the Phanerozoic.
  const balance = energyBalanceReport(world, buildPlanet(solved), seriesList);
  if (balance) {
    coverageFile.energyBalance = balance;
    for (const e of balance.evidence) log(`climate  energy balance at ${e.id} (${e.ageMa} Ma, ${e.co2.join('–')} bar): freezes below ${e.freezeBelow} bar; ${e.frozen} of ${e.members} runs frozen`);
    for (const g of balance.glaciations) log(`climate  energy balance for ${g.id}: freezes below ${g.freezeBelowAtStart} bar at its start, thaws ${g.thawAboveAtEnd === null ? 'only above the model\'s limit' : `above ${g.thawAboveAtEnd} bar`} at its end${g.co2AtEnd ? `; the rocks give ${[...new Set(g.co2AtEnd.value)].join('–')} bar` : ''}`);
    if (balance.phanerozoic) {
      const d = balance.phanerozoic.meanDifference;
      log(`climate  energy balance over the Phanerozoic against ${balance.phanerozoic.against}: ${Math.abs(d)} °C ${d < 0 ? 'colder' : 'warmer'} on average, r = ${balance.phanerozoic.correlation}`);
    }
  }
  if (climateKeys.length && biomeField) {
    const forests = forestChecks(solved, climateKeys, climateGrid((climateField!.grid as { res_deg: number }).res_deg), biomeField.params as unknown as ClimateRule);
    coverageFile.forests = forests;
    const dry = forests.filter((f) => f.climate === 'desert');
    log(`biomes  ${forests.length} fossil forests against the climate field: ${dry.length ? `${dry.length} in a reconstructed desert: ${dry.map((f) => `${f.id} (${f.ageMa} Ma)`).join(', ')}` : 'none in a reconstructed desert'}`);
  }
  put('coverage.json', stableStringify(coverageFile));
  // What is drawn over the globe as rows of a dataset: today's map, and the hazards.
  const present = await presentLayer(world);
  if (present) put('present.json', stableStringify(present));
  const hazards = await hazardLayer(world, fixesOf('hazards'));
  if (hazards) put('hazards.json', stableStringify(hazards));
  const polities = await polityLayer(world, new Set(territoryFile.territories.flatMap((t) => t.claims.flatMap((c) => c.rows.map((r) => r.name)))), fixesOf('polities'));
  if (polities) put('polities.json', stableStringify(polities));
  // Fields of points, lines and areas, the one way (docs/STRUCTURE.md section 3.6): the languages and the roads.
  const layers = await fieldLayers(world, claims);
  for (const [path, content] of layers.files) put(path, content);
  // What the overlays say of the rows they name, for the inspect panel.
  const overlays = overlayFile(world, claims);
  if (overlays) put('overlays.json', stableStringify(overlays));
  // Where people lived: a grid, drawn as a picture of the surface, and so a file of numbers rather than of rows.
  const people = await peopleLayer(world);
  if (people) put('people.lwt', encodeTile(people.header as unknown as Record<string, unknown>, people.arrays, stableStringify));
  // The living scene, on the land and climate above.
  const sites: SiteInfo[] = [];
  let atlasFile: string | undefined;
  let lifeAtlas: ReturnType<typeof buildAtlas> = undefined;
  let seaAtlas: SeaOut | undefined;
  if (city) {
    const v = (world.generators.find((g) => g.id === 'gen:rome/fabric')!.params as unknown as { site: Pick<SiteInfo, 'near' | 'window' | 'view'> }).site;
    sites.push({ kind: 'city', id: city.file.site.id, label: city.file.site.label, file: `city/${city.file.site.id}.json`, place: 'places/rome', origin: city.file.site.origin, span: city.file.site.span, slice: city.file.site.slice, near: v.near, window: v.window, view: v.view });
  }
  if (climateKeys.length && biomeField) {
    const elevation = paleoElevation(grids)!;
    const cg = climateGrid((climateField!.grid as { res_deg: number }).res_deg);
    const living = buildScene(solved, elevation.snapshots, climateKeys, cg, biomeField.params as unknown as ClimateRule, buildPlanet(solved), log);
    if (living) {
      const f = living.file;
      const spec = f.spec;
      put(`scene/${spec.site.id}.json`, stableStringify(f));
      const lp = world.generators.find((g) => g.id === 'gen:life/scene')!.params as unknown as { site: { window: string[] }; view: { range: number; turn: number; tilt: number } };
      const heading = (Math.atan2(f.to_river[0], f.to_river[1]) * 180) / Math.PI + lp.view.turn * (180 / Math.PI);
      sites.push({ kind: 'life', id: spec.site.id, label: spec.site.label, file: `scene/${spec.site.id}.json`, place: spec.site.place, origin: spec.site.origin, span: spec.site.span, slice: spec.site.slice, near: spec.site.span, window: lp.site.window.map((p) => parsePoint(p as TimePointInput).t) as [number, number], view: { x: f.focus[0], y: f.focus[1], range: lp.view.range, heading: Math.round(((heading % 360) + 360) % 360), tilt: lp.view.tilt } });
    }
    // Who lived where, for a scene of any place on land.
    const atlas = buildAtlas(solved, periodList, elevation.snapshots, climateKeys, cg, biomeField.params as unknown as ClimateRule, log);
    if (atlas) {
      for (const [path, content] of atlas.files) put(path, content);
      // A scene's months, from their files as written, as a browser reads them (world/generators/life/climate.ts).
      const monthTiles = new Map<string, MonthsTile>();
      const monthsAt = monthsInfo
        ? (pw: PlaceWorld, lat: number, lon: number, ageMa: number) => {
            const where = monthsPlace(monthsInfo, pw, lat, lon, ageMa);
            if (!where) return undefined;
            const tiles: MonthsTile[] = [];
            for (const key of tilesNear(where.lat, where.lon, where.set)) {
              const file = where.set.tiles[key];
              if (!file) continue;
              if (!monthTiles.has(file)) {
                const { header, arrays } = decodeTile<MonthsTileHeader>(monthBytes.get(file)!.slice().buffer as ArrayBuffer);
                monthTiles.set(file, new MonthsTile(header, arrays as unknown as ArrayLike<number>[]));
              }
              tiles.push(monthTiles.get(file)!);
            }
            return tiles.length ? placeMonths(monthsInfo, where, tiles) : undefined;
          }
        : undefined;
      const seen = witnesses(solved, atlas.index, atlas.files, elevation.snapshots, climateKeys, cg, biomeField.params as unknown as ClimateRule, buildPlanet(solved), log, waterAt, monthsAt);
      put('life/witness.json', stableStringify(seen));
      atlasFile = 'life/atlas.json';
      coverageFile.forms = { ...atlas.index.coverage, wanted: atlas.wanted.slice(0, 200) };
      lifeAtlas = atlas;
    }
    // Who lived in the sea, on the same stages and patches: genera, with no forms.
    const seaField = world.fields.find((f) => f.data?.as === 'community-sea');
    if (seaField) {
      const id = seaField.data!.from;
      const d = world.manifest.datasets[id];
      const snap = JSON.parse(await readFile(datasetFile(id, d, seaField.data!.file), 'utf8')) as LandSnapshot;
      const isoline = world.fields.find((f) => f.id === 'field:earth/coastline')?.isoline_m ?? 20;
      const started = Date.now();
      seaAtlas = buildSeaAtlas(solved, periodList, elevation.snapshots, snap, id, seaField.params as unknown as SeaParams, isoline, log);
      for (const [path, content] of seaAtlas.files) put(path, content);
      log(`sea     built in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    }
  }

  // Every layer answers everywhere, in a tier (docs/STRUCTURE.md section 3.3): how much of the world each tier holds.
  const resolveWorld = resolveWorldOf(world, solved, grids, climateKeys, ice, people, polities, lifeAtlas, seaAtlas, riversInfo ? { info: riversInfo, seen: riversSeen } : undefined, seriesList);
  coverageFile.tiers = TIER_SPANS.map((sp) => {
    const times = Array.from({ length: 8 }, (_, i) => fromMa(sp.olderMa + ((sp.youngerMa - sp.olderMa) * (i + 0.5)) / 8));
    return { span: sp.label, layers: tierCounts(resolveWorld, gridPlaces(10), times) };
  });
  // The same, finely: every layer across a 5° grid at three times in each of 160 steps of the time control's scale,
  // with what answers each layer when, for the coverage chart.
  const started = Date.now();
  const sources = coverageSources(
    world,
    span,
    resolveWorld.planet,
    grids,
    [...(climateField && climateKeys.length ? [{ field: climateField, keys: climateKeys }] : []), ...recentClimates.map((c) => ({ field: c.field, keys: c.keys }))],
    iceField && ice ? { field: iceField, built: ice } : undefined,
    people,
    polities ? { field: world.fields.find((f) => f.data?.as === 'polities')!, file: polities } : undefined,
    lifeAtlas,
    seriesList,
    seaAtlas,
    riversInfo,
  );
  coverageFile.matrix = coverageMatrix(resolveWorld, span, COVERAGE.columns, COVERAGE.step, COVERAGE.samples, sources);
  log(`coverage  ${COVERAGE.columns} columns × ${coverageFile.matrix.layers.length} layers over a ${COVERAGE.step}° grid in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  put('coverage.json', stableStringify(coverageFile));

  // 9. Index and identity.
  const tileset: Omit<Tileset, 'build'> = {
    format: 'lightworld-tileset@4',
    fields: grids.map((g) => fieldInfo(world, g)),
    timeRange: span,
    lods: lods.map((l) => ({ lod: l.lod, step: l.step, cell: [l.cells[0][2] - l.cells[0][0], l.cells[0][3] - l.cells[0][1]], binsMa: l.binsMa })),
    tiles,
    files: { frames: 'frames.json', periods: 'periods.json', search: 'search.json', records: 'records/', coverage: 'coverage.json', series: 'series.json', planet: 'planet.json', territory: 'territory.json', city: city ? `city/${city.file.site.id}.json` : undefined, climate: climateKeys.length ? 'climate.lwt' : undefined, ice: ice ? 'ice.lwt' : undefined, tree: 'tree.json', ...(present ? { present: 'present.json' } : {}), ...(hazards ? { hazards: 'hazards.json' } : {}), ...(polities ? { polities: 'polities.json' } : {}), ...(overlays ? { overlays: 'overlays.json' } : {}), ...(people ? { people: 'people.lwt' } : {}), ...(atlasFile ? { atlas: atlasFile } : {}), ...(seaAtlas ? { sea: 'life/sea.json' } : {}), features: FEATURE_INDEX },
    rivers: riversInfo,
    months: monthsInfo,
    climates: recentClimates.length
      ? recentClimates.map(({ field: f, keys, chunks }) => ({
          field: f.id,
          title: f.title,
          description: f.description,
          source: f.data!.from,
          sourceRecord: sourceRecord(world.source.get(f.data!.from)!),
          spread: f.spread,
          res_deg: (f.grid as { res_deg: number }).res_deg,
          coverage: [fromMa(Math.max(...keys.map((k) => k.ageMa))), fromMa(Math.min(...keys.map((k) => k.ageMa)))] as [number, number],
          chunks,
        }))
      : undefined,
    climate: climateField && biomeField && climateKeys.length ? { field: climateField.id, title: climateField.title, description: climateField.description, biomeTitle: biomeField.title, biomeDescription: biomeField.description, source: climateField.data!.from, sourceRecord: sourceRecord(world.source.get(climateField.data!.from)!), params: biomeField.params ?? {}, spread: climateField.spread } : undefined,
    ice: iceField && ice ? { field: iceField.id, title: iceField.title, description: iceField.description, uncertainty: iceField.uncertainty, basis: iceField.basis!, source: iceField.data!.from, sourceRecord: sourceRecord(world.source.get(iceField.data!.from)!), coverage: ice.coverage, keyframesMa: ice.keyframesMa, projection: iceField.projection ? { method: iceField.projection.method, until: parsePoint(iceField.projection.until as TimePointInput).t, note: iceField.projection.note } : undefined, marginM: ice.marginM, scenarios: ice.scenarios } : undefined,
    layers: layers.infos.length ? layers.infos : undefined,
    credits: credits(world),
    alternatives,
    kinds: Object.fromEntries(Object.entries(world.vocab.kinds).map(([k, v]) => [k, v.label])),
    sites: sites.length ? sites : undefined,
  };
  put('ATTRIBUTION.md', attributionMarkdown(world));
  const contentHash = sha256([...out.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, c]) => `${p} ${sha256(c)}`).join('\n') + stableStringify(tileset));
  const buildId = contentHash.slice(0, 16);
  put('tileset.json', stableStringify({ ...tileset, build: buildId }));
  const { commit, dirty } = dataCommit();
  put(
    'build.json',
    stableStringify(
      {
        id: buildId,
        data: { commit, dirty },
        datasets: Object.fromEntries(Object.entries(world.manifest.datasets).map(([id, d]) => [id, { sha256: d.fetch.sha256, version: d.version, license: d.license }])),
        snapshots: Object.fromEntries(world.sources.filter((s) => s.snapshot).map((s) => [s.id, s.snapshot])),
        generators: Object.fromEntries(world.generators.map((g) => [g.id, { version: g.version, seeds: Object.fromEntries(Object.entries(g.slots).map(([k, v]) => [k, v.seed])) }])),
        alternatives: { shown: alternatives.flatMap((g) => g.members.map((m) => m.id)), default: Object.fromEntries(alternatives.map((g) => [g.id, g.default])) },
        licenses: { allowed: world.manifest.publish.licenses, datasets: Object.fromEntries(Object.entries(world.manifest.datasets).map(([id, d]) => [id, d.license])) },
        importer: { outputs: imports, pygplates },
        counts: { entities: world.entities.length, claims: world.entities.reduce((n, e) => n + e.claims.length + e.relations.length, 0), sources: world.sources.length, tiles: tiles.length, wanted: wanted.length },
      },
      1,
    ),
  );

  // 10. Write: to a temporary directory, then move into place.
  const dest = join(BUILDS, buildId);
  const tmp = `${dest}.tmp-${process.pid}`;
  await rm(tmp, { recursive: true, force: true });
  for (const [path, content] of out) {
    const p = join(tmp, path);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, content);
  }
  await rm(dest, { recursive: true, force: true });
  await rename(tmp, dest);
  const indexPath = join(BUILDS, 'index.json');
  const index = existsSync(indexPath) ? JSON.parse(await readFile(indexPath, 'utf8')) : { builds: [] };
  index.builds = [{ id: buildId, commit, dirty }, ...index.builds.filter((b: { id: string }) => b.id !== buildId)];
  index.latest = buildId;
  await writeFile(indexPath, JSON.stringify(index, null, 1) + '\n');
  const total = [...out.values()].reduce((s, c) => s + (typeof c === 'string' ? Buffer.byteLength(c) : c.length), 0);
  log(`build ${buildId}: ${tiles.length} tiles, ${recs.length} records, ${seriesList.length} series, ${(total / 1e6).toFixed(1)} MB → ${dest}`);
  if (args.includes('--print-id')) console.log(buildId);
  return 0;
}
