// What the build writes for each entity (records/<id>.json), for search (search.json), for
// periods (periods.json) and for coverage (coverage.json): everything the viewer's inspect
// panel needs, already resolved.
import type { CoverageMatrix } from './coverage.ts';
import type { CheckStep, Level } from './ladder.ts';
import type { FieldSpread } from './samples.ts';
import type { Basis, FeatureBasis, FeatureName, FeatureTime } from './tileset.ts';

export interface SourceRecord {
  id: string;
  type: string;
  kind: string;
  citation: string;
  authors?: string[];
  published?: number;
  /** when a text from before printing was written, as text */
  written?: string;
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
  /** how far it has been checked against its source, and the level that comes to (core/ladder.ts) */
  checked?: CheckStep[];
  level: Level;
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
  /** each phase's interval in the default picture, and under the scenarios that move it */
  phases: { id: string; label: string; gap?: boolean; time: FeatureTime; variants?: Record<string, FeatureTime> }[];
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

export interface SearchEntry {
  id: string;
  label: string;
  kind: string;
  summary?: string;
  time: FeatureTime;
  located: boolean;
  /** imported in bulk: found by search, but too many to mark along the time control */
  bulk?: boolean;
}

export interface SearchFile {
  entities: SearchEntry[];
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

/** A global series: one value for the whole planet at each time, with a band around it. */
export interface SeriesRecord {
  id: string;
  title: string;
  quantity?: string;
  unit?: string;
  description?: string;
  /** the basis of its values up to `projectedAfter`; after it they are projections */
  basis: Basis;
  projectedAfter?: number;
  interpolation: string;
  /** the series of the same quantity that this one is finer than, over part of its span */
  refines?: string;
  /** what the lo–hi band is */
  band?: string;
  /** how its uncertainty is carried (core/samples.ts); a computed series' is its model's */
  spread?: FieldSpread;
  /** [year, value, lo, hi], oldest first; lo and hi are null where there is no band */
  points: [number, number, number | null, number | null][];
  /** by alternative: the points that picture reads instead, for a series that follows one */
  variants?: Record<string, [number, number, number | null, number | null][]>;
  /** where it comes from: a dataset, or the source of the rule it is computed with */
  source: CitationRecord;
  sourceRecord?: SourceRecord;
  /** for a computed series: the rule and its parameters */
  rule?: { name: string; params: Record<string, unknown> };
}

export interface SeriesFile {
  series: SeriesRecord[];
}

export interface CoverageFile {
  claims: {
    total: number;
    byBasis: Record<string, number>;
    unsourced: string[];
    disputed: string[];
    proposed: number;
    withoutLocator: number;
    /** how many claims stand at each step of checking (core/ladder.ts) */
    ladder: Record<Level, number>;
  };
  wanted: { ref: string; from: string[] }[];
  /** how far the world's forms reach, and what most wants one */
  forms?: { taxa: number; own_form: number; inherited_form: number; no_form: number; rows_drawable: number; rows_total: number; wanted: { no: number; name: string; rows: number; node: string | null }[] };
  /** the energy-balance model against the evidence it does not read (model:earth/energy-balance) */
  energyBalance?: EnergyBalanceReport;
  /**
   * the human landscape: at some times, the share of the land HYDE's anthromes and the region's archaeologists disagree on,
   * and the share whose way of life rests on the archaeologists (model:people/lifeways)
   */
  landscape?: {
    disagree: { t: number; land: number; disagree: number; evidence: number }[];
    /** at each of the survey's times: regions with no farming, and how many HYDE farms under 1% of; with farming widespread, and how many HYDE farms at all and over a twentieth */
    farming: { slice: string; year: number; none: [number, number]; widespread: [number, number, number] }[];
  };
  /** fossil forests against the climate reconstructed for their place and time; none should be in a desert */
  forests?: { id: string; ageMa: number; keyframeMa: number; lat: number; lon: number; climate: string | null; label: string }[];
  /** which tier answers each layer, over a grid of places at times through each span (core/resolve.ts) */
  tiers?: { span: string; layers: Record<string, Record<string, number>> }[];
  /** the same, finely, with what answers each layer when: what the coverage page draws (core/coverage.ts) */
  matrix?: CoverageMatrix;
  /** how much of each area and era rests on each basis: features per tile, by basis */
  tiles: { tile: string; bbox: [number, number, number, number]; time: [number, number]; features: Partial<Record<Basis, number>> }[];
}

/**
 * The energy-balance model against the evidence (tools/world/src/build/energybalance.ts). Pressures are in bar, ages in
 * Ma, temperatures in °C; `luminosity` is the Sun's, relative to today's.
 */
export interface EnergyBalanceReport {
  model: string;
  /** today's Sun at the model's reference CO₂, against the temperature series' present value */
  present: { mean: number; iceEdge: number; against?: string; value?: number; lo?: number | null; hi?: number | null };
  /** each sample whose CO₂ is claimed: the model run from a warm start on members across its range */
  evidence: { id: string; claim: string; ageMa: number; luminosity: number; co2: [number, number]; freezeBelow: number; frozen: number; members: number; mean: [number, number, number]; verdict: 'unfrozen' | 'partly-frozen' | 'frozen' }[];
  /** each glaciation whose ice reached the equator: the CO₂ the model needs to freeze at its start and to thaw at its end */
  glaciations: { id: string; startMa: number; endMa: number; freezeBelowAtStart: number; thawAboveAtEnd: number | null; co2AtEnd?: { claim: string; value: [number, number] }; thawsAtEnd?: boolean }[];
  /** the model's temperature over the Phanerozoic against the rocks' */
  phanerozoic?: { against: string; points: number; meanDifference: number; rms: number; correlation: number };
}

/** What overlays say of the rows of datasets they name (docs/STRUCTURE.md section 3.1), by row: src:<dataset>#<key>. */
export interface OverlaysFile {
  format: 'lightworld-overlays@1';
  rows: Record<
    string,
    {
      dataset: string;
      key: string;
      /** the entity this row is a row of */
      same_as?: string;
      note?: string;
      /** the row's own claims and the overlay's, in that order */
      claims: { prop: string; value: unknown; origin: 'record' | 'row' | 'overlay'; rank: string; status: string; level: Level; author: string; sources: { ref: string; loc?: string; quote?: string }[]; note?: string }[];
    }
  >;
}

export interface BuildIndex {
  latest: string;
  builds: { id: string; commit: string; dirty: boolean }[];
}
