// The public site, put together for Cloudflare Pages: the landing page (site/) at /, the viewer
// (dist/site) at /world/, and the latest world build at /world/builds/, where the viewer looks for
// it. Pages refuses a deployment with a file over 25 MiB or more than 20,000 files, so both are
// checked here, where the error can say which file.
import { cpSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export const PAGES_MAX_FILE = 25 * 1024 * 1024;
export const PAGES_MAX_FILES = 20_000;

interface BuildIndex {
  latest: string;
  builds: { id: string }[];
}

export interface SiteOptions {
  /** The landing page's directory (site/). */
  landing: string;
  /** The built viewer (dist/site). */
  viewer: string;
  /** The world builds (dist/builds), with their index.json. */
  builds: string;
  /** Where to write the site; emptied first. */
  out: string;
}

export function assembleSite({ landing, viewer, builds, out }: SiteOptions): { build: string; files: number; bytes: number } {
  const index = JSON.parse(readFileSync(join(builds, 'index.json'), 'utf8')) as BuildIndex;
  const build = index.latest;
  const entry = index.builds.find((b) => b.id === build);
  if (!entry) throw new Error(`dist/builds/index.json names ${build} as latest but does not list it`);

  rmSync(out, { recursive: true, force: true });
  cpSync(landing, out, { recursive: true, filter: (p) => relative(landing, p) !== 'README.md' });
  cpSync(viewer, join(out, 'world'), { recursive: true });
  cpSync(join(builds, build), join(out, 'world/builds', build), { recursive: true });
  // Only the latest build is published, so the index lists only it.
  writeFileSync(join(out, 'world/builds/index.json'), JSON.stringify({ builds: [entry], latest: build }, null, 1) + '\n');

  let files = 0;
  let bytes = 0;
  const big: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else {
        files++;
        bytes += s.size;
        if (s.size > PAGES_MAX_FILE) big.push(`${relative(out, p)} (${(s.size / 1048576).toFixed(1)} MiB)`);
      }
    }
  };
  walk(out);
  if (big.length) throw new Error(`Cloudflare Pages serves files up to 25 MiB; these are larger: ${big.join(', ')}`);
  if (files > PAGES_MAX_FILES) throw new Error(`Cloudflare Pages takes up to ${PAGES_MAX_FILES} files; the site has ${files}`);
  return { build, files, bytes };
}
