# Fifth slice: Rome the city

Status: built and passing its tests. The first four slices look at the planet from orbit. This
one tests the other end of the design's scale: a single place, down to a person's height, with
its buildings as records. It maps the city of Rome as it stood in 315 CE, the year of
Constantine's arch and close to the Regionary Catalogues' numbers, and lets you scroll from the
globe down into its streets.

It adds:

- **The map as a dataset.** 746 footprints, walls, roads and gates from OpenHistoricalMap,
  kept as a snapshot in the repository and imported as records a machine proposes. Each has
  its start and end dates, so a time scrubbed back or forward shows a different city.
- **Monuments as records.** 96 monuments written by hand with sources, most with a `form`
  claim saying what it was like: a Corinthian temple with eight columns across its front and
  eleven down its side, or an amphitheatre of three tiers and an attic. They rise and fall with
  their dates.
- **The city's numbers.** The 14 regions of Augustus as records, with their counts of insulae
  and domus from the Curiosum and the Notitia.
- **A generated city, marked as generated.** 11,201 houses and blocks of flats, 23,861 trees
  and a crowd, from a seeded generator that keeps clear of everything real and follows the
  Catalogues' density. Nobody recorded any of them, and the viewer says so.
- **A ground.** Elevation at 10 m around the city, 50 m and 800 m beyond it, with the river
  carved in, the valleys let down to their ancient levels around the Forum, and level plots
  under the great buildings.
- **A camera that goes all the way down.** One continuous descent from the globe to eye
  level, tilting as it comes, with no load screen and no change of mode.
- **A second renderer.** Atmospheric sky, a sun that moves, cascaded shadows, ambient
  occlusion, water, bloom and film tone mapping, drawn into the same canvas as the globe.

## Running it

As for the other slices (see the [README](../../README.md)). `npm run fetch` now also downloads
one TINITALY tile (43.5 MB), two SRTM tiles (4.8 and 16 MB) and two ETOPO tiles (25 and
24.5 MB). The build reads what it needs once and caches it in `.cache/import/`.

In the viewer, scroll down over Italy at any time from 1000 BCE to 1950, or press **Fly down
into Rome, 315 CE** at the bottom of the globe. Once there:

- Drag to pan, right-drag or Shift-drag to turn and tilt, and scroll to go up and down.
- `W` `A` `S` `D` walk. Below a few metres the camera is at eye height and can look up.
- The slider, or `L`, sets the hour of the day.
- Click a monument or its name to open its record, and a house to be told nothing is known
  of it.
- Move the time strip: buildings rise over the seven years up to the date they start, and come
  down over the seven after the date they end.
- `E` marks what is generated in magenta and what is reconstructed in amber.

## Pass criteria

| Criterion | Where it is checked | Result |
|---|---|---|
| The generated fabric is the same in the build and the browser, to the byte | `viewer/test/e2e/city.spec.ts`: a link lands | the plan's hash in `city/rome.json` matches what the browser makes |
| The fabric is deterministic, built clear of everything real, and undisturbed by edits elsewhere | `tools/world/test/city.test.ts`: the generated fabric | no lot on a standing monument, a garden, the river or a street; a monument dated later does not clear its plot; a change of height changes nothing; a new temple leaves the far side of the city alone |
| Housing follows the Catalogues | `city.test.ts` | a region that counts four times the insulae gets well over twice the lots |
| The map is imported as proposals, and a written record adopts its element | `city.test.ts`: the map's snapshot | machine author, status proposed; elements that carry a licence tag are left out; a start after an end loses the end and says so |
| The snapshot can be made again | `npm run world -- ohm-snapshot`, and by hand | a fresh export on 1 November 2026 was byte-identical to the file kept |
| Elevation grids are read as the surveys wrote them | `city.test.ts`: reading elevation grids | raw and deflated TIFF, both predictors; UTM zone 32 |
| The ground is level under a place, carved under the river, and never raised by a buried valley | `city.test.ts`: the ground | a river the map has twice is carved as one it has once |
| Every form draws sound geometry, near and far | `city.test.ts`: the forms | all 26: finite vertices, unit normals, indices in range, close to its footprint, as much or more up close as from afar; rays from outside meet an arcade's face, not its back; arches and aqueducts open right through |
| A form follows its claim | `city.test.ts` | more columns, more geometry; `faces` turns the front; the Colosseum stands to its recorded height |
| The camera holds a view exactly | `city.test.ts`: the camera near the ground | the link keeps height, heading and tilt; a globe link is as it was, with none of them in it |
| The wheel comes down from the globe into the city and back | `city.spec.ts` | height falls at every step; the city is loaded when it is reached |
| A name is shown only for what can be seen | `city.test.ts`: what the eye can see; `city.spec.ts`: names | a line of sight is cut by a wall below its top, not by what it looks at, not across an open court, and only at the time the wall stands; from a street in the Forum, the Colosseum and the Baths of Trajan are not named; from above, the Colosseum is |
| What stands depends on the time | `city.spec.ts` | the Arch of Constantine is named and clickable in the middle of 315, gone in 290 |
| A click tells a record from a generated house | `city.spec.ts` | a monument opens its record; a house says the generator placed it, and is marked procedural |
| Deep time lifts the camera | `city.spec.ts` | at 66 Ma the camera is back above the globe, and stays there on returning |
| Earlier renders are unchanged | `golden.spec.ts` | the six earlier images and their markers match |
| The city's views hold | `city.spec.ts`: views | five new goldens: overview, Colosseum, Forum, Pantheon, sunset |

## What was built

### The map

OpenHistoricalMap (OHM) is OpenStreetMap's sister project for the past, with a start and end
date on every element and a CC0 dedication. Its Rome is unusually good: mappers have traced
the Colosseum, the fora, the baths and the walls from old plans.

A changing database has no stable URL, so the export is kept in
[`world/snapshots/`](../../world/snapshots/) with its query, and the manifest pins its hash. It
holds what stood before 600 CE within 41.82–41.96°N, 12.38–12.60°E, plus the undated river and
the island: 854 elements, 380 KB. `npm run world -- ohm-snapshot` exports it again and prints
what to change in the manifest.

Each element becomes a record, `rome/ohm/way-123`, made by `machine:ohm-import` and proposed,
with its kind, name, dates, height where the map has one, and a footprint that points to the
element:

```yaml
footprint:
  prop: footprint
  value:
    from: src:ohm-rome-2026-11-01
    elements: [way/28945019]
```

A record written by hand that names an element adopts it: the machine's record for that
element is not made, and the footprint is drawn under the record's own name. The building is
then the written record's to date and describe.

### The monuments

Ninety-six monuments are records under `world/entities/rome/`, 629 claims, researched in three
groups: the Forum and the imperial fora; the Palatine, the Colosseum valley and the south; and
the Campus Martius and the river. Each has a start and usually an end and a footprint from the
map, and 70 have a `form` with what the sources give of their orders, columns and facing. Their 387 quotes were checked by script against the downloaded texts: Platner and
Ashby (1929), Lanciani (1897), Cassius Dio, Livy, and the Roma Capitale portal. Everything is
machine-made and proposed.

`form` is a new type of claim, checked against a table of what each form can hold
(`FORM_PARAMS` in [`core/city.ts`](../../core/city.ts)):

```yaml
form:
  prop: form
  value: { type: temple, plan: peripteral, order: corinthian, front: 8, side: 11, column_height: 12.5, podium_height: 7, shaft: marble, faces: 23 }
```

That is the Temple of Castor. Where a claim says nothing, the form's proportions fill in the
rest, and a monument with no form claim is drawn from its kind and footprint. What that gives is
a picture, and it is not a claim.

Three records have a `ground_level` claim, the ancient paving around the Forum. The ground is
let down there before the buildings are raised, and the Forum's monuments stand in a hollow as
they did.

### The regions

The 14 regions are records with their counts from the Regionary Catalogues, thirteen from the
Curiosum and region VI from the Notitia, read from page images of Jordan (1871) pp. 543–564
and checked against Preller and Urlichs. They sum to 44,300 insulae against the 46,602 the
text states, and 1,681 domus against 1,790 (1,781 if region III's domus is read as 160).

### The ground

Three nested grids of 16-bit decimetres, the finer eased into the coarser over 32 cells:

| Grid | Reach | Cell | From |
|---|---|---|---|
| City | ±6.4 km | 10 m | TINITALY 1.1, blurred to take out buildings, with the river carved and plots levelled |
| Hills | ±40 km | 50 m | SRTM GL1 |
| Region | ±480 km | 800 m | ETOPO 2022 |

The build makes them; the same sampler reads them in the build and in the viewer, so the
generator gets the same ground in both. The map has the Tiber's reach through the city twice, as a
relation and as the way it is made of, so its outlines are kept once and each is carved on its own.
From a few kilometres up the bed is narrower than the terrain's cells, so its water is painted on.

### The forms

[`world/generators/city/forms.ts`](../../world/generators/city/forms.ts) raises each of 26 forms
from a structure's claims: temples with real entablatures and fluted columns, amphitheatres
with their tiers of arcades, seating and masts for the awning, theatres, circuses with their
spina, baths with their domes and vaults, porticoes, walls with their towers and gates,
aqueducts on arches, bridges. Most of the map's elements give only an outline and a kind, and
get a `generic` form: a plain mass with a roof.

The forms hold no facts about Rome: every number comes from a claim or from proportions of the
footprint. A form draws a coarse mesh for the distance and a fine one up close. All of it is
made in the browser, in a worker, from the build's 400 KB of structures, so a build carries no
geometry. Forms are drawn in the same materials: marble, travertine, brick, tufa, tile, lead
and bronze, painted procedurally in the shader in metres, so they stay the same up close.

### The generated city

[`gen:rome/fabric`](../../world/generators/rome/fabric.yaml) fills what the map leaves empty. It
scatters a jittered grid of block centres inside the Aurelian Walls and more thinly along the
roads beyond them, cuts them apart with a Voronoi pattern, clips each block away from the
streets, the river and whatever stands in 315, and cuts it into lots. Each region's lot size
follows its share of the insulae and domus the Catalogues count, between 240 and 2,400 m².
Most lots become apartment buildings of three to six storeys, the larger with a light well,
with balconies and shop awnings; some become town houses around a court, more of them on the
hills; those outside the walls are houses in their own ground. Trees stand in the map's gardens
and in copses out in the country.

It is the design's generator as the clouds are: a record with a seed and parameters, whose
output's hash is written into the build and recomputed by the viewer, with only + − × ÷, square
roots and integer operations, so two engines agree to the bit. Its output is marked
`procedural`, and each thing it makes is named as such when clicked.

### Rendering

[`viewer/src/gl/city.ts`](../../viewer/src/gl/city.ts) is a second renderer, on WebGL 2, drawn over
the globe and fading in as the camera comes down:

- the sky from a small atmospheric scattering table, with aerial haze between the eye and what
  it sees;
- a sun at its true altitude for the latitude and hour, on one day of the year;
- three cascades of shadow maps, redrawn only when something changes;
- a depth pass, half-resolution ambient occlusion with a bilateral blur, and then the lit pass
  at 4× MSAA in 16-bit float;
- terrain as nested rings of a clipmap, read from the elevation in the vertex shader, painted
  by a mask of built-up land, gardens, paving and river;
- water with a still pattern of ripples, reflecting the sky and the sun;
- bloom and ACES tone mapping.

Faces are drawn from both sides in every pass, and turned by the mesh to face the way their normal
says, so nothing can be seen through by being looked at from behind. Names are placed above each
structure as raised, and shown only if a line of sight reaches them: every building's outline is
kept as walls of its height, in buckets ([`viewer/src/city/skyline.ts`](../../viewer/src/city/skyline.ts)).

Earth's curve is applied in the shaders, so the horizon falls away, and vertices are sent to
the GPU relative to the eye, so nothing shakes at street level. Each mesh's vertices carry an
entity, whose dates are in a small texture, so moving the time strip rebuilds nothing:
buildings rise and fall in the vertex shader. Picking reads a second pass of entity ids.

On an Apple M3 Max at 1280×760 a frame takes 5 to 8 ms of the GPU's time, at street level or over
the whole city, measured in headless Chromium on Metal, so it holds 60 frames a second.

### The camera

The globe's camera gains a heading and a tilt, zero at any height above the region. Coming down,
it tilts by itself; its lowest height depends on how far it is from Rome, so it can only go
below the globe's old limit where there is a ground to see. Links keep height, heading, tilt
and hour once they are in use; a globe link reads as it did.

The globe itself is unchanged: the six earlier goldens and their markers still match.

## Decisions

1. **One slice in time, but dated records.** The generated housing describes the middle of 315,
   where a date given only as 315 CE is held, so what was built that year is standing; the map's and
   the records' dates are real. So 100 CE has the right monuments in a city whose ordinary
   houses are those of 315, and the housing fades out before 300 BCE and after 600 CE, leaving
   only what is dated. Housing that changes with time would need a model of how a city grows.
2. **OpenHistoricalMap, not OpenStreetMap or SITAR.** OSM's many ancient buildings are ODbL and
   SITAR's excellent Roman archaeology is CC BY-SA. The build's licence filter takes CC0, CC BY
   and public domain, so neither may be used in a published build. OHM's CC0 applies "except
   where otherwise noted", in tags on elements, so the import leaves out any element with such
   a tag.
3. **The machine's records stay proposals; a written record adopts.** Elements are data, not
   facts anyone has checked, and many mix survivors with guesses. Adoption keeps a single
   record per building without losing the map's outline.
4. **Generated things are entities like any other, but say what they are.** Clicking a house
   gives a panel, not silence; evidence mode shows them in magenta. Keeping them out of the
   records keeps 11,201 unnamed buildings out of search, the time track and the validator.
5. **Geometry is made in the browser.** A city's meshes are large; its plan is small and
   deterministic. The build ships the plan's inputs and a hash, as with the clouds.
6. **Curve and drift.** Earth's curve is in the shaders, since at 16 km it is 20 m. Plate drift
   is ignored inside a city: a few tens of metres since 753 BCE, and the whole city moves as one.
7. **Today's river.** The river's polygons are today's, in the embankments of the 1870s. They
   are what the map has, and Rome's flood plain would have to be reconstructed to do better.
8. **Nearest-label regions.** The map has the regions as nodes, not outlines. Housing belongs
   to the nearest region's label; this is a weighting, not a claim of where a boundary ran.

## Limitations

- **Claims need review.** Every record is machine-made and proposed. Points to check first:
  - *Regions:* Hermansen, Nordh and Valentini–Zucchetti were not read. Regions III and IV both
    have 2,757 insulae and XII and XIII both 2,487, which Jordan takes for copying errors;
    region III has 60 domus or 160; the Notitia differs in X and XI; VI is 3,403 or 3,303.
  - *Forum:* Venus and Roma's end in 847; Concord's start, between 121 BCE and 10 CE; whether
    Juno Moneta still stood in 315; Castor's height of 23.25 m leaves out the pediment; the
    facing of Saturn (36°) rests on Platner and Ashby's "north front"; two quotes keep the
    OCR's "Ist" and "I13"; Vesta, Maxentius and the Markets of Trajan keep the map's start
    dates.
  - *Palatine and south:* Cestius's height, 36.4 m against Platner and Ashby's 27 m; the
    Colossus's height is a conversion of 120 Roman feet; the Septizodium's facing and the
    Palatine stadium's lack of a spina are inferences; the Temple of Claudius's footprint is
    its platform; the Temple of Diana's footprint is too small; the Temple of Sol, Domus Aurea,
    Domus Severiana and Porticus Aemilia have no form.
  - *Campus Martius:* the Pantheon's start is a range, 120–128; the Hadrianeum's column height
    was read from the OCR's "I 5"; Platner and Ashby call the Temple of Portunus "Mater Matuta";
    the facing of Pompey's theatre, Marcellus's and the Circus of Nero is inferred; the Pons
    Neronianus may have been in ruins by 315; the names themselves are unsourced labels;
    Wikipedia is the source for the two temples in the Forum Boarium.
- **The sources are mostly second-hand.** LacusCurtius and Perseus were mostly unreachable when
  this was researched, so Platner and Ashby were read from archive.org's OCR, and modern
  excavation reports were not read at all. Heights in particular often rest on one source.
- **The map's quality varies.** Its footprints are simplified, its dates round, and it marks
  no difference between what survives and what was restored on paper. Most of the 588 structures
  not written by hand are plain masses.
- **The ground is today's, with patches.** Only around the Forum is it let down to ancient
  levels. The Tiber is in its embankments, with today's Isola Tiberina; the Campus Martius
  and the valleys elsewhere stand several metres too high. TINITALY is itself a sparse TIN over
  Rome, smoothed further here to take out modern buildings, so hills are softer than they were.
- **Housing is generated for one time,** and does not respect monuments of other times: at 100
  CE a house may stand where the Baths of Caracalla will be. It doesn't know the real street
  grid outside the map's few roads, or which areas were gardens unless the map says so.
- **The meshes are not hashed.** The plan's hash proves the lots are the same, not the geometry
  raised on them. Forms live in the viewer's bundle, not in the build.
- **Forms are types.** A temple is a temple of its order and columns, not this temple: no
  friezes that are really there, and no statues on the pediments. The Colosseum's bay count and
  tiers are right; its masonry is a pattern.
- **One day of the year.** The sun's path is that of a day with a declination of 16°, and only
  the hour changes it, between about 5:24 and 18:36, when the sun is low but up. The sky is single
  scattering, so it goes black when the sun sets: there is no twilight, moon or night, and no
  weather.
- **The walker walks through walls.** No collision with buildings, only the ground, and an eye
  inside a building sees its shell from within: interiors are not modelled, not even the Pantheon's.
- **Labels don't follow names.** A monument's label is its record's name, not the one in use at
  the time shown. A name's line of sight ignores walls, aqueducts and the hills under 200 m away.
- **Figures and trees are stylised.** People stand still, in a tunic or a robe, and are all alike
  but for colour and height. Up close, a tree's crown is a few rough balls of leaves.
- **Great complexes are guessed at.** Where the map has only a large irregular outline, such as the
  Domus Tiberiana, it is drawn as a terrace with ranges of roofs. The pattern is the generator's.
- **One site.** The site is a parameter of the generator (`site` in the build), and only Rome has
  one. Two sites at once would need work in the viewer.

## Next

- ancient street levels and the Tiber's course from Lanciani's plates, as a dataset of their own;
- housing that follows time: a growth model anchored on the Catalogues, the Servian and
  Aurelian walls, and the fires;
- a contributor's path for a monument: a claim that changes a column count and a picture that
  shows the difference;
- more detail on the great monuments, as records of their parts: the Colosseum's seating, the
  Forum's statues, the Pantheon's coffers;
- a second city, to prove the site is really a parameter: Constantinople, or Ostia.
