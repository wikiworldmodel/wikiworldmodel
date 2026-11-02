// The build: validate the world, solve its chronology, and compile it into a versioned 4D
// tile set plus the records, search index, periods, series, frames and coverage the viewer
// reads.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { encodeTile } from '../../../../core/container.ts';
import type { CoverageFile, PeriodRecord, PeriodsFile, SearchFile, SeriesFile } from '../../../../core/records.ts';
import { bakeRotationModel, parseRot, RotationModel } from '../../../../core/rotation-model.ts';
import { fromMa, parsePoint, PRESENT_YEAR, toMa, type TimePointInput } from '../../../../core/time.ts';
import type { Basis, Feature, FieldInfo, FieldKeyframe, FramesFile, GeneratorConstraint, TileHeader, TileRef, Tileset } from '../../../../core/tileset.ts';
import { GENERATOR as CLOUDS, VERSION as CLOUDS_VERSION, generateClouds, type CloudParams } from '../../../../world/generators/earth/clouds/v1.ts';
import { GENERATOR as SURFACE, VERSION as SURFACE_VERSION, generateSurface, type SurfaceParams } from '../../../../world/generators/earth/surface/v1.ts';
import { claimGroups, solveScenario, solveVariants } from '../chronology.ts';
import { fieldAgesMa, fieldSource, importBlocks, importElevation, PLATE_MODEL } from '../importer.ts';
import { datasetFile } from '../manifest.ts';
import { BUILDS, REPO } from '../paths.ts';
import { sha256, stableStringify } from '../util.ts';
import { formatIssue, validateWorld } from '../validate/index.ts';
import { loadWorld, type World } from '../world.ts';
import { fieldFor, fieldLods, loadBlocks, loadSnapshots, sliceField, tileGrid, timeBins, type GridField } from './fields.ts';
import { features as buildFeatures, periods as buildPeriods, records as buildRecords, search as buildSearch, sourceRecord, type Solved } from './records.ts';
import { planet as buildPlanet } from './planet.ts';
import { series as buildSeries } from './series.ts';
import { territory as buildTerritory } from './territory.ts';

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
function overlaps(f: Feature, span: [number, number]): boolean {
  const margin = (span[1] - span[0]) * 0.25;
  const times = [f.time, ...Object.values(f.variants ?? {})];
  return times.some((t) => {
    const lo = Number.isFinite(t.start.lo) ? t.start.lo : t.start.best ?? -Infinity;
    const hi = t.end.best === null ? Infinity : Number.isFinite(t.end.hi) ? t.end.hi : t.end.best;
    return lo <= span[1] + margin && hi >= span[0] - margin;
  });
}

/** Attribution for what the build shows: its datasets, and the databases its records cite. */
function credits(world: World): Tileset['credits'] {
  const out: Tileset['credits'] = Object.values(world.manifest.datasets).map((d) => ({ label: d.credit!, license: d.license! }));
  const cited = new Set(world.entities.flatMap((e) => [...e.claims, ...e.relations].flatMap((c) => c.sources.map((s) => s.ref))));
  // A database may have changed its licence between the snapshots read: credit each one.
  const databases = new Map<string, Set<string>>();
  for (const id of cited) {
    const s = world.source.get(id);
    if (s?.type === 'database-record' && s.license && s.container) databases.set(s.container, (databases.get(s.container) ?? new Set()).add(s.license));
  }
  for (const [label, licenses] of [...databases].sort(([a], [b]) => (a < b ? -1 : 1))) out.push({ label, license: [...licenses].sort().join(' and ') });
  return out;
}

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

/** Claims and wanted records, and how much of each tile's area and era rests on each basis. */
function coverage(world: World, wanted: { ref: string; from: { file: string; where: string }[] }[], feats: Feature[], tiles: TileRef[]): CoverageFile {
  const all = world.entities.flatMap((e) => [...e.claims, ...e.relations]);
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
  const coastline = world.fields.find((c) => c.derived && c.rule === 'isoline' && c.from?.includes(f.id));
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
    coastline: coastline ? { id: coastline.id, title: coastline.title, isolineM: coastline.isoline_m ?? 0 } : undefined,
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

  // 3. Chronology: the default picture, the alternatives the build shows, and each picture
  // with one competing claim picked.
  const sol = solveScenario(world);
  if (!sol.ok) throw new Error('unreachable: validated world has no solution');
  const alternatives = shownAlternatives(world);
  const solved: Solved = {
    world,
    sol,
    centres: solveScenario(world, {}, true),
    variants: solveVariants(world, alternatives.flatMap((g) => g.members.map((m) => m.id))),
    groups: claimGroups(world),
    model,
  };

  // 4. Gridded fields: elevation grids, and before them the plate model's blocks.
  const grids: GridField[] = [];
  const imports: Record<string, string> = {};
  let pygplates = '';
  for (const f of world.fields.filter((x) => !x.derived && x.grid?.kind === 'lonlat')) {
    const mode = fieldSource(f);
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
    grids.push({ field: f, mode, snapshots, coverMa: [oldest, Math.min(youngest, until)] });
  }
  // Where two fields meet, the younger one is preferred at the shared age.
  grids.sort((a, b) => a.coverMa[1] - b.coverMa[1]);
  const plateIds = new Set<number>();
  for (const g of grids) for (const s of g.snapshots) for (const p of s.plate) if (p) plateIds.add(p);
  const plateIndexList = [0, ...[...plateIds].sort((a, b) => a - b)];
  const plateIndex = new Map(plateIndexList.map((p, i) => [p, i]));
  const frames: FramesFile = {
    rotations: baked,
    plateIndex: plateIndexList,
    frames: world.frames.map((f) => ({ id: f.id, title: f.title, kind: f.kind, plate: f.kind === 'plate' ? f.transform?.plate : undefined, entity: f.entity })),
  };
  put('frames.json', stableStringify(frames));

  // 5. Generators: run each slot from its record's seed and parameters.
  const code = [
    { id: CLOUDS, version: CLOUDS_VERSION, run: (seed: string, p: unknown) => generateClouds(seed, p as CloudParams) },
    { id: SURFACE, version: SURFACE_VERSION, run: (seed: string, p: unknown) => generateSurface(seed, p as SurfaceParams) },
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
        outputSha256: sha256(c.run(s.seed, gen.params)),
      });
    }
  }

  // 6. Records, periods, search and series, whose times set the span of the tile set.
  const allFeatures = buildFeatures(solved);
  const periodList = buildPeriods(solved);
  const found = buildSearch(solved, allFeatures);
  const seriesList = await buildSeries(world);
  const span = worldSpan(periodList, found, grids, seriesList);

  // 7. Tiles: every span of time has LOD 0 tiles (its features and generator constraints, and
  // the field that covers it, if any); spans with a field also have finer LOD 1 tiles.
  const cuts = grids.flatMap((g) => [g.snapshots[0].ageMa, g.snapshots.at(-1)!.ageMa]);
  const lods = fieldLods(timeBins(toMa(span[0]), toMa(span[1]), cuts), grids);
  const tiles: TileRef[] = [];
  for (const lod of lods) {
    lod.cells.forEach((cell, ci) => {
      const grid = tileGrid(lod, cell);
      const x = lod.lod === 0 ? 0 : ci % 4;
      const y = lod.lod === 0 ? 0 : Math.floor(ci / 4);
      lod.binsMa.forEach(([older, younger], bi) => {
        const g = fieldFor(grids, [older, younger]);
        const arrays: (Int16Array | Uint16Array)[] = [];
        let field: TileHeader['field'] = null;
        if (g) {
          const keys = g.snapshots.filter((s) => s.ageMa >= younger && s.ageMa <= older);
          const keyframes: FieldKeyframe[] = sliceField(keys, grid, plateIndex).map((k) => {
            arrays.push(k.elev, k.plate);
            return { t: fromMa(k.ageMa), ageMa: k.ageMa, elev: arrays.length - 2, plate: arrays.length - 1 };
          });
          field = { id: g.field.id, grid, keyframes };
        }
        const time: [number, number] = [fromMa(older), fromMa(younger)];
        const id = `${lod.lod}/${x}-${y}/b${bi}`;
        const parentBin = lods[0].binsMa.findIndex(([o, yy]) => younger >= yy && older <= o);
        const header: TileHeader = {
          format: 'lightworld-tile@3',
          id,
          lod: lod.lod,
          bbox: cell,
          time,
          field,
          features: lod.lod === 0 ? allFeatures.filter((f) => overlaps(f, time)) : [],
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
  put('territory.json', stableStringify(await buildTerritory(solved, log)));
  put('coverage.json', stableStringify(coverage(world, wanted, allFeatures, tiles)));

  // 9. Index and identity.
  const tileset: Omit<Tileset, 'build'> = {
    format: 'lightworld-tileset@3',
    fields: grids.map((g) => fieldInfo(world, g)),
    timeRange: span,
    lods: lods.map((l) => ({ lod: l.lod, step: l.step, cell: [l.cells[0][2] - l.cells[0][0], l.cells[0][3] - l.cells[0][1]], binsMa: l.binsMa })),
    tiles,
    files: { frames: 'frames.json', periods: 'periods.json', search: 'search.json', records: 'records/', coverage: 'coverage.json', series: 'series.json', planet: 'planet.json', territory: 'territory.json' },
    credits: credits(world),
    alternatives,
    kinds: Object.fromEntries(Object.entries(world.vocab.kinds).map(([k, v]) => [k, v.label])),
  };
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
