# Contributing to World Model Zero, for agents

World Model Zero (working title; the repository is `lightworld`) is a sourced, four-dimensional
history of Earth, life and civilization, from the Solar System's first solids to the far future,
with a viewer to fly through it. It is a world model of the base-reality kind: every fact in it
is a claim that cites a source, and nothing is made up to fill a gap without saying it was. The
design is in [docs/WORLD-MODEL.md](docs/WORLD-MODEL.md); what is built is in the five slice
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
npm run fetch          # the pinned datasets → .cache/datasets (165 MB)
npm run validate       # schema, references, vocabularies, review, chronology, plate frames
npm test               # unit tests (they need only the plate model)
npm run build:world    # → dist/builds/<id>/
npm run test:build     # checks on that build
npm run build:viewer && npx playwright test --project=globe   # browser tests (also: city, city-views)
npm run dev            # the viewer, at http://localhost:5173/
```

Node 22.19+ or 24+, Python 3.12+.

**Sandboxes with limited network access.** Datasets come from several hosts: GitHub, Zenodo,
publishers' sites, NOAA, OpenTopography, INGV. If some are blocked where you run:

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
4. **Check quotes against the texts** you retrieved, by script, not by eye: every `quote` must be
   a substring of the source text (after normalizing whitespace). Record what you checked in
   the source's `verified:` note.
5. **Validate.** `npm run validate -- --verbose`. Fix every error and warning; read the notes
   (wanted records, and competing claims that contradict the rest of the world).
6. **Build and look**, if you can: `npm run build:world`, then open the place and time in the
   viewer, and check that what you added appears where and when it should.
7. **Open a pull request** with the template below.

## Finding work

- **[docs/DATA-OUTLINE.md](docs/DATA-OUTLINE.md)**: everything a complete history needs, by
  domain, with candidate datasets, their licenses, and what is already here. Start from a row
  marked *missing* in an area you can research well.
- **Wanted records**: references to records nobody has written, listed by
  `npm run validate -- --verbose` and in each build's `coverage.json`.
- **Unsourced claims**: 112 at the time of writing, also in `coverage.json`. Find a source, or
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
[world/snapshots/](world/snapshots/) or a pinned archive, with the query that made it.

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
the five built so far has a document in [docs/](docs/): what it adds, its pass criteria and
where each is tested, its decisions, its limitations and what comes next.

Propose a slice in an issue before starting one, with its pass criteria. Build it on a branch,
write its document in the same form, and make every criterion a test.

## Code

- TypeScript, strict; `npm run typecheck` must pass. Match the code around you: its comments,
  its names, its idioms.
- **No facts in code.** The renderer, the viewer and the generators read every fact from
  records; a number about the world in code is a bug.
- **Generators are deterministic.** They are seeded by stable ids and use only + − × ÷, square
  roots and integer operations, so the build and every browser make the same bytes. A change to
  a generator's output is a new version, not an edit.
- **Tests.** Unit tests with `npm test`; they run on every pull request, so keep them fast and
  free of builds. Tests of a build go in the `build` group (`vitest.config.ts`). Browser tests
  in three groups, run nightly: `globe`, `city` (drawn with `quality=fast`) and `city-views`
  (full quality). Golden images change only with a change
  that should change them: regenerate them with `--update-snapshots`, look at every diff, and
  say in the pull request why each changed.
- Builds are reproducible: two builds of the same commit are byte-identical. Keep it so.

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
- Don't mark anything `accepted`, or change a claim's rank without saying why.
- Don't store a date, position or geometry the build can derive.
- Don't import share-alike, non-commercial or unlicensed data.
- Don't add a vocabulary term when an existing one fits.
- Don't open a pull request that changes hundreds of records at once without agreeing it in an
  issue first.
