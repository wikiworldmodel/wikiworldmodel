// Who the world's data comes from, and on what terms: the datasets the build reads and the
// databases its records cite. The build credits them in the viewer (`credits` in tileset.json) and
// writes them out as ATTRIBUTION.md in each build; `npm run world -- attribution` writes the
// repository's copy, which a unit test keeps current.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Tileset } from '../../../core/tileset.ts';
import { REPO } from './paths.ts';
import type { World } from './world.ts';

/** Attribution for what the build shows: its datasets, and the databases its records cite. */
export function credits(world: World): Tileset['credits'] {
  const out: Tileset['credits'] = [];
  // Tiles of one dataset share a credit.
  for (const d of Object.values(world.manifest.datasets)) if (!out.some((c) => c.label === d.credit)) out.push({ label: d.credit!, license: d.license! });
  return [...out, ...citedDatabases(world).map(({ label, licenses }) => ({ label, license: licenses.join(' and ') }))];
}

/** The databases whose entries the records cite, each with every licence it was read under. */
function citedDatabases(world: World): { label: string; licenses: string[] }[] {
  const cited = new Set(world.entities.flatMap((e) => [...e.claims, ...e.relations].flatMap((c) => c.sources.map((s) => s.ref))));
  // A database may have changed its licence between the snapshots read: credit each one.
  const databases = new Map<string, Set<string>>();
  for (const id of cited) {
    const s = world.source.get(id);
    if (s?.type === 'database-record' && s.license && s.container) databases.set(s.container, (databases.get(s.container) ?? new Set()).add(s.license));
  }
  return [...databases].sort(([a], [b]) => (a < b ? -1 : 1)).map(([label, licenses]) => ({ label, licenses: [...licenses].sort() }));
}

/** The fonts the site serves, named by the licence files beside them (site/fonts/OFL-<Name>.txt). */
export function siteFonts(dir = join(REPO, 'site/fonts')): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^OFL-.+\.txt$/.test(f))
    .map((f) => f.slice(4, -4).replace(/-/g, ' '))
    .sort();
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** ATTRIBUTION.md: every dataset with its citation, licence and credit; the cited databases; the fonts. */
export function attributionMarkdown(world: World, fonts: string[] = siteFonts()): string {
  const lines = [
    '# Attribution',
    '',
    '<!-- Written by `npm run world -- attribution` from world/manifest.yaml and the sources the records cite. Do not edit by hand. -->',
    '',
    "WikiWorldModel's own code is under the Apache License 2.0 ([LICENSE](LICENSE)), and its records and",
    'documentation are dedicated to the public domain under CC0 1.0 ([LICENSE-DATA](LICENSE-DATA)). It is',
    'built on the work of others, credited here. Anything that shows the world, or is made from it, credits',
    'them in the same way: the viewer does, under *Data and licences*.',
    '',
    '## Datasets',
    '',
    'The build reads these datasets, each pinned by its checksum in [world/manifest.yaml](world/manifest.yaml),',
    'under the licence given. A build may read only CC0, CC BY and public-domain data.',
    '',
  ];
  for (const [id, d] of Object.entries(world.manifest.datasets)) {
    lines.push(`### ${oneLine(d.title ?? d.credit ?? id)}`, '', oneLine(d.citation), '');
    lines.push(`- Licence: ${d.license ?? 'none stated'}${d.license_note ? `. ${oneLine(d.license_note)}` : ''}`);
    if (d.credit) lines.push(`- Credit: ${oneLine(d.credit)}`);
    if (d.doi) lines.push(`- DOI: [${d.doi}](https://doi.org/${d.doi})`);
    if (d.url) lines.push(`- From: <${d.url}>`);
    lines.push(`- Source id: \`${id}\``, '');
  }
  const databases = citedDatabases(world);
  if (databases.length) {
    lines.push(
      '## Databases the records cite',
      '',
      'Records cite entries in these databases for facts, with short quotes as evidence. Nothing is imported',
      'from them as data; the quotes stay under the terms given.',
      '',
      '| Database | Licence |',
      '|---|---|',
      ...databases.map(({ label, licenses }) => `| ${label.replace(/\|/g, '\\|')} | ${licenses.join(', ')} |`),
      '',
    );
  }
  if (fonts.length) {
    lines.push(
      '## Fonts',
      '',
      `The site's fonts are served from [site/fonts/](site/fonts/), each under the SIL Open Font License 1.1 in the`,
      `OFL file beside it: ${fonts.join(', ')}.`,
      '',
    );
  }
  lines.push(
    '## Code',
    '',
    'The libraries the code depends on keep their own licences, listed in `package-lock.json` and',
    '`tools/world/importers/requirements.txt`.',
    '',
  );
  return lines.join('\n');
}
