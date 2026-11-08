# Sixth slice: life at a place and a time

Status: built and passing its tests. It is the first three steps of the
[roadmap](../archive/ROADMAP.md): what covered the land at any time, the tree of life beside the globe, and
one place and moment you can fly down into and see what lived there, the way Rome stands in 315 CE.

It adds:

- **A climate for every time since the Cambrian.** Fifty-five runs of a climate model (Li et al.
  2022), reduced to the four numbers per node that the Köppen–Geiger classes follow from, carried
  with the plates like the land itself.
- **Biomes on the globe.** The land is painted from that climate and from what had come to exist by
  then. There is no green before the record of land plants starts, no forest before the first
  forests, and no grass before grasslands. That ends the second slice's limitation of land drawn green
  before there were plants.
- **The transitions that bound it.** Microbial crusts on land, the first land plants, the first
  forests, the spread of grasslands, and seven episodes of reef builders, each sourced, with their
  competing dates as competing claims; 16 fossil forests; and an `evidence` property on the world's
  occurrences saying what kind of evidence each one is.
- **A tree of life panel.** Beside the globe (`T`): lineages branch at their start and end at their
  extinction, at the time on the slider, on the time control's own scale. Choosing a group lights up
  its fossils on the globe and along the time control.
- **A curated database as a snapshot.** 5,277 occurrences of the Hell Creek Formation in 591
  collections from the Paleobiology Database, dated, with the query that made them, kept in
  `world/snapshots/`. Its 1,287 taxa become records a machine proposes; its rows stay rows.
- **A first living scene: the Hell Creek, about 66.5 Ma.** A river's floodplain and what lived on it:
  42 taxa written by hand with sizes and postures from the literature, 36 of them drawn from body-plan
  kits, nearly 300,000 plants and animals placed by a seeded generator. Every one is a taxon with an
  occurrence in the formation at that moment. Nobody recorded where any of them stood, and a click,
  and evidence mode, say so.

## Running it

As for the other slices (see the [README](../../README.md)). `npm run fetch` now also downloads the
climate runs (754 MB). The build reads them once a time and keeps nothing it does not use: the
climate file it writes is 5.4 MB.

- **Biomes:** move the time slider. Before about 472 Ma the land is bare rock and sand; click any
  land to see what covers it, and which transitions it rests on.
- **The tree:** press `T`, or the **Tree** button. Scroll to go through it, Ctrl-scroll to zoom,
  click a row to open a taxon, and click its left edge to open or fold what is under it.
- **The scene:** search for *Hell Creek ecosystem*, or go to 66.5 Ma and look at the Canadian Shield,
  where the Hell Creek's plate had carried it, and press **Fly down into the Hell Creek, 66.5 Ma**.
  Everything from Rome works there: drag, turn, `W` `A` `S` `D`, the hour, `E`. Click an animal or a
  plant to open its taxon and see what puts it there and what was invented.

## Pass criteria

The roadmap's "done when", each with where it is checked. Every test named here passes.

| Criterion | Where it is checked | Result |
|---|---|---|
| No vegetation before the land-plants claim | `tools/world/test/planet.test.ts`; `tools/world/test/life.test.ts`: the biomes; `viewer/test/e2e/biomes.spec.ts` | none at any time before it, in every scenario; the land measurably greens across it on the GPU |
| Biome boundaries move with the plates | `biomes.spec.ts`: a climate's border moves with the plates | a spot in India carried by its plate keeps its climate; the spot of the globe it left does not |
| No forest fossil falls in a reconstructed desert | `life.test.ts`: the biomes, from the `forests` list in each build's `coverage.json` | 15 fossil forests, read at their dates and carried by their plates: none in a desert. See the limitations |
| The panel and the globe agree at every time | `viewer/test/e2e/tree.spec.ts` | the same rule, at eight times from 3 Ga to 1 Ma, and across a scenario |
| A taxon's bar starts within the solver's bounds | `life.test.ts`: the tree of life; `tree.spec.ts` | every dated node of the tree, and of the panel |
| It works with the 26 taxa, and with thousands | `tools/world/test/tree.test.ts`; `tree.spec.ts` | 50,000 synthetic taxa lay out in under 1.5 s; the build's are shown folded |
| Selecting a group lights up its fossils on the globe and the timeline | `tree.spec.ts` | Dinosauria lights hundreds of the snapshot's rows, and they go out with it |
| Every organism in the scene is a taxon with an occurrence in the formation | `life.test.ts`: a living scene | recounted from the snapshot, at the slice; all 36 taxa are drawn |
| Nothing appears that the records place elsewhere or elsewhen | `life.test.ts` | each taxon's record has it alive at the slice; a taxon without an occurrence or a size is left out and says why |
| Clicking any of them says what is recorded and what was generated | `viewer/test/e2e/life.spec.ts` | the taxon's record opens, with the rows behind it, and what the generator made up |
| The scene is the same to the byte in the build and the browser | `life.spec.ts`; `life.test.ts`; `world/generators/life/scene/v1.test.ts` | the plan's hash and one cell's mesh's hash agree; the plan uses only + − × ÷, square roots and integers |
| Evidence mode shows generated life in the same colour as generated housing | `life.spec.ts` | one path through one shader: basis 3 |
| Builds stay reproducible | `tools/world/test/build.test.ts` | two builds are byte-identical, with all of this in them |

Four of the globe's golden images changed, as they should: `today`, `k-pg-boundary`, `pangaea-280ma` and
`roman-empire-120` now show biomes instead of land coloured by its height. `magma-ocean` and
`sturtian-snowball` did not change by a pixel, nor did Rome's views. Those four's marker files gained the
records of those times, most of them from the [record sets](../RECORD-SETS.md), and a few dots moved down as
others came to sit beside them: Rome's, and Chicxulub's by 17 px, and writing's in Mesopotamia by 51.

## What was built

### The climate field

`world/fields/earth/climate.yaml` reads `src:li-2022-phanerozoic-climate`, one NetCDF file of 754 MB,
through a small reader of its own (`tools/world/src/netcdf.ts`): nothing else in the build needs a
NetCDF library, and the classic format is simple enough to read directly. Twelve months of
temperature and rain at each land cell come down to four numbers, averaged onto a 2° grid: the warmest
month, the coldest, how dry the year is against the Köppen threshold, and how far its driest month
stands from what a rain forest needs. A node with no land of the model's gets the nearest land's
values and is marked, because the model's coasts and the elevation field's do not quite agree.

The four numbers are bytes on a grid, not classes. The shader classifies each pixel by the rule in
`world/fields/earth/biome.yaml`, after Peel et al. (2007), so a border can fall between nodes and
drift smoothly with the plates and through time.

### The biomes

`field:earth/biome` is derived: it is declared, and never stored. The globe's shader takes the climate
class and the cover fractions from `coverAt` (`core/planet.ts`), which reads the transitions in the
scenario chosen: none before a transition's start, ramping to its end, or over the rule's 30 Myr if it
gives none. Reefs hold only while a reef builder lasts. The texture within a cover comes from a new
generator, `gen:earth/biome-texture`, whose hash the browser checks.

### The transitions and fossil forests

In `world/entities/life/transitions/` and `world/entities/life/fossil-forests/`, with 63 sources. The
`cover` property says which part of the picture a transition bounds; `evidence` says what kind of thing
an occurrence is. A fossil forest in place has `evidence: in-situ-forest`, and that is what the check
against the climate field looks for. Eleven plates that the forests and the formation needed were
added as frames, with their names from the plate model's rotation file.

### The tree

`tree.json` holds every taxon, its parent, its time in every scenario, and which fossils belong to it.
`core/tree.ts` lays it out, parent before child; a node whose children all came from a database stays
folded until opened, so the 1,300-odd taxa show as sixty-odd rows. The panel draws on a canvas, only
the rows in view, on the same scale as the time control. A lineage that has not arisen by the time
shown is not drawn. `viewer/src/ui/fossils.ts` draws the rows of the group chosen at their paleo-positions.

### The snapshot

`npm run world -- pbdb-snapshot "Hell Creek"` asks the Paleobiology Database's data service for a
formation's occurrences and collections, and for every taxon they name with all its parents, and keeps
the rows of that formation only (a search also finds Shell Creek). Identity is a name's concept, its
`orig_no`, because parents and accepted names point at that and not at a spelling.

At load, `tools/world/src/pbdb.ts` turns its taxa into records a machine proposes, up to the first taxon
the world has already placed in the tree. A record written by hand adopts a taxon by its number
(`same_as: { pbdb: "txn:38862" }`), and what it does not say of its parent and dates is filled in. Only a
genus or a species gets a start from the database: a higher group's oldest record can be a stray or a
matter of classification, and contradicted the tree in three places when it was tried.

### The scene

`world/generators/life/scene.yaml` holds the numbers and `world/generators/life/scene/v1.ts` the plan:

- **The ground.** A river, a curve whose direction swings like a sine; old bends cut off from it;
  ponds; banks, levees and ridges across the bends. It is 10 m a cell out to 6.4 km and 50 m out to
  32 km, where it gives way to the elevation field's land. It is all invented, and the build writes it
  as a city's ground is written, so the plan reads the same integers in both places.
- **The cover.** Patches of forest and glade, bare sediment by the water, a clearing where a visitor
  arrives. How much forest the plain bears follows the climate class at the place and what the
  transitions allow, so a scene in a desert or before the first forests would have no trees.
- **The plants.** Sown thickly near the arrival and thinning outwards. Which taxon is chosen by its
  rows in the snapshot and whether the ground is wet; how tall, between about two fifths and all of
  what its claim gives.
- **The animals.** Each row of the snapshot stands for a number of animals that depends on the body
  plan, in groups, about half near the arrival. They keep clear of each other and of trunks. Commoner
  fossils make more animals, and this is no census.

`world/generators/life/organisms.ts` is the kit, on the city's mesh: a tube through rings for a body,
chains for legs, and the parts that make a Triceratops one: a shield of a frill, three horns, a beak.
There are ten animal plans and four plant plans, each drawn finely close by and coarsely far off. They
are drawn from `body_length`, `hip_height`, `plant_height` and `posture` claims, and where a mammal's
only claim is its mass, the kit's shape gives its length (and the panel says so).

The viewer's `CityScene` split into `CellScene`, what any site drawn in cells needs, and two kinds of
site; `viewer/src/main.ts` went from one site to several, each open for its own times. Each taxon is one
entity in the renderer, dated by its record, so a click names it and every one of it lights up. Time
reaches the shader as years from the slice, which 32-bit floats hold finely.

## Decisions

1. **The climate model is Li et al.'s CESM.** The roadmap's example, the HadCM3L runs of Valdes et al.
   (2021), has raw files on a Bristol page and no license that could be found, so it may be cited but
   not imported. Pohl et al. (2022, CC BY) looked ideal, but at 0 Ma it has Antarctica above 10 °C in
   summer and Germany under 7 °C. Li et al. is CC BY too, has a finer grid, and at the present has
   Antarctica frozen, the Amazon wet and Germany temperate; 17 places were compared.
2. **Classes in the shader, not in a file.** A stored map of classes on a 2° grid would have blocky
   borders that jump. Four numbers per node give borders that move.
3. **A biome is a reading of a climate.** Which class gets which cover is the renderer's choice, and the
   panel says so. The lithologic indicators the roadmap mentions, coals, evaporites and tillites, were
   not imported: no download of the Boucot atlas was found, only citations of the book. The fossil-forest
   check stands in for them as a test against evidence.
4. **Rows stay rows.** 5,277 occurrences as YAML would be noise, and section 12 of the design says to
   reference a dataset. Taxa become records, so the tree, search and the solver see them; occurrences
   stay in the snapshot, and the panel draws them.
5. **A size is not guessed.** A taxon with no claim of its size is left out of the scene, and the file
   lists it with why: Dryophyllum, the commonest leaf in the snapshot, is among them, because no source
   read gives its height. A row's count never becomes an animal without a body to draw.
6. **The origin is the place at the slice.** The site's local grid sits where the plate had carried
   the place, so it lies 25° of longitude from today's Montana, and that is where the globe has it.
7. **The climate's reading is used as read.** See the limitations: the field calls the place cold, and
   fossil leaves say it was warmer. The scene follows the field, as everything else on the globe does.
8. **Colours are invented, and vary by taxon.** It lets a viewer tell them apart. It is listed among
   what the generator made up.

## Limitations

- **The climate field is one model.** Its runs are 10 Myr apart, on Scotese's own paleogeography, with
  no ice sheets except where the pre-industrial run has them. Continental interiors run cold, as in
  many models: at the Hell Creek it reads the coldest month below freezing (Köppen D), where fossil leaves
  (Wilf et al. 2003, in the ecosystem's record) give mean annual temperatures of about 12–20 °C. Nothing
  yet sets competing readings side by side. Only the nearest keyframe informs the scene.
- **The forest check is coarse.** Each forest is read at the middle of its dated range, at the nearest
  keyframe, at one 2° node. Rusinga falls in a steppe, which is allowed by the rule, and some "forests"
  are weak: Pine Island Bay is roots only.
- **The scene has one moment.** It is drawn for its span, but written for 66.5 Ma; a taxon comes and goes
  with its dates, and nothing else about it changes with time.
- **The river and the plain are invented.** Nothing about them comes from the sedimentology; the climate
  class barely matters to the look; and the elevation field beyond is a 1° grid.
- **Ages are coarse.** The snapshot's rows are dated by their interval, mostly the whole Lancian, so
  "alive at the slice" cannot separate the lower and upper formation.
- **Sizes have doubts**, each noted on its claim. Plant heights are often living relatives' maxima (a
  redwood of 110 m); a Pachycephalosaurus of 7 m sits against a mass of 370 kg; Acheroraptor's sizes
  come by comparison. Sizes follow the default picture: picking a competing claim changes the panel, and
  not the plan.
- **Kits are not reconstructions.** A body plan is a shape, not a skeleton; Ginkgo is drawn as a
  broad-leaved tree, Champsosaurus as a crocodilian, ferns by rows that are often spores.
- **Birds, fishes, lizards, salamanders and insects are not drawn**, though the snapshot has them: no
  kit yet. The file counts what is drawn against the rows of the slice.
- **Leaves do not rustle.** Nothing moves: animals are posed, and water only ripples.

## Next

- the rest of the twenty [record sets](../archive/ROADMAP.md), in order;
- a second scene, to prove the parameters: the Morrison Formation, say;
- competing climates on the globe, with Valdes et al. if a license turns up;
- lithologic indicators against the biomes, wherever a license allows;
- body plans for birds, fish and amphibians, and sizes for the taxa left out.
