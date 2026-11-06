# The living world: zoom in anywhere and see what lived there

Status: the plan, November 2026. What is built of it is in [SEVENTH-SLICE.md](SEVENTH-SLICE.md). It
follows from the [roadmap's](ROADMAP.md) aim: at any place and any time, the ground, the plants and the
animals of that place and moment, and honest about which is which.

## The idea

**A scene is a function, not a file.** `scene(place, time, seed)` runs in the browser and makes the same
scene everywhere: the same individuals exactly, in the same places within a tolerance. What it reads is small and sourced: an atlas of who lived where and when, and a form
for each kind of living thing. What it makes, the ground and every plant and animal on it, is never
stored. So the world can grow without the build growing with it, and the cost of a frame depends on the
pixels on the screen and not on the size of the Earth.

Storing scenes cannot work: the Hell Creek's ground alone is 9 MB for about 3,200 km², which is about
420 GB for one moment of today's land, and tens of terabytes across the Phanerozoic. Simulating the whole
Earth cannot work either, and would not reproduce what actually happened. A model that paints the view
live could not say what any animal rests on, or make the same picture twice.

```text
sourced records + fossils + climate + plates
        ↓  the build
atlas: who, how sure, how common, by place and time        forms: a body for every node of the tree
        ↓  a few KB at a time, in the browser                     ↓
scene(place, time, seed) → ground, cover, individuals
        ↓
drawn at the detail each one's size on the screen calls for
```

There are four questions, and each has one answer that scales.

## 1. Who lived here, then?

Most places and times have no fossils at all, so the atlas answers in tiers, and always says which:

| Tier | What it means | What a click says |
|---|---|---|
| **Here** | an occurrence of this taxon within a few hundred km, at this time | the rows that put it here |
| **Region** | an occurrence reachable overland, in a like climate, at this time | how far away, and that its being here is an inference |
| **Stand-in** | nothing near: the nearest known member of a clade, drawn as the clade | how far the nearest fossil is, and that this is a guess at what kind of thing lived here |
| **Nothing** | no record of this kind of life at this time | says so, and draws none |

Distance is overland, on the land of that time, with the sea costing far more: so a dinosaur known from
Mongolia does not walk into the Hell Creek, and the Western Interior Seaway divides what it should.
Fossils say who is present. How many comes from general rules, next.

The fossil record leans heavily to Europe and North America. Richer scenes there partly show who has been
digging, and the panel has to say so.

## 2. What did it look like?

**Every taxon gets a form, and the tree of life fills every gap.** A form is a small piece of data, not a
mesh and not code: a body described as named parts (a trunk through rings, legs, a head, a frill), in
proportions of the animal's own length. It sits on a node of the tree, and a child inherits its parent's
and changes only what differs:

```text
Ceratopsidae                 the whole body plan: trunk, four pillar legs, head, frill, three horns
└── Chasmosaurinae           a longer frill
    └── Triceratops          a short solid frill, long brow horns      (an agent wrote this)
        └── T. prorsus       a longer nose horn                        (an agent wrote this)
    └── Anchiceratops        nobody has written it yet: it is drawn as Chasmosaurinae, and says so
```

So there is **always something to draw**, from the first day, for every taxon: the nearest node's form. And
the record gets better one species at a time without anything else changing. A panel says whose form it
is: *"Drawn from the form of Chasmosaurinae; no one has written its own yet."*

**Agents write them, all of them, over time.** That is what makes it possible to go to every species and
not stop at a few famous ones. A form is compact and checkable enough for a machine to write and for the
next one, or a person, to review:

1. `npm run world -- forms-wanted` lists the taxa that most need one: those most often drawn, with no form
   of their own.
2. An agent reads what is published on the animal, and writes its `body_form` and its sizes as claims, with
   sources, as any other claim. [FORMS.md](FORMS.md) is the brief.
3. `npm run world -- form-sheet <taxon>` draws it from the side, the front and above with a scale bar, so
   that the agent can look at what it made, compare it with what it read, and correct it.
4. `npm run validate` compiles every form and refuses what breaks the rules: a part it does not know, a
   body below the ground, a size past its budget.
5. It is `proposed`, like all machine work, until a person has looked at it.

At about a kilobyte each, a million forms is about a gigabyte across shards, of which a scene fetches a few
dozen. A form says what a body plan looks like and what was measured: the skin's colour and most of the soft
tissue stay the generator's, and are marked so. Likewise sizes: a taxon with no measured size takes the
range its nearest node's claim gives, and says so.

## 3. How many, and where?

Today one row of a formation's snapshot stands for a few animals, which mostly measures what fossilises and
who collected it. General rules say more: density falls with body mass (Damuth's rule), predators are fewer
than prey, the climate and the cover set how much grows. Fossils decide who is there; these decide how many.
They run in the generator, with a stated factor for how many more are shown than a census would see, as
otherwise a visitor would seldom meet a large animal at all. A full ecosystem model (Madingley, say) is for
checking these rules offline, not for the viewer.

## 4. How is it drawn?

- **Stateless and on demand.** Each cell of the ground makes what stands in it from a hash of the cell, so
  nothing is laid out until it is looked at, and the same plant is the same plant from any direction.
- **The same individuals at every zoom.** Each has a rank from its hash. A far view shows the top of the same
  list a near view shows in full, so nothing changes identity as you come closer.
- **Instancing.** One mesh for each form, pose and level of detail, with each individual a few numbers. This
  replaces a merged mesh for each cell, whose memory grows with the number of organisms.
- **A chain of details.** A fine mesh, a coarse mesh, a tiny one, the canopy painted on the ground, and the
  biome's colour on the globe, each about the colour of the next.
- **The ground follows what is known.** The field's heights where it has them, invented detail below that,
  and marked as invented. For now a river runs downhill from the place; it should come to be routed over the land.
- **Budgets, not hopes.** A frame draws at most so many instances and triangles, whatever the world holds.

WebGPU compute culling can come later, and is not needed yet. Virtual geometry is poorly suited to foliage.

## What it will not do

- At a past time a valley at street level is invented, as the heights are only 1° across.
- Colour, feathers and behaviour are mostly unknowable. A stand-in is a guess at the kind of thing, and is
  labelled as one.
- A place's richness partly reflects where people have dug.
- Some of the best data may be closed to us: the licences of species ranges and trait databases have to be
  read one at a time, and share-alike or non-commercial ones cannot come in.

## The order

Each step is usable by itself, and each is tested. The first four are the seventh slice.

1. **Forms on the tree.** The kit as data, with fallback to the nearest node, and the agents' line. *Built.*
2. **The atlas.** The Paleobiology Database's land fossils as one pinned snapshot, reduced by the build to who
   lived where in each stage, in tiers. *Built.*
3. **Any land, any time the atlas covers.** The Hell Creek's generator turned into the general function. The
   Hell Creek becomes its first test, and must keep its taxa. *Built.*
4. **Instancing and details,** with the frame's budgets as tests. *Built.*
5. **Seamless ground.** Fly over the land without entering a separate site: the ground follows the camera,
   and rivers run from the coarse slope down.
6. **Agents at scale.** Batches of forms, by clade, as long as anyone runs them; and more body plans. *A first
   batch is written.*
7. **The seas,** with their own forms and depth layers.
8. **Today and the recent past,** which have far more data and a different licence check.
