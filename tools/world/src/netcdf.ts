// A reader for classic NetCDF files (the CDF-1 and CDF-2 formats): the header, and any variable's
// values read straight from its place in the file, so a large file need not fit in memory.
import { open, type FileHandle } from 'node:fs/promises';

const SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 4, 6: 8 };

export interface NcVariable {
  name: string;
  dims: { name: string; size: number }[];
  /** 1 byte, 2 char, 3 short, 4 int, 5 float, 6 double */
  type: number;
  begin: number;
  attrs: Record<string, string | number[]>;
}

export interface NcFile {
  dims: { name: string; size: number }[];
  variables: Map<string, NcVariable>;
  attrs: Record<string, string | number[]>;
  /** A run of a variable's values, along its first dimension: `count` slices from `start`, as doubles. */
  read(name: string, start?: number, count?: number): Promise<Float64Array>;
  close(): Promise<void>;
}

/** Parse a header from the bytes it starts in. Exported for tests. */
export function parseHeader(b: Uint8Array): Pick<NcFile, 'dims' | 'variables' | 'attrs'> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b[0] !== 0x43 || b[1] !== 0x44 || b[2] !== 0x46) throw new Error('not a classic NetCDF file');
  const wide = b[3] === 2;
  if (b[3] !== 1 && !wide) throw new Error(`NetCDF version ${b[3]} is not supported`);
  let o = 4;
  const u32 = () => {
    const x = v.getUint32(o);
    o += 4;
    return x;
  };
  const name = () => {
    const n = u32();
    const s = new TextDecoder('latin1').decode(b.subarray(o, o + n));
    o += (n + 3) & ~3;
    return s;
  };
  const attributes = () => {
    u32();
    const n = u32();
    const out: Record<string, string | number[]> = {};
    for (let i = 0; i < n; i++) {
      const key = name();
      const t = u32();
      const len = u32();
      const bytes = len * SIZES[t];
      if (t === 2) out[key] = new TextDecoder('latin1').decode(b.subarray(o, o + len));
      else {
        const vals: number[] = [];
        for (let k = 0; k < len; k++) {
          const p = o + k * SIZES[t];
          vals.push(t === 1 ? v.getInt8(p) : t === 3 ? v.getInt16(p) : t === 4 ? v.getInt32(p) : t === 5 ? v.getFloat32(p) : v.getFloat64(p));
        }
        out[key] = vals;
      }
      o += (bytes + 3) & ~3;
    }
    return out;
  };
  u32();
  u32();
  const nd = u32();
  const dims: NcFile['dims'] = [];
  for (let i = 0; i < nd; i++) dims.push({ name: name(), size: u32() });
  const attrs = attributes();
  u32();
  const nv = u32();
  const variables = new Map<string, NcVariable>();
  for (let i = 0; i < nv; i++) {
    const nm = name();
    const n = u32();
    const ids: number[] = [];
    for (let k = 0; k < n; k++) ids.push(u32());
    const va = attributes();
    const type = u32();
    u32();
    const begin = wide ? Number(v.getBigUint64(o)) : v.getUint32(o);
    o += wide ? 8 : 4;
    variables.set(nm, { name: nm, dims: ids.map((d) => dims[d]), type, begin, attrs: va });
  }
  return { dims, variables, attrs };
}

export async function openNetcdf(path: string): Promise<NcFile> {
  const fh: FileHandle = await open(path, 'r');
  // Headers run to a few kilobytes; a large one is read again whole.
  const head = new Uint8Array(1 << 20);
  await fh.read(head, 0, head.length, 0);
  const h = parseHeader(head);
  return {
    ...h,
    async read(name, start = 0, count) {
      const va = h.variables.get(name);
      if (!va) throw new Error(`no variable ${name}`);
      const slice = va.dims.slice(1).reduce((n, d) => n * d.size, 1);
      const first = va.dims[0]?.size ?? 1;
      const n = (count ?? first - start) * slice;
      const size = SIZES[va.type];
      const buf = new Uint8Array(n * size);
      await fh.read(buf, 0, buf.length, va.begin + start * slice * size);
      const view = new DataView(buf.buffer);
      const out = new Float64Array(n);
      if (va.type === 5) for (let i = 0; i < n; i++) out[i] = view.getFloat32(i * 4);
      else if (va.type === 6) for (let i = 0; i < n; i++) out[i] = view.getFloat64(i * 8);
      else if (va.type === 4) for (let i = 0; i < n; i++) out[i] = view.getInt32(i * 4);
      else if (va.type === 3) for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2);
      else throw new Error(`${name}: type ${va.type} is not numeric`);
      return out;
    },
    close: () => fh.close(),
  };
}
