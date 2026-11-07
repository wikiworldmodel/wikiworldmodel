// Download every dataset in world/manifest.yaml into .cache/, verifying checksums.
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { unzipSync } from 'fflate';
import { datasetDir, datasetPath, loadManifest, type Dataset } from './manifest.ts';
import { REPO } from './paths.ts';
import { sha256, sha256File } from './util.ts';

// Node's fetch ignores HTTPS_PROXY; undici's agent honours it. It is loaded only when a proxy
// is set, since recent undici needs a newer Node (zstd in zlib) than the tools otherwise do.
if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  const { EnvHttpProxyAgent, setGlobalDispatcher } = await import('undici');
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

async function download(url: string, dest: string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  // A snapshot of a changing database is kept in the repository until there is a blob store.
  if (url.startsWith('repo:')) await writeFile(tmp, new Uint8Array(await readFile(join(REPO, url.slice('repo:'.length)))));
  else {
    // Some hosts refuse a client with no name of its own.
    const res = await fetch(url, { headers: { 'User-Agent': 'wikiworldmodel-world-tools' } });
    if (!res.ok || !res.body) throw new Error(`GET ${url}: HTTP ${res.status}`);
    // Written as it comes, since some datasets are larger than is wise to hold in memory.
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(tmp));
  }
  await rename(tmp, dest);
}

async function verified(path: string, expected: string): Promise<boolean> {
  return existsSync(path) && (await sha256File(path)) === expected;
}

async function fetchDataset(id: string, d: Dataset, log: (s: string) => void): Promise<void> {
  const path = datasetPath(id, d);
  const { url, sha256: expected, format, files } = d.fetch;
  if (!(await verified(path, expected))) {
    log(`${id}: downloading ${url}`);
    await download(url, path);
    const got = await sha256File(path);
    if (got !== expected) {
      await rm(path);
      throw new Error(`${id}: checksum mismatch\n  expected ${expected}\n  got      ${got}`);
    }
  }
  if (format === 'zip' && files) {
    let entries: Record<string, Uint8Array> | undefined;
    for (const [name, f] of Object.entries(files)) {
      const out = join(datasetDir(id, d), f.path);
      if (await verified(out, f.sha256)) continue;
      entries ??= unzipSync(new Uint8Array(await readFile(path)));
      const data = entries[f.path];
      if (!data) throw new Error(`${id}: archive has no member ${f.path}`);
      if (sha256(data) !== f.sha256) throw new Error(`${id}: member ${f.path} (${name}) checksum mismatch`);
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, data);
    }
  }
  log(`${id}: ok (${expected.slice(0, 12)})`);
}

/** Fetch every dataset in the manifest, or only those named. */
export async function fetchAll(log: (s: string) => void = console.log, only: string[] = []): Promise<void> {
  const manifest = await loadManifest();
  for (const id of only) if (!manifest.datasets[id]) throw new Error(`${id} is not a dataset in the manifest`);
  for (const [id, d] of Object.entries(manifest.datasets)) if (!only.length || only.includes(id)) await fetchDataset(id, d, log);
}
