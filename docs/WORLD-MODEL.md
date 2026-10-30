# Lightworld world model — design overview

Status: draft proposal. A first end-to-end slice is built (Pangaea to today); see
[FIRST-SLICE.md](FIRST-SLICE.md) for what it tested and where it departs from this
document. It covers the world model and its
main consumer, an interactive viewer for flying through space and time. The
film is a second consumer: a scripted flight through the same
world, rendered offline.

## 1. Goal

Lightworld should grow into a detailed, accurate and openly contributable
history of Earth, life and civilization in four dimensions. It should work at
every scale, from the whole planet over billions of years down to a single
city decade by decade, for example ancient Rome in 3D.

People mainly experience it through an **interactive viewer**. They fly
around the globe and down into a city, scrub or zoom through time, and click
anything to see what it is and how we know. Films and guided tours are paths
through the same viewer.

Four requirements follow:

- **Explorable.** Any place at any time can be visited, at whatever detail
  exists, and moving through space or time is smooth.
- **Iterable.** Detail is added piece by piece, forever. The world is usable
  at every stage and never needs to be "finished".
- **Accurate and honest.** Every visible thing traces back to evidence, or is
  marked as a reconstruction or as generated filler. The viewer can always
  show which.
- **Coherent.** Thousands of contributions, at scales from plates to
  buildings, must not contradict each other or drift apart.

## 2. Core idea: separate the world from its presentations

```
 sources ──► WORLD (canonical, versioned) ──► build ──► 4D tile set ──► VIEWER (primary)
 papers,      entities · phases · claims       validate   space × time      free flight, scrub time,
 excavations, relations · frames · fields      solve      × LOD             inspect, evidence mode
 maps,        sources · generators             derive     + index           │
 datasets                                      pin                          ├─ tours (authored paths)
                                                                            └─ film (scripted path,
                                                                               rendered offline)
```

- **World:** one canonical model of what existed where and when, built from
  sourced claims. It is the only place facts live.
- **Build:** compiles the world into a validated, versioned **4D tile set**
  (section 7) plus a search index. Every presentation reads the build. None
  reads raw records or holds facts of its own.
- **Viewer:** the main product. It streams tiles for whatever is in view at
  the current time and detail level, and it shows sources for anything
  visible.
- **Tours and films:** authored camera-and-time paths with captions. They
  refer to world records by ID. A tour plays live in the viewer; the film is
  a tour rendered offline frame by frame with the same renderer.


## 3. The viewer

### 3.1 What a user does

- **Fly.** Start from deep space, orbit the globe, then descend continuously
  to a region, a city and a street.
- **Move through time.** Use a time control that zooms like a map. At planet
  scale it spans billions of years on a log scale; near a Roman street it
  spans decades on a linear scale. Play, scrub, or jump to named periods and
  events.
- **Inspect.** Click any building, coastline, ice sheet, species range or
  event to see its phases, claims, sources, competing claims and basis
  (evidence, reconstruction or procedural).
- **Evidence mode.** Tint or ghost everything that is reconstructed or
  generated, show uncertainty, and switch between competing claims (for
  example, two proposed sites for a lost temple).
- **Search and share.** Search entities, places, periods and events. The URL
  always encodes place, time, camera and data version, so any view is a
  shareable, reproducible link.
- **Tours.** Follow authored paths with captions, and step off them at any
  point to explore.

### 3.2 What this asks of the data

The viewer is why several choices in this document matter:

- **Coupled space and time detail.** What is worth loading depends on both
  how close you are and how finely you are looking in time. At orbit over
  deep time the viewer needs plates, climate fields and ice. At street level
  in 110 CE it needs buildings that existed that decade. The tile set is
  indexed by both (section 7).
- **Scrubbing without refetching.** A tile covers a time span and carries
  every feature that overlaps it, together with that feature's interval and
  interpolation rule. The client filters and interpolates locally, so
  dragging the time slider is instant until it leaves the tile's span.
- **Smooth change.** Coastlines, ice and plates move continuously; buildings
  rise, burn and fall via events with durations (section 5). Nothing pops
  unless the world says it changed abruptly.
- **Picking.** Every rendered element carries its entity and phase ID, so a
  click resolves to records and sources.
- **Generators run in the client.** Generated filler, such as apartment
  blocks or field patterns, is not shipped as geometry. The client runs the
  same versioned, seeded generators as the build, from compact constraints
  in the tile. This keeps tiles small and output identical everywhere. Heavy
  generators can be pre-baked instead.
- **Latency budgets.** The first globe should appear within a few seconds,
  and the viewer should hold 60 fps while flying. Progressive refinement
  always shows the coarser level while finer tiles load.

### 3.3 Rendering

The film's Earth renderer is the starting point for the viewer's planet
level: the atmosphere, clouds, climate-driven surface and lights. Below some
altitude, a local scene renderer for terrain, buildings and objects takes
over and blends with the globe. The renderer is deterministic, so the same
build, time and camera produce the same pixels. That is what makes films,
visual diffs and shareable views reproducible.

## 4. Data model

Six record types:

### 4.1 Entities and phases

An **entity** is anything with identity over time: a planet, a plate, an
ice sheet, a clade, a polity, a city, a road, a building, an object. It has a
stable opaque ID, a `kind` from a controlled vocabulary, and links to
external IDs (Wikidata, Pleiades, the Paleobiology Database and so on).

A **phase** is a time-bounded state of an entity, with its own interval,
frame, geometry and attributes.

- A temple rebuilt after three fires is one entity with four phases.
- Byzantium, Constantinople and Istanbul are one entity whose `name` claims
  carry dates.
- **Events** (an impact, an eruption, a fire, a battle, an edict) are short
  entities, linked by relations to whatever they changed.

### 4.2 Claims

Every date, position, dimension and attribute is a **claim**. A claim has:

- subject (entity or phase), property and value
- valid time (when the claim holds in the world)
- source(s), method, confidence
- author (a person, or `machine:<tool>`) and status: `proposed`, `accepted`,
  `disputed` or `deprecated`
- rank (`preferred`, `normal` or `deprecated`), which picks the value the
  viewer shows by default

Competing claims coexist, and the viewer can switch between them. People add
evidence instead of overwriting each other, so disagreement is recorded as
data rather than fought as an edit war. Wikidata's statement model and the
Seshat databank's coding of uncertain and disputed values are the main
precedents.

### 4.3 Relations

| Family | Examples |
|---|---|
| temporal | before, after, during, overlaps; optional lag bounds ("10–30 years after") |
| spatial | within, adjacent, connects (road → gate, aqueduct → reservoir) |
| lineage | replaces, splits-into, merges-into, moved-to, reused-in (spolia), descends-from (phylogeny) |
| causal | caused-by, destroyed-by, built-for |

### 4.4 Frames

There are no absolute coordinates. Every geometry lives in a **frame** whose
transform relative to its parent is a function of time:

```
object → building → site grid → tectonic plate → planet (body frame) → space
```

- **Plate frames** come from a published rotation model: finite rotations per
  plate, relative to a parent plate, keyed by time. This is how GPlates works,
  and what `plates.js` approximates by hand today.
- **Site grids** are local metric coordinates anchored to a surveyed point,
  which itself rides on a plate.
- **Moves** are frame changes. An obelisk shipped from Heliopolis to Rome,
  then moved across the city in 1589, is one entity that changes parent frame
  twice.

The viewer's scene graph follows the same chain, so flying to a site 250
million years ago lands where that site was on its plate at the time.

### 4.5 Fields

Continuous quantities over space and time are stored as chunked arrays
(Zarr-style) on a stated frame and grid. Examples: elevation and bathymetry,
sea level, ice thickness, temperature, precipitation, CO₂, population density,
land use. The build turns them into multi-resolution pyramids for streaming.

### 4.6 Sources and generators

- A **source** is a citation: a publication, excavation report, ancient text,
  historical map sheet or dataset version. It carries a license and a
  reliability note.
- A **generator** is versioned code plus parameters plus a seed. It produces
  plausible content where no evidence exists, such as a Roman insula, a field
  system or a cloud pattern. Its output is tagged `basis: procedural` and is
  reproducible, in the build and in the client alike.

## 5. Time

**Axis.** Time is stored as a float64 *decimal astronomical year* (year 0 =
1 BCE, so 44 BCE is −43). Display units (BCE/CE, BP, Ma, Ga) exist only in
the UI.

- **Precision:** float64 resolves about 30 seconds at 4.54 Ga and microseconds
  today, so one axis covers everything.
- **No date types:** JavaScript `Date` stops around 272,000 BCE and Postgres
  timestamps at 4713 BCE.

**Uncertainty.** Every time value is an interval or a distribution: `{ lo, hi }`,
a normal distribution, or a reference to a probability density (for example a
calibrated radiocarbon date). The viewer can show it in evidence mode, for
example as a feature fading in across its uncertain start.

**Derived, not typed.** Most dates are solved, not stored. Records hold the
evidence:

- a radiocarbon measurement plus the calibration curve version
- a stratigraphic "later than"
- "begun under Vespasian", where the reign is itself an entity
- an inscription

The build derives the dates, as archaeologists do with Harris matrices and
Bayesian tools such as OxCal. When a calibration curve is revised, the dates
follow.

**Interpolation.** Each property declares how it changes between known
points: `step`, `linear`, `log-time`, `slerp` (rotations) or `event`
(animated over the event's duration). Any instant can be sampled, so
"every decade" is just how fast the user scrubs, not a storage unit.

**Two clocks.**

- *Valid time* is when something was true in the world. This is what the
  time slider moves.
- *Knowledge time* is when the dataset came to believe it, and Git history
  provides it for free.

Each build records its data commit. A view or render can then be reproduced
as "the world as known on 2027-03-01", and changes in belief can be diffed.

## 6. Example record

```yaml
# world/entities/places/italy/rome/buildings/colosseum.yaml
id: rome/colosseum
kind: building/amphitheatre
frame: rome/site-grid                  # → plate → planet, each moving in time
same_as: { wikidata: "Q…", pleiades: "…" }
phases:
  - id: flavian
    start: { derive: [c1, r1] }        # solved: 69–79 CE
    geometry: asset:sha256:9f2c…       # glTF in the blob store
    basis: evidence                    # evidence | reconstruction | procedural
  # …later phases: 1349 earthquake collapse, centuries of quarrying
claims:
  c1: { prop: begun_under, value: rome/vespasian, source: suetonius/vespasian/9 }
  c2: { prop: dedicated, value: 80, source: suetonius/titus/7.3, confidence: high }
relations:
  r1: { after: rome/domus-aurea/lake }   # built over the drained lake of Nero's palace
```

Clicking the Colosseum in the viewer shows this record: its phases, the two
Suetonius passages, the derived 69–79 CE start, and the relation to Nero's
lake.

## 7. Levels of detail: the world as a mipmap

Every level has a fallback:

- **Roll-up.** Coarse levels are summaries of finer evidence. The glow of
  Rome seen from orbit at night comes from Rome's population and buildings.
- **Drill-down.** Where evidence runs out, finer levels are generated from
  coarser constraints. Apartment blocks are generated to fit Rome's population
  and the per-district counts in the 4th-century Regionary Catalogues.

| Level | From evidence | Generated |
|---|---|---|
| Planet, 66 Ma | impact site, sea-level and CO₂ curves | weather, cloud patterns |
| Plates | rotations fitted to paleomagnetic and seafloor data | fine coastline detail |
| Region, Latium 100 CE | towns, roads, villas | farms, field patterns |
| City, imperial Rome | monuments, walls, aqueducts, Marble Plan fragments | apartment blocks, gardens, minor streets |
| Building, the Colosseum | surviving fabric, plan, coin depictions | lost statues and fittings |

Wherever the user flies, something plausible is on screen, and evidence
gradually replaces generated content. Rome Reborn split its model the same
way: monuments hand-built where the evidence is good, procedural buildings
elsewhere.

Rules:

- **Everything carries `basis`.** The default view shows the best guess.
  Evidence mode tints or ghosts reconstructed and procedural content.
- **Generators are seeded by stable IDs and locations, not by build order.**
  This way, editing one temple doesn't reshuffle the generated houses around
  it, and every client generates the same city.
- **Promotion.** When someone finds evidence for a generated building, it
  becomes a real entity, with the generated geometry as its starting draft.

**The 4D tile set** is what the viewer streams:

- **Space:** hierarchical cells on the sphere. Below city scale, local tiles
  sit in site frames.
- **Time:** hierarchical bins, log-scaled in deep time and linear in history.
  Coarse spatial levels use coarse time bins, so the planet at orbit is a
  handful of tiles per million years, while a street is tiled per decade.
- **Contents:** each tile holds the features overlapping its span, each with
  its interval, interpolation rule, IDs and basis. It also holds field
  pyramids and generator constraints.
- **Query:** the client asks for *frustum × time window × LOD*, keeps the
  parent tiles as a fallback, and prefetches neighbours in both space and
  time along the direction the user is moving.

## 8. How detail gets filled in

### 8.1 Seed each level from open data

| Domain | Seed sources |
|---|---|
| Plates and paleogeography | GPlates rotation models (e.g. Merdith et al. 2021, 1 Ga to present); Scotese PALEOMAP paleo-elevation grids |
| Climate | Judd et al. 2024 (485 Myr surface temperature); CO₂ and sea-level compilations; ICE-6G (last glacial ice sheets) |
| Life | Paleobiology Database (fossil occurrences with paleo-coordinates); Open Tree of Life |
| People | HYDE (gridded population and land use since 10,000 BCE); Seshat (polities); Pleiades (ancient places); OpenHistoricalMap (dated map features); Wikidata (entities and IDs) |
| Rome specifically | Severan Marble Plan fragments; Lanciani's *Forma Urbis Romae*; Nolli's 1748 map; Regionary Catalogues; excavation reports |

Imported datasets are **referenced, not copied**: the manifest pins each one
by version and checksum, and the build fetches them (section 12).

### 8.2 Kinds of contribution

The viewer doubles as the front door for contributors. Fly to a place and
time, see what is missing or wrong, and open an editor right there.

| Contribution | Who | Tooling |
|---|---|---|
| Claims with citations | historians, scientists, careful readers | inspect panel → "add claim"; the citation is required |
| Geometry tracing | mappers | editor over georeferenced historical maps, in place in the viewer; the backdrop sheet is recorded as the source |
| 3D models | modelers | glTF linked to the evidence for each part, previewed in the viewer at its place and time |
| Generators | programmers | typology rules (insula, domus, field system) with tests and render diffs |
| Review | domain stewards | accept, rank or dispute claims; approve merges |

### 8.3 Machine assistance

AI can draft at scale:

- extract claims from papers and reports, with quoted spans and page numbers
- vectorize historical maps
- propose dates from relations

Everything a machine produces enters as `status: proposed` with
`author: machine:<tool>`, and needs a human to accept it. Machine-made
geometry is `basis: reconstruction` or `procedural`, never `evidence`.

### 8.4 Where detail goes first

Three signals set priorities:

- **Where people go.** Anonymous, aggregate heat-maps of where and when
  viewers spend time.
- **Tours and films.** Authored paths declare what they show (region, time
  span, LOD).
- **Coverage.** Every build produces a coverage map: how much of each area
  and era is evidence, reconstruction or procedural, and which claims are
  disputed.

The viewer can show the coverage map as an overlay. That overlay is the
project's to-do list.

## 9. Coherence

### 9.1 Derive, don't duplicate

Store the smallest set of independent facts and compute everything else.
A derived value cannot disagree with its inputs.

| Derived | From |
|---|---|
| coastlines | elevation + sea level (this puts Ostia on the shore in 100 CE, though it is ~3 km inland today) |
| paleo-positions | plate-local coordinates + rotation model |
| night lights, campfires | population fields + buildings |
| dates | evidence + relations (section 5) |
| snapshots, tiles | entities + phases + interpolation rules |

No facts live in renderer, viewer or tour code. Labels, captions and tour
narration reference claims, so a change to the claim flags them.

### 9.2 Validators (CI for history)

These run on every change and fail or warn the pull request.

- **Schema:** every file validates against JSON Schema, IDs resolve, and
  vocabularies are respected.
- **Chronology:** dates and relations form a *simple temporal network*, where
  each constraint is `b − a ∈ [lo, hi]`. Consistency is a shortest-path check.
  A negative cycle is a contradiction, reported with the minimal set of
  conflicting claims.
- **Space and topology:**
  - land features sit on land at their time, after rotation and sea level
  - children stay inside their parents in both space and time
  - no two buildings share a footprint in overlapping phases
  - roads and aqueducts connect
- **Continuity:**
  - nothing appears or vanishes without an event (built, burned, buried,
    moved, demolished)
  - each entity's phases tile its lifetime or mark gaps explicitly

  Both matter in the viewer, where users scrub through every moment.
- **Budgets:** these are what bind micro to macro.
  - ice volume ↔ sea level
  - a city's housing capacity ↔ the population the regional layer claims
  - food and water supply ↔ that population
  - sum of regions ↔ global totals
- **Model vs evidence:** sample derived fields against independent evidence.
  - climate vs lithologic indicators (coals = wet, evaporites = arid,
    tillites = glacial)
  - biomes vs fossil occurrences

  For example, a build that paints desert over Carboniferous coal swamps
  fails.
- **Visual diff:** the renderer posts before/after stills of the places and
  times a change touches.

### 9.3 Process

- **Stewardship.** Owners per region × era (CODEOWNERS-style) review changes
  in their area, and disputed topics need two stewards.
- **Shared vocabularies and IDs:**
  - the ICS chronostratigraphic chart for geologic periods
  - PeriodO for historical periods
  - Pleiades and Wikidata for places and entities
  - a Lightworld `kind` vocabulary
- **Neutral presentation of contested history.** Borders and names are
  shown as attributed alternatives that the viewer can switch between, not
  silently resolved.
- **Reproducible builds.** Each build records:
  - the data commit
  - dataset checksums
  - generator versions and seeds

  The same inputs produce the same tiles, the same view for a given link, and
  the same film frame for frame.

## 10. Repository layout and formats

```
world/
  schema/              JSON Schema for every record type; vocabularies
  manifest.yaml        external datasets: url, version, sha256, license
  sources/             citations (one file per source)
  frames/              rotation models (or pointers to them), site grids
  periods/             named periods (ICS, PeriodO links)
  entities/            sharded by domain/region/era, one file per entity
    earth/  life/  people/  places/italy/rome/…
  generators/          procedural rules (code + tests), shared by build and viewer
  fields/              field definitions; arrays live in the blob store
  tours/               authored camera-and-time paths with captions (the film is one)
core/                  runtime code shared by build and viewer (time, frames, tile format)
tools/world/           validators, solver, importers, build
viewer/                the interactive viewer
```

| Content | Format | Where |
|---|---|---|
| entities, claims, relations, sources, tours | YAML or JSON, one entity per file | git |
| rotation models | GPlates `.rot`, baked to quaternion keyframes for the client | git if small, else blob |
| meshes | glTF | blob store, referenced by sha256 |
| fields | Zarr / NetCDF, Cloud-Optimized GeoTIFF for 2D rasters | blob store |
| historical map scans | Cloud-Optimized GeoTIFF + georeferencing | blob store |
| build outputs | 4D tile set (vector features and 3D Tiles with time intervals, field pyramids), search index (SQLite/DuckDB), film assets | CDN / build artifacts, never committed |

## 11. Serving

The viewer is a static web app, and the tile set is static files on a CDN,
versioned per build. No server is needed for viewing. A link pins a build
version, so old links keep working. Search runs on a small index, which can
be downloaded or served. Editing (sections 8.2 and 12) is the only part that needs a
backend.

## 12. Storage and scale

**What goes in git:** human-researched records only.

- External datasets are pinned in the manifest.
- Generated content is reproduced from generators.
- Binaries go to a content-addressed blob store.
- Build outputs are never committed.

The repo grows by roughly one small text file per thing someone actually
researched: thousands of files at first, tens of thousands after years of
work. That is comfortable for git and free on GitHub.

The blob store and CDN are cheap object storage, for example Cloudflare R2,
which has no egress fees. That matters for a viewer streaming tiles to many
users. Avoid Git LFS for large assets, because its storage and bandwidth are
metered.

**Where git stops working**, roughly in the order you would hit the limits:

1. **Contributors.** Pull requests suit dozens of technical contributors,
   not thousands of casual ones. First, add an in-viewer editor that opens
   pull requests. Later, move to a database with an edit API and
   OpenStreetMap-style changesets.
2. **Queries.** Git is not a query engine, so the build compiles the repo
   into tiles and an index on every commit.
3. **Size.** GitHub wants repos under a few GB and rejects files over 100 MB.
   Only committing binaries or imports would get there.
4. **File count.** Git slows past about a million files. Sparse checkout
   helps.

**Habits that keep a later migration cheap:**

- stable opaque IDs
- one entity per file, in sharded directories
- schema validation
- no derived or generated data in git
- binaries stored by hash

With these in place, moving to Postgres or PostGIS later is an import script.

## 13. Licensing and federation

- **Federate, don't fork.** Link OpenHistoricalMap, Wikidata, Pleiades and
  the Paleobiology Database by ID, import from them, and send corrections
  upstream where possible. OpenHistoricalMap already provides a dated 2D map
  of history with a community behind it. Lightworld's own value is:
  - the synthesis across scales
  - 3D reconstruction
  - the deep-time Earth state
  - the viewer that lets anyone fly through it
- **Choose the data license before the first outside contribution**, and
  track a license per source so builds can filter by compatibility.
  - OpenStreetMap's ODbL is share-alike.
  - Wikidata is CC0.
  - Most science datasets are CC-BY.

  The mix decides what a build may publish. Code and data licenses are chosen
  separately.

## 14. Open questions

- **Time control.** What UI zooms smoothly from billions of years to a
  decade? Options include a log-scaled slider, a coupled "time zoom" tied to
  altitude, or both. What happens visually while scrubbing fast across
  millions of years?
- **Uncertainty display.** In evidence mode, how should "exists with
  probability p at time t" look: a fade, a ghost, or a slider?
- **Client vs baked generators.** Where is the cut-off between generating
  in the browser and pre-baking? What does that mean for mobile devices?
- **Renderer platform.** Should the viewer stay on WebGL2, as the film is
  today, or move to WebGPU for large city scenes?
- **Generator drift.** A generator upgrade changes many outputs at once, so
  its review rules probably need render diffs over sample sites.
- **Granularity.** Should claims live in their own files, or inside entity
  files? The proposal is inside entity files, until merge conflicts say
  otherwise.
- **Contested history.** How are default ranks chosen when stewards
  disagree?
- **Rotation models.** Which published model or models should be adopted?
  How should the seams between models covering different eras be reconciled,
  and how should deep time before ~1 Ga be represented?
