// Lightworld world tools: fetch datasets, import them, validate the world, build tile sets.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchAll } from './fetch.ts';
import { fieldSource, importBlocks, importElevation } from './importer.ts';
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
    for (const f of world.fields.filter((x) => !x.derived && x.grid?.kind === 'lonlat')) {
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
  async validate(args) {
    const { runValidate } = await import('./validate/index.ts');
    return runValidate(args);
  },
  async build(args) {
    const { runBuild } = await import('./build/index.ts');
    return runBuild(args);
  },
  // The public site for Cloudflare Pages, from site/, the built viewer and the latest build.
  async site([out = 'dist/public']) {
    const { assembleSite } = await import('./site.ts');
    const r = assembleSite({ landing: join(REPO, 'site'), viewer: join(REPO, 'dist/site'), builds: join(REPO, 'dist/builds'), out: join(REPO, out) });
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
