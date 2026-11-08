# WikiWorldModel

A detailed, sourced history of Earth, life and civilization in four dimensions, from the Solar
System's first solids to the far future, and a viewer for flying through it. Every fact in it is
a claim that cites a source, with a locator and a quote, and anything a generator fills in is
marked as generated. Fly through it at [worldmodelzero.com](https://worldmodelzero.com).

All of it so far was drafted by machines from the sources it cites, and is marked `proposed`
until a person checks it. Checking claims is the most useful thing a newcomer can do: see
[CONTRIBUTING.md](CONTRIBUTING.md).

- **Design:** [docs/WORLD-MODEL.md](docs/WORLD-MODEL.md), and [docs/README.md](docs/README.md) for
  a map of every document.
- **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md) for everyone, and [AGENTS.md](AGENTS.md)
  for AI agents. How to write a record is in [docs/RECORDS.md](docs/RECORDS.md), and what the
  world still lacks in [docs/DATA-OUTLINE.md](docs/DATA-OUTLINE.md).
- **Licenses:** code under [Apache-2.0](LICENSE), records and documentation under
  [CC0 1.0](LICENSE-DATA), datasets under their own terms ([ATTRIBUTION.md](ATTRIBUTION.md)).

## What is built

Eight slices, each a thin piece of the world taken through every layer, from sources to the
viewer:

- **Cambrian to today** runs through every layer of the design: plates, terrain and
  coastlines from 540 Ma to the present, with sourced entities, the geologic periods and an
  alternative time scale you can inspect and switch
  ([docs/slices/FIRST-SLICE.md](docs/slices/FIRST-SLICE.md)). For the last 798,000 years the coast is today's
  relief, at a tenth of a degree, under the sea level of each time, so the land bridges of
  the ice ages open and close; and the last 120,000 years have a climate of their own, every
  1,000 to 2,000 years.
- **The whole span** covers all of Earth's history and its far future, coarsely: the
  Precambrian time scale, continental blocks back to 1,800 Ma from two plate models, global
  series such as the Sun's brightness and surface temperature, 24 sourced milestones from
  the Solar System's oldest solids to the Sun's red-giant phase, and a basic tree of life
  ([docs/slices/SECOND-SLICE.md](docs/slices/SECOND-SLICE.md)).
- **Earth's states** draws the planet as the world says it was: a proto-Earth, the
  rock-vapour atmosphere and magma ocean left by the Moon-forming impact, then oceans, and
  the ice of the Snowball Earths. Each state is a sourced claim; the patterns it is drawn
  with come from a seeded generator ([docs/slices/THIRD-SLICE.md](docs/slices/THIRD-SLICE.md)).
- **Rome** is a small slice of human history: the Roman state from its legendary founding to
  the fall of Constantinople, its borders year by year from the Cliopatria dataset, dates to
  the day, and ancient texts as sources, with the dates they disagree on
  ([docs/slices/FOURTH-SLICE.md](docs/slices/FOURTH-SLICE.md)).
- **Rome the city** goes from the globe down to street level: the city as it stood in 315 CE,
  from a snapshot of OpenHistoricalMap, 96 monuments written by hand with sources, and a
  generated fabric of houses and streets, marked as generated, whose density follows the
  Regionary Catalogues. Monuments rise and fall with their dates, in a 3D view with its own
  sky, shadows and water ([docs/slices/FIFTH-SLICE.md](docs/slices/FIFTH-SLICE.md)).
- **Life at a place and a time** paints the land from a climate for every time since the
  Cambrian and from what had come to exist by then; adds a tree of life beside the globe, whose
  groups light up their fossils; and lets you fly down into the Hell Creek at 66.5 Ma, a generated
  floodplain where every animal and plant is a taxon with a fossil in the formation, sized from
  the literature, and marked as placed by a generator ([docs/slices/SIXTH-SLICE.md](docs/slices/SIXTH-SLICE.md)).
- **Life anywhere** lets you scroll down over any land at any time since the Cambrian, and the browser
  makes what lived there: the land and its climate, and plants and animals from an atlas of the
  Paleobiology Database's fossils, each saying whether it is recorded here, inferred from nearby or a
  stand-in. Every taxon is drawn from a form on the tree of life, its own or its nearest node's, as data
  that agents write ([docs/slices/SEVENTH-SLICE.md](docs/slices/SEVENTH-SLICE.md), and the plan in
  [docs/LIVING-WORLD.md](docs/LIVING-WORLD.md)). The sea has an atlas of its own, of the database's
  marine genera in the same tiers, which says what lived where but draws nothing yet.
- **Water** routes each climate's runoff over the land of its time, into rivers and lakes from today
  back through the glacial cycles and the Phanerozoic, and takes today's rivers wider than 30 m from what
  Landsat saw. A scene's rivers are the world's, drawn with the channels their flow gives them
  ([docs/slices/EIGHTH-SLICE.md](docs/slices/EIGHTH-SLICE.md)); [docs/SCENES.md](docs/SCENES.md) is the design for
  every layer of a natural scene.

Each slice's document, in [docs/slices/](docs/slices/), says what it contains, how it follows
the design, the decisions behind it and its limitations. Beyond the slices, twenty record sets
fill in breadth across time, life and civilization; where each stands, with what a reviewer
should look at first, is in [docs/RECORD-SETS.md](docs/RECORD-SETS.md). The plan for running
the project in public is in [docs/plans/PUBLIC-PROJECT.md](docs/plans/PUBLIC-PROJECT.md), and the
site's landing page is in [site/](site/README.md).

## Quick start

Needs Node 22.19 or newer (22 LTS or 24+; odd releases such as 23 are unsupported) and Python 3.12 or newer.

```sh
npm install
python3 -m venv .venv && .venv/bin/pip install -r tools/world/importers/requirements.txt
npm run fetch         # pinned datasets → .cache/
npm run build:world   # validate, solve, build → dist/builds/<id>/
npm run dev           # open http://localhost:5173/
```

In the viewer:

- Drag the globe to fly, and scroll to zoom.
- Drag the time strip to move through time, and scroll on it to zoom in time. It runs from
  the Hadean to the far future on one fixed scale, with more room the nearer the present: a
  year or two a pixel in the last few centuries, a million years a pixel at the dinosaurs'
  end. It zooms down to a few years, and the readout then gives the month or the day. Its
  ruler reads in years BCE and CE within 10 kyr of the present, and ka, Ma and Ga beyond.
- The track at the bottom of the strip marks every dated record: point at one to see it,
  click to open it. The thin band under it shows the planet's states, such as a magma ocean
  or a Snowball Earth's ice.
- The panel at the top left shows the planet at the time shown: its state, and values such
  as the Sun's brightness; click a row to see how it is known.
- Click anything to see its claims and sources, and pick between competing claims. A click
  inside a polity's territory opens its record and says which row of the borders dataset is
  drawn there.
- Switch the geologic time scale in the toolbar: records dated by a stage follow it.
- Press `E` for evidence mode, which marks what is reconstructed or generated.
- Scroll down over Rome, or press the button at the bottom of the globe, to come down into the
  city. There, drag to pan, right-drag or Shift-drag to turn and tilt, `W` `A` `S` `D` to walk,
  and move the Light slider or press `L` to change the hour. Click a monument to open its record.

The coverage page (`coverage` under the title, or http://localhost:5173/coverage.html) shows how much of
the world each layer knows: each layer is a strip along the time strip's own scale, coloured by the
share of the globe that evidence, a model or a generic stand-in answers, or where nothing is known.
Expand a layer to see what answers it when, with its grid; switch to *Finest grid* to see the scale;
pick a cell to map it, and click the map to open the globe there and then. Below the layers are the
fields drawn over the globe, the whole-planet series and the records, by kind.

## Checks

```sh
npm run validate      # the world: schema, references, licenses, chronology, plate frames
npm test              # unit tests: no build needed
npm run test:build    # checks on a build (npm run build:world first), reproducibility included
npm run build:viewer && npm run test:e2e   # browser tests, golden renders included
```

CI runs in three tiers, so that the checks on a pull request stay quick as the world grows:

- **Checks** (`ci.yml`), on every pull request and push to master, in a few minutes: the typecheck,
  `npm run validate` and `npm test`, its files side by side. They need only the plate model, 1 MB from GitHub, and
  pyGPlates is asked only about locations it has not placed before.
- **Build** (`build.yml`), when master changes, when a pull request changes how the world is
  built, and by hand: every dataset, `npm run build:world`, `npm run test:build`, the viewer,
  and on master the site's deployment. It builds the world once.
- **DCO** (`dco.yml`), on every pull request: every commit is signed off (see
  [CONTRIBUTING.md](CONTRIBUTING.md#pull-requests)).
- **Nightly** (`nightly.yml`), and by hand: the world built again and compared in meaning, its numbers
  within a tolerance (`npm run test:reproducible`), and the browser tests against their goldens, in three groups that can also be run alone with `--project`: `globe`, `city` (the city's
  behaviour, drawn the fast way) and `city-views` (the city at full quality, minutes a view in
  software).

Adding `quality=fast` to a link draws the city without shadows, occlusion, bloom or
multisampling, from coarse meshes, for slow machines.

After an intended change to the renderer or the world, regenerate the golden renders with
`npx playwright test --update-snapshots` and review the image diff.

## Layout

| Path | Contents |
|---|---|
| `world/` | the world, one record per file: entities (periods included), sources, frames, fields, generators, alternatives, and snapshots of databases; schemas and vocabularies in `schema/`; datasets pinned in `manifest.yaml` |
| `core/` | runtime code shared by the build and the viewer |
| `tools/world/` | fetch, import, validate and build |
| `viewer/` | the viewer |
| `site/` | the public site's landing page |
| `docs/` | the design, the guides for contributors, the slices' records and the plans ([docs/README.md](docs/README.md)) |

## License

The code is under the [Apache License 2.0](LICENSE). The records, vocabularies, schemas and
documentation are dedicated to the public domain under [CC0 1.0](LICENSE-DATA), so they can be
reused anywhere, Wikidata and OpenHistoricalMap included. Quotes inside records stay under their
works' terms. The datasets the build reads keep their own licenses (CC BY, CC0 or public domain)
and are credited in [ATTRIBUTION.md](ATTRIBUTION.md), as each build credits them in the viewer.
