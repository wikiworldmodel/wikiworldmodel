# Lightworld

A detailed, sourced history of Earth, life and civilization in four dimensions, and a viewer
for flying through it. The design is in [docs/WORLD-MODEL.md](docs/WORLD-MODEL.md).

Two slices are built:

- **Cambrian to today** runs through every layer of the design: plates, terrain and
  coastlines from 540 Ma to the present, with sourced entities, the geologic periods and an
  alternative time scale you can inspect and switch
  ([docs/FIRST-SLICE.md](docs/FIRST-SLICE.md)).
- **The whole span** covers all of Earth's history and its far future, coarsely: the
  Precambrian time scale, the plate model's continental blocks back to 1,100 Ma, global
  series such as the Sun's brightness and surface temperature, 24 sourced milestones from
  the Solar System's oldest solids to the Sun's red-giant phase, and a basic tree of life
  ([docs/SECOND-SLICE.md](docs/SECOND-SLICE.md)).

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
  the Hadean to the far future, on a scale that is close to logarithmic either side of the
  present.
- The track at the bottom of the strip marks every dated record: point at one to see it,
  click to open it.
- The panel at the top left shows the planet at the time shown, such as the Sun's
  brightness; click a value to see how it is known.
- Click anything to see its claims and sources, and pick between competing claims.
- Switch the geologic time scale in the toolbar: records dated by a stage follow it.
- Press `E` for evidence mode, which marks what is reconstructed or generated.

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
| `world/` | the world, one record per file: entities (periods included), sources, frames, fields, generators, alternatives; schemas and vocabularies in `schema/`; datasets pinned in `manifest.yaml` |
| `core/` | runtime code shared by the build and the viewer |
| `tools/world/` | fetch, import, validate and build |
| `viewer/` | the viewer |
| `examples/` | example records for every record type, the gaps they found, and their checker |
