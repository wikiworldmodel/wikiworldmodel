// WikiWorldModel world tools: fetch datasets, import them, validate the world, build tile sets.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fetchAll } from './fetch.ts';
import { fieldSource, importBlocks, importElevation, tiledField } from './importer.ts';
import { exportSnapshot, type OhmSnapshot } from './ohm.ts';
import { REPO } from './paths.ts';
import { loadWorld } from './world.ts';

const commands: Record<string, (args: string[]) => Promise<number | void>> = {
  // Every dataset, or only those named: `npm run fetch -- src:paleomap-plate-model`.
  async fetch(ids) {
    await fetchAll(console.log, ids);
  },
  async import() {
    await fetchAll();
    const world = await loadWorld();
    for (const f of world.fields.filter(tiledField)) {
      await (fieldSource(f) === 'elevation' ? importElevation(f) : importBlocks(f));
    }
  },
  // A fresh extract of the map over the box of a snapshot kept in world/snapshots. The old file stays
  // until the manifest is changed to the new one, as this prints.
  async 'ohm-snapshot'([name = 'ohm-rome-2026-11-01']) {
    const old = JSON.parse(readFileSync(join(REPO, 'world/snapshots', `${name}.json`), 'utf8')) as OhmSnapshot;
    const date = new Date().toISOString().slice(0, 10);
    const file = `world/snapshots/${name.replace(/\d{4}-\d{2}-\d{2}$/, date)}.json`;
    if (existsSync(join(REPO, file))) throw new Error(`${file} exists: one snapshot a day`);
    const snap = await exportSnapshot(old.bbox, date);
    const text = JSON.stringify(snap);
    writeFileSync(join(REPO, file), text);
    console.log(`${snap.elements.length} elements (${old.elements.length} before) → ${file}`);
    console.log(`In world/manifest.yaml point the dataset at repo:${file}, sha256 ${createHash('sha256').update(text).digest('hex')}, ${Buffer.byteLength(text)} bytes.`);
  },
  // A fresh extract of a formation from the Paleobiology Database, kept in world/snapshots. As with
  // the map's, the old file stays until the manifest is changed to the new one.
  async 'pbdb-snapshot'([formation = 'Hell Creek']) {
    const { exportSnapshot: exportPbdb } = await import('./pbdb.ts');
    const date = new Date().toISOString().slice(0, 10);
    const file = `world/snapshots/pbdb-${formation.toLowerCase().replace(/[^a-z]+/g, '-')}-${date}.json`;
    if (existsSync(join(REPO, file))) throw new Error(`${file} exists: one snapshot a day`);
    const snap = await exportPbdb(formation, date);
    const text = JSON.stringify(snap);
    writeFileSync(join(REPO, file), text);
    console.log(`${snap.occurrences.length} occurrences, ${snap.collections.length} collections, ${snap.taxa.length} taxa → ${file}`);
    console.log(`In world/manifest.yaml point the dataset at repo:${file}, sha256 ${createHash('sha256').update(text).digest('hex')}, ${Buffer.byteLength(text)} bytes.`);
  },
  // The land's fossils from the Paleobiology Database, for the atlas of who lived where, kept in world/snapshots.
  async 'pbdb-land'() {
    const { exportLand } = await import('./pbdb.ts');
    const date = new Date().toISOString().slice(0, 10);
    const file = `world/snapshots/pbdb-land-${date}.json`;
    if (existsSync(join(REPO, file))) throw new Error(`${file} exists: one snapshot a day`);
    const snap = await exportLand(date, console.log);
    const text = JSON.stringify(snap);
    writeFileSync(join(REPO, file), text);
    console.log(`${snap.rows.length} occurrences at ${snap.sites.length} sites, ${snap.taxa.length} taxa → ${file}`);
    console.log(`In world/manifest.yaml point the dataset at repo:${file}, sha256 ${createHash('sha256').update(text).digest('hex')}, ${Buffer.byteLength(text)} bytes.`);
  },
  // The sea's fossils from the Paleobiology Database, for the atlas of who lived in the sea: too many to ask for at once,
  // so a period at a time, and zipped in world/snapshots.
  async 'pbdb-sea'() {
    const { exportFossils } = await import('./pbdb.ts');
    const { zipSync, strToU8 } = await import('fflate');
    const date = new Date().toISOString().slice(0, 10);
    const name = `pbdb-sea-${date}`;
    const file = `world/snapshots/${name}.zip`;
    if (existsSync(join(REPO, file))) throw new Error(`${file} exists: one snapshot a day`);
    // Spans to ask for one at a time, about a period long each, over the same 541 Myr as the land's: where they fall does
    // not matter, as an occurrence the service gives for two of them is kept once.
    const edges = [541, 485, 444, 419, 359, 299, 252, 201, 145, 66, 23, 0];
    const snap = await exportFossils('marine', date, console.log, edges.slice(1).map((min, i) => ({ max: edges[i], min })));
    const json = strToU8(JSON.stringify(snap));
    const member = `${name}.json`;
    // A fixed time on the member, so that the same rows make the same bytes.
    const zip = zipSync({ [member]: [json, { level: 9, mtime: new Date('2000-01-01T00:00:00Z') }] });
    writeFileSync(join(REPO, file), zip);
    console.log(`${snap.rows.length} occurrences at ${snap.sites.length} sites, ${snap.taxa.length} taxa → ${file}`);
    console.log(`In world/manifest.yaml point the dataset at repo:${file}, sha256 ${createHash('sha256').update(zip).digest('hex')}, ${zip.length} bytes; its member ${member}, sha256 ${createHash('sha256').update(json).digest('hex')}.`);
  },
  // A fresh extract of NOAA's hazard databases, kept in world/snapshots.
  async 'noaa-snapshot'() {
    const { exportHazards } = await import('./noaa.ts');
    const date = new Date().toISOString().slice(0, 10);
    const file = `world/snapshots/noaa-hazards-${date}.json`;
    if (existsSync(join(REPO, file))) throw new Error(`${file} exists: one snapshot a day`);
    const snap = await exportHazards(date);
    const text = JSON.stringify(snap);
    writeFileSync(join(REPO, file), text);
    console.log(`${snap.rows.length} rows → ${file}`);
    console.log(`In world/manifest.yaml point the dataset at repo:${file}, sha256 ${createHash('sha256').update(text).digest('hex')}, ${Buffer.byteLength(text)} bytes.`);
  },
  // HYDE 3.2.1's population grids, added up to a grid small enough to keep in world/snapshots. They are a
  // fixed release, so this makes the same bytes every time, and has no date in its name.
  async 'hyde-snapshot'() {
    const { exportPopulationGrid, SNAPSHOT } = await import('./hyde.ts');
    const text = await exportPopulationGrid();
    writeFileSync(join(REPO, SNAPSHOT), text);
    console.log(`${text.split('\n').filter((l) => l && !l.startsWith('#')).length - 1} cells → ${SNAPSHOT}`);
    console.log(`In world/manifest.yaml the dataset is repo:${SNAPSHOT}, sha256 ${createHash('sha256').update(text).digest('hex')}, ${Buffer.byteLength(text)} bytes.`);
  },
  // ArchaeoGLOBE's summary tables, joined into one table kept in world/snapshots. A fixed record version, so this makes the
  // same bytes every time; it refuses a newer version until someone has read what changed.
  async 'archaeoglobe-snapshot'() {
    const { exportAssessments, SNAPSHOT } = await import('./archaeoglobe.ts');
    const text = await exportAssessments();
    writeFileSync(join(REPO, SNAPSHOT), text);
    console.log(`${text.split('\n').filter((l) => l && !l.startsWith('#')).length - 1} rows → ${SNAPSHOT}`);
    console.log(`In world/manifest.yaml the dataset is repo:${SNAPSHOT}, sha256 ${createHash('sha256').update(text).digest('hex')}, ${Buffer.byteLength(text)} bytes.`);
  },
  // What most wants a building tradition: `npm run world -- dwellings-wanted [--n 40] [--region 59]`.
  async 'dwellings-wanted'(args) {
    const { dwellingsWanted, wantedText } = await import('./dwellingsWanted.ts');
    const opt = (name: string) => {
      const i = args.indexOf(name);
      return i >= 0 ? Number(args[i + 1]) : undefined;
    };
    // Every 500 years from 3000 BCE to 500 BCE, then 1 CE and every 500 years to 1500, and the survey's last times.
    const times = [...Array.from({ length: 6 }, (_, i) => -2999 + i * 500), 1, 500, 1000, 1500, 1750, 1850];
    const { rows } = await dwellingsWanted(times);
    console.log(wantedText(rows, opt('--n') ?? 40, opt('--region')));
  },
  // A sheet of a form, to look at: `npm run world -- form-sheet life/taxa/triceratops`, or `plan:ceratopsian`.
  async 'form-sheet'([name, out]) {
    const world = await loadWorld();
    const { formSheet } = await import('./formsheet.ts');
    const { FormTree, planForm } = await import('./forms.ts');
    const tree = new FormTree(world);
    const isPlan = name?.startsWith('plan:');
    const form = isPlan ? planForm(world, name.slice(5)) : name ? tree.form(name) : undefined;
    if (!form) throw new Error(`no form for "${name}": give a taxon's id, or plan:<name> (${Object.keys(world.plans).join(', ')})`);
    const mid = (s?: { lo: number; hi: number }) => (s ? (s.lo + s.hi) / 2 : undefined);
    const posture = isPlan ? undefined : tree.posture(name);
    const file = out ?? join(REPO, 'dist', 'sheets', `${name.replace(/[^a-z0-9]+/gi, '-')}.png`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, formSheet(form, { label: name, biped: posture === 'biped', ...(isPlan ? {} : { length: mid(tree.size(name, 'body_length')), hip: mid(tree.size(name, 'hip_height')), height: mid(tree.size(name, 'plant_height')) }) }));
    if (!isPlan) {
      const s = tree.source(name)!;
      console.log(`Its body: the plan "${s.plan}" from ${s.node}${s.changes.length ? `, changed by ${s.changes.map((c) => c.node).join(', ')}` : ''}. Nearest node with anything to say: ${s.from}${s.own ? ' (its own)' : ''}.`);
    }
    console.log(file);
  },
  // What most wants a form: the taxa that most often come up in the atlas with none of their own. Give a
  // name to see only what is under it, --missing to see what has no form at any node above it, and --sea to rank
  // the sea's fossils for bodies that live in the sea.
  async 'forms-wanted'(args) {
    const world = await loadWorld();
    const { formsWanted } = await import('./formsWanted.ts');
    let sea: import('./pbdb.ts').LandSnapshot | undefined;
    if (args.includes('--sea')) {
      const { datasetFile } = await import('./manifest.ts');
      const f = world.fields.find((x) => x.data?.as === 'community-sea');
      if (!f) throw new Error('no field reads the sea\'s fossils');
      const id = f.data!.from;
      sea = JSON.parse(readFileSync(datasetFile(id, world.manifest.datasets[id], f.data!.file), 'utf8'));
    }
    console.log(formsWanted(world, args, sea));
  },
  // The first step of checking a claim: its quote found in the text its source was read in. Records the step on
  // each claim whose quote is found: `npm run world -- quote-check src:… <text file> [--by machine:<tool>] [--dry-run]`.
  async 'quote-check'(args) {
    const { runQuoteCheck } = await import('./quotecheck.ts');
    return runQuoteCheck(await loadWorld(), args);
  },
  // Every claim about a subject, a record or a row of a dataset, with where each comes from and which the default
  // picture shows (*): `npm run world -- claims src:noaa-hazards-2026-11-04#eruption:5238`, or an entity's id.
  async claims([ref]) {
    if (!ref) throw new Error('usage: world claims <entity id | src:<dataset>#<row key>>');
    const world = await loadWorld();
    const { ClaimIndex } = await import('./claimindex.ts');
    const { parseRef } = await import('../../../core/refs.ts');
    const r = parseRef(ref);
    const index = await ClaimIndex.of(world, r.type === 'row' ? [r.id] : []);
    if (r.type === 'row' && !index.tables.has(r.id)) console.log(`${r.id} is not read as rows here: fetch it, or give its field a rows: section`);
    const cs = index.of(ref);
    if (!cs.length) {
      console.log(`no claims about ${ref}`);
      return 1;
    }
    for (const c of cs) {
      const pick = index.chosen(c.subject, c.prop);
      const shown = pick && pick.origin === c.origin && pick.where === c.where && JSON.stringify(pick.value) === JSON.stringify(c.value) ? '*' : ' ';
      console.log(`${shown} ${c.prop.padEnd(14)} ${JSON.stringify(c.value)}\n    ${c.origin}, ${c.rank}, ${c.status}, ${c.level}; ${c.author}; ${c.where}${c.note ? `\n    ${c.note}` : ''}`);
    }
  },
  async validate(args) {
    const { runValidate } = await import('./validate/index.ts');
    return runValidate(args);
  },
  async build(args) {
    const { runBuild } = await import('./build/index.ts');
    return runBuild(args);
  },
  // ATTRIBUTION.md at the top of the repository, from the manifest and the sources the records cite.
  async attribution([out = 'ATTRIBUTION.md']) {
    const { attributionMarkdown } = await import('./attribution.ts');
    writeFileSync(join(REPO, out), attributionMarkdown(await loadWorld()));
    console.log(`attribution → ${out}`);
  },
  // The public site for Cloudflare Pages, from site/, the built viewer and the latest build. With
  // BUILD_STORE set to the URL of the builds' object storage, the index points there and the build
  // stays out of the site.
  async site([out = 'dist/public']) {
    const { assembleSite } = await import('./site.ts');
    const store = process.env.BUILD_STORE || undefined;
    const r = assembleSite({ landing: join(REPO, 'site'), viewer: join(REPO, 'dist/site'), builds: join(REPO, 'dist/builds'), out: join(REPO, out), store });
    console.log(`site: build ${r.build}, ${r.files} files, ${(r.bytes / 1e6).toFixed(1)} MB → ${out}`);
  },
};

const [name, ...args] = process.argv.slice(2);
const command = name ? commands[name] : undefined;
if (!command) {
  console.error(`usage: world <${Object.keys(commands).join('|')}> [args]`);
  process.exit(2);
}
command(args).then(
  (code) => process.exit(typeof code === 'number' ? code : 0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
