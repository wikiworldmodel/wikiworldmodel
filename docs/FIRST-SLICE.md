# First slice: Cambrian to today

Status: built and passing its tests, conformed to the revised [WORLD-MODEL.md](WORLD-MODEL.md)
and to the decisions in [examples/GAPS.md](../examples/GAPS.md). It is the first
end-to-end run of the design: a thin slice through every layer, from pinned datasets and
sourced records through validation, chronology solving and a versioned 4D tile set to the
viewer. It began at 300 Ma, with Pangaea; it now begins at 540 Ma, the age of the oldest
elevation grid, with the same two datasets.

The second slice, [SECOND-SLICE.md](SECOND-SLICE.md), widens the world to its whole span,
from the Hadean to the far future. Where the two differ (the time control, the tiling, the
fields), that document describes the current build.

The slice covers 540 Ma to today, with:

- moving plates from a published rotation model;
- reconstructed elevation and bathymetry, with coastlines derived from them;
- nine sourced entities, six plates and the 164 Phanerozoic periods of the ICS chart;
- competing claims, one of which the chronology solver shows to be inconsistent;
- an alternative time scale, which re-dates the records that cite its stages;
- a procedural cloud layer.

## Running it

```sh
npm install
python3 -m venv .venv && .venv/bin/pip install -r tools/world/importers/requirements.txt

npm run fetch          # download the pinned datasets into .cache/, checking their sha256
npm run validate       # schema, references, vocabularies, review, chronology, plate frames
npm run build:world    # → dist/builds/<build id>/
npm run dev            # the viewer, at http://localhost:5173/

npm test               # unit tests (about 10 s)
npm run build:viewer && npm run test:e2e   # browser tests in headless Chromium (about 2 min)
```

`npm run validate -- --verbose` also lists the notes: wanted records, and competing claims
that contradict the world. The build uses pyGPlates, through a Python importer, to
partition the elevation grids by plate and to check plate frames. Point
`WIKIWORLDMODEL_PYTHON` at an interpreter if you don't use `.venv`. Everything else is
TypeScript on Node 22.19+ or 24+.

## Pass criteria

| Criterion | Where it is checked | Result |
|---|---|---|
| Building twice gives byte-identical tiles | `tools/world/test/build.test.ts` | identical (every file's sha256) |
| The Mesosaurus sites meet in the Artinskian | `tools/world/test/mesosaurus.test.ts`, and in the browser `viewer.spec.ts` | 6,762–6,917 km apart today; 707–1,745 km apart at 285 and at 280 Ma |
| The contradiction fixture fails CI and names the conflicting claims | `tools/world/test/contradiction.test.ts`, and a CI step | fails, naming exactly the 3 clashing constraints |
| Golden-image renders at 3 times stay stable | `viewer/test/e2e/golden.spec.ts` (today, 66.03 Ma, 280 Ma) | match; unchanged by the conformance work and by the move to 540 Ma |
| A shared link reproduces the same view | `viewer/test/e2e/viewer.spec.ts` | same state, markers and pixels, exactly |

Also checked:

- **Validators.** `tools/world/test/validate.test.ts` writes a small world for each rule
  and checks that it is caught. The rules cover:
  - undeclared terms;
  - properties that don't fit their subject;
  - relations to the wrong kind;
  - a claim outside its subject's file;
  - a claim with no source and no reason;
  - an accepted machine claim;
  - an interval whose `lo` is the later time;
  - a restated value, and competing claims with no preferred one;
  - a cause dated after its effect;
  - an alternative that contradicts the default picture.

  The same test file checks two things that must not be errors: a reference to a missing
  record is reported as wanted, and no id is checked against its file's path.
- **Ids carry no meaning.** Moving a record to another directory changes nothing: the
  world test validates and solves a copy with a file moved.
- **Rotations.** The TypeScript rotation model matches pyGPlates on 3,341 reference cases:
  every plate at 13 ages from 0 to 540 Ma, crossovers included. The worst difference is
  4·10⁻¹⁰°.
- **Scrubbing.** Moving through time inside a tile's span fetches nothing.
- **Competing claims.** They switch. The URL records the pick (`pick=entity#claim`), and
  dates derived from the picked claim follow.
- **Contradictory claims.** A claim that contradicts the world can't be picked, and the
  panel says what it conflicts with.
- **Alternatives.** Switching the time scale re-dates the stages, and the records that cite
  them. The URL records the choice (`alt=…`).
- **Inverse relations.** A record shows the relations other records make to it: the
  derived inverses, never stored.
- **Generators.** The browser runs the cloud generator to the same bytes as the build: the
  viewer checks the sha256 recorded in the tile.
- **Evidence mode.** It changes the render, and the URL records it.

## What was built

The world follows the layout of section 10 of the design: one record per file, and every
record type in its own directory.

```
world/
  manifest.yaml                 2 pinned datasets, each also a source; the build's licence filter
  schema/                       JSON Schemas for every record type
    vocab/                      kinds, properties (with methods and confidence words),
                                relation types, source types and kinds
  sources/                      19 works, each noting what was checked and how
  frames/                       the geographic and present-day frames, and 6 PALEOMAP plate frames
  alternatives/                 the time-scale group and its one member
  entities/                     9 slice entities, 6 plates, and periods/ics/: 164 ICS periods
  fields/earth/                 elevation (from the PaleoDEMs) and coastline (derived, declared)
  generators/earth/             the cloud generator's record, and its code with a test
core/         runtime code shared by the build and the viewer: time axis, references,
              scenarios, quaternions, the rotation model, the temporal-network solver, the
              tile container and types
tools/world/  fetch, importers (pyGPlates; ICS periods), validators, chronology, build;
              tests and fixtures
viewer/       the WebGL2 viewer; browser tests and golden renders
```

### How records are written

A claim in the slice looks like this, from `entities/earth/structures/chicxulub-crater.yaml`:

```yaml
diameter-hildebrand-1991:
  prop: diameter                  # schema/vocab/properties.yaml: a quantity in km
  value: 180
  source:
    ref: src:hildebrand-1991-chicxulub
    loc: abstract
    quote: We suggest that a buried 180-km-diameter circular structure on the northern Yucatán Peninsula, Mexico, is an impact crater.
  rank: preferred
```

| Convention | Section | In this slice |
|---|---|---|
| Ids | 4.1 | Entities have bare ids. Other records carry their prefix in their own id (`src:`, `frame:`, `field:`, `gen:`, `alt:`), so a record's id is the reference to it. Phases are `id@phase`, claims and relations `id#key`; `@phase` and `#key` are shorthand inside the entity's own file. |
| Wanted records | 4.1 | A reference to a missing record is reported, not refused, and listed in the build's coverage file. The taxon *Mesosaurus tenuidens* is wanted: four records point to it. |
| Claims | 4.3 | Each claim has a subject (default: the entity), a property, a value typed by the vocabulary, and sources. A source is a work plus a locator and, for machine extraction, a short quote; a list of them records corroboration. A claim with no source says why (`unsourced:`). Methods and confidence words come from the vocabulary. The defaults: a claim's author is its file's `author`; status is `proposed` for machines and `accepted` for people; rank is `normal`; basis is `evidence`. |
| Evidence about a moment | 4.3, 5 | Properties declare `moment: true` (date, start, end, earlier than, later than): they feed the solver and are never interpolated. |
| Names | 4.2 | Names are claims, with a language and, if they have one, the time they were in use. The viewer labels a thing by the name in use at the time shown, else by today's. |
| Phases | 4.2 | A list, in order, that tiles the lifetime: the solver makes the first start with the entity, each end as the next starts, and the last end with it. A stretch whose state is unknown is a `gap: true` phase. |
| Relations | 4.5 | Relations are claims. Each type declares its inverse, the kinds it joins, and the constraints it puts on time, so the solver reads relations from the vocabulary rather than from code. `caused-by` makes a cause precede its effect; `part-of` keeps a part inside its whole. The build derives the inverses. |
| Frames | 4.6 | An entity's frame is a claim (`prop: frame`). Coordinates are recorded in the frame they were measured in (`frame:earth/present-day`), and the build carries them into the plate frame. The validator checks that the plate's polygon holds the location for the entity's lifetime, in every picture. A plate is also an entity; its frame names it. |
| Fields | 4.7 | One file per field. The coastline is declared as a derivation of the elevation field, never stored. |
| Sources | 4.8 | A source has a type (what the work is) and a kind (what sort of evidence it is), its date and a reliability note. Each dataset version in the manifest is a source too, cited as `src:paleodem-v2`. |
| Generators | 4.8, 7 | A record holds the version, parameters and seeds; the code sits next to it. Each item has a stable slot id (`globe`), which seeds it. The build refuses a record whose version differs from the code's. |
| Periods | 4.9 | Periods are entities of kind `period/<rank>`. A period's start is a claim citing the chart; its end is not restated, but comes from the next period of its rank (`before` with no lag). A period lies within its parent (`part-of`). |
| Alternatives | 4.4 | Groups and members are records. A claim joins the default picture unless it names an alternative, and within a group an alternative's own claims replace the default ones. Each alternative is validated as its own world with the default. The group records the steward decision: what a build shows, and its default. |
| Time | 5 | Each bound takes its own unit: a year, `CE`, `BCE`, `BP`, `ka`, `Ma`, `Ga`, `Myr/Gyr from now`. `lo` is always the earlier time, and a whole year means that year. Values are a point, `{lo, hi}` (either end may be left open; `unknown` says it ended at an unknown time), `{mean, sd}`, or another record's interval or edge: `{ref, edge, lag}`. |
| Basis | 7 | Claims carry a basis. Derived content takes the weakest basis among its inputs: a marker's place at past times is a reconstruction (it comes from the plate model), its place today is its measured location's, and its dates take the basis of the claims they rest on. |
| Validators | 9.2 | They check every file against its schema; that references resolve or are wanted; that terms are declared; that properties fit their subject's kind; and that relations join allowed kinds. They also check review status, duplicates (corroborations), ranks, the licence filter, the chronology (default and each alternative) and plate frames. |
| Reproducible builds | 9.3 | `build.json` records the data commit, the dataset checksums and database snapshot dates, the generator versions and seeds, the alternatives shown, and the licence filter. |
| Coverage | 8.4 | `coverage.json` lists unsourced and disputed claims, wanted records, and the features each tile shows by basis. |

### Entities

| Entity | What it tests |
|---|---|
| Mesosaurus at São Mateus do Sul (BR), Arroyo de La Mina (UY), Calvinia (ZA), Kabus (NA) | The frame chain: four fossil localities on three plates that meet when moved back to the Artinskian. Each is dated by the stage it cites, so its ages follow the time scale chosen. São Mateus also carries a competing radiometric date (Santos et al. 2006). Each is a `member-of` its taxon, a wanted record. |
| Chicxulub impact | Competing dates: Renne et al. 2013 (preferred) and Swisher et al. 1992 (deprecated). The 1992 date contradicts the Deccan dates, and the solver says so. |
| Chicxulub crater | A start derived from the impact through a `caused-by` relation; competing diameters (180 vs 150 km). |
| Deccan Traps | Two phases tiling a lifetime that has not ended: the main eruptive interval (Sprain et al. 2019) and the time since. |
| India–Asia collision onset | Competing dates (Hu et al. 2016: 59 ± 1 Ma; Yin & Harrison 2000: about 70 Ma), and an "earlier than" constraint (Najman et al. 2010). |
| Himalaya | A start derived only from relations: it follows whichever collision date is chosen. |
| Six plates | Plates as entities that define frames; their panels list what they carry, the derived inverse of the frame claims. |
| 164 ICS periods | Period boundaries as claims; the alternative time scale. |

Every claim was made by a machine: `machine:claude-code` for the slice's records,
`machine:ics-periods` for the imported chart. So every claim is `proposed`, and a validator
refuses any machine claim marked `accepted`. All of them need a person's review. The
`verified` note on each source says what was checked. Some values could only be partly
checked from here; the known gaps are under [Limitations](#limitations).

### The tile set

| Level | Space | Time bins (Ma) | Keyframes per tile |
|---|---|---|---|
| 0 | the globe, 2° grid | 0–20, 20–40, 40–80, 80–160, 160–320, 320–540 (log-scaled: each bin twice as long as the one after it) | 5–45 |
| 1 | 8 cells of 90° × 90°, 1° grid | each level-0 bin halved | 3–23 |

Each tile carries every keyframe needed inside its span, so the viewer can scrub without
refetching. The level-0 tiles also carry:

- **Features:** each with its interval, frame, plate and basis. A feature also carries its
  interval under other scenarios, where that differs: the alternatives the build shows, and
  each competing claim picked on its own.
- **Generator constraints:** the generator, its version, the slot and its seed, the
  parameters, and the expected output hash.

`tileset.json` is the index: space × time × LOD, with parent links, plus the alternatives
the build shows and the kind labels. The viewer:

- requests the cells in view for the current span;
- draws the coarse parent while finer tiles load;
- prefetches the neighbouring spans in time.

At the end of this slice a build was 102 tiles, plus a record for each of the 179 entities,
periods, a search index, the baked rotation keyframes and the coverage file: 41.3 MB
uncompressed. The build id is the hash of its contents. The second slice extends the bins
over the whole span, past and future, and splits them where a field starts or ends.

## Decisions, and where this departs from the design

1. **Rotation model: PALEOMAP, not Merdith et al. 2021.** The elevation grids (Scotese &
   Wright 2018) were made with the PALEOMAP model, and they are given in its frame. Moving
   them, or the fossils, with another model would put fossils off their own coastlines.
   - The importer checks the pairing: 85–100% (mean 93%) of PaleoDEM land falls inside the
     model's reconstructed continental polygons at every snapshot from 0 to 540 Ma. The 48
     snapshots older than 300 Ma score 90–98%.
   - Shifting the grid against the polygons by 2–4° lowers the score; at 100 Ma and 280 Ma
     the fit peaks at zero offset or within 2° of it.
   - The choice of model stays an open question (section 14 of the design). Swapping
     models means swapping the manifest entry, the field and the plate frames, and the
     validator then checks every frame claim against the new polygons.
2. **Fields move with plates between snapshots ("plate-warp").** Every grid node of a
   snapshot sits on a plate. To show a time between two snapshots:
   - each snapshot is rotated from its own time to the shown time by that plate's
     rotation, which is the rotation that moves the markers;
   - the two rotated snapshots are blended.

   Coastlines, terrain and markers therefore move together, smoothly, instead of
   cross-fading every 5 Myr.
3. **Coastlines are derived in the renderer.** The coastline field is the 20 m isoline of
   the blended elevation field, so it always agrees with the terrain under it. It is 20 m,
   not 0 m:
   - PaleoDEM values come in 40 m steps, with a large class at exactly 0 m along shores.
   - At 20 m those nodes count as sea, which reproduces the present-day land fraction
     of 29%.
4. **Source corrections in the importer.** The PaleoDEM grids are used as published,
   except for corrections that are listed per snapshot in the import report:
   - Each pole row is replaced by its median, since a pole row is a single point.
   - The missing 90°S row of the 150–395 Ma grids is added.
   - The duplicated 180°E column of the other grids is dropped.
   - 33 values above 8,849 m, impossible as 1° averages, are replaced by the median of their
     neighbours. Most of them are colour-scale markers.
5. **Chronology.**
   - Dates are solved, not stored: claims and relations become a simple temporal network.
   - A negative cycle is reported as the minimal set of conflicting constraints, by file
     and claim.
   - Derived dates keep the claims and relations they rest on, and the inspect panel
     lists them. Records therefore don't list them by hand (`start: { derive: [...] }` in
     the design's example): a hand-written list would repeat the solver's result.
   - Best estimates come from a second solve with every claim pinned to its centre, so
     "after X" starts at X's central value, not at the edge of X's uncertainty.
   - The build solves each picture (the default, and each alternative it shows), and each
     picture with one competing claim picked. Combinations of picks are not precomputed:
     with several picks, the viewer shows the first pick that changes a feature.
6. **A stated ± whose confidence level is not recorded is read as 1σ.** This is the wider,
   more permissive reading. Records give a normal distribution as `{mean, sd}`; where the
   source's ± is at another level, the note says how sd was derived (Santos et al. 2006:
   ±2.2 Ma at 95%, so sd ≈ 1.1 Myr).
7. **Vocabulary terms the slice adds.** The design asks for a new term to be proposed with
   the first records that need it. The slice adds:
   - `earlier_than` and `later_than`, for one-sided evidence: Najman et al. 2010 give only
     a minimum age.
   - The kind rule `moment`, for things shorter than the time resolution (an impact): a
     moment has one date, not a start and an end.
   - The methods `compilation`, `gazetteer`, `plate-polygon` and `editorial`.
   - The source kinds `compilation`, `model` and `software`, beside `measurement` and
     `review`.
   - The confidence words, IPCC AR6's likelihood scale, mapped to probability ranges.
   - The period ranks, as kinds.
8. **A period's end is not restated.** A period's start is a claim citing the chart. Its
   end comes from the next period of its rank (`before`, with no lag), so an alternative
   that moves a stage boundary changes one claim, and both stages follow. A period with no
   successor of its rank states its end, unless it still holds.
9. **The time-scale alternative.** The PBDB gives the Artinskian as 290.1–279.3 Ma, from
   its own time scale; the ICS chart v2020/03 gives 290.1–283.5 Ma. The Mesosaurus records
   now cite the stage, not the PBDB's numbers. So under the ICS chart (the default
   picture) they are dated 290.1–283.5 Ma; under the alternative "PBDB interval ages", which
   moves the base of the Kungurian to 279.3 Ma, they are dated 290.1–279.3 Ma.
10. **Plate frames are named in the records.** Each located entity claims the plate frame it
    moves with. The plate model's polygons back the claim, and the validator checks the
    claim against them. The design leaves open whether such a frame is a claim or derived
    from the polygons. A claim makes the frame visible and reviewable, at the cost of
    changing these claims if the model changes.
11. **The licence filter applies to datasets.** Their content is copied into tiles, so a
    dataset whose licence is not on the manifest's `publish.licenses` list fails
    validation. Publications and database records contribute single facts and short
    quotes, with credit, and are not filtered.
12. **Time zero.** "Ma" counts back from 1950 CE, the BP convention, so 0 Ma is year 1950 on
    the axis. "Myr/Gyr from now" counts from 1950 too: at that scale the difference does not
    matter, and a finer future would be written in calendar years.
13. **Crossovers.** At the exact age where a plate changes its fixed plate, the result
    depends on which sequence is used. GPlates picks it while building its tree: depth-first
    from the anchor, each plate's sequences in reverse file order. The rotation model does
    the same, which is why it matches pyGPlates exactly at crossovers too.
14. **Search index.** A JSON file, not SQLite or DuckDB; the slice is small.
15. **Where the data came from.** This environment cannot reach Zenodo, EarthByte or the
    Paleobiology Database, so the datasets come from public copies on GitHub:
    - The PALEOMAP files come from the rgplates package.
    - The PaleoDEMs come from vis.gl's lossless Parquet conversion; the manifest also
      records the upstream archive's checksum.
    - The PBDB records were read from the palaeoverse package's 2022 PBDB download.
    - The ICS chart table also comes from palaeoverse.

    Every copy is pinned to a commit and a sha256.

## Not covered yet

The slice does not exercise these parts of the design:

- **Checks** (section 4.3): claims that test a derived value without feeding it.
- **Tours and the film**, and captions as templates over claims.
- **Validators beyond the chronology:**
  - land features on land;
  - footprints;
  - continuity ("nothing appears without an event");
  - budgets;
  - model against evidence;
  - visual diffs.
- **Geometry** (glTF assets, per-part basis), generators with inputs and constraints, and
  promotion of generated items.
- **Other time values:** probability densities and radiocarbon calibration.
- **The future:** projections and scenarios.
- **The coverage map in the viewer:** `coverage.json` is written, not displayed.
- **Valid time** is checked and shown, but used only to choose names.

## Limitations

- **Claims and citations need review.** Values that could not be fully checked here:
  - The σ level of Renne et al.'s and Swisher et al.'s ±.
  - The per-sample uncertainties of the Deccan bounds (Sprain et al. 2019, Fig. 1).
  - The Mahabaleshwar coordinates.
  - The collision site, placed approximately 8 km south of Saga.
  - The Himalaya's marker point, which is a display choice (the claim says so and has no
    source).
  - Seven claims have no source: six editorial names and the Himalaya's point. The coverage
    file lists them.
- **Periods.**
  - The ICS table used here has no boundary uncertainties.
  - The PBDB alternative restates only the one boundary the records here depend on.
  - ICS and PeriodO identifiers are not recorded as external ids: they could not be
    checked from here.
- **Ocean floor.** The model only tracks continents and some ocean floor into the past,
  so most ocean nodes are on no plate and do not move. The plate polygons are only partly
  reconciled with the elevation grids: most of the land fits, some shelf does not.
- **Resolution.** The source is a 1° grid, so the coast is soft at close range.
- **Uncertainty with age.** The plate model and the elevation grids rest on sparser evidence
  the further back they go, most of all in the early Paleozoic, yet the build gives them all
  the same basis, reconstruction. Nothing records yet how their uncertainty grows with age.
- **Uncompressed tiles.** They should be served with gzip or brotli.
- **Data licence.** None has been chosen for WikiWorldModel itself (section 13 of the design).
  The datasets used are CC BY 4.0 as stated by their distributors; confirm upstream terms
  before publishing a build.

## Next slices

The whole span ([SECOND-SLICE.md](SECOND-SLICE.md)) came next, ahead of these two, so that
the whole timeline is covered coarsely before any era in depth. These remain, in the order
proposed when this slice was planned:

1. **Last Glacial Maximum to today.** This adds:
   - ice sheets and sea level on a fixed datum, so coastlines need a sea-level field;
   - population;
   - the budget validators (ice volume ↔ sea level).
2. **A sliver of Rome.** The fourth slice ([FOURTH-SLICE.md](FOURTH-SLICE.md)) took up
   Rome's history at the scale of the empire, with dates derived from historical evidence;
   the city itself is still to come. This adds:
   - phases with gaps;
   - dates derived from historical evidence;
   - site-grid frames, generators at city scale;
   - the hand-over from the globe to a local renderer.
