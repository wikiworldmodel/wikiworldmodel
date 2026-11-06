# Contributing to WikiWorldModel, for agents

WikiWorldModel (the repository is `lightworld`) is a sourced, four-dimensional
history of Earth, life and civilization, from the Solar System's first solids to the far future,
with a viewer to fly through it. It is a world model of the base-reality kind: every fact in it
is a claim that cites a source, and nothing is made up to fill a gap without saying it was. The
design is in [docs/WORLD-MODEL.md](docs/WORLD-MODEL.md); what is built is in the seven slice
documents in [docs/](docs/).

This guide is written for AI agents (and the people who run them) contributing research,
records, datasets and code. People follow the same rules; [CONTRIBUTING.md](CONTRIBUTING.md)
has the short version. The work still to do is outlined in
[docs/DATA-OUTLINE.md](docs/DATA-OUTLINE.md).

## The rules

These are not style preferences. A pull request that breaks one is closed.

1. **Never invent a source, a locator, a quote, a number or an identifier.** Cite only works
   you have actually retrieved and read. A quote must be copied from the text you retrieved,
   character for character. If you could not read a source, do not cite it: leave the claim
   out, or open an issue saying what you could not reach.
2. **Machine work is labelled and proposed.** Every claim you write has
   `author: machine:<tool>` (for example `machine:claude-code`), on the claim or for the whole
   file. Its status is then `proposed` by default. Never set `status: accepted`: only a person
   who has checked a claim may accept it, and the validator refuses a machine claim marked
   accepted.
3. **Every claim has a source with a locator, or says why it has none.** `source:` names a
   work (`ref: src:…`) and where in it (`loc:`: page, section, table row, record id), with a
   short `quote:` that shows the claim. A claim that rests on no source, such as an editorial
   label or a marker's placement, has `unsourced: <why>` instead.
4. **Disagreement is data.** If sources disagree, write competing claims on the same property,
   each with its source, and mark one `rank: preferred` with a note saying why. Never overwrite
   or delete another claim because you think it is wrong: add yours and say so. If a whole
   picture is at stake (a hypothesis, a reading, a perspective), it is an alternative
   (section 4.4 of the design).
5. **Derived values are never stored.** Dates that follow from other dates, coastlines,
   paleo-positions, inverse relations and coverage are computed by the build. Write the
   evidence ("after X", "within the Artinskian", "caused by Y"), not the result.
6. **Licenses are checked before data comes in.** A dataset the build reads must be CC0,
   CC BY or public domain (`publish.licenses` in [world/manifest.yaml](world/manifest.yaml)).
   Share-alike (CC BY-SA, ODbL) and non-commercial (CC BY-NC) data may not be imported. Quotes
   stay short (the schema caps them at 400 characters); never copy a text wholesale.
7. **Ids are stable and mean nothing.** Never rename an id or reuse one. No tool reads meaning
   into an id, and neither should you; moving a file never changes its id.
8. **Small, scoped, green.** One topic or area per pull request, with every check passing.
   Don't reformat files you aren't changing.

## Setting up

```sh
npm install
python3 -m venv .venv && .venv/bin/pip install -r tools/world/importers/requirements.txt
npm run fetch          # the pinned datasets → .cache/datasets (about 1.2 GB)
npm run validate       # schema, references, vocabularies, review, chronology, plate frames
npm test               # unit tests (they need only the plate model)
npm run build:world    # → dist/builds/<id>/
npm run test:build     # checks on that build
npm run build:viewer && npx playwright test --project=globe   # browser tests (also: city, city-views)
npm run dev            # the viewer, at http://localhost:5173/
```

Node 22.19+ or 24+, Python 3.12+.

**Sandboxes with limited network access.** Datasets come from several hosts: GitHub, Zenodo,
Figshare, PANGAEA, CEDA, publishers' sites, NOAA, OpenTopography, INGV. If some are blocked where you run:

- `npm run validate` and `npm test` need only the plate model, on GitHub:
  `npm run fetch -- src:paleomap-plate-model`. Records can be written and checked with no other
  dataset, and these are the checks CI runs on every pull request.
- `npm run build:world` needs them all. Say in your pull request that you could not build, and
  CI will.
- Never work around a blocked download with a file from somewhere else: datasets are pinned by
  sha256, and a different file is a different dataset.

## The loop

1. **Pick a task** (see [Finding work](#finding-work)). Say what you're doing in its issue, if it
   has one, so two agents don't do the same thing.
2. **Research it.** Find the best sources you can actually read (see
   [Research](#research)). Note each fact with its source, locator and verbatim quote as you go.
3. **Write the records** in [world/](world/): one entity per file, claims and relations in their
   subject's file, sources one per work.
4. **Check quotes against the texts** you retrieved, by script, not by eye: save the text you read
   and run `npm run world -- quote-check src:… <text file>`. Every `quote` must be found in it
   (after normalizing whitespace and typography); the command lists any that are not, and records
   the `quoted` step on each claim whose quote it finds (see [Checking](#how-far-a-claim-has-been-checked)).
   Say what you checked in the source's `verified:` note too.
5. **Validate.** `npm run validate -- --verbose`. Fix every error and warning; read the notes
   (wanted records, and competing claims that contradict the rest of the world).
6. **Build and look**, if you can: `npm run build:world`, then open the place and time in the
   viewer, and check that what you added appears where and when it should.
7. **Open a pull request** with the template below.

## Finding work

- **[docs/RECORD-SETS.md](docs/RECORD-SETS.md)**: the roadmap's record sets, what is left of them, and
  the doubts their first drafts left behind: a person or an agent with a source can settle one.
- **[docs/DATA-OUTLINE.md](docs/DATA-OUTLINE.md)**: everything a complete history needs, by
  domain, with candidate datasets, their licenses, and what is already here. Start from a row
  marked *missing* in an area you can research well.
- **Forms**: `npm run world -- forms-wanted` lists the taxa that most need a body of their own, and
  [docs/FORMS.md](docs/FORMS.md) is the brief. Any taxon with none is drawn as the nearest node of the tree that has one,
  so a coarse form on a family is worth a lot, and a form for each species is the long-run aim.
- **Wanted records**: references to records nobody has written, listed by
  `npm run validate -- --verbose` and in each build's `coverage.json`.
- **Unsourced claims**: listed in `coverage.json`, and counted by `npm run validate`. Find a source, or
  confirm there is none.
- **Each slice's "Next" section** in [docs/](docs/).
- **Issues** labelled `good first issue` or `agents welcome`.

Good tasks for an agent are bounded and checkable: "the 12 Phanerozoic large igneous provinces
with dated main phases", "the reigns of the Julio-Claudian emperors from Suetonius", "Pleiades
ids for the Rome monuments that lack them". Poor tasks are open-ended ("add history of China")
or rest on sources you cannot read.

## Research

**Sources, best first:**

1. Primary evidence and its first publication: a dated sample's lab paper, an excavation
   report, an inscription, a contemporary text in a critical edition.
2. Peer-reviewed syntheses and standard reference works: review papers, the ICS chart, Platner
   and Ashby for Rome, the Barrington Atlas through Pleiades.
3. Curated databases with versions: the Paleobiology Database, Pleiades, Wikidata (for
   identifiers more than for facts), PeriodO.
4. Encyclopedias such as Wikipedia, only to find the sources above. Cite them only when nothing
   better can be read, and say so in a note.

**Locators** are specific enough that a person can find the quote in a minute: `p. 412`,
`Fig. 3`, `Table 2, row "Deccan"`, `5.26.1`, `s.v. Arcus Titi, p. 45`, `occurrence 820351`.

**Numbers** are copied as the source gives them, with their uncertainty:
- `{ mean: 66.038 Ma, sd: 0.049 Myr }` for a stated ±. If the source says the ± is 2σ or 95%,
  halve it for `sd` and say so in a note; if it doesn't say, read it as 1σ and say so.
- `{ lo: 290.1 Ma, hi: 283.5 Ma }` for a range; `lo` is always the earlier time.
- A stage, reign or other record when that is what the source dates by: `{ ref: ics/artinskian }`.

**Dates** are written as the axis reads them ([core/time.ts](core/time.ts)):
- years: `44 BCE`, `80 CE`, `1990.61`;
- days and months: `15 March 44 BCE`, `March 44 BCE`, in the Julian calendar before 15 October
  1582 and the Gregorian after;
- ages: `4550 BP`, `12.9 ka`, `66.043 Ma`, `4.567 Ga`;
- the future: `5 Gyr from now`.

A Roman date before 45 BCE is in a calendar out of step with the seasons. Keep the date the source
gives and say so in a note.

**Places** are recorded as measured: `{ lat, lon, frame: frame:earth/present-day }`, usually
from a gazetteer (Pleiades, Wikidata, GeoNames) with `method: gazetteer` and the gazetteer's id
as the locator. The entity also needs a `frame` claim, the plate it rides; copy the pattern
from a neighbour on the same plate. `npm run validate` checks it against the plate polygons.

**Identifiers**: put Wikidata, Pleiades, PBDB, PeriodO and OpenHistoricalMap ids in `same_as`,
and only ones you have looked up.

## Writing records

Read three or four records near yours before writing; the patterns are consistent. The schemas
are in [world/schema/](world/schema/), and the terms you may use in
[world/schema/vocab/](world/schema/vocab/).

### An event

```yaml
# world/entities/people/events/battle-of-actium.yaml
id: people/events/battle-of-actium
kind: event/battle
summary: >-
  The sea battle off the promontory of Actium in which Octavian's fleet under Agrippa defeated
  Antony and Cleopatra.
author: machine:claude-code
same_as: { wikidata: Q160387 }
claims:
  name:
    prop: name
    value: { en: Battle of Actium }
    unsourced: An editorial label.
  date:
    prop: date
    value: 2 September 31 BCE
    source:
      ref: src:cassius-dio-roman-history
      loc: "51.1.1, vol. 6 p. 3"
      quote: Such was the naval battle in which they engaged on the second of September.
    method: historical-account
  location:
    prop: location
    value: { lat: 38.923568, lon: 20.749775, frame: frame:earth/present-day }
    source: { ref: src:pleiades-actium-promontory, loc: representative point }
    method: gazetteer
  frame:
    prop: frame
    value: frame:paleomap/plate-307
    source: { ref: src:paleomap-plate-model, loc: PALEOMAP_PlatePolygons.gpml }
    method: plate-polygon
    basis: reconstruction
```

### Competing claims

```yaml
  date-renne-2013:
    prop: date
    value: { mean: 66.038 Ma, sd: 0.049 Myr }
    source: { ref: src:renne-2013-kpg-timescales, loc: "40Ar/39Ar ages of tektites", quote: "…" }
    method: radiometric/ar-ar
    rank: preferred
    note: Why this one is preferred, in a sentence.
  date-swisher-1992:
    prop: date
    value: { mean: 64.98 Ma, sd: 0.05 Myr }
    source: { ref: src:swisher-1992-chicxulub-ages, quote: "…" }
    method: radiometric/ar-ar
    rank: deprecated
    note: What superseded it.
```

The viewer lets a reader switch between them; the solver says if one contradicts the rest of
the world.

### Evidence about time

```yaml
  date:                              # dated by the stage it was found in: follows the chart
    prop: date
    value: { ref: ics/artinskian }
  earlier-than-najman-2010:          # a one-sided bound
    prop: earlier_than
    value: 50.6 Ma
relations:
  formed-by:                         # a cause, with no lag: the crater starts with the impact
    rel: caused-by
    to: earth/events/chicxulub-impact
    lag: 0 yr
  during-deccan:                     # within another record's phase
    rel: during
    to: earth/lips/deccan-traps@main
```

Relations carry a `source` like any claim. Their meaning in time is declared in
[relations.yaml](world/schema/vocab/relations.yaml), so the solver checks them: a cause dated
after its effect fails validation.

### A source

```yaml
# world/sources/renne-2013-kpg-timescales.yaml
id: src:renne-2013-kpg-timescales
type: publication              # what the work is
kind: measurement              # what sort of evidence it is
citation: >-
  Renne, P.R., Deino, A.L., … & Smit, J. (2013). Time scales of critical events around the
  Cretaceous-Paleogene boundary. Science 339(6120), 684–687.
authors: ["Renne, P.R.", "Deino, A.L."]   # quote each: a bare flow list splits at the commas
published: 2013
doi: 10.1126/science.1230492
verified:
  by: machine:claude-code
  how: Citation, DOI and quoted values checked against the full text from the publisher's page.
```

One file per work, cited many times with different locators. An ancient text is one source,
naming the edition or translation it was read in.

### A dataset

A dataset the build reads goes in [world/manifest.yaml](world/manifest.yaml), not in records:
its title, citation, license and a `fetch:` block with the URL, `sha256` and size. Then an
importer turns it into what the build needs, in [tools/world/](tools/world/), with tests. Don't
convert a large dataset into thousands of YAML records: records are for researched facts, and
datasets are referenced, not copied (section 12 of the design). A database that changes every
day, such as OpenHistoricalMap or the PBDB, is kept as a dated snapshot in
[world/snapshots/](world/snapshots/) or a pinned archive, with the query that made it
(`npm run world -- ohm-snapshot`, `npm run world -- pbdb-snapshot "Hell Creek"`). A taxon written by
hand adopts the database's by its number: `same_as: { pbdb: "txn:38862" }`.

A dataset of points, lines or areas over the globe needs no code in the viewer: its field says
its `kind` (points, lines or areas), maps its columns in `rows:`, and says how it looks in `layer:`
(a colour, or a hue for each group; sizes, widths and opacity, fixed or by a column; names; a
toolbar toggle), and one renderer draws it ([core/fieldlayers.ts](core/fieldlayers.ts)). The
languages and the Roman roads are drawn so; copy one of theirs.

The field that reads a dataset says how its uncertainty is carried, as `spread:`: `band` (a low and a
high around each value), `alternatives` (readings, each its own picture), `ensemble` (members, such as
runs of a model), `claims`, `tiers`, or `unknown` when the source gives one value and no spread. Say
`unknown` rather than leave it out: no spread is not the same as exact.

### A row of a dataset

A dataset read as rows (the PBDB's fossils, Cliopatria's states, NOAA's hazards, Glottolog's
languages, Itiner-e's roads) is a source whose rows are claims. Its field's `rows:` section says
how a row is keyed and which column gives which property ([tools/world/src/tables.ts](tools/world/src/tables.ts)).
A row's address is `src:<dataset>#<key>`: the inspect panel shows it, and
`npm run world -- claims <address>` lists what the row says.

A record can't be written into a dataset, so an **overlay**, one file per row in
[world/overlays/](world/overlays/), names the row and does one of three things:

- **corrects it:** a claim of the same property, `rank: preferred`, with a `note` saying why the
  row is wrong and a source for the right value;
- **corroborates it:** the same value, from another source;
- **ties it to a record:** `same_as: <entity id>`, the entity it is a row of.

```yaml
# world/overlays/noaa-hazards/eruption-5238.yaml: the shape of one, not a real correction
row: src:noaa-hazards-2026-11-04#eruption:5238
author: machine:claude-code
claims:
  date:
    prop: date
    value: …
    source: { ref: src:…, loc: …, quote: … }
    rank: preferred
    note: Why the row's year is wrong, in a sentence.
```

The row stays as the dataset gives it, and the build reads it with the correction applied. Write
an overlay only for a row you have something to say about; never copy rows into records.

### A model

A model fills the space between the evidence: code that turns records, datasets and fields into a
field or another derived value. Its record, in [world/models/](world/models/), says what it reads,
what it makes, where each parameter of what it makes comes from, and what it is checked against.
The values stay in the field; the model says only where they come from.

```yaml
# world/models/earth/coastline.yaml
id: model:earth/coastline
type: model
title: The coastline, from the elevation
description: >-
  The coast is where the elevation field crosses an isoline near sea level.
author: machine:claude-code
code: viewer/src/gl/globe.ts
inputs:
  - field:earth/elevation
outputs: [field:earth/coastline]
params:
  isoline_m: { choice: "Where the coast sits between the 0 m class and the first class of land." }
uncertainty: { kind: none, note: "A line with no width." }
```

- A parameter has a `source` (a work and a locator, as a claim's), `follows` a claim of the world, or
  is a `choice` that says what it means. Never call a choice a source.
- `checks` name a test and the test's name as written; the validator finds it. A check holds the model
  to evidence it does not read.
- `disagrees` lists evidence the model contradicts. Write it down rather than tune the model to hide it.
- `uncertainty` says how its output carries uncertainty. Uncertainty travels as samples
  ([core/samples.ts](core/samples.ts)): a member is a joint sample of the whole world, member 0 the
  central value. A model that reads a field with a band, alternatives or an ensemble runs once per
  member and carries the spread on; the validator warns at one that says its output carries none.
- A generator lists its `inputs` the same way, as records, or as `{ prop: … }`, `{ rel: … }` or
  `{ kind: … }` for every claim, relation or record of that term. Empty only if it reads nothing.
- **A model or a generator?** A model turns evidence into a distribution: its output is a claim about
  the world at its resolution, which can be tested against a piece of evidence at a place. A generator
  draws samples from a model's distribution, finer than anything known: no single output is a claim,
  only its statistics. One that samples fields or claims names `checks`, tests that hold what it
  makes in aggregate to them (generated density to the model's, the mix of taxa to the atlas's), and
  `limits` where it is known not to follow them.

`npm run validate -- --verbose` notes each model and field that no evidence of the world reaches. A
check against the world's own evidence there is among the most useful work there is.

### How far a claim has been checked

A claim's `status` says whether a person has accepted it. Its `checked:` steps say what has been
done short of that, each with who did it and how ([core/ladder.ts](core/ladder.ts)):

```yaml
    checked:
      - { step: quoted, by: machine:quote-check, how: "Found in renne-2013.txt (sha256 …).", on: "2026-11-06" }
      - { step: re-read, by: machine:claude-code@reread, how: "Read Table 2 again on its own; same value." }
```

- **quoted**: the quote was found in the text the source was read in, by script. `quote-check`
  writes it; don't write it by hand.
- **re-read**: a second reader read the source on its own and reached the same value. The reader is
  not the claim's author: a second agent names itself apart, as `machine:claude-code@reread`.
- **audited**: a person checked it, as part of a sample. Never a machine.
- **accepted** is the claim's status, set only by a person.

Each step stands on the one below it, and the inspect panel and `coverage.json` show the level a
claim has reached. Record only steps that were taken.

### A new term

A kind, property, method or relation type that isn't in the vocabulary is added in the same pull
request as the first records that need it, with a description. Prefer an existing term if one
fits; ask in the pull request if unsure.

### Geometry

Outlines of buildings, walls, roads and the like belong in
[OpenHistoricalMap](https://www.openhistoricalmap.org/), with their dates. A record adopts the
element (`footprint: { from: src:ohm-…, elements: [way/…] }`) and the snapshot is refreshed with
`npm run world -- ohm-snapshot`. Federate, don't fork: fix the map upstream, not here.

## Larger work: slices

A slice is a thin piece of the world taken through every layer, from sources and records
through validation and the build to the viewer, with criteria that say when it works. Each of
those built so far has a document in [docs/](docs/): what it adds, its pass criteria and
where each is tested, its decisions, its limitations and what comes next.

Propose a slice in an issue before starting one, with its pass criteria. Build it on a branch,
write its document in the same form, and make every criterion a test.

## Code

- TypeScript, strict; `npm run typecheck` must pass. Match the code around you: its comments,
  its names, its idioms.
- **No facts in code.** The renderer, the viewer and the generators read every fact from
  records; a number about the world in code is a bug.
- **Generators are seeded, not exact.** A generator is seeded by stable slot ids and may use any
  arithmetic: `Math.*`, libraries, WebAssembly, the GPU. What it makes is compared by its
  fingerprint ([core/fingerprint.ts](core/fingerprint.ts)): which things there are, exactly, and
  where and how big, within a tolerance. An individual's identity comes from its slot and seed,
  never from a computed position, so a link, a click and a promotion keep working when two machines
  differ in the last bits of a float. A change to a generator's output beyond the tolerance is a
  new version, not an edit. In the viewer, generators run in a worker, off the page.
- **Tests.** Unit tests with `npm test`; they run on every pull request, so keep them fast and
  free of builds. Tests of a build go in the `build` group (`vitest.config.ts`). Browser tests
  in three groups, run nightly: `globe`, `city` (drawn with `quality=fast`) and `city-views`
  (full quality). Golden images change only with a change
  that should change them: regenerate them with `--update-snapshots`, look at every diff, and
  say in the pull request why each changed.
- **Every layer answers everywhere.** Asked at any place and time, a layer says what it has and which
  tier answered: evidence, model, generic or unknown ([core/resolve.ts](core/resolve.ts)). A new layer
  adds its case there; `coverage.json` counts the tiers and the build's tests ask every layer across
  the whole span. Unknown is a fine answer; drawn, it is the generic prior, plainly, never a hole.
- Builds are reproducible in meaning: two builds of the same commit have the same files, records,
  ids and words, and the same numbers within a tolerance (`npm run test:reproducible`). Keep it so.

## Pull requests

Title: what the change does, in the imperative ("Add the end-Permian extinction's dates").

```markdown
## What
The records, datasets or code changed, and why.

## Sources
Each work cited, and how it was read (publisher's page, archive.org scan, Perseus…).

## Checks
- [ ] `npm run validate` passes with no warnings
- [ ] quotes checked by script against the texts retrieved
- [ ] `npm test` passes; for a change to how the world is built, `npm run build:world` and
      `npm run test:build` too (or: could not fetch <dataset>, so not run)
- [ ] seen in the viewer at <link>

## Open questions
Anything uncertain a reviewer should look at first.
```

Note at the end which agent made the change, and who ran it if a person did.

## Don't

- Don't cite a source you haven't read, or a page number you didn't see.
- Don't paraphrase a quote; copy it.
- Don't record a check you did not make.
- Don't mark anything `accepted`, or change a claim's rank without saying why.
- Don't store a date, position or geometry the build can derive.
- Don't import share-alike, non-commercial or unlicensed data.
- Don't add a vocabulary term when an existing one fits.
- Don't open a pull request that changes hundreds of records at once without agreeing it in an
  issue first.
