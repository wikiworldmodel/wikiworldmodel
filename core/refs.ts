// References (section 4.1 of WORLD-MODEL.md). Entities are referenced by bare id; other
// record types by prefixed id (src:, frame:, field:, model:, gen:, tour:, alt:); external ids name
// their scheme (wikidata:Q10285). Parts of an entity are addressed inside it: id@phase is a
// phase and id#key a claim or relation. Inside an entity's own file, @phase and #key are
// shorthand for that entity's parts.
//
// A row of a dataset is addressed inside its dataset: src:<dataset>#<key>, the key as the dataset's
// field makes it, its characters percent-encoded where a reference would misread them
// (docs/STRUCTURE.md section 3.1).
//
// Ids carry no meaning: this module splits a reference into the record it names and the
// part, and nothing reads anything into the id itself.

export const RECORD_PREFIXES = ['src', 'frame', 'field', 'model', 'gen', 'tour', 'alt'] as const;
export type RecordType = (typeof RECORD_PREFIXES)[number];

/** An entity id: lowercase words joined by "/", at least two of them. */
export const ENTITY_ID = /^[a-z0-9][a-z0-9.-]*(\/[a-z0-9][a-z0-9.-]*)+$/;
/** A prefixed record id, e.g. src:renne-2013 or frame:paleomap/plate-201. */
export const RECORD_ID = /^(src|frame|field|model|gen|tour|alt):[a-z0-9][a-z0-9.-]*(\/[a-z0-9][a-z0-9.-]*)*$/;
const PART = /^[a-z0-9][a-z0-9-]*$/;

export type Ref =
  | { type: 'entity'; id: string; phase?: string; part?: string }
  | { type: RecordType; id: string }
  | { type: 'row'; id: string; key: string }
  | { type: 'external'; scheme: string; id: string };

/** A row of a dataset: src:<dataset>#<key>. */
export const ROW_REF = /^(src:[a-z0-9][a-z0-9.-]*(?:\/[a-z0-9][a-z0-9.-]*)*)#(\S+)$/;

/** A row's key as it is written in a reference: only what a reference would misread is percent-encoded. */
export const encodeRowKey = (key: string) => key.replace(/[%#\s]/g, (c) => encodeURIComponent(c));

/** A row's address: its dataset and its key. */
export const rowRef = (dataset: string, key: string) => `${dataset}#${encodeRowKey(key)}`;

export class RefError extends Error {}

/** Parse a reference; `self` resolves local @phase and #key shorthand. */
export function parseRef(s: string, self?: string): Ref {
  if (typeof s !== 'string' || !s) throw new RefError(`not a reference: ${JSON.stringify(s)}`);
  if (s.startsWith('@') || s.startsWith('#')) {
    if (!self) throw new RefError(`"${s}" is local shorthand, which only works inside an entity's file`);
    return parseRef(self + s);
  }
  const colon = s.indexOf(':');
  if (colon > 0) {
    const scheme = s.slice(0, colon);
    if ((RECORD_PREFIXES as readonly string[]).includes(scheme)) {
      const row = scheme === 'src' ? ROW_REF.exec(s) : null;
      if (row) {
        let key: string;
        try {
          key = decodeURIComponent(row[2]);
        } catch {
          throw new RefError(`malformed row key in "${s}"`);
        }
        return { type: 'row', id: row[1], key };
      }
      if (!RECORD_ID.test(s)) throw new RefError(`malformed ${scheme}: reference "${s}"`);
      return { type: scheme as RecordType, id: s };
    }
    if (!/^[a-z][a-z0-9-]*$/.test(scheme) || colon === s.length - 1) throw new RefError(`malformed external id "${s}"`);
    return { type: 'external', scheme, id: s.slice(colon + 1) };
  }
  const m = /^([^@#]+)(?:@([^@#]+)|#([^@#]+))?$/.exec(s);
  if (!m || !ENTITY_ID.test(m[1])) throw new RefError(`malformed entity reference "${s}"`);
  if (m[2] !== undefined && !PART.test(m[2])) throw new RefError(`malformed phase in "${s}"`);
  if (m[3] !== undefined && !PART.test(m[3])) throw new RefError(`malformed claim or relation key in "${s}"`);
  return { type: 'entity', id: m[1], phase: m[2], part: m[3] };
}

/**
 * Split a well-formed reference into the record it names and the part of it, without
 * checking it (parseRef checks). Used where references have already been validated.
 */
export function splitRef(ref: string): { record: string; phase?: string; part?: string } {
  const at = ref.indexOf('@');
  if (at > 0) return { record: ref.slice(0, at), phase: ref.slice(at + 1) };
  const hash = ref.indexOf('#');
  if (hash > 0) return { record: ref.slice(0, hash), part: ref.slice(hash + 1) };
  return { record: ref };
}
