// The build: validate the world, solve its chronology, and compile it into a versioned 4D
// tile set plus the records, search index and frames that the viewer reads.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { encodeTile } from '../../../../core/container.ts';
import { bakeRotationModel, parseRot, RotationModel } from '../../../../core/rotation-model.ts';
import { fromMa } from '../../../../core/time.ts';
import type { FieldKeyframe, Feature, FramesFile, GeneratorConstraint, TileHeader, TileRef, Tileset } from '../../../../core/tileset.ts';
import { DEFAULT_PARAMS, GENERATOR as CLOUDS, VERSION as CLOUDS_VERSION, generateClouds } from '../../../../world/generators/clouds/v1.ts';
import { solveAlternatives, solveWorld } from '../chronology.ts';
import { importFields, loadField, resolvePoints, type PointResult } from '../importer.ts';
import { datasetFile, loadManifest } from '../manifest.ts';
import { BUILDS, REPO } from '../paths.ts';
import { sha256, stableStringify } from '../util.ts';
import { formatIssue, validateWorld } from '../validate/index.ts';
import { loadWorld } from '../world.ts';
import { fieldLods, loadSnapshots, sliceField, tileGrid } from './fields.ts';
import { features as buildFeatures, records as buildRecords } from './records.ts';

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

/** Does a feature's interval (under any claim choice) come near a tile's time span? */
function overlaps(f: Feature, span: [number, number]): boolean {
  const margin = (span[1] - span[0]) * 0.25;
  const times = [f.time, ...Object.values(f.alternatives ?? {})];
  return times.some((t) => {
    const lo = Number.isFinite(t.start.lo) ? t.start.lo : t.start.best ?? -Infinity;
    const hi = t.end.best === null ? Infinity : Number.isFinite(t.end.hi) ? t.end.hi : t.end.best;
    return lo <= span[1] + margin && hi >= span[0] - margin;
  });
}

export async function runBuild(args: string[]): Promise<number> {
  const log = (s: string) => console.log(s);
  const out = new Map<string, Uint8Array | string>(); // path → content
  const put = (path: string, content: Uint8Array | string) => out.set(path, content);

  // 1. Validate.
  const world = await loadWorld();
  const issues = await validateWorld(world);
  for (const i of issues) if (i.level !== 'info') log(formatIssue(i));
  if (issues.some((i) => i.level === 'error')) {
    log('build: the world does not validate');
    return 1;
  }

  // 2. Chronology, frames.
  const sol = solveWorld(world);
  if (!sol.ok) throw new Error('unreachable: validated world has no solution');
  const centres = solveWorld(world, {}, true);
  const alternatives = solveAlternatives(world);
  const pointQueries = world.entities
    .filter((e) => e.data.frame === 'earth/plates')
    .map((e) => {
      const loc = Object.values(e.data.claims).find((c) => c.prop === 'location' && c.rank === 'preferred')!;
      const p = loc.value as { lat: number; lon: number };
      return { id: e.data.id, lat: p.lat, lon: p.lon, agesMa: [0] };
    });
  const plates = new Map<string, PointResult>((await resolvePoints(pointQueries)).map((r) => [r.id, r]));

  // 3. Fields.
  const manifest = await loadManifest();
  const field = await loadField();
  const importDir = await importFields(log);
  const { meta, snapshots } = await loadSnapshots(importDir);
  for (const s of meta.snapshots) {
    if (s.alignment.land_inside_polygons < MIN_ALIGNMENT) {
      log(`error   fields     ${s.ageMa} Ma: only ${s.alignment.land_inside_polygons} of PaleoDEM land lies inside the plate model's polygons (min ${MIN_ALIGNMENT}); field and frames disagree`);
      return 1;
    }
  }
  const pm = manifest.datasets[field.plate_model];
  const rot = await readFile(datasetFile(field.plate_model, pm, 'rotations'), 'latin1');
  const baked = bakeRotationModel(parseRot(rot));
  const model = new RotationModel(baked);
  const plateIds = new Set<number>();
  for (const s of snapshots) for (const p of s.plate) if (p) plateIds.add(p);
  const plateIndexList = [0, ...[...plateIds].sort((a, b) => a - b)];
  const plateIndex = new Map(plateIndexList.map((p, i) => [p, i]));
  const frames: FramesFile = { rotations: baked, plateIndex: plateIndexList };
  put('frames.json', stableStringify(frames));

  // 4. Generators.
  const cloudBytes = generateClouds('earth/clouds', DEFAULT_PARAMS);
  const clouds: GeneratorConstraint = {
    id: 'earth/clouds',
    generator: CLOUDS,
    version: CLOUDS_VERSION,
    seed: 'earth/clouds',
    basis: 'procedural',
    params: DEFAULT_PARAMS as unknown as Record<string, unknown>,
    outputSha256: sha256(cloudBytes),
  };

  // 5. Tiles.
  const allFeatures = buildFeatures(world, sol, centres, alternatives, plates);
  const maxAge = Math.max(...snapshots.map((s) => s.ageMa));
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
          format: 'lightworld-tile@1',
          id,
          lod: lod.lod,
          bbox: cell,
          time: span,
          field: { id: field.id, grid, keyframes },
          features: lod.lod === 0 ? allFeatures.filter((f) => overlaps(f, span)) : [],
          generators: lod.lod === 0 ? [clouds] : [],
        };
        const bytes = encodeTile(header as unknown as Record<string, unknown>, arrays, stableStringify);
        const url = `tiles/${lod.lod}/${x}-${y}/b${bi}.lwt`;
        put(url, bytes);
        tiles.push({ id, lod: lod.lod, bbox: cell, time: span, url, bytes: bytes.length, sha256: sha256(bytes), parent: lod.lod === 0 ? null : `0/0-0/b${parentBin}` });
      });
    });
  }

  // 6. Records, search, periods.
  const recs = buildRecords(world, sol, centres, alternatives, plates, (p) => model.label(p));
  for (const r of recs) put(`records/${r.id}.json`, stableStringify(r));
  const periods = world.periods.flatMap((pf) =>
    pf.data.periods.map((p) => ({ id: p.id, name: p.name, rank: p.rank, start: fromMa(p.start.ma), end: fromMa(p.end.ma), color: p.color, parent: p.parent, source: pf.data.source })),
  );
  const periodSources = Object.fromEntries(world.sources.filter((s) => world.periods.some((p) => p.data.source === s.data.id)).map((s) => [s.data.id, s.data]));
  put('periods.json', stableStringify({ periods, sources: periodSources }));
  put(
    'search.json',
    stableStringify({
      entities: allFeatures.map((f) => ({ id: f.id, label: f.label, kind: f.kind, summary: world.entities.find((e) => e.data.id === f.id)!.data.summary, time: f.time })),
      periods: periods.map((p) => ({ id: p.id, name: p.name, rank: p.rank, start: p.start, end: p.end })),
    }),
  );

  // 7. Index and identity.
  const tileset: Omit<Tileset, 'build'> = {
    format: 'lightworld-tileset@1',
    field: {
      id: field.id,
      title: field.title,
      units: field.units,
      datum: field.datum,
      basis: field.basis,
      interpolation: field.interpolation,
      source: manifest.datasets[field.dataset].source,
      sourceRecord: world.sources.find((x) => x.data.id === manifest.datasets[field.dataset].source)?.data,
      coastlineM: field.derived?.coastline?.isoline_m ?? 0,
    },
    keyframesMa: snapshots.map((s) => s.ageMa),
    timeRange: [fromMa(maxAge), fromMa(0)],
    lods: lods.map((l) => ({ lod: l.lod, step: l.step, cell: [l.cells[0][2] - l.cells[0][0], l.cells[0][3] - l.cells[0][1]], binsMa: l.binsMa })),
    tiles,
    files: { frames: 'frames.json', periods: 'periods.json', search: 'search.json', records: 'records/' },
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
        datasets: Object.fromEntries(Object.entries(manifest.datasets).map(([id, d]) => [id, { sha256: d.sha256, version: d.version, license: d.license }])),
        generators: { [CLOUDS]: CLOUDS_VERSION },
        importer: { output: importDir.split('/').pop(), pygplates: meta.pygplates },
        counts: { entities: world.entities.length, sources: world.sources.length, tiles: tiles.length },
      },
      1,
    ),
  );

  // 8. Write: to a temporary directory, then move into place.
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
