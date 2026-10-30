# Lightworld world model — design overview

Status: draft proposal. Two slices are built: Cambrian to today, and the whole
span from the Hadean to the far future. [FIRST-SLICE.md](FIRST-SLICE.md) and
[SECOND-SLICE.md](SECOND-SLICE.md) say what they test and where they depart from
this document. It covers the world model and its main consumer, an
interactive viewer for flying through space and time. The film is a second
consumer: a scripted flight through the same world, rendered offline.

## 1. Goal

Lightworld should grow into a detailed, accurate and openly contributable
history of Earth, life and civilization in four dimensions, continuing into
its possible futures. It should work at every scale, from the whole planet
over billions of years down to a single city decade by decade, for example
ancient Rome in 3D.

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
  marked as a reconstruction, a projection or generated filler. The viewer
  can always show which.
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
  (evidence, reconstruction, projection or procedural).
- **Evidence mode.** Tint or ghost everything that isn't evidence, show
  uncertainty, and switch between competing claims and alternatives: two
  proposed sites for a lost temple, rival hypotheses for how the Moon
  formed, or emissions scenarios for the coming century.
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
  rise, burn and fall via events with durations (section 4.2). Nothing pops
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

The world is made of a few record types: **entities** (with their
**phases**), **claims**, **relations**, **frames**, **fields**, **sources**
and **generators**. Vocabularies define the terms they use. Two rules run
through all of them:

- **Every fact is a claim.** Dates, positions, names, frames, relations and
  even whether something existed are claims, with sources and confidence.
- **Every value is stored, generated or derived.** A geometry, a date or a
  field can be given directly, produced by a generator, or computed from
  other records. Derived values are never stored (section 9.1).

### 4.1 Identifiers and references

- **Stable IDs.** Every record has an ID that is never reused or
  repurposed. IDs may be readable, like `rome/colosseum`, but carry no
  meaning: renaming a thing, moving its file or re-sharding a directory
  never changes its ID, and no tool parses it.
- **One reference form.** Entities are referenced by bare ID. Other record
  types have a prefix (`src:`, `frame:`, `field:`, `gen:`, `tour:`), and
  external IDs name their scheme (`wikidata:Q10285`). Parts of a record are
  addressed inside it: `rome/colosseum@flavian` is a phase and
  `rome/colosseum#c2` is a claim or relation.
- **Wanted records.** A reference to a record that doesn't exist yet is
  allowed. It is reported as *wanted*, and wanted records appear on the
  coverage map (section 8.4).
- **People.** Contributors are accounts. People of the past are entities.

### 4.2 Entities and phases

An **entity** is anything with identity over time: a planet, a plate, an
ice sheet, a clade, a polity, a city, a building, an object, a person, a
practice such as farming. It has a `kind` from the vocabulary and links to
external IDs (Wikidata, Pleiades, the Paleobiology Database and so on).
Identity follows the thing, not its state:

- A temple rebuilt after three fires is one entity with four phases.
- Byzantium, Constantinople and Istanbul are one entity whose `name` claims
  carry dates. The viewer labels a thing by the name in use at the time
  shown, or by today's name where it had none: Pangaea was named in 1915.
- An animal, its fossil and the museum specimen are one entity, so clicking
  the specimen leads to where it lived.

A **phase** is a time-bounded state of an entity. Its interval, frame,
geometry and attributes are claims about it. An entity's lifetime is itself
a claim. Its phases tile that lifetime, and a period with no known state is
an explicit gap, never a hole.

Change is modelled in one of three ways, chosen by what the change is:

- A **new phase** when the entity becomes a different state: rebuilt,
  ruined, buried, put on display.
- A **varying property** when it changes gradually within one state: a
  growing population, a thinning ice sheet. Properties interpolate (section
  5) and continuous quantities live in fields (section 4.7).
- An **event** when the change needs its own date, cause or record. Events
  are entities with a duration, lasting seconds (an impact) to hundreds of
  millions of years (the oxidation of the atmosphere). Their properties may
  vary while they last, as a fire spreads. Relations link them to whatever
  they changed and to their participants.

**Geometry** is optional and may be stored (a glTF asset), generated (a
generator with parameters), or derived from a field, a dataset or other
entities, as a species' range is derived from fossil occurrences. An entity
without geometry, such as a reign or a lineage with no known place, is
shown through what it is related to.

Things inside things are separate entities linked by `part-of` when they
have identity of their own. Otherwise they are attributes. An entity may
carry handling notes, such as human remains or a sacred site, which the
viewer and tours honour.

### 4.3 Claims

A claim has:

- a subject (any record, or part of one), a property and a value. The
  property's vocabulary entry fixes the value's type: a quantity with unit,
  a time, a reference, a geometry, text with language, or a raw measurement
  such as a radiocarbon age
- valid time (when the claim holds in the world)
- sources, each a work plus a locator (section 4.8), and a method
- confidence, as a probability. Calibrated words such as "likely" map to
  probabilities in the vocabulary
- basis (section 7)
- author (an account, or `machine:<tool>`) and status: `proposed`,
  `accepted`, `disputed` or `deprecated`. Machine claims start as
  `proposed`, human ones as `accepted`
- rank (`preferred`, `normal` or `deprecated`, default `normal`), which picks
  the value the viewer shows by default

Claims live in their subject's file. A claim with no source says so
explicitly and counts against coverage. When a second source supports the
same value, it is added to the existing claim, so corroboration is recorded
rather than duplicated.

Two kinds of claim are not ordinary states:

- **Evidence about a moment**, such as "dedicated in 80" or "begun under
  Vespasian", feeds the date solver (section 5) and is not interpolated.
- **Checks**, such as Ostia's ancient shoreline, test a derived value. A
  check never feeds the derivation it tests.

Competing claims coexist, and the viewer can switch between them. People add
evidence instead of overwriting each other, so disagreement is recorded as
data rather than fought as an edit war. Wikidata's statement model and the
Seshat databank's coding of uncertain and disputed values are the main
precedents.

### 4.4 Alternatives

Competing claims handle disagreement about one value. Disagreement about a
whole picture is an **alternative**: a named set of claims that stand or
fall together. The same mechanism covers:

- **hypotheses**: the Moon formed from one giant impact or from many smaller
  ones. In the second, the impactor doesn't exist, so its existence is a
  claim in the first.
- **perspectives** on contested history: the names and borders a
  government, church or tradition uses
- **scenarios** for the future: an emissions pathway, with its sea level and
  temperatures
- **readings** of evidence: two proposed sites for a lost temple

A claim belongs to the default picture unless it names an alternative.
Alternatives come in groups. Members of a group exclude each other (one
emissions scenario at a time), and different groups combine freely. Each
alternative ranks its own claims, so the preferred value can differ by
perspective. The viewer switches whole alternatives, validators check each
alternative as its own consistent world, and a build includes the default
picture plus the alternatives its stewards choose to show.

### 4.5 Relations

A relation is a claim whose value is another record. It has sources, valid
time, confidence, status and rank like any claim, and it can join any
records or parts: a phase to an event, a fossil to a period, an entity to a
field. It is stored once, in its subject's file, and the build derives the
inverse. Each relation type declares its inverse, the kinds it may join, and
its direction in time where it has one: a cause precedes its effect, and a
replacement follows what it replaces.

| Family | Examples |
|---|---|
| temporal | before, after, during, overlaps; optional lag bounds ("10–30 years after") |
| spatial | within, adjacent, connects (road → gate, aqueduct → reservoir) |
| structural | part-of, member-of (a specimen in its species, a city in its province, one centre of early farming in farming as a whole) |
| lineage | replaces, splits-into, merges-into, descends-from, sister-of, reused-in (spolia) |
| causal | caused-by, destroyed-by, damaged-by, commissioned-by, built-for |
| participation | participant, with a role (attacker, impactor, founder) |

Lineage is a graph, not a tree. Lineages merge as well as split, as when a
eukaryote absorbed the bacterium that became its mitochondria, or villages
merged into a city.

### 4.6 Frames

There are no absolute coordinates. Every geometry lives in a **frame** whose
transform relative to its parent is a function of time:

```
object → building → site grid → tectonic plate → planet → Sun → galaxy
```

- **An entity's frame is a claim**, usually given per phase. A move is a
  change in that claim. An obelisk shipped from Heliopolis to Rome, then
  moved across the city in 1589, is one entity whose frame and position
  claims change.
- **Plate frames** come from a published rotation model: finite rotations per
  plate, relative to a parent plate, keyed by time. This is how GPlates works,
  and what `plates.js` approximates by hand today. A plate is also an
  entity, and its frame is the one that entity defines. The model's choice of
  absolute reference (paleomagnetic, hotspot or mantle) is part of the model
  adopted. Where no model covers a time, the frame still exists and its
  transform is a reconstruction or a placeholder, shown as such in evidence
  mode.
- **Site grids** are local metric coordinates anchored to a surveyed point,
  which itself rides on a plate.
- **The planet and Sun frames** vary too: orbit, spin, day length and
  axial tilt all change over deep time, and the Sun orbits the galaxy.
- **Things that span plates**, such as a supercontinent or an empire, live in
  a parent frame or give their geometry in pieces, one per plate.
- **Coordinates are recorded in the frame they were measured in**, often
  present-day latitude and longitude, a site grid or a georeferenced map.
  The build carries them into the record's frame.

Rigid plates approximate deforming regions. Local change in the ground, such
as Rome's street level rising several metres since antiquity, belongs in
fields. The viewer's scene graph follows the same chain, so flying to a site
250 million years ago lands where that site was on its plate at the time.

### 4.7 Fields

Continuous quantities over space and time are stored as chunked arrays
(Zarr-style) on a stated frame and grid. Examples: elevation and bathymetry,
sea level, ice thickness, temperature, precipitation, CO₂, population density,
land use. A field may also be a single global time series (mean sea level)
or a vector layer (plate outlines).

- **Uncertainty and alternatives** work as for claims: bands, ensembles, or
  alternative versions, such as a dataset's low and high estimates or one
  field per future scenario.
- **Stitched provenance.** A field can be assembled from several sources,
  each covering part of its span, and keeps provenance for each part.
- **Local detail.** A finer field over a site replaces the coarse one there.
- **Derived fields**, such as coastlines, are declared as derivations, not
  stored.

The build turns fields into multi-resolution pyramids for streaming.

### 4.8 Sources and generators

- A **source** is a work: a publication, excavation report, ancient text,
  historical map, survey or dataset version. There is one record per work,
  and claims cite it with a locator such as a chapter, page, sheet or table
  row. A source has dates of its own (when it was written, what time it
  depicts), a kind that says what sort of evidence it is (measurement,
  survey, eyewitness, later historian, tradition), a reliability note, and a
  license. Its scans and other assets carry their own licenses. Datasets in
  the manifest are sources too. Machine extraction cites a locator and a
  short quoted span, enough to verify the claim without copying the work.
- A **generator** is versioned code plus parameters plus a seed. It produces
  plausible content where no evidence exists, such as a Roman insula, a field
  system or a cloud pattern, reproducibly in the build and in the client. It
  declares its inputs (claims and fields as constraints, other generators'
  output) and the kinds, places and eras it applies to. Each item it
  produces has a stable slot ID derived from the generator and place, so a
  generated building can be referenced, reviewed and promoted (section 7).

### 4.9 Vocabularies and periods

Kinds, properties, relation types and methods are records in `schema/`.

- A **property** declares its value type, unit and interpolation rule (or
  that it is evidence about a moment), the kinds it applies to, and any
  totals it rolls up into (section 9.2).
- A **kind** may carry rules, such as "events have a duration".
- A **new term** is a small reviewed change proposed alongside the first
  records that need it. Validators reject terms that were never declared.

**Named periods** are entities of kind `period`, so their boundaries are
claims with sources and alternatives, like anything else. ICS and PeriodO
identifiers are their external IDs. A period may be defined through other
records: the Flavian period through the reigns of its emperors, the end of
the Cretaceous through the impact layer. A period may also be contested or
deprecated.

## 5. Time

**Axis.** Time is stored as a float64 *decimal astronomical year* (year 0 =
1 BCE, so 44 BCE is −43). It runs past the present into the future.

- **Precision:** float64 resolves about 30 seconds at 4.54 Ga and microseconds
  today, so one axis covers everything.
- **No date types:** JavaScript `Date` stops around 272,000 BCE and Postgres
  timestamps at 4713 BCE.
- **Writing time.** A record may give each bound in whatever unit suits it:
  a year CE or BCE, years BP, ka, Ma, Ga, or years from now. The two ends of
  an interval may use different units ("1 Ga to 2100"). The loader converts
  everything to the stored axis. `lo` is always the earlier time, whatever
  the unit, and a bare year means that whole year.

**Uncertainty.** Every time value is an interval or a distribution: `{ lo, hi }`,
a normal distribution, or a reference to a probability density (for example a
calibrated radiocarbon date). Either end may be open, and "still holds" is
not the same as "ended at an unknown time": `{ lo: 80 }` holds from 80
onwards, while `{ lo: 80, hi: unknown }` ended at some unknown time. The
viewer can show uncertainty in evidence mode, for example as a feature fading
in across its uncertain start.

**Derived, not typed.** Most dates are solved, not stored. Records hold the
evidence:

- a radiocarbon measurement plus the calibration curve version
- a stratigraphic "later than", or a fossil that only says "earlier than"
- "begun under Vespasian", where the reign is itself an entity
- an inscription
- another record's start or end plus a lag ("rebuilt within 15 years of the
  fire")

The build derives the dates, as archaeologists do with Harris matrices and
Bayesian tools such as OxCal. When a calibration curve is revised, the dates
follow. Phase boundaries, periods and captions refer to the evidence rather
than copying a number, so they move with it.

**Interpolation.** Each property declares how it changes between known
points: `step`, `linear`, `log-time`, `slerp` (rotations) or `event`
(animated over the event's duration). Evidence about a moment is not
interpolated. Any instant can be sampled, so "every decade" is just how fast
the user scrubs, not a storage unit.

**The future.** The same axis, claims and alternatives describe what is
expected to happen. Anything later than the evidence that supports it is a
**projection**: a spacecraft's position is evidence up to its last tracking
and a projection after it. Near futures usually branch into scenarios
(section 4.4). Far futures, such as the Sun swelling into a red giant, are
single projections with wide uncertainty.

**Two clocks.**

- *Valid time* is when something was true in the world. This is what the
  time slider moves.
- *Knowledge time* is when the dataset came to believe it, and Git history
  provides it for free.

When a source was written is a valid-time fact about that source (section
4.8), not knowledge time. Each build records its data commit. A view or
render can then be reproduced as "the world as known on 2027-03-01", and
changes in belief can be diffed.

## 6. Example record

```yaml
# world/entities/places/italy/rome/buildings/colosseum.yaml
id: rome/colosseum
kind: building/amphitheatre
same_as: { wikidata: Q10285 }
phases:
  - id: flavian
    frame: frame:rome/site-grid        # → plate → planet → Sun, each moving in time
    start: { derive: ["#c1", "#r1"] }  # solved: 69–79 CE
    end: { ref: rome/fire-217, edge: start }
    geometry: asset:sha256:9f2c…       # glTF in the blob store
    basis: evidence                    # evidence | reconstruction | projection | procedural
  # …later phases: restoration after the 217 fire, 1349 earthquake collapse,
  # centuries of quarrying, protected from 1749
claims:
  c1: { prop: begun_under, value: rome/reign/vespasian, source: { ref: src:suetonius, loc: "Vesp. 9" } }
  c2: { prop: dedicated, value: 80, source: { ref: src:suetonius, loc: "Tit. 7.3" }, confidence: 0.95 }
  c3: { prop: name, value: { la: Amphitheatrum Flavium }, valid: { lo: 80 } }
relations:
  r1: { rel: after, to: rome/domus-aurea@lake, source: { ref: src:martial-spectacles, loc: "2" } }
```

Clicking the Colosseum in the viewer shows this record: its phases, the
Suetonius and Martial passages, the derived 69–79 CE start, and the relation
to Nero's lake. The 217 fire is a wanted record until someone writes it
(section 4.1).

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

- **Everything carries `basis`**, which says how directly it rests on
  evidence:
  - `evidence`: observed or measured
  - `reconstruction`: inferred from evidence by people or models, including
    data assimilation
  - `projection`: expected, beyond the evidence (section 5)
  - `procedural`: generated filler

  Basis can be set on a phase, a claim or a part of a geometry, so a
  building can be evidence up to its surviving floors and reconstruction
  above them. Derived content takes the weakest basis among its inputs.
  Whether a source is a measurement or a legend is a property of the source
  (section 4.8), not a basis.
- **The default view shows the best guess.** Evidence mode tints or ghosts
  everything that isn't evidence.
- **Generators are seeded by stable IDs, places and time bins, not by build
  order.** This way, editing one temple doesn't reshuffle the generated
  houses around it, and every client generates the same city. Time bins
  follow the level of detail, so deep time needs no more seeds than a
  decade does.
- **Promotion.** When someone finds evidence for a generated building, it
  becomes a real entity. The entity records the slot ID it replaces and
  starts from the generated geometry as its draft.

**The 4D tile set** is what the viewer streams:

- **Space:** hierarchical cells on the sphere. Below city scale, local tiles
  sit in site frames.
- **Time:** hierarchical bins, log-scaled in deep time and linear in history.
  Coarse spatial levels use coarse time bins, so the planet at orbit is a
  handful of tiles per million years, while a street is tiled per decade.
- **Contents:** each tile holds the features overlapping its span, each with
  its interval, interpolation rule, IDs, basis and the alternative it
  belongs to. It also holds field pyramids and generator constraints.
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
by version and checksum, and the build fetches them (section 12). Databases
that change continuously, such as Wikidata, the Paleobiology Database and
Pleiades, are pinned as dated snapshots kept in the blob store, so any old
build can be rebuilt.

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

- extract claims from papers and reports, with locators and short quoted
  spans
- vectorize historical maps
- propose dates from relations

Everything a machine produces enters as `status: proposed` with
`author: machine:<tool>`, and needs a human to accept it. A machine claim
that matches an existing one adds its source as corroboration. Machine-made
geometry is `basis: reconstruction` or `procedural`, never `evidence`.

### 8.4 Where detail goes first

Three signals set priorities:

- **Where people go.** Anonymous, aggregate heat-maps of where and when
  viewers spend time.
- **Tours and films.** Authored paths declare what they show (region, time
  span, LOD).
- **Coverage.** Every build produces a coverage map: how much of each area
  and era rests on each basis, which claims are disputed or unsourced, and
  which records are wanted (referenced but not yet written).

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

Nothing derived is written back into records, not even as a cache. Checks
(section 4.3) stay outside the derivations they test, so a model can't pass
by being fitted to its own test.

No facts live in renderer, viewer or tour code. Labels, captions and tour
narration are templates that reference claims, so a change to the claim
updates or flags them.

### 9.2 Validators (CI for history)

These run on every change and fail or warn the pull request. Each one runs
on the default picture and again on every alternative combined with it
(section 4.4).

- **Schema:** every file validates against JSON Schema, IDs resolve or are
  reported as wanted, every term is declared, properties fit their subject's
  kind, and relations join the kinds their type allows.
- **Chronology:** dates and relations form a *simple temporal network*, where
  each constraint is `b − a ∈ [lo, hi]`. Consistency is a shortest-path check.
  A negative cycle is a contradiction, reported with the minimal set of
  conflicting claims. Relations with a direction in time are constraints
  too, so a cause dated after its effect is a contradiction. The solver
  runs first, so the checks below see solved dates.
- **Space and topology:**
  - land features sit on land at their time, after rotation and sea level
  - children stay inside their parents in both space and time
  - no two buildings share a footprint in overlapping phases
  - roads and aqueducts connect
- **Continuity:**
  - nothing appears or vanishes without an event (built, burned, buried,
    moved, demolished)
  - each entity's phases tile its lifetime claim or mark gaps explicitly

  Both matter in the viewer, where users scrub through every moment.
- **Budgets:** these are what bind micro to macro.
  - ice volume ↔ sea level
  - a city's housing capacity ↔ the population the regional layer claims
  - food and water supply ↔ that population
  - sum of regions ↔ global totals

  Properties declare the totals they roll up into (section 4.9). Where finer
  evidence disagrees with a coarser field, the finer evidence wins locally,
  the field is rebalanced around it, and the difference is reported.
- **Duplicates:** a claim restating another's value with a new source
  becomes a corroboration.
- **Model vs evidence:** sample derived fields against independent evidence,
  recorded as checks.
  - climate vs lithologic indicators (coals = wet, evaporites = arid,
    tillites = glacial)
  - biomes vs fossil occurrences

  For example, a build that paints desert over Carboniferous coal swamps
  fails.
- **Visual diff:** the renderer posts before/after stills of the places and
  times a change touches.

### 9.3 Process

- **Stewardship.** Owners per region × era (CODEOWNERS-style) review changes
  in their area, and disputed topics need two stewards. Areas are written
  with the same references and time values as records.
- **Shared vocabularies and IDs:**
  - the ICS chronostratigraphic chart for geologic periods
  - PeriodO for historical periods
  - Pleiades and Wikidata for places and entities
  - Lightworld vocabularies for kinds, properties and relations (section 4.9)
- **Neutral presentation of contested history.** Borders, names and readings
  are attributed alternatives (section 4.4) that the viewer can switch
  between, not silently resolved. Which one a build shows by default is a
  recorded steward decision.
- **Reproducible builds.** Each build records:
  - the data commit
  - dataset checksums and snapshot dates
  - generator versions and seeds
  - the alternatives shown and the license filter applied

  The same inputs produce the same tiles, the same view for a given link, and
  the same film frame for frame.

## 10. Repository layout and formats

```
world/
  schema/              JSON Schema for every record type; vocabularies (kinds, properties, relations)
  manifest.yaml        external datasets: url, version or snapshot date, sha256, license
  sources/             citations (one file per work)
  frames/              rotation models (or pointers to them), planet and site frames
  alternatives/        named hypotheses, perspectives and scenarios, and their groups
  entities/            sharded by domain/region/era, one file per entity
    earth/  life/  people/  places/italy/rome/…  space/  periods/
  generators/          procedural rules (code + tests), shared by build and viewer
  fields/              field definitions; arrays live in the blob store
  tours/               authored camera-and-time paths with captions, each pinned to a build when published (the film is one)
core/                  runtime code shared by build and viewer (time, frames, tile format)
tools/world/           validators, solver, importers, build
viewer/                the interactive viewer
```

| Content | Format | Where |
|---|---|---|
| entities, claims, relations, sources, alternatives, vocabularies, tours | YAML or JSON, one record per file (claims and relations inside their subject's file) | git |
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
  track a license per source and per asset so builds can filter by
  compatibility. Anything with an unknown license stays out of published
  builds.
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
- **Contested history.** How is the default alternative chosen when
  stewards disagree?
- **Alternatives in the viewer.** How can many alternative groups be offered
  without overwhelming people, and which combinations should a build
  pre-compute rather than solve on demand?
- **Rotation models.** Which published model or models should be adopted,
  with which absolute reference frame? How should the seams between models
  covering different eras be reconciled, and how should deep time before
  ~1 Ga be represented?
- **The far future.** How far ahead should projections go, and at what point
  does branching into scenarios give way to single projections with wide
  uncertainty?
