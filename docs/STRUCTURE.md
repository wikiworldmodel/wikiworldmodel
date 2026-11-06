# Structure: what to settle before the world grows

Status: proposal, November 2026. Nothing in it is built yet, except where it says so. It comes from comparing the
repository with a first-principles view of the project. It names the structural choices that are cheap to make now and
expensive once many agents have written against them. It goes with the `model:` records being drafted for
[WORLD-MODEL.md](WORLD-MODEL.md) section 4.10, and it revises one rule of [AGENTS.md](../AGENTS.md): generators no
longer need to be byte-identical (section 3.5).

## 1. The aim, restated

Pick any place and any time in Earth's history and get the best view that can honestly be given of it. Fidelity
follows the evidence: square metres for the present, a landscape for the Cretaceous, a whole planet for the Hadean.

That makes the world a function, not a map:

> **view(place, time, scale)** → the best estimate of what was there, how uncertain it is, and what it rests on.

The function is never empty. There is always a prior, at worst a rocky planet with the right Sun, day and Moon, and
each layer of knowledge sharpens it locally. **Filling in** means closing the gap between what the function returns
and the best that anyone knows, everywhere, weighted by how much people look.

Two gaps need keeping apart:

- **The ingestion gap.** The knowledge exists, in a paper or a database, but the world has not read it yet. Agents
  close this one.
- **The science gap.** The evidence did not survive, or nobody has studied it. No amount of reading closes it. The
  world shows it honestly, as uncertainty, alternatives and labelled generated detail.

The best achievable fidelity at a place and time (its *ceiling*) is set by the evidence that survived. It is lumpy:
Pompeii, the Burgess Shale and the last 800 kyr of ice cores are peaks; most of the Proterozoic is flat. Work is worth
most where the ceiling is high, the world is still far below it, and people look.

### 1.1 Three kinds of content

Every view is made of three kinds of content, and each needs different work:

| Kind | What it is | Example | Who does the work |
|---|---|---|---|
| **Evidence** | sparse, sourced points in space and time | a zircon age, a pollen core, a fossil, an excavation report, a census | agents at scale: reading, extracting, citing |
| **Models** | fill the space between the evidence | plate reconstructions, paleoclimate runs, who lived where, population | scientific engineering; fewer hands |
| **Generators** | make plausible detail finer than the evidence | a Maastrichtian floodplain forest turned into trees, ground and light | engineering and taste; fewest hands |

A pixel is a generator's sample, conditioned on models, conditioned on evidence. Where evidence is dense the generator
invents little; where it is sparse it invents almost everything, and says so.

A fourth kind sits between evidence and generators: **appearance**, sourced knowledge of what things looked like. The
forms on the tree of life ([FORMS.md](FORMS.md)) are the first of it, and keeping it as reviewable data rather than code
is right.

### 1.2 Where the repository stands

| Layer | How close | In short |
|---|---|---|
| Evidence | close | claims with a source, locator and quote; pinned datasets; snapshots with their queries. About 17,200 claims in the last build, none accepted, about 1,460 unsourced |
| Models | far, being drafted | mostly other people's model output imported as fields (PALEOMAP, PaleoDEM, the Li et al. 2022 climate run, HYDE). The life atlas and the date solver are the two places where the world's own evidence becomes a model. `model:` records are being written now |
| Generators | halfway | real records with versions, seeds and slots. Until the model draft, every one declared `inputs: []`, and the living scene still carries the Hell Creek in its parameters |

Other gaps the comparison found, which are content rather than structure:

- **The present is nearly empty:** Natural Earth borders and cities, two ETOPO tiles, SRTM around Rome, HYDE to 2015.
- **Before about 1.1 Ga there is no land.** The third slice draws "oceans without land where the map is unknown", though
  there were cratons. A confidently empty ocean is less honest than a labelled guess.
- **Life is land-only.** The atlas reads the PBDB's land occurrences, though life was marine for about three billion
  years and most of the fossil record is marine.
- **The lowest layers do not reach the picture.** The Sun's luminosity, day length and the Moon's distance are series;
  the viewer does not read them.
- **Status drifts.** DATA-OUTLINE, ROADMAP, RECORD-SETS and CATALOG count the world differently from each other and
  from the build. [CATALOG.md](CATALOG.md) is the fix and should be built before the next wave of record sets.

## 2. The order of the decisions

Sections 3.1 to 3.3 shape the model records, because models are what read rows, carry uncertainty and answer
`resolve`; settle them before the model schema is final. Sections 3.4 to 3.7 come next. Section 4 can wait.

## 3. Decisions

### 3.1 Rows are claims: one claim model, two kinds of storage

**Now.** Datasets read as rows (Cliopatria, Itiner-e, NOAA's hazards, Glottolog, the PBDB's 245,000 land
occurrences) are a second world. As [RECORD-SETS.md](RECORD-SETS.md) says, "they are not searched, not dated by the
solver, and a click says what the dataset says of a row." A row cannot be corrected, contested, corroborated, linked
to a record or used as evidence by a model. With agents at scale, rows will outnumber hand-written claims by orders of
magnitude, so the hand-written world would cover only famous things.

**Proposal.** A dataset is a source whose rows are claims. The meaning is the same as for records; only the storage
differs:

- **Records.** What someone researched one by one stays YAML in git, one entity per file.
- **Claim tables.** A pinned snapshot, stored columnar (Parquet). Each row is addressed by its upstream id, such as
  `src:pbdb-land-2026-11-05#occ:820351`. A declarative mapping in the field or importer says which column is which
  property, with which method and basis.
- **Overlays.** A record can name a row as its subject: to correct it, rank it, corroborate it, or tie it to an entity
  with `same_as`. The row stays as the dataset gives it; the overlay is a competing claim, as section 4.3 of the design
  requires.
- **Promotion.** A row becomes a full record only when someone researches it, as a generated slot is promoted.
- **One index.** The build compiles records, tables and overlays into one claim index (DuckDB or Parquet). The solver,
  the models, search and the inspect panel read that index and never the storage beneath it.

**Why not convert every row to a record.** One-off conversion is cheap; the lasting costs are not:

- every new snapshot of an upstream database becomes a diff of thousands of files, which forks the upstream and buries
  real edits in refreshes;
- file counts reach the limits section 12 of the design warns about, and validation time grows with rows;
- YAML is roughly ten times larger than columnar storage and slower to query.

The test for which form a thing takes: if a person would ever edit it on its own, it is a record; if it is refreshed
from upstream as a whole, it is a table; overlays join the two.

### 3.2 Uncertainty travels as ensembles

**Now.** About 940 values are written as ranges, about 100 as a mean and sd, and 14 files use `confidence:`. Every
field has one value per cell: one climate run, one elevation model. The rule that derived content "takes the weakest
basis among its inputs" says what kind of knowledge a thing is, not how uncertain it is.

**Proposal.** Every model consumes and produces uncertainty in one currency: **samples**. The model record's
`uncertainty.kind` (none, interval, band, ensemble, alternatives, tiers) says how a source gives it; the build reads
each kind as samples:

- **A member is a joint sample of the whole world.** Member 7 of the climate goes with member 7 of the elevation. There
  is no cross-product, so two interacting fields of N members cost N, not N². Propagating uncertainty is running the
  model graph N times: linear in N.
- **Most uncertainty is parametric** (a range, a mean and sd). Samples are drawn from it with a seed when needed, and
  cost no storage.
- **Only true ensembles are stored as members,** such as several runs of a climate model. 10 to 30 members show a
  spread well enough.
- **The viewer streams one member by default** (the median, or member 0). Evidence mode adds a spread layer, a per-cell
  sd or quantiles, which is two or three times one layer, not N.
- **Generators sample from one member.**
- **A single-valued field is allowed,** and says its uncertainty is unknown rather than pretending it is zero.
- **Alternatives are labelled members.** An alternative (section 4.4 of the design) is a set of members a reader
  switches between by name, and the date solver's intervals are one more special case.

### 3.3 One contract: `resolve(place, time, layer)`

**Now.** Each subsystem has its own chain of fallbacks: forms climb the tree of life, the atlas has tiers, the clouds
are generic, and before about 1.1 Ga nothing answers, so nothing is drawn.

**Proposal.** Every layer, asked at any place and time, returns:

- a value;
- the **tier** that answered: *evidence*, *model*, *generic prior* or *unknown*;
- its basis and its uncertainty.

"Unknown" is a valid answer, and every tier has a designed look. Unknown is drawn as the generic prior (generic cratons
in the Precambrian, a generic shallow sea), and the panel says that nothing is known here. Evidence mode shows which
tier is on screen. **Blanks look generic, never broken.**

The error is in the build, not the viewer: a layer that returns nothing and names no tier fails a test. Today's
Precambrian is the opposite case, which looks finished and is a hole.

This is the contract that makes WORLD-MODEL section 7 true ("Wherever the user flies, something plausible is on
screen") for every layer rather than some.

### 3.4 Models and generators: where the line is

- **A model** turns evidence into a *distribution*. Its output is a claim about the world at its resolution, with
  uncertainty, and can be tested against specific evidence at a specific place: "this cell was humid; here is a coal
  bed." It usually runs in the build, and its basis is `reconstruction`. Examples: the climate, the biome classifier,
  the life atlas, river routing ("a river runs roughly here").
- **A generator** draws *samples* from a model's distribution, below the resolution of anything known. No single output
  is a claim, only its statistics, and it can be tested only in aggregate. It runs when something is looked at, and its
  basis is `procedural`. Examples: which 30 animals stand in view, a river's meanders, a canopy's texture.

**The test:** would it mean anything to compare this output with one piece of evidence at this exact place? If yes, it
is a model; if only in distribution, a generator.

**The check that ties them:** a generator's aggregate output must match the model it samples. Generated tree density
matches the model's; the mix of generated taxa follows the atlas's probabilities. Each generator record names the
model outputs it samples in its `inputs`, and a test compares its aggregate with them.

### 3.5 Generators: no byte-identical rule, more power, stable identity

**Now.** Generators use only + − × ÷, square roots, floor and 32-bit integer operations, with sine as a polynomial
([math.ts](../world/generators/city/math.ts)), so that every JavaScript engine makes the same bytes. That caps what a
generator can be: erosion, river routing, GPU shading and learned textures are hard or impossible under it.

**Decision.** The byte-identical requirement is dropped, for generators and for builds.

- **Generators may use anything:** `Math.*`, noise libraries, WebAssembly, WebGPU, learned models.
- **Identity stays stable.** A generated individual's identity comes from a hash of its slot id and seed, never from a
  computed position. Links, clicks and promotion keep working when positions differ slightly between machines.
- **Tests compare within a tolerance**, as the golden images already do, not byte for byte. Builds are reproducible in
  meaning: the same commit gives the same records, ids and statistics.
- **Heavy generators are pre-baked** in the build, as section 3.2 of the design already allows; light ones run in the
  client.
- **Contributed generator code runs sandboxed** in the viewer (a Worker or WebAssembly). New generator code goes to the
  human-review lane of [OPEN-CONTRIBUTION.md](OPEN-CONTRIBUTION.md), because it runs in every visitor's browser.

### 3.6 One contract for fields and layers

**Now.** Each dataset got its own importer, build step, binary file and viewer layer: `people.lwt`, `ice.lwt`,
`climate.lwt`, canvases for rows, an 18 MB file of polities loaded whole. The 4D tile set holds only markers; the field
pyramids of WORLD-MODEL section 7 were never built.

**Proposal.** A small set of typed field kinds: continuous raster, categorical raster, points, lines, areas, series.
Each has one build path into tiled, time-binned pyramids, and one generic renderer whose styling is data in the field
record. A new dataset is a manifest entry, an importer and a field record, and nothing in the viewer.

**Why, when engineering is cheap.** What remains costly is not writing code but keeping every code path right about
time, plate frames, uncertainty, alternatives, picking and evidence mode. Each bespoke layer does all of these again,
and they drift: does the roads layer honour alternatives, move with the plates, fade in evidence mode? A shared
contract also means:

- agents contribute data, which a schema checks, rather than viewer code, which runs in every browser;
- models read any field the same way, so a new layer can feed models and checks at once;
- streaming and memory budgets are kept in one place;
- a visitor meets one inspect panel, one legend and one evidence mode everywhere.

**What stays free.** The risk is a lowest common denominator; the people layer found that a shader texture beat a
canvas. So the *data* is uniform (tiles, time bins, provenance, picking, uncertainty) and the *rendering* is pluggable:
the standard renderers, and room for a bespoke one that still reads the standard tiles.

### 3.7 A verification ladder on every claim

**Now.** A claim is `proposed` or `accepted`, and `verified:` exists only on sources. At agent scale almost everything
stays proposed for ever, and the status stops saying anything.

**Proposal.** Each claim carries how far it has been checked, each step with who did it and how:

1. **quoted:** the quote was found in the retrieved text, by script;
2. **re-read:** a second agent, reading the source independently, reached the same value;
3. **audited:** a person checked it as part of a sample, which measures how often the machines are wrong;
4. **accepted:** a person accepted it.

Evidence mode can show the step. The machine error rates measured at step 3 set how far the green lane of
OPEN-CONTRIBUTION may reach. CATALOG section 6's ladder (named, sourced, placed, identified, accepted) is about how
complete a record is; this one is about how far it has been checked, and the two go side by side.

## 4. Deferred

- **Federated layers for the present.** The best present-day sources are share-alike (OpenStreetMap) or proprietary
  (photorealistic 3D tiles, most imagery), and the build imports only CC0, CC BY and public-domain data. Reaching the
  present at street fidelity will need a second kind of layer: streamed by the viewer at a pinned version, referenced by
  the build but not inside it, labelled, and kept out of derivations. Not now.

## 5. Smaller, but structural

- **Areas as claim values.** The only geometry in records is points and 96 building footprints adopted from
  OpenHistoricalMap. Ranges, ice extents and borders exist only inside datasets, so no record can assert or contest an
  area.
- **Frames in deep time.** The chain object → building → site → plate → planet is sound. It needs a placeholder frame
  before the plate models begin, about 1.1 Ga, and room for deforming regions, before many records lean on it.

## 6. What changes

| Where | Change |
|---|---|
| [AGENTS.md](../AGENTS.md), Code | drop "the build and every browser make the same bytes" and the + − × ÷ rule; say identity is by slot id and seed, and tests use tolerances |
| [WORLD-MODEL.md](WORLD-MODEL.md) 3.2, 3.3, 7, 9.3 | the same, for generators, the renderer and reproducible builds |
| WORLD-MODEL 4.7, 4.10 | claim tables and overlays; uncertainty as samples; `resolve` and its tiers |
| `world/schema/` | row subjects (`src:…#…`) in references; the verification ladder on claims; generator `inputs` naming the model outputs sampled |
| `tools/world/` | one claim index; field kinds built into tiled pyramids; a test that every layer answers `resolve` with a tier |
| `viewer/` | generic renderers per field kind; a designed look for each tier |
| the tests | reproducibility by tolerance; `reproducible.test.ts` checks ids and statistics, not bytes |

## 7. Open questions

- **How many members.** Is a fixed N for the whole world simpler than a per-field N with resampling?
- **Where rows are corrected.** When an overlay corrects a row, should the correction also be sent upstream
  automatically, as "federate, don't fork" asks?
- **The generic prior's look.** How generic is generic? A Precambrian craton drawn too well invites belief; drawn too
  plainly it looks broken.
- **Sandboxing cost.** Can a Worker-sandboxed generator hold the frame budgets of [LIVING-WORLD.md](LIVING-WORLD.md)
  section 4?
