# Seventh slice: life anywhere

Status: built and passing its tests. The plan it comes from is [LIVING-WORLD.md](../LIVING-WORLD.md). It takes the first living
scene, one place and one moment written largely by hand, and makes it a function of any place on land and any stage of the
Phanerozoic. Scroll down anywhere on land, at any time since the Cambrian, and the browser makes what lived there.

It adds:

- **Forms on the tree of life.** Body plans are data now, in [world/plans](../../world/plans). A child inherits its parent's body
  and says what differs, part by part. A taxon with no form of its own is drawn as the nearest node above it that has one, and
  says so.
- **An agents' line for forms.** A list of what most needs one, a drawing to check it by, a validator that compiles every form,
  and a brief, [FORMS.md](../FORMS.md). The first batch was written by agents, by branch of the tree.
- **An atlas of who lived where.** The Paleobiology Database's land fossils as one pinned snapshot, reduced by the build to a
  list for each 4° patch of land in each stage, each taxon with its tier: recorded here, recorded in the region, or a stand-in.
- **Scenes anywhere.** The generator is stateless now: each 400 m cell makes what stands in it from hashes of where it is. It
  reads the land and the climate of any place, so that a desert is a desert and a coast has a shore. No ground and no organism is
  stored, for any place, the Hell Creek included.
- **Instancing and details,** with budgets, so that a frame's cost depends on the screen and not on what lives in the scene.

## Running it

As for the other slices (see the [README](../../README.md)). The build reads the snapshot in `world/snapshots`; it needs nothing new
fetched.

- **Anywhere:** go to any time since the Cambrian, and scroll down over any land. The globe gives way to the place at about 300 km
  up, and you can go on down to the ground. Over the sea there is no way down yet, unless you are already near the coast.
- **The bar** at the bottom says how many of what lives here are recorded here, nearby or stand-ins. Press it for the list. **Go and
  see** takes you down to where something of each is standing.
- **Click** an animal or a plant, or its name, to see what is recorded, what is inferred, whose form it is and what was generated.
- **See it where it lived:** a taxon's record offers to take you there. It sets the time, flies to where most of its fossils are, and goes
  down to where something of it is standing.
- **Try:** the Morrison at 149 Ma (36°N, 62°W on the globe of that time), Patagonia at 69 Ma (44°S, 54°W), Mongolia at 69 Ma (40°N,
  90°E). The Hell Creek is still at 66.5 Ma.

For someone writing forms: `npm run world -- forms-wanted`, `npm run world -- form-sheet <taxon>`, and [FORMS.md](../FORMS.md).

## Pass criteria

Every criterion is a test, and every test named here passes.

| Criterion | Where it is checked | Result |
|---|---|---|
| Every taxon in the atlas draws from its own form or its nearest node's, and the file says whose | `tools/world/test/forms.test.ts`: the atlas's taxa; `tools/world/test/atlas.test.ts` | `form_from` and `own` on every taxon of every list |
| A form changes only what it names: everything else is its parent's | `world/generators/life/forms.test.ts`: a child form | field by field; null takes a part away; lists replace whole |
| A taxon with its form taken away falls back to the node above, and nothing else about it changes | `forms.test.ts`: the walk up the tree | |
| The validator refuses a form with an unknown part, a body below the ground, or a size past its budget | `forms.test.ts`: the validator; `npm run validate` | and an unknown field, a missing one, a material there is not, and a plant's part on an animal |
| A taxon's tier is true: *here* has a row within its radius at the time, recounted from the snapshot | `tools/world/test/life.test.ts`: the atlas | recounted across the Maastrichtian with the plate model, with a patch's width as the slack |
| A taxon in a scene has a row overlapping the time, or it is a stand-in that says how far the nearest is | `life.test.ts`; `atlas.test.ts` | every stage sampled; a stand-in has no rows of its own and says so |
| A taxon known only from elsewhere does not reach a place across the sea as *here* or *region* | `atlas.test.ts` | on a made-up Earth of two continents |
| No land plant before the land-plants claim, no forest before forests, no grass before grass: in any scene | `world/generators/life/scene/v2.test.ts`: what the land allows; `life.test.ts`: the biomes | the cover comes from the transitions, as it does on the globe |
| The Hell Creek still draws every taxon it drew, each with its occurrences in the formation | `life.test.ts`: a living scene with its own formation; `viewer/test/e2e/life.spec.ts` | the same 36 by name, among 95 |
| The same place and time make the same bytes in the build and the browser, at witness places | `life.spec.ts`: anywhere else; `life.test.ts` | ground, a cell and a mesh, including one near a pole and one by the line where longitude wraps |
| The same individuals at every zoom: what a far view draws is a subset of what a near one draws | `v2.test.ts`: what a view draws | a cell's far rows are among its near rows |
| A frame's instances and triangles stay within budget, in the busiest scene | `v2.test.ts`; `life.spec.ts` | at five heights, in both budgets |
| What a descent fetches is small: under a stated number of bytes, none of it ground or organisms | `life.spec.ts`: anywhere else; `life.test.ts`: the atlas | see below |
| A click says what is recorded, what is inferred, whose form it is and what was generated | `life.spec.ts` | |
| A taxon's record goes to where it lived, and down to where it stands, from the globe and from another scene | `life.spec.ts` | a flight waits above a scene that has yet to come, and flies a long way high |
| Evidence mode shows generated life as it does generated housing | `life.spec.ts` | one path through one shader: basis 3 |
| Rome's views stay as they were | `viewer/test/e2e/city-views.spec.ts` | the goldens are untouched, and pass within their tolerance of 0.2% of the pixels: closing the seams of the ground's rings can fill a few |
| Builds stay byte-reproducible | `tools/world/test/build.test.ts` | two builds are byte-identical, with all of this in them |

## What was built

### Forms

[core/form.ts](../../core/form.ts) says what a form is and how a child's changes merge into its parent's.
[world/generators/life/forms.ts](../../world/generators/life/forms.ts) draws them, on the city's mesh, and holds the first kit's
drawing code with every number about a body taken out into [world/plans](../../world/plans). A plan is a few dozen lines of named
parts: a trunk through rings, a head with where its joint goes in each pose, legs, spikes, a frill, a wing. It says how the body keeps too
(`behave`): in groups of how many, on what ground and in what poses.

[tools/world/src/forms.ts](../../tools/world/src/forms.ts) walks up the tree from a taxon to the nearest `body_plan`, and merges every
`body_form` on the way down. Sizes are inherited the same way, one claim at a time: a clade's `body_length` is a range for its members,
and a member with no size of its own takes a place in it by its own number, evenly in proportion, so that most of a wide range is near its
small end. A taxon with no size at any node above it is not drawn: a size is inherited, and never guessed.

### The line for agents

`forms-wanted` ranks taxa by how many rows of the snapshot name them or anything below them, as that is how often they come up.
`form-sheet` draws a form from the side, the front and above, in its poses and at each detail, with a scale, by a software rasterizer
of its own and a PNG writer, so that it runs anywhere and an agent can read what it made. The validator compiles every plan and
every taxon that says anything of its body.

### The atlas

`npm run world -- pbdb-land` asks the data service for every regular occurrence named to a genus or better from a terrestrial
environment, and every taxon they name with all its parents. It keeps them as tables, in `world/snapshots`. Taxa are rows too: a taxon
joins the world's tree only if a record adopts its number, and takes its parent from the database.

[tools/world/src/build/atlas.ts](../../tools/world/src/build/atlas.ts) cuts the chart's stages to at most 8 Myr, carries each site to the
stage's middle by the plate model, and walks a 2° graph of the land of the elevation keyframe nearest it, with a km of shallow sea
costing 4 of land and a km of deep sea 14. A row counts for less the further it is and the less like the climate there, and each kind of
thing on a list (canopy, understory, floating, big, middle, small, in the air, tiny) has a quota, so that what is many and small does not
crowd out what is few and large. A kind with nothing within reach gets a stand-in: the clade whose form its nearest members have, drawn as that
clade.

A species counts as its genus unless a record adopts the species: rows name far more species than there are forms for them, and a list of a genus says what
a place held as well. A row dated to more than 30 Myr says too little of any one stage and is left out; one dated to more than 10 Myr is left out for a taxon that has
rows dated better, or a loosely dated skull would bring *Triceratops* into the Campanian. `life/where.json` holds, for each taxon, the stage and the place with the most
of its well-dated rows: where a record's button takes you.

### The scene

`world/generators/life/scene/v2.ts` (since replaced by later versions in [world/generators/life/scene/](../../world/generators/life/scene/)) makes it all from a spec
([core/scene.ts](../../core/scene.ts)), which [spec.ts](../../world/generators/life/spec.ts) puts together the same way in the build and the
browser. **The land:** the field's heights around the place, with a plain and its river laid over them near the middle, running downhill,
and ridges made up in proportion to the height beyond. A place at the coast has a shore where the field goes under the sea. **The cover:**
how much is forest, low plants and bare ground comes from the climate class and from what the transitions allow by then, so before land plants
it is all rock. **Who stands where:** every tree is a node of a sowing grid with a hash; every animal group a hash of its cell, as many as Damuth's
rule says for its mass, times a stated factor for how many more are shown than a census would see, and fewer of what eats others. Something
of each is set near the place a visitor arrives.

[world/generators/life/stream.ts](../../world/generators/life/stream.ts) is what a view costs: it asks for the cells in view, at the detail
their distance calls for, and sorts everyone into meshes. It runs in a worker. A mesh is made once for each taxon, pose and detail, and
goes up once.

### The viewer

`CityRenderer` draws instanced meshes alongside its cell meshes, in every pass, through the same shaders. A new place reuses the renderer, and
only its ground and colours change. The land's colours come from its climate class (`cover.tones` in `scene.yaml`). `viewer/src/main.ts` keeps a scene of
wherever the camera has come to rest over, or a flight is going down to, and swaps it in when it is ready; a flight waits above the place until it is. A place is on a
lattice about 11 km across at any latitude, so that the same place at the same stage is the same scene however it was reached. A long flight rises, crosses high and comes down
over the place. The ground's rings now overlap by half a cell, as bare ground showed dashes where a pixel fell between two of them.

## How big it is

| What | Size | Gzipped |
|---|---|---|
| One stage's lists, the median of 118 | 315 KB | 62 KB |
| The largest stage's lists, the Middle Pleistocene to today | 1.07 MB | 245 KB |
| All the stages' lists | 39.9 MB | |
| The forms, all 373 whole ones | 562 KB | 111 KB |
| Where each of 1,581 records' taxa is best seen | 113 KB | 17 KB |
| The Hell Creek's file: its spec, and no ground | 301 KB | |

A build grows from about 153 MB to 200 MB and 3,564 files, nearly all of it the lists. The sixth slice's ground alone was 9 MB for this one place: now no place stores any.
The repository gains the 15 MB snapshot, 113 plans, 576 taxon records and 119 sources.

Of the 245,380 rows on the land, 97% can be drawn. Of the 68,361 taxa the lists hold, 128 have a form of their own, 65,549 inherit one and 2,684 have none, for want of a
size or a body plan anywhere above them.

The atlas takes about 30 s of a build of about 3.5 minutes. On a laptop's GPU a scene is ready about 2 s after the camera comes to rest over a new place, with the ground taking about 1 s of that. At
1600×900 the median frame there took 17 ms, drawing 42,720 instances and 1.28 million triangles, against a budget of 220,000 and 9 million.

## Decisions

1. **A form is data, not a mesh and not code.** A mesh per species would be megabytes that no one could review or inherit, and code per
   species would need review as code. A kilobyte of named parts can be written by an agent, checked by a validator, read by the next
   agent, and changed one field at a time down a tree.
2. **The nearest node, not a guess.** A taxon with no form draws as its nearest node's, and a taxon with no size takes its nearest node's
   range. Both say so. That replaces the sixth slice's rule that a taxon with no size is left out, which would have left out nearly everything.
3. **Rows stay rows, taxa too.** The snapshot's 104,000 taxa would break the 20,000-file limit of the site as records, and slow the
   solver for nothing. A taxon becomes a record when someone has something to say of it.
4. **One snapshot, in the repository.** 15 MB, by far the largest file there, until there is a blob store. It is the whole
   Phanerozoic because the pipeline does not care: the atlas costs a minute of build, and the rest is forms.
5. **A list per 4° patch, not a list per cell of a finer grid.** Fossils are too sparse for a finer grid to say more.
6. **The sea costs more than the land, and no more than that.** There are no realms drawn by hand: what a seaway divides, it divides by its
   width, on that stage's own land.
7. **The land is read from what the viewer has.** The relief comes from the tiles of the globe and the climate from `climate.lwt`, so that a
   scene costs a stage's lists and nothing else that is new.
8. **The Hell Creek keeps its formation.** Its taxa come from its own snapshot, as before, with the same generator as everywhere else. The Hell
   Creek's patch of the atlas names many of the same taxa, as recorded here. A taxon of the formation that the sixth slice left out for lack of a size of its own now takes
   its nearest node's, so its list has grown, and nothing has left it.
9. **Generator version 2.** Version 1 and its drawing code are gone: nothing else used them, and the history has them. Its river, plain and
   bends are the same code, in `land.ts`.

## Limitations

- **Most of it is inference.** A list is mostly what is known of a region, moved over land and weighted by climate. It is the same
  list for a whole 4° patch, for a whole stage of up to 8 Myr.
- **The record is lopsided.** Rich lists mostly mark where people have dug, and Europe and North America above all. The panel says so.
- **The land is invented below a degree.** The elevation field is 1° across, and every valley and river is made up. A river runs straight
  downhill from the place through a flat plain: there is no flow routing yet, no tributary, and no water that runs down a slope, so a
  scene in the mountains is a valley with a flat floor. Rivers do not join up across places.
- **Dry places are bare.** A desert draws bare ground, and seldom a river or the trees along one, so the Morrison at 149 Ma, where *Allosaurus*'s button goes, is sand with sauropods on it. Its climate
  comes from one run per 10 Myr on a 2° grid, and water is not routed. This is the most visible thing to mend.
- **A scene is a place, not a world.** Each is about 32 km across, with detail ±6 km from its middle. Cross the edge of a square of the lattice, about 5 km from the middle,
  and the next square's scene takes over, with a new river: everything in view changes at once. The next step is a ground that follows the camera.
- **Forms are coarse.** Kits of tubes and lumps, not reconstructions, and most taxa inherit. Colours are invented, and vary by taxon only so
  that a viewer can tell them apart. Nothing moves.
- **Sizes rest on what agents could read,** many as whole-clade ranges from encyclopedias, each saying so in its note. Nothing has been reviewed
  by a person. See the report in [RECORD-SETS.md](../RECORD-SETS.md).
- **Density is a rule, not a census,** and the factor of 12 is for a visitor's sake. Trophic levels are only that predators are fewer.
- **No seas.** Marine taxa are left out, and over the sea nothing is drawn. Fish are on the lists and are not drawn, because the water is opaque.
- **Today is thin.** The snapshot has only fossils. The last stage is the Pleistocene and Holocene's subfossils, not the living world.
- **A scene is written for the middle of its stage.** The land is the keyframe nearest it, and climate the nearest of its 10 Myr runs.
- **Competing claims do not move a scene's list.** A taxon's size follows the default picture.
- **Forms are one file.** It should be split by hash long before a million forms, and a stage's lists could be half the size if they were not JSON.

## Next

See [LIVING-WORLD.md](../LIVING-WORLD.md): a ground that follows the camera, with rivers routed over the land; agents at scale, by clade, as long
as anyone runs them; the seas; and today, with GBIF and others, licence by licence.
