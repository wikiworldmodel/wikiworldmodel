// The build: validate the world, solve its chronology, and compile it into a versioned 4D
// tile set plus the records, search index, periods, frames and coverage the viewer reads.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { encodeTile } from '../../../../core/container.ts';
import type { CoverageFile, PeriodsFile } from '../../../../core/records.ts';
import { bakeRotationModel, parseRot, RotationModel } from '../../../../core/rotation-model.ts';
import { fromMa } from '../../../../core/time.ts';
import type { Basis, Feature, FieldKeyframe, FramesFile, GeneratorConstraint, TileHeader, TileRef, Tileset } from '../../../../core/tileset.ts';
import { GENERATOR as CLOUDS, VERSION as CLOUDS_VERSION, generateClouds, type CloudParams } from '../../../../world/generators/earth/clouds/v1.ts';
import { claimGroups, solveScenario, solveVariants } from '../chronology.ts';
import { ELEVATION, fieldAgesMa, importFields } from '../importer.ts';
import { datasetFile } from '../manifest.ts';
import { BUILDS, REPO } from '../paths.ts';
import { sha256, stableStringify } from '../util.ts';
import { formatIssue, validateWorld } from '../validate/index.ts';
import { loadWorld, type World } from '../world.ts';
import { fieldLods, loadSnapshots, sliceField, tileGrid } from './fields.ts';
import { features as buildFeatures, periods as buildPeriods, records as buildRecords, search as buildSearch, sourceRecord, type Solved } from './records.ts';

// Share of PaleoDEM land that must fall inside the plate model's polygons at every snapshot,
// a coarse check that field and frames come from the same model. This pair scores 0.85–1.00
// (mean 0.92); the score drops when the grid is shifted against the polygons.
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
  const databases = new Map<string, string>();
  for (const id of cited) {
    const s = world.source.get(id);
    if (s?.type === 'database-record' && s.license && s.container) databases.set(s.container, s.license);
  }
  for (const [label, license] of [...databases].sort()) out.push({ label, license });
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
  const field = world.fields.find((f) => f.id === ELEVATION)!;
  const coastline = world.fields.find((f) => f.derived && f.from?.includes(ELEVATION) && f.rule === 'isoline')!;
  const pmId = field.moves_with!;
  const pm = world.manifest.datasets[pmId];
  const rot = await readFile(datasetFile(pmId, pm, 'rotations'), 'latin1');
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

  // 4. Fields.
  const importDir = await importFields(log);
  const { meta, snapshots } = await loadSnapshots(importDir);
  for (const s of meta.snapshots) {
    if (s.alignment.land_inside_polygons < MIN_ALIGNMENT) {
      log(`error   fields      ${s.ageMa} Ma: only ${s.alignment.land_inside_polygons} of PaleoDEM land lies inside the plate model's polygons (min ${MIN_ALIGNMENT}); field and frames disagree`);
      return 1;
    }
  }
  const plateIds = new Set<number>();
  for (const s of snapshots) for (const p of s.plate) if (p) plateIds.add(p);
  const plateIndexList = [0, ...[...plateIds].sort((a, b) => a - b)];
  const plateIndex = new Map(plateIndexList.map((p, i) => [p, i]));
  const frames: FramesFile = {
    rotations: baked,
    plateIndex: plateIndexList,
    frames: world.frames.map((f) => ({ id: f.id, title: f.title, kind: f.kind, plate: f.kind === 'plate' ? f.transform?.plate : undefined, entity: f.entity })),
  };
  put('frames.json', stableStringify(frames));

  // 5. Generators: run each slot from its record's seed and parameters.
  const gen = world.generators.find((g) => g.id === CLOUDS);
  if (!gen || gen.version !== CLOUDS_VERSION) {
    log(`error   generators  ${CLOUDS}: the record is version ${gen?.version ?? 'missing'}, the code version ${CLOUDS_VERSION}`);
    return 1;
  }
  const generators: GeneratorConstraint[] = Object.entries(gen.slots).map(([slot, s]) => ({
    generator: gen.id,
    version: gen.version,
    slot,
    seed: s.seed,
    basis: gen.outputs.basis as 'procedural',
    params: gen.params,
    outputSha256: sha256(generateClouds(s.seed, gen.params as unknown as CloudParams)),
  }));

  // 6. Tiles.
  const allFeatures = buildFeatures(solved);
  const { maxAgeMa } = fieldAgesMa(field);
  const maxAge = Math.min(maxAgeMa, Math.max(...snapshots.map((s) => s.ageMa)));
  const lods = fieldLods(maxAge);
  const tiles: TileRef[] = [];
  for (const lod of lods) {
    lod.cells.forEach((cell, ci) => {
      const grid = tileGrid(lod, cell);
      const x = lod.lod === 0 ? 0 : ci % 4;
      const y = lod.lod === 0 ? 0 : Math.floor(ci / 4);
      lod.binsMa.forEach(([older, younger], bi) => {
        const keys = snapshots.filter((s) => s.ageMa >= younger && s.ageMa <= older);
        const sliced = sliceField(keys, grid, plateIndex);
        const arrays: (Int16Array | Uint16Array)[] = [];
        const keyframes: FieldKeyframe[] = sliced.map((k) => {
          arrays.push(k.elev, k.plate);
          return { t: fromMa(k.ageMa), ageMa: k.ageMa, elev: arrays.length - 2, plate: arrays.length - 1 };
        });
        const span: [number, number] = [fromMa(older), fromMa(younger)];
        const id = `${lod.lod}/${x}-${y}/b${bi}`;
        const parentBin = lods[0].binsMa.findIndex(([o, yy]) => younger >= yy && older <= o);
        const header: TileHeader = {
          format: 'lightworld-tile@2',
          id,
          lod: lod.lod,
          bbox: cell,
          time: span,
          field: { id: field.id, grid, keyframes },
          features: lod.lod === 0 ? allFeatures.filter((f) => overlaps(f, span)) : [],
          generators: lod.lod === 0 ? generators : [],
        };
        const bytes = encodeTile(header as unknown as Record<string, unknown>, arrays, stableStringify);
        const url = `tiles/${lod.lod}/${x}-${y}/b${bi}.lwt`;
        put(url, bytes);
        tiles.push({ id, lod: lod.lod, bbox: cell, time: span, url, bytes: bytes.length, sha256: sha256(bytes), parent: lod.lod === 0 ? null : `0/0-0/b${parentBin}` });
      });
    });
  }

  // 7. Records, search, periods, coverage.
  const recs = buildRecords(solved);
  for (const r of recs) put(`records/${r.id}.json`, stableStringify(r));
  const periods: PeriodsFile = {
    periods: buildPeriods(solved),
    sources: Object.fromEntries(
      [...new Set(world.entities.filter((e) => e.kind.startsWith('period/')).flatMap((e) => e.claims.flatMap((c) => c.sources.map((s) => s.ref))))]
        .sort()
        .map((id) => [id, sourceRecord(world.source.get(id)!)]),
    ),
  };
  put('periods.json', stableStringify(periods));
  put('search.json', stableStringify(buildSearch(solved, allFeatures)));
  put('coverage.json', stableStringify(coverage(world, wanted, allFeatures, tiles)));

  // 8. Index and identity.
  const demId = field.data!.from;
  const tileset: Omit<Tileset, 'build'> = {
    format: 'lightworld-tileset@2',
    field: {
      id: field.id,
      title: field.title,
      units: field.unit!,
      datum: field.datum!,
      basis: field.basis!,
      interpolation: field.interp!,
      source: demId,
      sourceRecord: sourceRecord(world.source.get(demId)!),
      coastline: { id: coastline.id, title: coastline.title, isolineM: coastline.isoline_m ?? 0 },
    },
    keyframesMa: snapshots.map((s) => s.ageMa),
    timeRange: [fromMa(maxAge), fromMa(0)],
    lods: lods.map((l) => ({ lod: l.lod, step: l.step, cell: [l.cells[0][2] - l.cells[0][0], l.cells[0][3] - l.cells[0][1]], binsMa: l.binsMa })),
    tiles,
    files: { frames: 'frames.json', periods: 'periods.json', search: 'search.json', records: 'records/', coverage: 'coverage.json' },
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
        importer: { output: importDir.split('/').pop(), pygplates: meta.pygplates },
        counts: { entities: world.entities.length, claims: world.entities.reduce((n, e) => n + e.claims.length + e.relations.length, 0), sources: world.sources.length, tiles: tiles.length, wanted: wanted.length },
      },
      1,
    ),
  );

  // 9. Write: to a temporary directory, then move into place.
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
  log(`build ${buildId}: ${tiles.length} tiles, ${recs.length} records, ${(total / 1e6).toFixed(1)} MB → ${dest}`);
  if (args.includes('--print-id')) console.log(buildId);
  return 0;
}
