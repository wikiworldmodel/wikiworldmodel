# Lightworld

A detailed, sourced history of Earth, life and civilization in four dimensions, and a viewer
for flying through it. The design is in [docs/WORLD-MODEL.md](docs/WORLD-MODEL.md).

Five slices are built:

- **Cambrian to today** runs through every layer of the design: plates, terrain and
  coastlines from 540 Ma to the present, with sourced entities, the geologic periods and an
  alternative time scale you can inspect and switch
  ([docs/FIRST-SLICE.md](docs/FIRST-SLICE.md)).
- **The whole span** covers all of Earth's history and its far future, coarsely: the
  Precambrian time scale, the plate model's continental blocks back to 1,100 Ma, global
  series such as the Sun's brightness and surface temperature, 24 sourced milestones from
  the Solar System's oldest solids to the Sun's red-giant phase, and a basic tree of life
  ([docs/SECOND-SLICE.md](docs/SECOND-SLICE.md)).
- **Earth's states** draws the planet as the world says it was: a proto-Earth, the
  rock-vapour atmosphere and magma ocean left by the Moon-forming impact, then oceans, and
  the ice of the Snowball Earths. Each state is a sourced claim; the patterns it is drawn
  with come from a seeded generator ([docs/THIRD-SLICE.md](docs/THIRD-SLICE.md)).
- **Rome** is a small slice of human history: the Roman state from its legendary founding to
  the fall of Constantinople, its borders year by year from the Cliopatria dataset, dates to
  the day, and ancient texts as sources, with the dates they disagree on
  ([docs/FOURTH-SLICE.md](docs/FOURTH-SLICE.md)).
- **Rome the city** goes from the globe down to street level: the city as it stood in 315 CE,
  from a snapshot of OpenHistoricalMap, 96 monuments written by hand with sources, and a
  generated fabric of houses and streets, marked as generated, whose density follows the
  Regionary Catalogues. Monuments rise and fall with their dates, in a 3D view with its own
  sky, shadows and water ([docs/FIFTH-SLICE.md](docs/FIFTH-SLICE.md)).

Each document says what its slice contains, how it follows the design, the decisions behind
it and its limitations. Hand-written example records for every record type, and the gaps
they exposed in the design, are in [examples/](examples/README.md).

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

## Checks

```sh
npm run validate      # what CI runs on every change to the world (--verbose for notes)
npm test              # unit tests
npm run build:viewer && npm run test:e2e   # browser tests, golden renders included
```

After an intended change to the renderer or the world, regenerate the golden renders with
`npx playwright test --update-snapshots` and review the image diff.

## Layout

| Path | Contents |
|---|---|
| `world/` | the world, one record per file: entities (periods included), sources, frames, fields, generators, alternatives, and snapshots of databases; schemas and vocabularies in `schema/`; datasets pinned in `manifest.yaml` |
| `core/` | runtime code shared by the build and the viewer |
| `tools/world/` | fetch, import, validate and build |
| `viewer/` | the viewer |
| `examples/` | example records for every record type, the gaps they found, and their checker |
