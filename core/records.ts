// What the build writes for each entity (records/<id>.json), for search (search.json), for
// periods (periods.json) and for coverage (coverage.json): everything the viewer's inspect
// panel needs, already resolved.
import type { Basis, FeatureBasis, FeatureName, FeatureTime } from './tileset.ts';

export interface SourceRecord {
  id: string;
  type: string;
  kind: string;
  citation: string;
  authors?: string[];
  published?: number;
  snapshot?: string;
  title?: string;
  container?: string;
  doi?: string;
  url?: string;
  license?: string;
  via?: string;
  reliability?: string;
  verified?: { by: string; how: string };
  note?: string;
}

export interface CitationRecord {
  ref: string;
  loc?: string;
  quote?: string;
}

/** What claims and relations share. */
interface ClaimCommon {
  /** entity#key */
  ref: string;
  key: string;
  /** the entity, or entity@phase */
  subject: string;
  valid?: unknown;
  validText?: string;
  sources: CitationRecord[];
  unsourced?: string;
  confidence?: number | string;
  /** a calibrated confidence word's probability range */
  confidenceRange?: [number, number];
  basis: Basis;
  /** the alternative the claim belongs to; absent: the default picture */
  alt?: string;
  author: string;
  status: string;
  rank: string;
  note?: string;
}

export interface ClaimRecord extends ClaimCommon {
  prop: string;
  value: unknown;
  /** human-readable value */
  valueText: string;
  method?: string;
  methodLabel?: string;
  /** "subject|prop": claims in the same group compete */
  group: string;
  competing: boolean;
  /** the claim the default picture uses for its group */
  chosen: boolean;
}

export interface RelationRecord extends ClaimCommon {
  rel: string;
  family: string;
  to: string;
  toLabel: string;
  /** the target is not written yet */
  wanted: boolean;
  lagText?: string;
}

/** A relation stored in another record, seen from its target: the build derives it. */
export interface InverseRecord {
  rel: string;
  /** the stored relation, entity#key */
  via: string;
  from: string;
  fromLabel: string;
  status: string;
}

export interface VariantRecord {
  /** scenario key: the alternatives and picks it adds to the default picture */
  key: string;
  consistent: boolean;
  /** constraint sources (entity#key) on the conflicting cycle, if inconsistent */
  conflict?: string[];
  /** this entity's interval in the scenario, if consistent */
  time?: FeatureTime;
}

export interface EntityRecord {
  id: string;
  kind: string;
  kindLabel: string;
  /** today's name */
  label: string;
  names: FeatureName[];
  summary?: string;
  basis: FeatureBasis;
  frame?: { id: string; title: string; plate?: number; entity?: string; entityLabel?: string };
  same_as?: Record<string, string | number>;
  phases: { id: string; label: string; gap?: boolean; time: FeatureTime }[];
  time: FeatureTime;
  claims: ClaimRecord[];
  relations: RelationRecord[];
  inverse: InverseRecord[];
  variants: VariantRecord[];
  /** claims and relations the derived dates rest on */
  derivedBy: { start: string[]; end: string[] };
  sources: Record<string, SourceRecord>;
  /** records this one refers to that are not written yet */
  wanted: string[];
}

export interface SearchFile {
  entities: { id: string; label: string; kind: string; summary?: string; time: FeatureTime; located: boolean }[];
}

export interface PeriodRecord {
  id: string;
  name: string;
  /** its kind's last part: era, period, epoch, stage, … */
  rank: string;
  /** astronomical years, in the default picture */
  start: number;
  end: number;
  color?: string;
  parent?: string;
  /** start and end under scenarios that move them */
  variants?: Record<string, { start: number; end: number }>;
}

export interface PeriodsFile {
  periods: PeriodRecord[];
  sources: Record<string, SourceRecord>;
}

export interface CoverageFile {
  claims: {
    total: number;
    byBasis: Record<string, number>;
    unsourced: string[];
    disputed: string[];
    proposed: number;
    withoutLocator: number;
  };
  wanted: { ref: string; from: string[] }[];
  /** how much of each area and era rests on each basis: features per tile, by basis */
  tiles: { tile: string; bbox: [number, number, number, number]; time: [number, number]; features: Partial<Record<Basis, number>> }[];
}

export interface BuildIndex {
  latest: string;
  builds: { id: string; commit: string; dirty: boolean }[];
}
