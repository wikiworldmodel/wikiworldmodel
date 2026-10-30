# First slice: Pangaea to today

Status: built and passing its tests. This is the first end-to-end run of the design in
[WORLD-MODEL.md](WORLD-MODEL.md): a thin slice through every layer, from pinned datasets
and sourced records through validation, chronology solving and a versioned 4D tile set to
the viewer.

The slice covers 300 Ma to today, with:

- moving plates from a published rotation model;
- reconstructed elevation and bathymetry, with coastlines derived from them;
- nine sourced entities;
- one competing claim that the chronology solver shows to be inconsistent;
- a procedural cloud layer.

## Running it

```sh
npm install
python3 -m venv .venv && .venv/bin/pip install -r tools/world/importers/requirements.txt

npm run fetch          # download the pinned datasets into .cache/, checking their sha256
npm run validate       # schema, ids, vocabularies, review status, chronology, plate frames
npm run build:world    # → dist/builds/<build id>/
npm run dev            # the viewer, at http://localhost:5173/

npm test               # unit tests (about 10 s)
npm run build:viewer && npm run test:e2e   # browser tests in headless Chromium (about 1 min)
```

The build uses pyGPlates, through a Python importer, to partition the elevation grids by
plate. Point `LIGHTWORLD_PYTHON` at an interpreter if you don't use `.venv`. Everything
else is TypeScript on Node 22.

## Pass criteria

| Criterion | Where it is checked | Result |
|---|---|---|
| Building twice gives byte-identical tiles | `tools/world/test/build.test.ts` | identical (every file's sha256) |
| The Mesosaurus sites meet at 280 Ma | `tools/world/test/mesosaurus.test.ts`, and in the browser `viewer.spec.ts` | 6,762–6,917 km apart today; 707–1,745 km apart at 280 Ma |
| The contradiction fixture fails CI and names the conflicting claims | `tools/world/test/contradiction.test.ts`, and a CI step | fails, naming exactly the 3 clashing constraints |
| Golden-image renders at 3 times stay stable | `viewer/test/e2e/golden.spec.ts` (today, 66.03 Ma, 280 Ma) | match |
| A shared link reproduces the same view | `viewer/test/e2e/viewer.spec.ts` | same state, markers and pixels, exactly |

Also checked:

- **Rotations.** The TypeScript rotation model matches pyGPlates on 2,313 reference cases:
  every plate at 9 ages, crossovers included. The worst difference is 4·10⁻¹⁰°.
- **Scrubbing.** Moving through time inside a tile's span fetches nothing.
- **Competing claims.** They switch: the URL records the choice, and dates derived from the
  switched claim follow.
- **Contradictory alternatives.** A claim that contradicts the world can't be chosen, and the
  panel says what it conflicts with.
- **Generators.** The browser runs the cloud generator to the same bytes as the build: the
  viewer checks the sha256 recorded in the tile.
- **Evidence mode.** It changes the render, and the URL records it.

## What was built

```
world/        the world: records only, all in git
  manifest.yaml                 2 pinned datasets (url, sha256, license)
  schema/                       JSON Schemas; kind, property and relation vocabularies
  sources/                      21 sources, each noting what was checked and how
  periods/ics-2020-03.yaml      164 ICS intervals with their standard colours
  frames/earth.yaml             the PALEOMAP planet frame and plate frames
  fields/elevation.yaml         the elevation field, from 300 Ma to today, every 5 Myr
  entities/                     9 entities (below)
  generators/clouds/v1.ts       seeded clouds, shared by the build and the viewer
core/         runtime code shared by the build and the viewer: time axis, quaternions,
              the rotation model, the temporal-network solver, the tile container and types
tools/world/  fetch, importer (pyGPlates), validators, chronology, build; tests and fixtures
viewer/       the WebGL2 viewer; browser tests and golden renders
```

### Entities

| Entity | What it tests |
|---|---|
| Mesosaurus at São Mateus do Sul (BR), Arroyo de La Mina (UY), Calvinia (ZA), Kabus (NA) | The frame chain: four fossil localities on two plates that meet when moved back to 280 Ma. São Mateus also carries a competing radiometric date (Santos et al. 2006). |
| Chicxulub impact | Competing dates: Renne et al. 2013 (preferred) and Swisher et al. 1992 (deprecated). The 1992 date contradicts the Deccan dates, and the solver says so. |
| Chicxulub crater | A start derived from the impact through a `caused-by` relation; competing diameters (180 vs 150 km). |
| Deccan Traps | A phase (main eruptive interval, Sprain et al. 2019) inside an entity that still exists. |
| India–Asia collision (onset) | Competing dates (Hu et al. 2016: 59 ± 1 Ma; Yin & Harrison 2000: about 70 Ma), and a "no later than" constraint (Najman et al. 2010). |
| Himalaya | A start derived only from relations: it follows whichever collision date is chosen. |

Every claim was written by a machine, so it carries `author: machine:claude-code` and
`status: proposed`. The design requires that, and a validator enforces it: no machine-made
claim may be `accepted`. All of them need a person's review. The `verified` note on each
source says what was checked. Some values could only be partly checked from here; the
known gaps are listed under [Limitations](#limitations).

### The tile set

| Level | Space | Time bins (Ma) | Keyframes per tile |
|---|---|---|---|
| 0 | the globe, 2° grid | 0–20, 20–40, 40–80, 80–160, 160–300 (log-scaled) | 5–29 |
| 1 | 8 cells of 90° × 90°, 1° grid | each level-0 bin halved | 3–15 |

Each tile carries every keyframe needed inside its span, so the viewer can scrub without
refetching. The level-0 tiles also carry:

- **Features:** each with its interval, frame, plate, basis, and its interval under each
  alternative claim.
- **Generator constraints:** for the clouds, with the expected output hash.

`tileset.json` is the index: space × time × LOD, with parent links. The viewer:

- requests the cells in view for the current span;
- draws the coarse parent while finer tiles load;
- prefetches the neighbouring spans in time.

A build is 85 tiles, plus records, a search index, periods and baked rotation keyframes:
23.8 MB uncompressed. The build id is the hash of its contents, and `build.json` records
the data commit, the dataset checksums and the generator versions.

## Decisions, and where this departs from the design

1. **Rotation model: PALEOMAP, not Merdith et al. 2021.** The elevation grids (Scotese &
   Wright 2018) were made with the PALEOMAP model, and they are given in its frame. Moving
   them, or the fossils, with another model would put fossils off their own coastlines.
   - The importer checks the pairing: 85–100% (mean 92%) of PaleoDEM land falls inside the
     model's reconstructed continental polygons at every snapshot.
   - Shifting the grid against the polygons by 2–4° lowers the score; at 100 Ma and 280 Ma
     the fit peaks at zero offset or within 2° of it.
   - The choice of model stays an open question (section 14 of the design); swapping
     models means swapping the manifest entry and the field.
2. **Fields move with plates between snapshots ("plate-warp").** Every grid node of a
   snapshot sits on a plate. To show a time between two snapshots:
   - each snapshot is rotated from its own time to the shown time by that plate's
     rotation, which is the rotation that moves the markers;
   - the two rotated snapshots are blended.

   Coastlines, terrain and markers therefore move together, smoothly, instead of
   cross-fading every 5 Myr.
3. **Coastlines are derived in the renderer.** The coastline is the sea-level isoline of the
   blended field, so it is never stored and always agrees with the terrain under it. The
   isoline is at 20 m, not 0 m:
   - PaleoDEM values come in 40 m steps, with a large class at exactly 0 m along shores.
   - At 20 m those nodes count as sea, which reproduces the present-day land fraction
     of 29%.
4. **Source corrections in the importer.** The PaleoDEM grids are used as published,
   except for corrections that are listed per snapshot in the import report:
   - Each pole row is replaced by its median, since a pole row is a single point.
   - The missing 90°S row of the 150–395 Ma grids is added.
   - The duplicated 180°E column of the other grids is dropped.
   - 32 values above 8,849 m, impossible as 1° averages, are replaced by the median of their
     neighbours. Most of them are colour-scale markers.
5. **Chronology.**
   - Dates are solved, not stored: claims and relations become a simple temporal network.
   - A negative cycle is reported as the minimal set of conflicting constraints.
   - Derived dates keep the claims and relations they rest on, and the inspect panel
     lists them.
   - Best estimates come from a second solve with every claim pinned to its centre, so
     "after X" starts at X's central value, not at the edge of X's uncertainty.
   - Each alternative claim is solved on its own. Combinations of switched claims are not
     precomputed.
6. **A stated ± whose confidence level is not recorded is read as 1σ.** This is the wider,
   more permissive reading. Claims whose source states the level carry it, e.g. `sigma: 2`.
7. **Two small vocabulary additions.**
   - `date_before` and `date_after` (terminus ante/post quem): Najman et al. 2010 give
     only a minimum age.
   - An entity-level `basis`.
8. **Time zero.** "Ma" counts back from 1950 CE, the BP convention, so 0 Ma is year 1950 on
   the axis.
9. **Crossovers.** At the exact age where a plate changes its fixed plate, the result
   depends on which sequence is used. GPlates picks it while building its tree: depth-first
   from the anchor, each plate's sequences in reverse file order. The rotation model does
   the same, which is why it matches pyGPlates exactly at crossovers too.
10. **Search index.** A JSON file, not SQLite or DuckDB; the slice is small.
11. **Where the data came from.** This environment cannot reach Zenodo, EarthByte or the
    Paleobiology Database, so the datasets come from public copies on GitHub:
    - The PALEOMAP files come from the rgplates package.
    - The PaleoDEMs come from vis.gl's lossless Parquet conversion; the manifest also
      records the upstream archive's checksum.
    - The PBDB records were read from the palaeoverse package's 2022 PBDB download.

    Every copy is pinned to a commit and a sha256.

## Limitations

- **Claims and citations need review.** Values that could not be fully checked here:
  - The σ level of Renne et al.'s and Swisher et al.'s ±.
  - The per-sample uncertainties of the Deccan bounds (Sprain et al. 2019, Fig. 1).
  - The Mahabaleshwar coordinates.
  - The collision site, placed approximately 8 km south of Saga.
  - The Himalaya's marker point, which is a display choice (the claim says so).
- **Ocean floor.** The model only tracks continents and some ocean floor into the past,
  so most ocean nodes are on no plate and do not move. The plate polygons are only partly
  reconciled with the elevation grids: most of the land fits, some shelf does not.
- **Resolution.** The source is a 1° grid, so the coast is soft at close range.
- **Uncompressed tiles.** They should be served with gzip or brotli.
- **Data licence.** None has been chosen for Lightworld itself (section 13 of the design).
  The datasets used are CC BY 4.0 as stated by their distributors; confirm upstream terms
  before publishing a build.

## Next slices

The order is as proposed when this slice was planned:

1. **Last Glacial Maximum to today.** This adds:
   - ice sheets and sea level on a fixed datum, so coastlines need a sea-level curve;
   - population;
   - the budget validators (ice volume ↔ sea level).
2. **A sliver of Rome.** This adds:
   - phases;
   - dates derived from historical evidence;
   - site-grid frames, generators at city scale;
   - the hand-over from the globe to a local renderer.
