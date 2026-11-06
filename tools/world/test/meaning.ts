// What a build means, file by file, so that two builds can be compared without asking for the same
// bytes (docs/STRUCTURE.md section 3.5): the same files, the same records, ids and words, and the same
// numbers within a tolerance. A generator's fingerprint is compared as fingerprints are; a tile's
// arrays by their fingerprints; any other binary file by the fingerprint of its bytes.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { decodeTile } from '../../../core/container.ts';
import { bytesPrint, fingerprint, fingerprintProblems, type Fingerprint } from '../../../core/fingerprint.ts';

export type Meaning = { kind: 'json'; value: unknown } | { kind: 'tile'; header: unknown; arrays: Fingerprint } | { kind: 'bytes'; print: Fingerprint };

/** What changes from one build of a commit to the next without changing what it means: its id, and the hashes and sizes of files. */
const VOLATILE: Record<string, string[]> = { 'tileset.json': ['build', 'sha256', 'bytes'], 'build.json': ['id'] };

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export function meaningOf(dir: string): Map<string, Meaning> {
  const out = new Map<string, Meaning>();
  for (const p of walk(dir)) {
    const path = relative(dir, p);
    const bytes = readFileSync(p);
    if (path.endsWith('.json')) out.set(path, { kind: 'json', value: JSON.parse(bytes.toString('utf8')) });
    else if (path.endsWith('.lwt')) {
      const { header, arrays } = decodeTile<Record<string, unknown>>(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      const { buffers: _buffers, ...rest } = header;
      out.set(path, { kind: 'tile', header: rest, arrays: fingerprint(arrays.map((a, i) => ({ name: String(i), values: a }))) });
    } else out.set(path, { kind: 'bytes', print: bytesPrint('bytes', new Uint8Array(bytes)) });
  }
  return out;
}

const isPrint = (v: unknown): v is Fingerprint =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((p) => !!p && typeof p === 'object' && typeof (p as { n?: unknown }).n === 'number');

/** Where two values differ beyond the tolerance: numbers relatively, fingerprints as fingerprints, the rest exactly. */
function compare(a: unknown, b: unknown, at: string, skip: string[], out: string[], rel = 1e-6): void {
  if (out.length > 50) return;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > rel * Math.max(1, Math.abs(a), Math.abs(b))) out.push(`${at}: ${b} for ${a}`);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${at}: ${b.length} items, not ${a.length}`);
    else a.forEach((x, i) => compare(x, b[i], `${at}[${i}]`, skip, out, rel));
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (isPrint(a) && isPrint(b) && Object.keys(a).length) {
      for (const p of fingerprintProblems(a, b)) out.push(`${at}: ${p}`);
      return;
    }
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const k of keys) {
      if (skip.includes(k)) continue;
      if (!(k in a) || !(k in b)) out.push(`${at}.${k}: ${k in a ? 'missing' : 'not expected'}`);
      else compare((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${at}.${k}`, skip, out, rel);
    }
    return;
  }
  if (a !== b) out.push(`${at}: ${JSON.stringify(b)?.slice(0, 80)} for ${JSON.stringify(a)?.slice(0, 80)}`);
}

/** How two builds differ in meaning, file by file; empty when they mean the same. */
export function meaningProblems(a: Map<string, Meaning>, b: Map<string, Meaning>): string[] {
  const out: string[] = [];
  for (const path of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const x = a.get(path);
    const y = b.get(path);
    if (!x || !y) {
      out.push(`${path}: ${x ? 'missing' : 'not expected'}`);
      continue;
    }
    const skip = VOLATILE[path] ?? [];
    const here: string[] = [];
    if (x.kind !== y.kind) here.push(`a ${y.kind}, not a ${x.kind}`);
    else if (x.kind === 'json') compare(x.value, (y as typeof x).value, '', skip, here);
    else if (x.kind === 'tile') {
      compare(x.header, (y as typeof x).header, '', skip, here);
      here.push(...fingerprintProblems(x.arrays, (y as typeof x).arrays));
    } else here.push(...fingerprintProblems(x.print, (y as typeof x).print));
    out.push(...here.map((p) => `${path}${p.startsWith('.') || p.startsWith('[') ? '' : ' '}${p}`));
  }
  return out;
}
