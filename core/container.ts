// LWT1, the tile container: a JSON header followed by typed arrays.
//
//   bytes 0–3   "LWT1"
//   bytes 4–7   header length N (uint32, little-endian)
//   bytes 8…    header: UTF-8 JSON, padded with spaces to a multiple of 8 bytes
//   then        the buffers, each starting on an 8-byte boundary
//
// The header lists the buffers as { type, offset, length } (offset from the start of the
// buffer section, length in elements), and anything else a tile needs.

export type ArrayType = 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32' | 'float64' | 'uint8';

export type TypedArray = Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array | Uint8Array;

export interface BufferRef {
  type: ArrayType;
  offset: number;
  length: number;
}

const CTORS = {
  int16: Int16Array,
  uint16: Uint16Array,
  int32: Int32Array,
  uint32: Uint32Array,
  float32: Float32Array,
  float64: Float64Array,
  uint8: Uint8Array,
} as const;

function typeOf(a: TypedArray): ArrayType {
  for (const [name, C] of Object.entries(CTORS)) if (a instanceof C) return name as ArrayType;
  throw new Error('unsupported array type');
}

const MAGIC = [0x4c, 0x57, 0x54, 0x31]; // "LWT1"
const pad8 = (n: number) => (n + 7) & ~7;

/**
 * Encode a header and arrays. `stringify` must be deterministic (sorted keys) for builds to
 * be reproducible; the header gets a `buffers` field listing the arrays in order.
 */
export function encodeTile(header: Record<string, unknown>, arrays: TypedArray[], stringify: (v: unknown) => string): Uint8Array {
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw new Error('big-endian hosts are not supported');
  const buffers: BufferRef[] = [];
  let offset = 0;
  for (const a of arrays) {
    buffers.push({ type: typeOf(a), offset, length: a.length });
    offset = pad8(offset + a.byteLength);
  }
  const json = new TextEncoder().encode(stringify({ ...header, buffers }));
  const headerLen = pad8(json.length);
  const out = new Uint8Array(8 + headerLen + offset);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, headerLen, true);
  out.fill(0x20, 8, 8 + headerLen);
  out.set(json, 8);
  const base = 8 + headerLen;
  arrays.forEach((a, i) => out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), base + buffers[i].offset));
  return out;
}

export interface DecodedTile<H> {
  header: H & { buffers: BufferRef[] };
  arrays: TypedArray[];
}

export function decodeTile<H>(data: ArrayBuffer): DecodedTile<H> {
  const bytes = new Uint8Array(data);
  if (MAGIC.some((b, i) => bytes[i] !== b)) throw new Error('not an LWT1 tile');
  const headerLen = new DataView(data).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLen))) as H & { buffers: BufferRef[] };
  const base = 8 + headerLen;
  const arrays = header.buffers.map((b) => new CTORS[b.type](data, base + b.offset, b.length) as TypedArray);
  return { header, arrays };
}
