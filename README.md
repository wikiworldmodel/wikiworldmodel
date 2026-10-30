# Lightworld

A detailed, sourced history of Earth, life and civilization in four dimensions, and a viewer
for flying through it. The design is in [docs/WORLD-MODEL.md](docs/WORLD-MODEL.md).

The first end-to-end slice, **Pangaea to today**, is built: plates, terrain and coastlines
from 300 Ma to the present, with sourced entities, the geologic periods and an alternative
time scale you can inspect and switch. What it contains, how it follows the design, the
decisions behind it and its limitations are in [docs/FIRST-SLICE.md](docs/FIRST-SLICE.md).
Hand-written example records for every record type, and the gaps they exposed in the
design, are in [examples/](examples/README.md).

## Quick start

Needs Node 22 and Python 3.12 or newer.

```sh
npm install
python3 -m venv .venv && .venv/bin/pip install -r tools/world/importers/requirements.txt
npm run fetch         # pinned datasets → .cache/
npm run build:world   # validate, solve, build → dist/builds/<id>/
npm run dev           # open http://localhost:5173/
```

In the viewer:

- Drag the globe to fly, and scroll to zoom.
- Drag the time strip to move through time, and scroll on it to zoom in time.
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
