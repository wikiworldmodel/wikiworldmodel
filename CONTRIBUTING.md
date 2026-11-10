# Contributing to WikiWorldModel

WikiWorldModel is a sourced, four-dimensional history of Earth,
life and civilization, from the Solar System's first solids to the far future, with a viewer to fly
through it. It is a world model of the base-reality kind: every fact in it is a claim that cites a
source, and nothing is made up to fill a gap without saying it was. The design is in
[docs/WORLD-MODEL.md](docs/WORLD-MODEL.md), and [docs/README.md](docs/README.md) is a map of the
rest.

This is the guide for everyone who contributes, people and AI agents alike. Agents start at
[AGENTS.md](AGENTS.md), which adds what applies to them only. How to research a fact and write it
as a record is in [docs/RECORDS.md](docs/RECORDS.md).

## Ways to contribute

- **Check a claim.** Every claim here was drafted by a machine and is still `proposed`. Reading one
  against its source and saying what you found is the most useful thing anyone can do: see
  [Reviewing](#reviewing).
- **Report a problem.** A wrong date, a misplaced city, a view that breaks: open an issue with the
  *Report a problem* form.
- **Add to the world.** Research a fact and write it as a record with its source
  ([docs/RECORDS.md](docs/RECORDS.md)), bring in an open dataset, or give a taxon a body
  ([docs/FORMS.md](docs/FORMS.md)).
- **Write code**: the build, the validators, the models, the generators and the viewer
  ([Code](#code)).
- **Fix the map upstream.** Outlines of buildings, walls and roads belong in OpenHistoricalMap, and
  corrections to a dataset go to the dataset ([Geometry](docs/RECORDS.md#geometry)).

Questions and proposals go to GitHub Discussions. Everyone taking part follows the
[code of conduct](CODE_OF_CONDUCT.md). Report a security problem privately, as
[SECURITY.md](SECURITY.md) says, not in an issue.

## The rules

These are not style preferences. A pull request that breaks one is closed.

1. **Never invent a source, a locator, a quote, a number or an identifier.** Cite only works
   you have actually retrieved and read. A quote must be copied from the text you retrieved,
   character for character. If you could not read a source, do not cite it: leave the claim
   out, or open an issue saying what you could not reach.
2. **Machine work is labelled and proposed.** Every claim a machine writes has
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
npm run fetch          # the pinned datasets → .cache/datasets (about 3 GB)
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
   has one, so two people or agents don't do the same thing.
2. **Research it.** Find the best sources you can actually read (see
   [Research](docs/RECORDS.md#research)). Note each fact with its source, locator and verbatim quote as you go.
3. **Write the records** in [world/](world/): one entity per file, claims and relations in their
   subject's file, sources one per work.
4. **Check quotes against the texts** you retrieved, by script, not by eye: save the text you read
   and run `npm run world -- quote-check src:… <text file>`. Every `quote` must be found in it
   (after normalizing whitespace and typography); the command lists any that are not, and records
   the `quoted` step on each claim whose quote it finds (see [Checking](docs/RECORDS.md#how-far-a-claim-has-been-checked)).
   Say what you checked in the source's `verified:` note too.
5. **Validate.** `npm run validate -- --verbose`. Fix every error and warning; read the notes
   (wanted records, and competing claims that contradict the rest of the world).
6. **Build and look**, if you can: `npm run build:world`, then open the place and time in the
   viewer, and check that what you added appears where and when it should.
7. **Open a pull request** ([Pull requests](#pull-requests)).

## Finding work

- **The coverage page** (`npm run dev`, then http://localhost:5173/coverage.html): every layer of the
  world along the whole span of time, coloured by what answers it (evidence, a model, a generic
  stand-in, or nothing), with what answers each layer when and how finely. A stretch that is
  generic or unknown where you know a source is work; so is a layer whose finest grid is coarser
  than the evidence allows.
- **[docs/RECORD-SETS.md](docs/RECORD-SETS.md)**: the twenty record sets, what is left of them, and
  the doubts their first drafts left behind: a person or an agent with a source can settle one.
- **[docs/DATA-OUTLINE.md](docs/DATA-OUTLINE.md)**: everything a complete history needs, by
  domain, with candidate datasets, their licenses, and what is already here. Start from a row
  marked *missing* in an area you can research well.
- **Forms**: `npm run world -- forms-wanted` lists the taxa that most need a body of their own, and
  [docs/FORMS.md](docs/FORMS.md) is the brief. Any taxon with none is drawn as the nearest node of the tree that has one,
  so a coarse form on a family is worth a lot, and a form for each species is the long-run aim.
- **Building traditions**: `npm run world -- dwellings-wanted` lists the regions and times where the most people are drawn
  with generic houses, and [docs/DWELLINGS.md](docs/DWELLINGS.md) is the brief for a tradition's record.
- **Wanted records**: references to records nobody has written, listed by
  `npm run validate -- --verbose` and in each build's `coverage.json`.
- **Unsourced claims**: listed in `coverage.json`, and counted by `npm run validate`. Find a source, or
  confirm there is none.
- **Each slice's "Next" section** in [docs/slices/](docs/slices/).
- **Issues** labelled `good first issue` or `agents welcome`.

Good tasks are bounded and checkable: "the 12 Phanerozoic large igneous provinces
with dated main phases", "the reigns of the Julio-Claudian emperors from Suetonius", "Pleiades
ids for the Rome monuments that lack them". Poor tasks are open-ended ("add history of China")
or rest on sources you cannot read.

## Reviewing

A claim's `status` says whether a person has accepted it, and its `checked:` steps say what has
been done to it short of that ([how far a claim has been
checked](docs/RECORDS.md#how-far-a-claim-has-been-checked)). Review is a person's work, and no
claim has had any yet. [docs/RECORD-SETS.md](docs/RECORD-SETS.md) says what each set of records
should be checked for first.

To review a claim:

1. **Find it.** Click the thing in the viewer and read its claims, or run
   `npm run world -- claims <id>`.
2. **Read its source** at the locator it gives. Is the quote there, word for word? Does the source
   say what the claim says, with the same number and the same uncertainty? Is it the best source
   that could be cited?
3. **Say what you found**, in an issue or a pull request: the claim, what you read and where, and
   whether it holds. A pull request may add an `audited` step to a claim you checked, `by:` your
   GitHub account and saying how; or, where the claim does not hold, a competing claim with the
   better source (never an overwrite: rule 4).

Accepting a machine's claim needs review records, which are not built yet
([docs/plans/PUBLIC-PROJECT.md](docs/plans/PUBLIC-PROJECT.md), Phase 1); until then the validator
refuses `status: accepted` on one.

## Larger work: slices

A slice is a thin piece of the world taken through every layer, from sources and records
through validation and the build to the viewer, with criteria that say when it works. Each of
those built so far has a document in [docs/slices/](docs/slices/): what it adds, its pass criteria and
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

Title: what the change does, in the imperative ("Add the end-Permian extinction's dates"). GitHub
fills in the description from [the template](.github/PULL_REQUEST_TEMPLATE.md): what changed and
why, each source and how it was read, the checks run, and open questions. Note at the end which
agent made the change, and who ran it if a person did.

A maintainer reviews every pull request before it merges. Code, and the generators in
`world/generators/` above all, since they run in every visitor's browser, need a maintainer's
review ([.github/CODEOWNERS](.github/CODEOWNERS)).

## Licenses

A contribution is made under the license of what it changes:

- **Code** (`core/`, `tools/`, `viewer/`, the generators' code in `world/generators/`, `site/`):
  [Apache-2.0](LICENSE).
- **Records, vocabularies, schemas and documentation:** [CC0 1.0](LICENSE-DATA), the same as
  Wikidata and OpenHistoricalMap, so facts can move between them freely.

Quotes inside records stay under their works' terms: they are short quotations used as evidence.
Datasets keep their own licenses, and only CC0, CC BY and public-domain data may come in (rule 6).
What the build reads, and whom it credits, is in [ATTRIBUTION.md](ATTRIBUTION.md).

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
