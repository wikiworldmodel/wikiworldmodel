// HYDE 3.2.1's population grids, brought down to a grid small enough to keep in world/snapshots.
//
// The archive is 5.3 GB of zip whose members are compressed with Deflate64, and the build needs one grid
// of it per time step, much coarser than HYDE's own. So nothing here downloads the archive: it reads the
// directory at its end, then only the members it wants, by HTTP range requests, checks each one's CRC-32
// against that directory, and adds its 5′ cells up into coarser ones. What comes out is a different file
// from anything in the archive, and so a dataset of its own, whose manifest entry says what it was made
// from; `npm run world -- hyde-snapshot` makes it again, to the byte.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';
import { CACHE } from './paths.ts';
import { sha256 } from './util.ts';

export interface Archive {
  name: string;
  url: string;
  bytes: number;
}

export interface Member {
  name: string;
  /** 8 is Deflate, 9 Deflate64 */
  method: number;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
}

const u16 = (b: Uint8Array, p: number) => b[p] | (b[p + 1] << 8);
const u32 = (b: Uint8Array, p: number) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
const u64 = (b: Uint8Array, p: number) => u32(b, p) + u32(b, p + 4) * 2 ** 32;

/** The last place a 4-byte signature occurs in a buffer. */
function lastIndexOf(b: Uint8Array, sig: number, from = b.length - 4): number {
  for (let i = from; i >= 0; i--) if (u32(b, i) === sig) return i;
  return -1;
}

/** The members a zip's tail lists, zip64 or not. `start` is where the tail starts in the file. */
export function centralDirectory(tail: Uint8Array, start: number): Member[] {
  const eocd = lastIndexOf(tail, 0x06054b50);
  if (eocd < 0) throw new Error('no end of central directory in the tail');
  let count = u16(tail, eocd + 10);
  let at = u32(tail, eocd + 16);
  const locator = lastIndexOf(tail, 0x07064b50, eocd);
  if (locator >= 0) {
    const z = u64(tail, locator + 8) - start;
    if (u32(tail, z) !== 0x06064b50) throw new Error('no zip64 end of central directory in the tail');
    count = u64(tail, z + 32);
    at = u64(tail, z + 48);
  }
  let p = at - start;
  if (p < 0) throw new Error('the central directory starts before the tail');
  const out: Member[] = [];
  for (let i = 0; i < count; i++) {
    if (u32(tail, p) !== 0x02014b50) throw new Error(`bad central directory entry ${i}`);
    let compressed = u32(tail, p + 20);
    let size = u32(tail, p + 24);
    const nameLength = u16(tail, p + 28);
    const extraLength = u16(tail, p + 30);
    const commentLength = u16(tail, p + 32);
    let offset = u32(tail, p + 42);
    const extra = p + 46 + nameLength;
    for (let q = extra; q + 4 <= extra + extraLength; q += 4 + u16(tail, q + 2)) {
      if (u16(tail, q) !== 1) continue;
      let r = q + 4;
      if (size === 0xffffffff) {
        size = u64(tail, r);
        r += 8;
      }
      if (compressed === 0xffffffff) {
        compressed = u64(tail, r);
        r += 8;
      }
      if (offset === 0xffffffff) offset = u64(tail, r);
    }
    out.push({ name: new TextDecoder().decode(tail.subarray(p + 46, extra)), method: u16(tail, p + 10), crc: u32(tail, p + 16), compressed, size, offset });
    p = extra + extraLength + commentLength;
  }
  return out;
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 3];
const LENGTH_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 16];
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577, 32769, 49153];
const DISTANCE_BITS = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14];
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
const FAST = 10;

interface Huffman {
  /** by the next FAST bits: symbol << 4 | code length, or 0 for a longer code */
  fast: Uint16Array;
  count: Uint16Array;
  symbol: Uint16Array;
}

function huffman(lengths: ArrayLike<number>, n: number): Huffman {
  const count = new Uint16Array(16);
  for (let i = 0; i < n; i++) count[lengths[i]]++;
  count[0] = 0;
  const next = new Uint16Array(17);
  for (let i = 1; i < 16; i++) next[i + 1] = next[i] + count[i];
  const symbol = new Uint16Array(n);
  const place = next.slice();
  for (let i = 0; i < n; i++) if (lengths[i]) symbol[place[lengths[i]]++] = i;
  const fast = new Uint16Array(1 << FAST);
  let code = 0;
  let index = 0;
  for (let len = 1; len <= FAST; len++) {
    for (let i = 0; i < count[len]; i++, code++, index++) {
      // Codes are packed from their highest bit, into a stream read from the lowest.
      let reversed = 0;
      for (let b = 0; b < len; b++) if (code & (1 << b)) reversed |= 1 << (len - 1 - b);
      for (let f = reversed; f < 1 << FAST; f += 1 << len) fast[f] = (symbol[index] << 4) | len;
    }
    code <<= 1;
  }
  return { fast, count, symbol };
}

const fixedLengths = new Uint8Array(288);
fixedLengths.fill(8, 0, 144);
fixedLengths.fill(9, 144, 256);
fixedLengths.fill(7, 256, 280);
fixedLengths.fill(8, 280, 288);
const FIXED_LENGTHS = huffman(fixedLengths, 288);
const FIXED_DISTANCES = huffman(new Uint8Array(32).fill(5), 32);

/**
 * Deflate64: Deflate with a 64 KiB window, two more distance codes, and a longest length code that takes
 * 16 extra bits instead of meaning 258. PKWARE's APPNOTE gives no more than that, and fflate and Node's
 * zlib refuse it. `size` is what the zip's directory says it comes to.
 */
export function inflate64(input: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let at = 0;
  let p = 0;
  let bits = 0;
  let have = 0;
  // At most 16 bits are asked for at once, so they fit an integer; past the end of the input they read as nothing.
  const need = (n: number) => {
    while (have < n) {
      bits |= (input[p++] ?? 0) << have;
      have += 8;
    }
  };
  const take = (n: number) => {
    need(n);
    const v = bits & ((1 << n) - 1);
    bits >>>= n;
    have -= n;
    return v;
  };
  const decode = (h: Huffman): number => {
    need(FAST);
    const e = h.fast[bits & ((1 << FAST) - 1)];
    if (e) {
      bits >>>= e & 15;
      have -= e & 15;
      return e >> 4;
    }
    // A long code, a bit at a time.
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= take(1);
      const c = h.count[len];
      if (code - c < first) return h.symbol[index + (code - first)];
      index += c;
      first = (first + c) << 1;
      code <<= 1;
    }
    throw new Error('deflate64: bad code');
  };
  for (let last = 0; !last; ) {
    last = take(1);
    const type = take(2);
    if (type === 0) {
      // To the next whole byte, giving back any whole bytes read ahead.
      p -= have >> 3;
      bits = 0;
      have = 0;
      const len = u16(input, p);
      if ((len ^ u16(input, p + 2)) !== 0xffff) throw new Error('deflate64: bad stored block');
      out.set(input.subarray(p + 4, p + 4 + len), at);
      at += len;
      p += 4 + len;
      continue;
    }
    if (type === 3) throw new Error('deflate64: bad block type');
    let literals = FIXED_LENGTHS;
    let distances = FIXED_DISTANCES;
    if (type === 2) {
      const nlen = take(5) + 257;
      const ndist = take(5) + 1;
      const ncode = take(4) + 4;
      const lengths = new Uint8Array(320);
      for (let i = 0; i < ncode; i++) lengths[ORDER[i]] = take(3);
      const codes = huffman(lengths, 19);
      lengths.fill(0);
      for (let i = 0; i < nlen + ndist; ) {
        const sym = decode(codes);
        if (sym < 16) {
          lengths[i++] = sym;
          continue;
        }
        const repeat = sym === 16 ? 3 + take(2) : sym === 17 ? 3 + take(3) : 11 + take(7);
        const value = sym === 16 ? lengths[i - 1] : 0;
        for (let k = 0; k < repeat; k++) lengths[i++] = value;
      }
      literals = huffman(lengths, nlen);
      distances = huffman(lengths.subarray(nlen), ndist);
    }
    for (;;) {
      const sym = decode(literals);
      if (sym < 256) {
        out[at++] = sym;
        continue;
      }
      if (sym === 256) break;
      const length = LENGTH_BASE[sym - 257] + take(LENGTH_BITS[sym - 257]);
      const d = decode(distances);
      const distance = DISTANCE_BASE[d] + take(DISTANCE_BITS[d]);
      if (distance > at) throw new Error('deflate64: distance too far back');
      for (let k = 0; k < length; k++, at++) out[at] = out[at - distance];
    }
  }
  if (at !== size) throw new Error(`deflate64: made ${at} bytes where ${size} were expected`);
  return out;
}

/** Bytes of a file, by a range request. */
async function range(url: string, from: number, length: number): Promise<Uint8Array> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'lightworld-world-tools', Range: `bytes=${from}-${from + length - 1}` } });
      if (res.status !== 206) throw new Error(`GET ${url}: HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length !== length) throw new Error(`GET ${url}: ${buf.length} bytes where ${length} were asked for`);
      return buf;
    } catch (err) {
      if (attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
}

/** The members of an archive, from its last megabyte. */
export async function listMembers(a: Archive): Promise<Member[]> {
  const length = Math.min(a.bytes, 1 << 20);
  const start = a.bytes - length;
  return centralDirectory(await range(a.url, start, length), start);
}

/** A member's bytes, as compressed: kept under .cache, by its CRC, so that a second run reads nothing. */
async function compressedBytes(a: Archive, m: Member): Promise<Uint8Array> {
  const path = join(CACHE, 'hyde', a.name, `${m.name.replace(/[^A-Za-z0-9_.-]+/g, '_')}.${m.crc.toString(16).padStart(8, '0')}`);
  if (existsSync(path)) return new Uint8Array(await readFile(path));
  // The directory does not say how long the local header's own name and extra fields are.
  const local = await range(a.url, m.offset, 30);
  if (u32(local, 0) !== 0x04034b50) throw new Error(`${m.name}: no local header at ${m.offset}`);
  const data = await range(a.url, m.offset + 30 + u16(local, 26) + u16(local, 28), m.compressed);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.part`, data);
  await rename(`${path}.part`, path);
  return data;
}

/** A member, decompressed and checked against the CRC-32 the archive's directory gives it. */
export async function readMember(a: Archive, m: Member): Promise<Uint8Array> {
  const raw = await compressedBytes(a, m);
  const data = m.method === 9 ? inflate64(raw, m.size) : m.method === 8 ? new Uint8Array(inflateRawSync(raw)) : m.method === 0 ? raw : undefined;
  if (!data) throw new Error(`${m.name}: compression method ${m.method}`);
  const got = crc32(data);
  if (got !== m.crc) throw new Error(`${m.name}: CRC-32 ${got.toString(16)} where the archive's directory gives ${m.crc.toString(16)}`);
  return data;
}

export interface AsciiGrid {
  ncols: number;
  nrows: number;
  xll: number;
  yll: number;
  cell: number;
  /** by row from the north, then west to east; a cell with no data is NaN */
  values: Float64Array;
}

/** An Arc ASCII grid. */
export function parseAsciiGrid(b: Uint8Array): AsciiGrid {
  const header: Record<string, number> = {};
  let p = 0;
  const token = (): string => {
    while (b[p] <= 32) p++;
    const s = p;
    while (p < b.length && b[p] > 32) p++;
    return String.fromCharCode(...b.subarray(s, p));
  };
  for (let i = 0; i < 6; i++) {
    const key = token().toLowerCase();
    header[key] = Number(token());
  }
  const { ncols, nrows, xllcorner, yllcorner, cellsize, nodata_value: nodata } = header;
  const values = new Float64Array(ncols * nrows);
  for (let i = 0; i < values.length; i++) {
    while (p < b.length && b[p] <= 32) p++;
    if (p >= b.length) throw new Error(`the grid ends after ${i} of ${values.length} cells`);
    const s = p;
    while (p < b.length && b[p] > 32) p++;
    // Most cells are one short token.
    const v = p - s === 1 && b[s] === 48 ? 0 : Number(String.fromCharCode(...b.subarray(s, p)));
    values[i] = v === nodata ? NaN : v;
  }
  return { ncols, nrows, xll: xllcorner, yll: yllcorner, cell: cellsize, values };
}

/** Add a grid's cells up into cells `factor` times as wide; a cell with no data adds nothing. By row from the north. */
export function coarsen(g: Pick<AsciiGrid, 'ncols' | 'nrows' | 'values'>, factor: number): Float64Array {
  const nx = g.ncols / factor;
  const ny = g.nrows / factor;
  if (!Number.isInteger(nx) || !Number.isInteger(ny)) throw new Error(`a grid of ${g.ncols} × ${g.nrows} does not divide by ${factor}`);
  const out = new Float64Array(nx * ny);
  for (let r = 0; r < g.nrows; r++) {
    const row = Math.floor(r / factor) * nx;
    for (let c = 0; c < g.ncols; c++) {
      const v = g.values[r * g.ncols + c];
      if (v === v) out[row + Math.floor(c / factor)] += v;
    }
  }
  return out;
}

// ── The snapshot ──────────────────────────────────────────────────────────────────────────────

export const BASELINE: Archive = { name: 'baseline', url: 'https://archaeology.datastations.nl/api/access/datafile/5490328', bytes: 5339653974 };
export const GENERAL: Archive = { name: 'general', url: 'https://archaeology.datastations.nl/api/access/datafile/5490327', bytes: 23585889 };

/** Where the snapshot is kept, and how wide its cells are, in HYDE's cells of 5′. */
export const SNAPSHOT = 'world/snapshots/hyde-3.2.1-population-1deg.csv';
const FACTOR = 12;
/** The last step the readme, the DANS record and the article give: the table has two more. */
const LAST_STEP = 2015;

/** The year HYDE labels a population grid with, as the world's series reads it: 10000BC is −10000, 0AD is 0. */
export function stepOf(name: string): number | undefined {
  const m = /\/popc_(\d+)(AD|BC)\.asc$/.exec(name);
  return m ? (m[2] === 'BC' ? -Number(m[1]) : Number(m[1])) : undefined;
}

export interface SnapshotStep {
  step: number;
  member: Member;
  sha256: string;
  /** the sum of the grid's own cells */
  sum: number;
  /** its cells added up, by row from the north */
  cells: Float64Array;
}

/**
 * The snapshot's text: a line for each member it came from, then a row for each cell that ever holds
 * anyone. A cell's sum is rounded to a whole person, and a blank is nobody. It has no date in it, so that
 * making it again makes the same bytes.
 */
export function snapshotText(steps: SnapshotStep[], land: { member: Member; sha256: string; cells: Float64Array }, grid: { nx: number; ny: number; res: number }): string {
  const hex = (n: number) => n.toString(16).padStart(8, '0');
  const line = (m: Member, sha: string, sum?: number) => `# ${m.name},${m.compressed},${m.size},${hex(m.crc)},${sha}${sum === undefined ? '' : `,${sum.toFixed(1)}`}`;
  const out = [
    `# HYDE 3.2.1, baseline scenario: how many people in each ${grid.res}° cell, by the year HYDE labels each time step with.`,
    '# This is not a file of HYDE\'s. It adds up the 5′ cells of the grids popc_<step>.asc, which count inhabitants per cell, and rounds each sum to a whole person; a blank is nobody.',
    `# A row is a cell that ever holds anyone. lat and lon are its south-west corner, and it runs ${grid.res}° north and east of them.`,
    '# land_km2 adds up maxln_cr.asc, the "maximum landarea available per gridcell", which is what HYDE\'s own grids of density divide by.',
    '# Made by `npm run world -- hyde-snapshot` (tools/world/src/hyde.ts), which reads the members below by HTTP range requests and checks each one\'s CRC-32 against its archive\'s directory.',
    `# Population: HYDE3_2_1-baseline.zip, ${BASELINE.bytes} bytes, SHA-1 0d0e4ff97deb59664ce6c34dfdeeafa08e487d20 as DANS states it: ${BASELINE.url}`,
    `# Land: HYDE3_2_1-general_supplementary.zip, ${GENERAL.bytes} bytes, SHA-1 3cfe98d21e70c9ce478460c7265962f1bb2b6aab as DANS states it: ${GENERAL.url}`,
    '# Neither archive was downloaded whole, so neither SHA-1 was checked. Both are https://doi.org/10.17026/dans-25g-gez3.',
    '# Licence: the release\'s readme says "The Creative Commons License (CC BY 3.0) applies to all of the HYDE data." The DANS record says CC0-1.0. Adding the cells up is the change made here.',
    '# Cite: Klein Goldewijk, Beusen, Doelman & Stehfest (2017), ESSD 9, 927-953, doi:10.5194/essd-9-927-2017.',
    '# Members: name, compressed bytes, bytes, CRC-32, sha256, and for a grid of people the sum of its cells.',
    line(land.member, land.sha256),
    ...steps.map((s) => line(s.member, s.sha256, s.sum)),
    `lat,lon,land_km2,${steps.map((s) => s.step).join(',')}`,
  ];
  for (let c = 0; c < grid.nx * grid.ny; c++) {
    if (!steps.some((s) => Math.round(s.cells[c]) > 0)) continue;
    const south = 90 - (Math.floor(c / grid.nx) + 1) * grid.res;
    const west = -180 + (c % grid.nx) * grid.res;
    out.push(`${south},${west},${Math.round(land.cells[c])},${steps.map((s) => Math.round(s.cells[c]) || '').join(',')}`);
  }
  return `${out.join('\n')}\n`;
}

/** Read every step, add its cells up, and return the snapshot's text. */
export async function exportPopulationGrid(log: (s: string) => void = console.log): Promise<string> {
  const members = (await listMembers(BASELINE)).flatMap((member) => {
    const step = stepOf(member.name);
    return step !== undefined && step <= LAST_STEP ? [{ step, member }] : [];
  });
  members.sort((a, b) => a.step - b.step);
  const res = FACTOR / 12;
  let nx = 0;
  let ny = 0;
  const steps: SnapshotStep[] = [];
  for (const { step, member } of members) {
    const data = await readMember(BASELINE, member);
    const g = parseAsciiGrid(data);
    nx = g.ncols / FACTOR;
    ny = g.nrows / FACTOR;
    let sum = 0;
    for (const v of g.values) if (v === v) sum += v;
    steps.push({ step, member, sha256: sha256(data), sum, cells: coarsen(g, FACTOR) });
    log(`${member.name}: ${Math.round(sum).toLocaleString('en-US')} people`);
  }
  const landMember = (await listMembers(GENERAL)).find((m) => m.name === 'general_files/maxln_cr.asc');
  if (!landMember) throw new Error('the general archive has no maxln_cr.asc');
  const landData = await readMember(GENERAL, landMember);
  return snapshotText(steps, { member: landMember, sha256: sha256(landData), cells: coarsen(parseAsciiGrid(landData), FACTOR) }, { nx, ny, res });
}
