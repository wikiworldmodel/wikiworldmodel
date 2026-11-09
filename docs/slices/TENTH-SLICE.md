# Tenth slice: the seas

Life was marine for three billion years, and most of the fossil record is the sea's; yet up to now nothing of the sea was
drawn. The eighth slice's sea atlas listed what lived in each patch of sea in each stage, but none of its genera had a
body, the scene generator had no sea, the viewer did not load the sea's lists, and the water was an opaque sheet a visitor
could not go below. This slice takes [LIVING-WORLD.md](../LIVING-WORLD.md)'s seventh step: the seas, with their own forms
and depths.

- **The sea's lists draw** (`field:life/community-sea`, [build/sea.ts](../../tools/world/src/build/sea.ts)): each genus
  is given the body it is drawn with by the land atlas's own classification, run for the sea, so that only a plan that
  swims, lives on the sea's floor, anywhere or at the water's edge, or flies over it, is drawn there. After a list's most
  recorded genera, which are often too small to see, it keeps up to ten more a scene can draw, no more than three of one
  class.
- **Bodies for the sea** (`world/plans/`, `world/entities/life/taxa/sea/`): fifteen new plans, on the sea's floor (trilobite,
  brachiopod, ammonoid, coral, crinoid, echinoid, sponge, bryozoan, clam, sea star, eurypterid) and in its water (whale,
  ichthyosaur, plesiosaur, mosasaur), and twenty-five records that adopt the database's great groups of the sea with their
  sizes, written by an agent on the forms' line ([FORMS.md](../FORMS.md)). Of the sea snapshot's 1,471,786 rows, 62% can
  now be drawn, up from 35%.
- **A scene of the sea** (`gen:life/scene` version 5, [scene/v5.ts](../../world/generators/life/scene/v5.ts)): a place in
  the sea has its floor from the field, no invented river, what lives on the floor resting on it and what swims in the
  water above it. A place on land makes what version 4 made.
- **Under the water** ([gl/cityShaders.ts](../../viewer/src/gl/cityShaders.ts), [gl/city.ts](../../viewer/src/gl/city.ts),
  [city/view.ts](../../viewer/src/city/view.ts)): a scene of the sea is drawn with its floor at its true depth, shaded as sand,
  mud, ooze or rock and darker the deeper it lies; a surface seen from above, tinted by the water under it, and from below,
  with the sky through its window; everything under water dimmed along its path through the water, and the light by its
  depth. A visitor can go down through the surface to a little over the floor. On land and in Rome nothing changes.
- **The forms' line for the sea**: `npm run world -- forms-wanted --sea --missing` ranks the sea's fossils by what most
  wants a body, and `habitat: floor` is the form language's word for what lives on the sea's floor.

## Running it

As for the other slices (see the [README](../../README.md)); nothing new is fetched. Go to any stage of the Phanerozoic
and scroll down over a sea whose atlas has a list: the globe gives way to the sea at about 300 km up, and you can go on
down through its surface to its floor.

## Pass criteria

| # | Criterion | Test |
| --- | --- | --- |
| 1 | A sea's list keeps, after its most recorded genera, those a scene can draw, each with a body that lives in the sea and a size, and no more than the limit of one class among those added. | `tools/world/test/life.test.ts` |
| 2 | In a scene of the sea, what lives on the floor rests on it, what swims is in the water above it and below the surface, within its band, and no land animal is drawn. | `world/generators/life/scene/v5.test.ts` |
| 3 | A place on land makes what version 4 made: every test of the land's scenes holds, and nothing that swims is drawn on land. | `v5.test.ts` |
| 4 | The browser's scene of a place in the sea is the build's, within the tolerance, as for places on land: the build writes a witness at sea. | `life.test.ts` |
| 5 | Where the sea's atlas has a list and the land's none, a visitor goes down into a scene of the sea, below its surface to a little over its floor; the bar names who is drawn, and Go and see stays under water. Where neither atlas has a list, there is still no way down. | `viewer/test/e2e/life.spec.ts` |
| 6 | The camera's way under the sea: how much of a sight line lies in the water, a look through a point down to the floor, the eye kept over the floor, and a scene on land as it was. | `tools/world/test/view.test.ts` |
| 7 | No genus the database puts on land or in fresh water alone is drawn in the sea, whatever its body. | `life.test.ts` |
| 8 | Rome and the land's scenes draw as before: the city and city-views browser tests, golden images included, pass unchanged. | `viewer/test/e2e/city.spec.ts`, `city-views.spec.ts` |

## What was built

### The sea's lists

[build/sea.ts](../../tools/world/src/build/sea.ts) runs the land atlas's `classify` over the sea's snapshot in a mode of its
own: a genus is drawn with the body of the nearest record above it that has one, but only if that body's plan says it
swims (`water`), lives on the floor (`floor`), anywhere (`any`) or at the water's edge (`edge`, drawn on the floor), or flies
over the sea (`air`); and it needs a size there too. A list then keeps its twelve most recorded genera, as before, and adds
the most recorded of the rest that can be drawn, up to ten drawn in all and no more than three of a class among those
added. The genera's whole forms go in `life/sea-forms.json`, keyed as the land's are, so that a browser merges the two.

In the build of this slice, 97% of the sea's 389,767 lists draw something, nine genera on average, and of the 13,022 lists
with a genus recorded within reach, 12,598. What they draw most, by class: bivalves, rhynchonelliform brachiopods,
cephalopods, snails, corals, trilobites, strophomenate brachiopods, sharks and lingulids.

### The scene

[scene/v5.ts](../../world/generators/life/scene/v5.ts) is version 4 with a sea. A place whose ground at the origin lies under
the generator's `sea_below` is a scene of the sea: its water is the sea, at z = 0; its ground is the field's floor; it
invents no river. In it, what swims is laid out where the water is more than 2 m deep, at least half its length above the
floor and below the surface, and within `sea.swim_m` (40 m) of the floor; what lives on the floor, and what lives anywhere
or at the water's edge, rests on the floor where the water is more than half a metre deep. A land animal has nowhere to
stand under water, and a body of the sea never stands on land. A place's spec takes the sea's list where the land's atlas
has none ([spec.ts](../../world/generators/life/spec.ts)), in the build and in the browser alike, and the build writes a
witness at sea: in this slice's build, a Hauterivian sea at 64° N, 38° E, with twelve genera.

### Under the water

All of it is drawn only in a scene of the sea (`placeLook(spec).sea`): on land and in Rome the renderer runs the code it ran
before. Its colours and the rates at which the water takes light are a look, not a measurement, and the code says so, as it
does of the air's haze.

- **The floor** is the terrain at its true depth in every pass (lit, the depth prepass, the shadows and picking), shaded as
  a sea's floor: sand on the shelf, mud and ooze deeper, rock on the slopes, a beach at the waterline, darker with depth so
  that an abyss is darker than a shelf.
- **The surface** is its own translucent mesh at z = 0, drawn after everything opaque. From above it reflects the sky and the
  sun and is tinted by the depth of water under it, so that a shelf reads shallow and the open sea deep; from below it is a
  window onto the sky, a mirror of the depths outside it.
- **The water** dims everything seen through it, colour by colour, toward its own colour, and the light reaching a point by
  its depth; the sky seen from under water is the water's colour, and the camera's exposure opens a little under water.
- **The camera** stands on the sea's floor rather than on its surface, so a visitor can go down to 1.7 m over the floor,
  with a near plane close enough to see what swims beside the eye ([city/view.ts](../../viewer/src/city/view.ts)).
- **The bar and the panels** read as on land where the scene draws something, and say that nothing of the sea's life can be
  drawn there where it draws nothing. A genus is "recorded by sea" and stands in from "a like belt of latitude", as the sea's
  atlas words it; a click on the ground is "the sea floor here", and Go and see takes the visitor to the nearest large group
  under water.

## Decisions

- **One classification, two filters.** The land atlas already walks each fossil's taxon up the database's tree to the
  nearest record with a body and a size; the sea's atlas does the same, keeping only what can live in the sea. A body is
  drawn in the sea only if its plan says outright that it swims, lives on the floor, anywhere or at the edge, or flies:
  a plan that says nothing is left out, so that a land animal found in a marine bed is not drawn under water.
- **What lived and what is drawn, both.** A list's most recorded genera are often foraminifera, radiolarians or
  coccolithophores, too small to see. The list keeps them, as the record of what lived there, and adds the genera a scene
  can draw, so that the scene shows the sea's macrofauna without the list pretending the plankton was not there.
- **A few of each class.** Unlimited, a Paleozoic shelf would draw its ten commonest brachiopods; the limit of three to a
  class among those added gives a scene the variety of its sea. It changes which genera are drawn, not what lived there.
- **The land's density rule in the sea.** No work gives how many of each kind live on a sea's floor in the terms the
  generator needs, so it uses the land's, and the generator's record says so as a limit.
- **Swimmers near the floor.** What swims is drawn within 40 m of the floor, where a visitor looks; the sea's whole
  depth is no claim about where anything swam.
- **A new version.** A scene at sea is new output, so the generator is version 5; at a place on land its output is
  version 4's, and its tests say so.

## Limitations

- **No temperature of the sea.** A like sea is still a belt of latitude. The climate model's runs that the build reads
  have a surface temperature over the ocean too, which the build discards; it would make the sea's lists, its reefs and
  its colours follow the water's warmth.
- **Densities are the land's rule,** and a reef or a shell bed is far denser than any herd.
- **No reefs as structures,** and no plants of the sea: algae and sea grasses are not drawn.
- **The open ocean is dark and mostly empty:** the record is of shelves, and a deep floor's list is often stand-ins.
- **Bodies are coarse,** and most genera inherit their class's; crinoids and sea stars have bodies and no size, so they are
  not drawn ([RECORD-SETS.md](../RECORD-SETS.md) lists the doubts of the sea's forms).
- **Small animals only close, at full quality.** The fast quality draws no animal under 0.6 m, so most of a Paleozoic
  floor (trilobites, brachiopods, clams a few centimetres long) is seen only at full quality, close by.
- **Arrivals are the land's.** A scene stages something of each genus within a few hundred metres of the arrival, as on
  land, but the water shows only some 75 m, so Go and see goes in two steps.
- **The deep past's shelves are deep.** The Paleozoic shelves of the elevation grids lie flat at about 150 m, so their
  scenes are dim; the ground's grids hold no floor deeper than 3,200 m.
- **Not drawn:** caustics, shafts of light, particles in the water and refraction; from below, the surface outside its window
  is a mirror.

## Next

- The sea's surface temperature from the climate runs, for a like sea, for reefs and for the water's colour;
- reefs as built structures, and the sea's plants;
- depth zones, from the database's life habits: what lives in the water column, on the floor and in it;
- the agents' line for the sea's forms, class by class, as for the land's.
