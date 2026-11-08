# Eighth slice: water

Up to now a scene's river was one recipe, written for the Hell Creek and run everywhere: a coin toss for whether a
place had one, a curve of fixed width through the scene's middle, oxbows scattered beside it, and a flat sheet of water.
This slice gives the world its water and the scenes its rivers, as [SCENES.md](../SCENES.md) designs for every layer of a
natural scene: the finest evidence where there is any, a model everywhere else, and a generator for what is finer
than either.

- **A water balance** (`model:earth/water-balance`): each climate keyframe's months make runoff, by McCabe and
  Markstrom's monthly water balance with Hamon's evapotranspiration.
- **Drainage** (`model:earth/drainage`): that runoff routed over the ground of its time, out of every hollow over its
  lowest pass, into rivers with a flow and lakes that spill or stand where the climate holds them. Today's ground at
  0.1° for the glacial cycles, with the sea of each time; each PaleoDEM at 1° before.
- **Rivers as Landsat saw them** (`field:earth/river-widths`): every river at least 30 m wide, segment by segment, with
  its width at mean flow, from GRWL. Evidence today, and on today's ground held back through the glacial cycles.
- **Channels by the laws of rivers**: width and depth from flow, the length of a bend from the width, braided or
  meandering from slope and flow, each a parameter with its source.
- **A scene's rivers from all of this** (`gen:life/scene` version 3): the river where the world puts it, wound into
  bends only where its course is coarser than them, its older courses' loops left as oxbows, its water falling
  downstream, its floodplain and valley following it, and its water drawn with its flow and depth.

## Running it

```sh
npm run fetch -- src:grwl-summary-v01.02
npm run build:world
npm run dev
```

On the globe, the toolbar's Rivers button (`ly=rv`) draws the drainage's rivers of the time shown and its lakes, and,
close to the ground today, the rivers Landsat saw. To stand by the Mississippi:
`/?t=1950&lat=33.4&lon=-91.1&d=1.00025&h=30&v=75`.

## Pass criteria

| # | Criterion | Test |
| --- | --- | --- |
| 1 | A year's water adds up once the soil settles: what falls is taken up or runs off; a rainforest runs much of its rain off and a desert hardly any; snow is held while it is cold. | `core/water.test.ts` |
| 2 | The routing takes every node of land to the sea, each after the node it drains to, and makes or loses no water. | `tools/world/test/drainage.test.ts` |
| 3 | A hollow holds a lake that evaporates what flows in, and spills when the climate is wet; a hollow under the sea level that the sea cannot reach stays land. | `drainage.test.ts` |
| 4 | Today's great rivers run where Landsat saw great rivers: within 30 km of three in four of the rivers it saw a kilometre wide. | `tools/world/test/build.test.ts` |
| 5 | The Caspian is a lake that does not spill, where Natural Earth has one. | `build.test.ts` |
| 6 | Rivers end at the sea of their time: at the Last Glacial Maximum they cross the Sunda shelf, and today they end at today's coast. | `build.test.ts` |
| 7 | A channel is as wide as its flow says, and braids, winds or runs straight as its slope and flow say. | `world/generators/life/rivers.test.ts` |
| 8 | Bends follow the sine-generated curve with the sinuosity asked for, a wavelength apart, and two scenes that see the same reach draw the same river. | `rivers.test.ts` |
| 9 | Oxbows lie on the floodplain, off the channel. | `rivers.test.ts` |
| 10 | A scene runs its rivers where the world says, within their floodplains, its water falling downstream, the ground under them cut below it, its water flowing downstream, and a visitor arriving by one. | `world/generators/life/scene/v4.test.ts` |
| 11 | A river's water falls gently and never rises, where the coarse ground under it steps; a river running into another meets its water and is not drawn inside its channel. | `rivers.test.ts` |
| 12 | The water layer answers evidence where Landsat saw rivers, model where the drainage covers the time, and generic before. | `core/resolve.test.ts` |
| 13 | The globe draws the great rivers from far off and the Amazon to its estuary; at the Last Glacial Maximum its rivers cross the Sunda shelf; the Caspian is a lake that spills nowhere. | `viewer/test/e2e/foundations.spec.ts` |
| 14 | A scene by a river Landsat saw draws that river, and a visitor arrives beside it. | `viewer/test/e2e/life.spec.ts` |

## What was built

### The water balance

[core/water.ts](../../core/water.ts) runs each land cell of a climate keyframe through twelve months, five years over so
the soil and the snow come round: rain or snow by the temperature, 5% of the rain straight off, the snow melting at up
to half a month, Hamon's potential evapotranspiration from the temperature and the hours of daylight, a soil that holds
150 mm, and half of each month's surplus running off. A lake's surface loses its potential evapotranspiration less the
rain on it. [build/climate.ts](../../tools/world/src/build/climate.ts) does this beside the climate's own reduction, for the
deep past's runs and the climate of the last 120,000 years alike.

### The drainage

[build/drainage.ts](../../tools/world/src/build/drainage.ts) floods the land from the sea upward in order of height
(priority-flood, with a queue for what hollows and flats hold), so each node drains to the node it was reached from. A
hollow is a set of nodes under the level their water rests at; its lake is settled when the flood's order reaches its
outlet: it spills what its surface cannot evaporate when full, or stands only as high as evaporates what comes in.
[build/rivers.ts](../../tools/world/src/build/rivers.ts) routes today's ground once, down to the lowest sea of the stack,
on each cell's lowest ground so that a gorge narrower than a cell stays open; each keyframe then has the sea of its time
and the water of its climate. Before the climate of the last 120,000 years begins, a keyframe takes the water of the
keyframe of that climate whose sea stood nearest. Each PaleoDEM is routed on its own, with its run's water.

What is written is a network and its keyframes ([core/rivers.ts](../../core/rivers.ts)): the reaches once, then for each
keyframe the sea level, each reach's flow and the lakes, in files of twelve keyframes that come as the time does.

### The rivers Landsat saw

[build/grwl.ts](../../tools/world/src/build/grwl.ts) reads GRWL's summary product, a shapefile of 42,117 segments with
the median of each one's widths, and cuts it into tiles of 10° for scenes, with one thinned file for the globe.

### A scene's rivers

[world/generators/life/rivers.ts](../../world/generators/life/rivers.ts) draws each river a scene's spec gives it. Its
width and depth come from its flow (or its measured width), and its pattern from its slope and flow: a mountain stream
steeper than 1 in 50, a braided river where Leopold and Wolman's line says so, and otherwise a meandering one. Where
its course is too coarse to show its bends, it is wound into Langbein and Leopold's sine-generated curve, 7 to 12
widths to a wavelength, each bend's size varied by a hash of the reach and the bend's number; so the bends are the same
wherever a scene meets the reach. Loops of its older courses, swung to the point of cutting off, are left as oxbows
beyond the belt it winds in now. [scene/v4.ts](../../world/generators/life/scene/v4.ts) lays the ground from the rivers:
each one's bed, banks, levees and floodplain at the height of its water there, and beyond the floodplain the land,
never lower than the plain, so that a valley's walls rise from it. The water is a ribbon along each river and oxbow,
carrying its flow and depth, so the water shader draws ripples drawn out along the current and a colour from the
climate's shallows to its depths.

A river's water is the ground's height along it made to fall: the nearest profile that never rises, smoothed over
2 km, so that one low cell of the coarse ground does not drop it all at once. A river that runs into another comes to
the other's water at the meeting, and is not drawn inside the other's channel. The water is drawn a little toward the
eye, out to the banks, so that where the ground's coarser rings cannot follow a channel, it is still seen in it: those
rings were what broke a river into slabs before.

[viewer/src/city/lifeatlas.ts](../../viewer/src/city/lifeatlas.ts) gives a scene its rivers: the segments Landsat saw
within 40 km, joined end to end into rivers, as GRWL keeps them from one junction to the next in no set direction; and
the drainage's reaches where Landsat saw none. A scene is now drawn at the time shown, within its stage, with the finest
relief of that time: a tenth of a degree for the glacial cycles.

### On the globe

[viewer/src/ui/riverslayer.ts](../../viewer/src/ui/riverslayer.ts) draws the drainage's rivers of the time shown, broken
where the sea or a lake of the time covers them, the great ones from far off and smaller ones closer in, each as wide
on the screen as the log of its flow says; the lakes of the time; and, close to the ground, the rivers Landsat saw at
their own widths. A network of today's ground is carried with its plates to the time shown, as the land under it is.

## How big it is

The rivers add 64 MB to a build: 32 MB of the glacial cycles' network and keyframes, 2.6 MB for the deep past and 29 MB
of GRWL's tiles. A viewer fetches a network once and a file of keyframes as the time comes to it. Routing takes about
100 s of a build.

## Decisions

- **HydroRIVERS is not imported.** Its licence is WWF's own agreement, which forbids distributing it as a stand-alone
  product and can be ended at WWF's discretion. TDX-Hydro is share-alike, and Hydrography90m and MERIT Hydro are
  non-commercial. GRWL is CC BY 4.0, and so is the routing built here.
- **GRWL's summary, not its full product.** The full product has a width every 30 m and is 3.1 GB; the summary's
  segments, a point every 700 m or so, are enough to follow a river's course, and a scene winds in what is finer.
- **The lowest ground of each cell.** Averaged to 0.1°, the ground dams every gorge narrower than a cell, and the
  routing held lakes the size of the Congo's basin behind them. Routed on the lowest ground, Baikal, Tanganyika, Malawi
  and Superior come out near their real levels.
- **A lake that spills is drawn only where today's lakes are.** The dams the grid still makes are left out that way; a
  lake that does not spill is the climate's, and is drawn wherever it stands.
- **The mean flow, for laws of the bankfull.** The width and depth laws are for bankfull flow, which the routing does
  not give; read with the mean, a channel is about as wide as its usual flow.
- **Invented things keyed by the reach.** A river's bends are a function of the reach and the distance along it, so
  scenes agree, as [SCENES.md](../SCENES.md) asks of everything invented.
- **The invented land scaled to its field.** A scene's coast wandered by up to 90 m wherever the land was low, and its
  hills stood in proportion to its height, both sized for a field a degree across, and hidden in the middle by the
  invented plain. With the plain following the rivers, they pocked every lowland with hollows under the sea. The coast
  now wanders only in the cells of the field it crosses, as far as a cell's spacing lets it, and the invented hills
  shrink with the square root of a finer field's spacing.

## Limitations

- **No water is lost along a river.** A river crossing a desert carries all it gathered: the Nile's mouth has several
  times its real flow.
- **Hamon's equation underestimates a desert's evaporation,** so Lake Chad is about three times its size, and in the
  glacial climate larger again. The Caspian stands about 14 m below its level.
- **Rivers under the ice sheets** are routed as if the ground were bare: the ice field is not read.
- **The past's courses are today's.** GRWL's rivers are held back as they run today; avulsions and moving deltas are not
  recorded. Rivers narrower than 30 m are the drainage's, whose course is known only to 0.1°.
- **A scene's lakes are its oxbows.** The drainage's lakes are drawn on the globe but not yet in scenes.
- **A braided river is a wide, shallow bed,** without its threads and bars.
- **The deep past's rivers are on 1° grids,** and a fossil site's own record of its setting (a channel, a floodplain,
  a lake) is not read yet.
- **Through a broad hollow the routing draws parallel straight reaches.** Inside a hollow filled to its pass, every
  node drains along the flood's path from the pass, a straight ray, and where the hollow's lake is not drawn the rays
  show as rivers: the floor of the Gulf of Carpentaria and of the Gulf of Thailand at a lowstand, the Chaco. A hollow's
  nodes should run downhill to its lowest node, and only that one out over the pass.
- **A scene's climate is still the deep past's runs,** not the climate of the last 120,000 years: the western Amazon
  is drawn as savanna today. Its relief is the finest of the time; its climate should be too.
- **A river's bends are the same in every scene only along a reach of the drainage.** Rivers Landsat saw are joined in
  each scene from what it can see, so the bends finer than their course may differ from one scene to the next.

## Next

Lakes in scenes, from the drainage and today's lakes; the ice sheets; losses along rivers and a lake evaporation from
a source; hollows routed to their lowest point; a scene's climate from the finest field of its time; braided threads; the
migration of bends, which would leave scroll bars; and the rock record's environments for the deep past's scenes, as
[SCENES.md](../SCENES.md) orders them.
