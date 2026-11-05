# Feature tiles: markers by time, place and prominence

The globe's markers used to travel inside the terrain tiles: every feature, for the whole planet,
copied into every time bin it overlapped. All of human history was one bin. It worked at a few
hundred records, and would have stopped at about 17,000 features in one bin, the 25 MiB limit on
a file. Now each marker is stored once, in a tile of its own, and the viewer fetches only what its
view needs. The code is in [core/featuretiles.ts](../core/featuretiles.ts) (addressing, and which
tiles a view needs), [tools/world/src/build/featuretiles.ts](../tools/world/src/build/featuretiles.ts)
(the build) and [viewer/src/features.ts](../viewer/src/features.ts) (the viewer).

## How a feature finds its tile

**Time.** Time is cut into leaves that double in length going away from the present, 34 each way, and
a binary tree stands over them. A feature goes in the smallest node that holds its whole life, under
every scenario and across its bounds. A moment goes in a leaf; anything still standing crosses the
present and goes in the root. A view fetches every node that touches its time, give or take how long
a moment stays visible.

**Place.** Within a node, a quadtree over the feature's position on its own plate, not over the map of
any one time. Each tile lists the plates in it and below it, and a cell's circle moves rigidly with
each plate, so the viewer rotates it to the time shown and asks if it is in view. A thing that moved
has no one place: it stays in its node's root.

**Prominence.** A cell keeps up to `budget` features, and the rest go to its four children. So a place
is never crowded out from afar by a busier place elsewhere. A cell splits only when it is full, so the
Pacific stays one cell while a city goes deep.

The viewer wants a child when its parent is more than 1.5 times what the screen spans. As close as the
globe goes it wants everything in view, or some of it could never be reached by coming nearer.

## Prominence is derived

From [prominence.yaml](../world/schema/vocab/prominence.yaml), by the build:

1. a score for the record's kind, its own or its nearest parent's;
2. what its largest measured size adds: population, settlement area, area;
3. among equals, the hash of its id, which favours nothing and does not change.

Within a cell, each domain (earth, life, people) has its top few kept first, so that one domain cannot
fill it. Prominence answers *from how far away does this show by itself*. It is a choice about what a
map can hold and no claim about the world, and it never hides a record from search, from its panel or
from flying there. It must never count sources or links: those measure how much has been researched.

The scores are a machine's first draft, and this is meant to be tweaked. There are no editorial pins
yet: a rule that derives is easier to see and to change.

## What else moved

- **Dates under other pictures** (`variants`, a feature's and its moves') were most of the bytes, and
  most people never need them. They are in `features/variants.json`, fetched when a picture other than
  the default is asked for.
- **What a site draws** (buildings, monuments, works, open spaces) is not in these tiles. The globe
  never showed it, and 857 of the 1,080 features in the old tile of the last 20 Myr were these.
- **A feature asked for by name**, such as a record opened from a link or a fossil lit by the tree of
  life, is found through `where` in `features/index.json`, wherever the view is.
- **Past 150 markers** on screen, the most prominent stay, with what is chosen or lit. At today's size
  this never happens. It does not apply as close as the globe goes.

## Where it stands

At 303 features there is very little to thin: 43 tiles, two of them below a root, each holding one feature. Its checks are on a
synthetic world of 100,000 features in `tools/world/test/featuretiles.test.ts`: every feature stored
once, every cell within budget, a feature found whenever it is alive and the camera is near, wherever
its plate has carried it.

## Limits of this first version

- **A long life takes a slot at every time.** The root holds everything still standing, whatever its
  start. A cell's budget can be spent on what is not alive at the time shown, so from afar a view may
  show fewer than it could. Nothing is lost: coming nearer finds it.
- **Bounds near a split.** A short life that crosses a split of the tree sits high up in it, for the
  same reason. Crossing the present is the worst case.
- **`where` grows with the world.** At about 40 bytes a feature it is fine for now, and it will need
  splitting by hash before a million features. So will the list of tiles, which should become computed
  addresses and a small map of what is empty.
- **Tiles are never evicted.** Their rows are small; a very long session over a much larger world would
  need it.
- **No prefetch.** Scrubbing fetches each new node as it reaches it, so markers can come a moment late.
- **Markers are still DOM elements,** and their labels are placed in time that grows with the square of
  how many there are. That is what the 150 protects. Drawing them on the GPU is the next step for density.
- **Records are still one file each,** and search is still one download. These reach their own limits
  (20,000 files on Cloudflare Pages) at about the same size, and need the next piece of work.
