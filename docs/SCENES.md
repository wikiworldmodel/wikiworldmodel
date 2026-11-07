# Natural scenes: any place, any time

Status: the design, November 2026. Water is the first layer built this way, in the
[eighth slice](EIGHTH-SLICE.md). It extends [LIVING-WORLD.md](LIVING-WORLD.md), which says who lives in a
scene and how they are drawn, to everything they stand on: the ground, the water, the soil, the cover and
the weather.

## What a scene was

Up to the seventh slice a scene was one recipe, written for the Hell Creek and run everywhere:

- **One river, invented.** Whether a place had a river was a weighted coin toss. The river was a curve of
  fixed width (86 m) and bend length (1.5 km) that ran downhill through the scene's middle. Its oxbows were
  arcs scattered near it, and its water was one flat sheet. So the Amazon, the Kansas prairie and the Hell
  Creek had the same river, and none of them had its own.
- **Coarse inputs, at the wrong time.** A scene read the land at whole degrees and the climate of the
  10 Myr runs, at the middle of the atlas's stage. A scene "today" was drawn at the sea level of 385 ka.
- **A place, not a world.** Everything invented was seeded by the scene. The next square of the lattice,
  11 km on, drew a different river.

## The principle

**A scene is the world's fields, downscaled.** It is not a separate world.

1. **Read every layer at the time shown, at the finest resolution anything answers it.** Each layer has
   its own clock: taxa by stage, relief and sea level by keyframe, climate by its runs, and the season by the
   month. A scene is keyed by the keyframes it reads, so the same place and time is the same scene.
2. **Generate only below that resolution.** The generator adds what the fields cannot hold: the bends of
   a river narrower than the line it follows, the hills inside a cell of the relief. It never moves what a
   field already places.
3. **Condition every invented thing on the fields.** Size, shape and kind come from the fields through
   stated rules: a river's width from its discharge, its bends from its width, and braided or meandering
   from its slope and discharge. They do not come from constants tuned for one place.
4. **Hold it to them in aggregate.** Averaged over a cell of a field, a scene gives the field back: its
   mean height, its share of forest, and its river where the drainage puts it, as wide as the law says.
   These are the generator's checks.
5. **Key invented things by the feature they belong to, in the world's coordinates.** A river's bends are
   keyed by the reach and the distance along it, not by the scene. So two scenes that overlap draw the same
   river, and flying from one into the next stays in one world.

## The layers of a natural scene

Each layer answers in the four tiers every layer does (evidence, model, generic, unknown), and each has
its own generator below its finest field.

| Layer | What it reads | Finest evidence today (candidates, licences to be read) | The past | Below the fields |
| --- | --- | --- | --- | --- |
| Relief | elevation, sea level, ice | ETOPO 2022 (0.1° in use; 15″ exists); SRTM 30 m | today's ground at the sea level of the time (800 kyr); PaleoDEMs at 1° | landforms by process: valleys cut by the rivers, hills by erosion, dunes, glacial forms |
| Water | relief, climate, water balance | HydroRIVERS; Natural Earth lakes | the drainage routed over the relief of the time, with runoff from its climate | channels from discharge; meanders, bars and oxbows; banks and floodplains |
| Substrate | geology, soils | Macrostrat; SoilGrids | lithology from the rock record; generic before | outcrop, scree and soil colour by lithology |
| Cover | biome, transitions, land cover | ESA WorldCover (10 m) | biome from climate; pollen biomes (BIOME 6000) for the late Quaternary | stands, glades and edges; trees along water |
| Life | the atlases, forms | living species (later) | fossils, in tiers | individuals, as now |
| Weather and season | monthly climate | observed climatologies | the runs' months | snow cover, leaf, a river's season, the light |

People's fields, roads and buildings follow the same pattern, and the Roman city already does.

## Across time

What answers a layer changes with the era, and the scene must say which:

- **Today:** the evidence is finest of all. Rivers are mapped reach by reach, and the ground is known to
  30 m. A scene should be almost entirely evidence above 500 m.
- **The historical past and the Holocene:** today's ground and rivers, held, with the changes that are
  recorded: shorelines, deltas, avulsions, drained marshes.
- **The glacial cycles:** today's ground at the sea level of the time. Rivers cross the exposed shelves,
  as the Channel River and the rivers of Sundaland did. Lakes fill where the climate fed them, as
  Bonneville did. Ice covers what the ice sheets covered.
- **The Phanerozoic:** the PaleoDEMs and the climate runs, at 1–2°, routed into rivers as big as those
  grids can hold. The rock record says what the place itself was. A fossil site's collection names its
  environment: channel, floodplain, lake, delta, dune or reef. Where it names one, the scene must draw it.
  This is the deep past's evidence for a scene, and the atlas already reaches it.
- **The Precambrian:** generic ground on the reconstructed blocks, plainly marked.

## Processes, where shape matters

Noise makes texture, not landforms. Where a form's shape carries meaning, it is made by the process
that makes it, at a scale a worker can afford:

- **Rivers:** the sine-generated curve of real meanders, scaled by the channel, and cutoffs that leave
  oxbows. Later, migration, which leaves scroll bars on the inside of each bend.
- **Hills and valleys below the relief's cell:** stream-power erosion on the generated relief, so that
  valleys lead to the rivers that drain them.
- **Dunes** from the wind of the climate runs, **glacial forms** from the ice's history, and **coasts**
  from the sea level's history: terraces, beaches and drowned valleys.

## What it costs

What is stored grows with the evidence, not with the Earth's area. Global fields are kept at the
resolution of their sources. Evidence finer than the globe needs, such as river reaches, comes in tiles
fetched for the place in view. Everything else is computed in a worker for the view and thrown away.
Each step has a budget, and a test.

## The order

1. **Water,** in the eighth slice: a water balance, routing over the land of any time, today's rivers
   as evidence, and channels drawn from their discharge.
2. **Scenes at the time shown,** with the finest relief and climate. The eighth slice draws a scene at the time
   shown, within its stage, on the 0.1° relief where it covers the time; the climate of the last 120,000 years is next,
   as a scene still reads the deep past's runs.
3. **The rock record's environments** for deep-time scenes: the PBDB's collection environments read
   into the atlas, and a scene that draws the one its fossils name.
4. **Relief below the field,** by erosion, and today's ground from finer tiles of evidence.
5. **Cover and substrate today:** land cover, soils and geology, licence by licence.
6. **Season and weather** from the monthly climate.
7. **Seamless ground,** keyed in the world's coordinates, which the rivers' keying begins.
