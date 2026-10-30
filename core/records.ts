// What the build writes for each entity (records/<id>.json) and for search (search.json):
// everything the viewer's inspect panel needs, already resolved.
import type { FeatureTime } from './tileset.ts';

export interface SourceRecord {
  id: string;
  type: string;
  citation: string;
  authors?: string[];
  year?: number;
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

export interface ClaimRecord {
  id: string;
  prop: string;
  phase?: string;
  value: unknown;
  /** human-readable value for time-valued claims */
  valueText?: string;
  source: string;
  locator?: string;
  quote?: string;
  method?: string;
  confidence?: string;
  author: string;
  status: string;
  rank: string;
  note?: string;
  /** "subject|prop": claims in the same group compete */
  group: string;
  /** used by the default chronology */
  chosen: boolean;
  competing: boolean;
}

export interface RelationRecord {
  id: string;
  type: string;
  typeFamily: string;
  phase?: string;
  of: string;
  ofLabel: string;
  lag?: { min?: Record<string, number>; max?: Record<string, number> };
  source: string;
  locator?: string;
  quote?: string;
  author: string;
  status: string;
  note?: string;
}

export interface AlternativeRecord {
  group: string;
  claim: string;
  consistent: boolean;
  /** constraint sources ("entity:claims.x") on the conflicting cycle, if inconsistent */
  conflict?: string[];
  /** this entity's interval under the alternative, if consistent */
  time?: FeatureTime;
}

export interface EntityRecord {
  id: string;
  kind: string;
  kindLabel: string;
  label: string;
  summary?: string;
  basis: 'evidence' | 'reconstruction' | 'procedural';
  frame: { id: string; title: string; plate?: number; plateLabel?: string };
  same_as?: Record<string, string | number>;
  phases: { id: string; label: string; summary?: string; time: FeatureTime }[];
  time: FeatureTime;
  claims: ClaimRecord[];
  relations: RelationRecord[];
  alternatives: AlternativeRecord[];
  /** claims and relations the derived dates rest on */
  derivedBy: { start: string[]; end: string[] };
  sources: Record<string, SourceRecord>;
}

export interface SearchFile {
  entities: { id: string; label: string; kind: string; summary?: string; time: FeatureTime }[];
  periods: { id: string; name: string; rank: string; start: number; end: number }[];
}

export interface PeriodRecord {
  id: string;
  name: string;
  rank: string;
  /** astronomical years */
  start: number;
  end: number;
  color?: string;
  parent?: string;
  source: string;
}

export interface PeriodsFile {
  periods: PeriodRecord[];
  sources: Record<string, SourceRecord>;
}

export interface BuildIndex {
  latest: string;
  builds: { id: string; commit: string; dirty: boolean }[];
}
