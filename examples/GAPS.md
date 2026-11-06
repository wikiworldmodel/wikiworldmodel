# What the example data exposed in WORLD-MODEL.md

100 hand-written records covering every record type, spanning 4.6 Ga to
+7.6 Gyr and scales from the galaxy down to an obelisk. Each place where the
doc didn't say how to express something is tagged `# GAP-xx` in the records.
Numbers aren't contiguous (32 is unused).

**Status (2026-10-29):** WORLD-MODEL.md now addresses these through a few
general mechanisms rather than one fix per gap:

| Mechanism | Doc section | Gaps |
|---|---|---|
| One reference form, wanted records, contributors vs historical people | 4.1 | 01, 02, 05, 17 |
| Identity follows the thing; phase vs varying property vs event; optional stored, generated or derived geometry | 4.2 | 04, 06, 07, 31, 33, 36, 47, 48, 60–62, 64 |
| Every fact is a claim; work + locator; corroboration; evidence-about-a-moment and checks | 4.3, 4.8 | 14–16, 20–24, 37, 54, 58 |
| Alternatives: hypotheses, perspectives, scenarios, readings | 4.4 | 35, 50, 56, 59 |
| Relations are claims, with inverses, allowed kinds and time direction | 4.5 | 25–29 |
| Frame is a claim; chain to the galaxy; measured-frame coordinates | 4.6 | 08, 09, 40–46, 49 |
| Fields with uncertainty, alternatives, stitched provenance, local detail | 4.7 | 52, 53 |
| Generators declare inputs and scope; stable slot IDs | 4.8, 7 | 63, 66, 67, 69 |
| Vocabularies as records; periods as entities | 4.9 | 18, 19, 22, 23, 30, 34, 55 |
| Mixed-unit authoring, `lo` = earlier, open vs unknown, the future as projection | 5 | 03, 10–13, 38, 39, 50 |
| Four-value basis, per part, derived takes the weakest | 7 | 51, 65 |
| No caches; captions as templates; validators per alternative | 9 | 57, 59, tours |
| Snapshots, per-asset licenses, pinned tours | 8.1, 10, 13 | 68, 70–73 |

The example records below still use the earlier ad hoc syntax (for example
`scenario` entities and a `perspective:` field where the doc now has
alternatives), so they no longer match the doc exactly.

## Coverage of the examples

| Record type | Files | Examples |
|---|---|---|
| entities | 36 | Earth, Theia, Moon, Sun; Chicxulub, K-Pg, Great Oxidation, Sun leaving the main sequence; Laurentia, Pangaea, Laurentide ice; LUCA, cyanobacteria, eukaryotes, T. rex, Sue; Roman Empire, Vespasian and his reign, Ötzi, SW Asian agriculture; Istanbul, Rome, Ostia, Colosseum, Domus Aurea, Temple of Vesta, a lost temple, an insula, the Flaminio obelisk, the fire of 64, Regio III; Voyager 1; two SSP scenarios |
| claims / relations | 98 / 54 | 14 disputed, 3 machine-authored, competing values on dates, names, mechanisms, locations, ownership and sex |
| frames | 15 | galactic, ICRF, heliocentric, Earth body, mantle, pre-1 Ga placeholder, 3 plates, 6 site and building grids, Moon |
| fields | 11 | sea level, CO₂, temperature, elevation, ice, plate polygons, coastline (derived), population, land use, territory, fossil density |
| sources | 20 | ancient texts, papers, a map sheet, a lab report, a survey, a law, museum records, an editor registry |
| generators | 7 | insula, round temple, garden lake, planet sphere, clouds, skeleton pose, field system |
| periods | 5 | ICS (Cretaceous, Maastrichtian, rejected Anthropocene), PeriodO (Flavian), WikiWorldModel (machine era) |
| tours | 2 | the film opening (4.5 Ga → +5 Gyr) and a Rome walk-through |
| datasets | 12 | in `manifest.yaml` |
| vocabularies | 3 | kinds, properties (with interpolation), relations (with inverses) |

`python3 examples/check.py` reports 0 errors and 49 warnings. 30 of them
are refs to 27 records left unwritten on purpose (GAP-02); the other 19 are
real findings, listed under "What the checker found".

## The ten that matter most

1. **The future has no model (GAP-50).** It's the user's second priority and
   the doc doesn't mention it. Projections fit none of `evidence |
   reconstruction | procedural`. Futures branch (SSP2-4.5 vs SSP5-8.5), and
   a branch is an exclusive *set* of claims, which competing claims can't
   express. Voyager 1 is evidence up to today and a projection after, inside
   one phase. Needs at least: a `projection` basis, a scenario record that
   claims can be conditioned on, and a viewer branch switch.
2. **Time can't be written by hand as specified (GAP-10…13).** Nobody will
   type `-66041050` for 66.043 Ma, so the examples needed unit sugar. Then
   three problems showed up: intervals that span units ("1 Ga to 2100") need
   mixed-unit bounds, which I wrote 10 times in 9 files without noticing; with "ago"
   units, `lo` became the larger number in some files and the earlier time in
   others, and the checker caught one reversed LUCA interval; and BP (before
   1950) vs astronomical years needs an explicit epoch. Fix: define authoring
   forms in the schema, normalise at load, and make `lo` always the earlier
   time.
3. **Frame must be per phase (GAP-49).** The doc's example puts `frame` on
   the entity, but its own obelisk example "changes parent frame twice".
   Every moving object (the obelisk, Sue, Ötzi, Voyager) needed per-phase
   frames, and the examples ended up with two ways to say "moved" (phase
   frame and `moved-to` relation). Pick one.
4. **References have no syntax (GAP-01, 02).** The doc says IDs are opaque
   but its example uses `rome/colosseum`. It has no way to reference a phase
   or a claim, and frames and sources share a bare-path namespace with
   entities. The examples use `entity@phase`, `entity#claim` and typed
   prefixes (`src:`, `frame:`…). Without these, nothing else resolves.
5. **Relations need everything claims have (GAP-25, 26).** Relations are
   contested too (did Deccan volcanism cause the K-Pg extinction?), so they
   need source, status, rank and confidence. The doc doesn't say which file
   owns a relation, whether inverses are stored, or whether a relation can
   start or end at a phase, a period or a field (all needed here). The
   K-Pg → "destroyed" fan-out to thousands of clades shows that inverses
   written by hand don't scale.
6. **`basis` is too coarse (GAP-50, 51, 58, 65).** The examples needed
   `projection` and `derived`. Data assimilation (Judd 2024) mixes evidence
   with a model prior. A legendary founding date (753 BCE) is neither
   evidence nor reconstruction. A building is evidence up to floor 4 and
   reconstruction above it. Consider basis per part, plus a separate
   "source kind" axis for myth and tradition.
7. **Claims are easy to leave unsourced (GAP-16, 21).** 68 of the 98 example
   claims have no source, as does `c1` in the doc's own example. The
   doc's citation is passage-shaped (`suetonius/titus/7.3`), which implies
   one source file per passage. The examples use one file per work plus a
   `loc` locator. Decide whether a missing source is an error, and what
   omitted `status` and `rank` default to.
8. **Things with no place have no pattern (GAP-33, 36).** "High-level
   developments" are the user's third priority. Agriculture arose in 7–11
   centres and spread as a front. LUCA has no known location. A person moves
   every day. The doc's entities all assume geometry in a frame.
9. **Phase, event and field overlap (GAP-04, 06, 07).** The Great Oxidation
   is a 300-Myr "event". Quarrying the Colosseum is a four-century event. The
   fire of 64 changes shape while it burns. Earth's "modern" phase lasts
   4 Gyr. The doc gives no rule for when change is a new phase, an event
   with a duration, or a field varying.
10. **Competing claims can switch values but not structure (GAP-35, 56).**
    Under the multiple-impact Moon hypothesis, Theia doesn't exist. Under
    "Rome fell in 1453", the Byzantine Empire is the same entity. Contested
    names need a `perspective` (Ottoman official, Greek Orthodox usage) as
    well as a rank, and the preferred value can differ by perspective.

## All gaps

Each row: the gap, what the examples did, and the open decision.

### IDs and references

| # | Gap | Examples chose | Decide |
|---|---|---|---|
| 01 | No syntax for referencing a phase, claim or relation | `entity@phase`, `entity#local` | Adopt this or URIs; local claim and relation keys share one namespace |
| 02 | Refs to records that don't exist yet | Left 27 unresolved on purpose | Is a dangling ref an error, or a "wanted" stub (useful as a to-do list)? |
| 05 | Shard layout has no `space/` or `future/`; Sun under `earth/`; `rome/vespasian` vs `people/persons/…` | Added `space/` and `future/` shards | Semantic path-like IDs drift from file paths; are IDs opaque (doc) or paths (example)? |
| 17 | `author: person:x` has no record; historical people (Sue's finder) aren't contributors | Stand-in registry `src:lightworld-editors` | Separate contributor IDs from historical persons, who should be entities |
| 24 | Claims about another entity (Chicxulub file claiming the K-Pg cause; scenario files claiming Earth's sea level) | Allowed via `subject:` | Which file owns a claim: subject's file, or wherever the evidence is? Affects merge conflicts (section 14, granularity) |

### Time

| # | Gap | Examples chose | Decide |
|---|---|---|---|
| 03 | Phase edges pinned to events or other edges (`{ref, edge, lag}`); several candidate start events (Vespasian acclaimed vs recognised) | `{ref: X, edge: start\|end, lag}` | Make this a first-class STN constraint form |
| 10 | Display units "only in the UI", but authors need units; date arithmetic ("age 45 at death") | `unit: ma\|ga\|ka\|bp\|from_now_gyr`; `minus:` | Authoring sugar normalised at load |
| 11 | `mean` + `lo/hi` together; a bare year as valid time (`valid: 2023`: instant or whole year?) | Allowed both | One canonical uncertainty form; year = `[y, y+1)` |
| 12 | Mixed-unit intervals (`{lo: {unit: ga, mean: 1}, hi: 2100}`); three other ad hoc forms crept in (`{ga: 1.0}`, `{from_now_yr: …}`, ICS stages as bins) | Checker warns | Per-bound units, or always normalise to astronomical years in the stored form |
| 13 | With "ago" units, is `lo` the earlier time or the smaller number? | Earlier time; LUCA `c1` breaks it and the checker catches it | Define `lo` = earlier, always |
| 14 | Calibration (radiocarbon → calendar) is a derivation the claim requests; curves are a dataset kind | `calibrate_with: ds:intcal20` | Measurement value type + derivation step in the solver |
| 15 | Sources are dated too, and a map has three dates (made, surveyed, depicts) | `composed`, `surveyed`, `depicts` | Needed for the "how do we know" panel and source-age reliability |
| 38 | One-sided bounds ("eukaryotes are older than this fossil") | `constraint: before` | STN constraint with an infinite bound |
| 39 | `end: null` means both "still exists" and "unknown" | Ambiguous | Distinguish `open` (ongoing) from `unknown` |
| 57 | Caching a solved date in git (`derived:` on Ötzi) | Did it once, as a planted violation | Forbid (section 12), or allow as a checked cache |

### Claims

| # | Gap | Examples chose | Decide |
|---|---|---|---|
| 16 | Citation granularity: passage-as-source vs work + locator | One file per work + `loc` | Locator schemes per source type (Loeb chapter, page, sheet, DOI fragment) |
| 20 | `confidence` scale undefined; IPCC calibrated likelihoods don't fit | `low\|medium\|high`, probability, `{likely: 0.66}` | One scale, with mappings |
| 21 | Defaults for omitted `status` and `rank`; duplicate claims (the same fact from a human and a machine) | accepted/normal; kept the duplicate | Dedupe vs "corroborates" link |
| 22 | Where interpolation and units are declared; claim units overriding vocab units | Per property in vocab; one claim overrides `unit` | Allow overrides or not |
| 23 | Evidence props (`begun_under`, `dedicated`) aren't states and shouldn't interpolate | `interp: none` | Distinguish state props from evidence props |
| 31 | Names: language, script, authority, synonyms, and modern names for ancient things (Pangaea, 1915) | Multilingual map + `valid` = "name in use" | Two times for a name: when it was used vs what it refers to; taxonomic names need authority and priority |
| 37 | Machine extraction must quote spans, but copyright limits stored quotes | `quote:` stored short or elided | Store a span offset into a licensed copy instead of text |
| 59 | Footprint validator vs alternative locations (lost temple c1/c2) | Unresolved | Validate each alternative world, or preferred only |

### Relations

| # | Gap | Examples chose | Decide |
|---|---|---|---|
| 25 | Type-as-key (`{after: X}`) can't carry source or lag | `{rel, to, lag, source, status}` | Relations are claims; share the schema |
| 26 | Which file owns a relation; inverses; relations to or from phases, periods, fields and frames; no instance-of | Owner = `from`; inverse built by the build; targets of any type | Allowed target types per relation family; a membership relation (specimen → species) |
| 27 | Phylogeny needs sister groups and reticulation (endosymbiosis), not just `descends-from` | Added `sister-of`, `merged-from` | Adopt Open Tree's model for topology, with disputed alternatives |
| 28 | `damaged-by` vs `destroyed-by`; `built-for` mixes purpose and patron | Added `damaged-by` | Split `built-for` into purpose and `commissioned-by` |
| 29 | Events need participants with roles | `participant` + `role` | Role vocabulary |

### Entities, kinds and phases

| # | Gap | Examples chose | Decide |
|---|---|---|---|
| 04 | When to cut a new phase vs vary a field | One 4-Gyr phase | Guideline: phases for discrete states that change rendering or identity |
| 06 | Events have durations; phases have start/end; event geometry changes during the event | `duration:`; keyframed spread | Event schema |
| 07 | Long processes as events (Great Oxidation, 300 Myr) | Event | Rule for event vs field vs phase |
| 30 | Kind vocabulary shape, rules per kind, governance | Tree with optional rules | Kinds carry validators (events need duration) and applicable props |
| 33 | Developments (agriculture, writing) arise in many centres and diffuse | One entity per centre, extent from a field | Concept entity + regional instances |
| 34 | Reign as entity (section 5) vs period (PeriodO); the doc's `begun_under: rome/vespasian` targets the person | Both exist, period defined by reigns | One authority, the other derived |
| 35 | Competing hypotheses imply different entity graphs | Theia has `existence: 0.8` | Hypothesis-scoped entities, or claim sets that include existence |
| 36 | Placeless entities: LUCA, persons, scenarios | `geometry: null`, `frame: null` | What the viewer shows for them |
| 60 | Organism → fossil → museum object as one entity | One entity, many phases | Confirm; affects T. rex range vs specimen |
| 61 | Phase gaps (Ötzi 1991–98, obelisk 1587–89, Domus Aurea 72–104, Vesta after 394) | Checker warns on 3; Vesta passes because the entity just ends | Explicit `gap` phases; a lifetime end ≠ last phase end |
| 62 | Sensitive content (human remains) | `sensitivity:` | Display policy in viewer and tours |
| 63 | Promotion: generated things have no ID to promote from | `promoted_from: {generator, version, slot}` | Stable slot IDs from the generator |
| 64 | Sub-entities vs attributes (houses inside the medieval Colosseum) | Note only | Parthood relation |
| 65 | Mixed basis within one geometry | `parts:` with selectors | Per-part basis in glTF metadata |

### Frames

| # | Gap | Examples chose | Decide |
|---|---|---|---|
| 08 | Present-day coordinates (Chicxulub, a named region) that the build must back-rotate | `crs: present-day` | Allowed input forms, converted to plate-local at load |
| 09, 44 | Before 1 Ga there is no rotation model; entities span the seam | Placeholder frame with `basis: procedural` | Time-varying frame parent; what may be drawn in an unknown frame |
| 40 | The chain stops at "space"; ICRF is present-day; the stars need a galactic frame; the Moon's parent | Two roots | Galactocentric root for deep time and the future |
| 41 | Plates are entities and frames; things spanning plates (Pangaea, empires) | Both records; spanning things in the mantle frame | Polygon-per-plate geometry for spanning entities |
| 42 | Earth's own rotation (day length, precession) over Gyr | Note only | Needed for sun angle and lighting in the renderer |
| 43 | The absolute reference frame (paleomagnetic vs hotspot vs mantle); PBDB uses its own rotation model | `frame:earth/mantle` | Pick one; re-rotate imported paleo-coordinates |
| 45 | Deforming crust (Apennines) vs rigid plates | Note only | Accept at v0 |
| 46 | Ground level rose 6–10 m in Rome: frame or field? | Field, with a local override grid | Local high-resolution field overrides |
| 49 | Frame on entity vs per phase; moves inside one frame | Per-phase `frame`, plus `moved-to` (redundant) | Per-phase only; moves are phase changes |

### Fields

| # | Gap | Examples chose | Decide |
|---|---|---|---|
| 47 | Geometry taken from a dataset query (PBDB hull, plate polygons, ephemeris), not an asset | `geometry: {from, query, method}` | Is a computed range a derived value or a claim? |
| 48 | Derived geometry (Pangaea = union of member plates) | `{derived: union, of}` | Geometry expression language, or always store |
| 51 | Basis of derived and assimilated outputs | `derived`; assimilation = reconstruction | Derived basis = weakest input? |
| 52 | 0-D time series (sea level, CO₂) as "fields"; time slices vs morphing between them; scenario-dependent futures in one field | `grid: scalar`; `interp` per field | Scalar series as a field kind; one field per scenario |
| 53 | Uncertainty in fields: bands, ensembles, dataset variants (HYDE lower/baseline/upper); fields stitched from many sources by era | All three forms appear | One uncertainty model for fields, and per-segment provenance |
| 54 | Evidence used to *check* a derived field (Ostia's shoreline, coal → wet) rather than feed it | `role: validation, checks:` | Mark validation claims so they never become inputs (else the check is circular) |
| 55 | Budgets: which claims roll up into which totals; who wins when the city and HYDE disagree | `budget:` links; `claim-wins-redistribute` | Budget graph and override policy |

### Sources, datasets, licenses

| # | Gap | Examples chose | Decide |
|---|---|---|---|
| 70 | Live upstreams (Wikidata, PBDB, Pleiades) have no versions; OpenHistoricalMap is in the doc's federation list but has no manifest entry | Dated snapshots | Mirror snapshots for reproducible builds |
| 71 | Paper vs dataset: one thing or two? | Both, linked by `dataset:` | Can claims cite `ds:` directly? (they do here) |
| 72 | Unknown and NC/SA licenses | `license: unknown` on 4 records | Build filter policy; refuse unknown? |
| 73 | Scan license ≠ license of the work | Note only | License per asset, not per source |

### Generators

| # | Gap | Examples chose | Decide |
|---|---|---|---|
| 66 | Where constraints live (district claims), and a generator's valid era | `generator_constraints:` on the district; `valid:` on the generator | Constraint schema per generator |
| 67 | Generators depending on generators (streets → insulae) or on another phase's geometry | Declared inputs | Dependency DAG; seed composition |
| 68 | Generator drift review; tours and films pinning a build | `review.render_diff_sites`; `build: null` | A film must pin a build |
| 69 | Seeds that depend on time over Gyr (clouds per day = 1.6 trillion seeds) | `floor(t / 1 day)` | Seed by time bin at the current LOD |

### Periods, tours, process

| # | Gap | Examples chose | Decide |
|---|---|---|---|
| 18 | ICS boundaries are defined by GSSPs (a rock layer), dated separately | Boundary as a ref to an event | Boundaries are claims |
| 19 | Periods have no claims, status or alternatives (Anthropocene: rejected in 2024, three proposed starts) | `status`, `alternatives` on the period | Periods should be entities with claims |
| 58 | Legend vs evidence (Rome founded 753 BCE) | `basis: reconstruction` + note | A "tradition" source kind |
| — | Tour captions hard-code facts ("66 million years ago") that section 9.1 wants built from claims | One caption uses `template` + `bind` | Require templates; flag literal numbers |
| — | Stewardship scope needs region × era as data | Editor registry `scope:` | Use the same ref and time syntax as records |

## What the checker found

- **Unknown vocabulary:** the first run had 8 errors. The examples needed
  `dissolved`, `end_state` and `habitat`, which were added to the vocab
  (they were missing, not wrong). `merges-from` was a typo for
  `merged-from`, and `start_event` was a prop that shouldn't exist. With a
  controlled vocabulary, every new topic adds props, so adding them needs a
  quick path.
- **Mixed-unit intervals (GAP-12):** 10 warnings in 9 files (field time
  axes, frame validity, the film's `declares`, steward scopes). This is the
  one finding I didn't plant: every interval running from deep time to the
  present needed it. Two more planted odd forms are flagged too (`{ga: 1.0}`
  in the manifest, `from_now_yr` on Voyager).
- **A reversed interval:** LUCA `c1` (GAP-13).
- **Contributors vs historical people:** 3 `person:` refs to historical
  people who aren't contributors (GAP-17).
- **Undocumented phase gaps:** 3 (GAP-61).
- **Unresolved refs:** 30, to 27 targets (GAP-02).
- **Unsourced claims:** 68 of 98 (GAP-16). Counted, not warned.

## Planted problems the checker can't catch

These need the real validators from section 9.2, or new rules.

| Planted | Needs |
|---|---|
| Great fire `c3` uses `species_lost_fraction` for districts destroyed | Props declare the kinds they apply to (GAP-30) |
| Laurentide `r1` says the ice sheet was `caused-by` the meltwater pulse (backwards) | Causal relations must point back in time: the solver can check cause precedes effect |
| Colosseum `c2m` duplicates `c2` | Duplicate detection (GAP-21) |
| Ötzi `c1.derived` caches a solved date in git | Ban derived keys in the schema (GAP-57) |
| Colosseum `r5` uses `built-for` with a patron | Relation target kinds (GAP-28) |
| Temple of Vesta has no phase from 394 to 1549 but stood until 1549 | Lifetime end as a claim, separate from the last phase (GAP-61) |
| Lost temple `c2` overlaps a generated insula | Footprint check across alternatives (GAP-59) |
| Phases bounded by `derive` or `ref` (most deep-time phases) can't be ordered or gap-checked without the date solver | Run the STN solver in CI before the continuity checks |
