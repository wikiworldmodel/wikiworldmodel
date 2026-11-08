# Second slice: the whole span

Status: built and passing its tests. The first slice ([FIRST-SLICE.md](FIRST-SLICE.md)) ran
one thin slice through every layer of the design, from the Cambrian to today. This one
widens the world to its whole span, coarsely, before any era is filled in depth: from the
Hadean to the Sun reaching the tip of the red-giant branch. It came ahead of the two slices
the first one proposed next (the Last Glacial Maximum, a sliver of Rome), so that the whole
timeline is covered before any part of it in detail.

The third slice, [THIRD-SLICE.md](THIRD-SLICE.md), draws the planet's states on the globe:
the magma ocean, the oceans and Snowball ice. Where the two differ (the plain globe before
1,100 Ma, the renderer), that document describes the current build.

The slice covers 4,600 Ma to 7.6 Gyr from now, with:

- the whole ICS chart: the Precambrian's 3 eons, 7 eras and 10 periods beside the
  Phanerozoic's intervals;
- where the plate model puts its continental blocks from 1,100 to 540 Ma, before the oldest
  elevation grid; before 1,100 Ma and after the near future, a plain globe that says no
  geography is known;
- the future: today's map held for 10 kyr as a projection, a time control that runs past the
  present, and projections for the Sun, the atmosphere and the galaxy;
- four global series, shown for the time on screen: the Sun's brightness (computed from a
  published formula), and surface temperature, CO₂ and sea level (read from datasets);
- a spine of 24 sourced milestones, from the Solar System's oldest solids to the Sun at the
  tip of the red-giant branch;
- a basic tree of life: 26 taxa placed by the Open Tree of Life, the oldest fossil of most of
  them, and published molecular-clock dates.

## Running it

As for the first slice (see the [README](../../README.md)). `npm run fetch` now downloads four
datasets.

## Pass criteria

| Criterion | Where it is checked | Result |
|---|---|---|
| The time control reaches every time the world has, past and future | `tools/world/test/timebar.test.ts`; in the browser, `viewer.spec.ts` | the Hadean to 7.59 Gyr from now; windows in the past no wider than 400 Myr map exactly as before |
| Each time shows the best geography the world has, and says so where it has none | `viewer.spec.ts`: deep time, the blocks, the future | elevation 540 Ma to 10 kyr from now; blocks 1,100–540 Ma; a plain globe, with a note, outside them |
| A series follows its source: computed by its rule, or read from its table | `tools/world/test/build.test.ts` | the Sun at 1 today; 541 temperature, 840 CO₂ and 541 sea-level points, with their bands |
| A taxon arises no later than its oldest member, and no earlier than its group | `tools/world/test/validate.test.ts` | a contradiction either way |
| The first slice's criteria still hold | `build.test.ts`, `mesosaurus.test.ts`, the contradiction fixture, `golden.spec.ts` | builds byte-identical; the Mesosaurus sites meet; the fixture fails; goldens as below |

The three golden renders were regenerated: the time control gained an eon row and a track,
so it is 29 px taller and the canvas shorter. Rendered at the old canvas size, the old
images still match exactly, so nothing in the renderer changed for them. Their marker lists
gain the new records that are near those times.

## What was built

### Periods

The ICS importer reads the whole chart (v2020/03, from the same palaeoverse table). It skips
the informal Precambrian super-eon and the four "… System" rows that repeat the Archean eras;
the chart has no Archean periods. The Hadean starts at 4,600 Ma, as on the chart. The 164
Phanerozoic records came out byte-identical. The time control shows a row of eons.

### Geography, in three modes

| Time | Field | The globe |
|---|---|---|
| 540 Ma to 10 kyr from now | `field:earth/elevation` | PaleoDEM terrain; after the present, today's grid held as a projection |
| 1,100–540 Ma | `field:earth/continental-blocks` | where the plate model puts its continental blocks: bare crust and open water, with no relief |
| before 1,100 Ma, after 10 kyr from now | none | a plain globe with a graticule, and a note saying why |

The blocks field is the plate model's polygons, partitioned on the grid every 10 Myr (57
snapshots), and moved between snapshots with the plates like the elevation field. Each block
is a present-day piece of continent moved to its place at the time. The shapes are today's,
and how much of each block stood above the sea is not known: the field's record and the panel
for a click on the ground say so. A polygon whose plate the rotations do not reach is left
out; every block reaches 1,100 Ma, the oldest age in the rotation file.

A marker is placed only where the frames say where it was: a plate-bound marker is hidden at
times its plate's rotations do not reach, and wherever no field covers the time. The Jack
Hills zircon (4,404 Ma) has a present-day place but none at its time.

### The tile set

Time bins double in length away from the present, in both directions (0–20, 20–40, 40–80 …
Ma, and the same into the future), and are split where a field starts or ends, so that one
field covers each bin, or none does. Every bin has a coarse tile, with its features, the
generator constraints and its field if it has one; only bins with a field have the finer
level. A build is 157 tiles (21 coarse, 136 fine), 63 MB uncompressed.

### The time control

- **Warp.** Logarithmic in distance from the present on both sides, log(1 + |age| / c), with
  c an eighth of the window's span, capped at 50 Myr. Windows in the past up to 400 Myr wide
  map exactly as before. (Since replaced by a fixed scale that gives recent history room: see
  [`timescale.ts`](../../core/timescale.ts).)
- **Ticks** are chosen along the strip, so they space evenly whatever the warp. Future ages
  are marked +.
- **Track.** A row below the bands marks every dated record: point at one for its name and
  time, click to open it.
- **Movement.** Playback and the arrow keys move evenly along the strip, not evenly in years.
- **Instants** stay visible for a dozen pixels of the strip either side of their time (before,
  1.2% of the window).

### Series

A series is a field with one value for the whole planet at each time (`grid: { kind: series
}`), read from a dataset's table (a CSV or TSV by column names, a workbook by sheet and column
letters) or computed by a rule. Neither is stored. Before the present a series has its
source's basis; after it, its values are projections. A panel at the top left shows each
series at the time on screen; clicking one opens its source and how it is known.

| Series | Source | Span |
|---|---|---|
| Brightness of the Sun | computed: Gough (1981), L = L☉ / (1 + 2/5 (1 − t/t☉)), t☉ = 4.567 Gyr | 4.3 Ga to 5 Gyr from now |
| Global mean surface temperature | the Scotese et al. (2021) curve in van der Meer et al. (2022), Supplementary Table 1 | 540–0 Ma |
| Atmospheric CO₂ | Foster, Royer & Lunt (2017), Supplementary Data 2 (the 68% interval as the band) | 419.5–0 Ma |
| Sea level | van der Meer et al. (2022), Supplementary Table 1 | 540–0 Ma |

### Records

| Group | Records |
|---|---|
| Solar System and Earth | the Solar System's oldest solids (4,567.3 Ma); the Moon-forming impact (three competing ages); the oldest zircon (Jack Hills, 4,404 Ma) and the oldest dated rock (Acasta gneiss, ≥ 4,025 Ma) |
| The Earth system | the Great Oxidation Event; the Sturtian and Marinoan glaciations; the Siberian Traps and the Central Atlantic Magmatic Province; the five great mass extinctions, each tied to its cause where its source gives one |
| People | plant domestication in southwest Asia; writing in Mesopotamia; the Industrial Revolution |
| Space | Sputnik 1; the Apollo 11 landing; Voyager 1 crossing the heliopause |
| The future | the end of Earth's oxygen-rich atmosphere (1.08 Gyr from now); the Milky Way–Andromeda merger (competing: about as likely as not in 10 Gyr, against 5.9 Gyr); the Sun leaving the main sequence; the Sun at the tip of the red-giant branch |
| The tree of life | 26 taxa, from cellular life to *Homo sapiens*, among them *Mesosaurus tenuidens*, the taxon the first slice's records wanted; 22 occurrences of their oldest fossils or traces |

Each taxon's place comes from the Open Tree of Life (synthesis 16.1, taxonomy 3.7), its
oldest fossil from a PBDB collection or a paper, and its molecular date from a paper. The
contested 3.7 Ga Isua structures are an occurrence of life only under the alternative
"Earliest evidence of life"; the default picture does not count them.

### Vocabulary

| Kind | Terms |
|---|---|
| Kinds | `event/formation`, `extinction`, `glaciation`, `transition`, `spaceflight`, `astronomical`; `development`; `sample`; `taxon` |
| Methods | `radiometric/pb-pb`, `re-os`, `radiocarbon`; `molecular-clock`; `model`; `documentary` |
| Relations | `descends-from` (inverse `gave-rise-to`): a group arises no earlier than its group; `member-of` now puts a member within its group's lifetime |
| Kind rule | `start: latest`, on `taxon` (see decision 6) |
| Time | `kyr from now` |

## Decisions

1. **Breadth first.** This slice came before the Last Glacial Maximum and Rome.
2. **Blocks, not coastlines.** Before the oldest elevation grid the plate model still says
   where its continental blocks were. That is shown as what it is: present-day shapes, bare,
   with open water between, and no relief or sea level.
3. **The plate model's reach.** The rotation file reaches 1,100 Ma. Before that, and for any
   plate its rotations do not reach, nothing is placed.
4. **Ten thousand years of today.** After the present, today's grid is held for 10 kyr:
   plates move far less than a grid cell in that time. Sea level and ice will change, and no
   scenario for them is modelled yet; the field's record says so.
5. **A symmetric logarithmic time control,** so that billions of years either side of the
   present fit on one strip, with the offset capped so that the present is not crushed.
6. **Showing a date that no claim pins.** Most estimates stay the centre of the evidence.
   Two cases had none worth the name:
   - a taxon whose origin is bounded only by fossils (or by a one-sided claim) is shown at
     the best date of the member or subgroup that limits it, its first appearance. If nothing
     limits it, its origin is unknown and only its bound is shown (Archaea: no earlier than
     3.4 Ga);
   - a moment dated within a long interval and before (or after) a tighter one-sided date is
     shown at that date: Dickinsonia, in the Ediacaran and below an ash bed of 555.3 Ma, at
     555.3 Ma.

   The solver records which claims set each bound, and both rules use that.
7. **Membership constrains time.** A member lies within its group's lifetime, so a fossil
   bounds its taxon's origin; a subgroup arises no earlier than its group. A molecular date
   younger than a group's oldest fossil is therefore a contradiction the validator reports.
8. **Licences decide the datasets.**
   - The best temperature reconstruction, the data assimilation of Judd et al. (2024), has
     no licence on its data, so the build uses the Scotese et al. (2021) curve, published
     under CC BY 4.0 in van der Meer et al. (2022). The two differ by as much as 13 °C.
   - No openly licensed series of atmospheric O₂ was found, so there is none.
   - The PBDB's data service now states CC0. The first slice's 2022 snapshot recorded CC BY
     4.0. Both are credited.
9. **`caused-by` may point to a large igneous province,** so the end-Permian and end-Triassic
   extinctions name their eruptions as causes.
10. **The Sun's series starts at 4.3 Ga.** The formula is less good in the Sun's first
    ~0.2 Gyr on the main sequence (Feulner 2012).
11. **Every new claim is machine-made,** so all 1,310 claims are `proposed` and need review.

## Limitations

- **Claims need review.** The research notes on each source say what was checked. Values
  that could not be fully checked include:
  - the confidence level of several ± values (read as 1σ: Connelly, Wilde, Maurice, Jacobson,
    Schröder & Smith, the end-Triassic dates);
  - the end-Triassic age of 201.564 Ma, taken from Davies et al. (2017) citing Blackburn;
  - the zircon's and the Acasta gneiss's coordinates, which are representative points;
  - the Sun's main-sequence exit, 5.42 Gyr from now, a subtraction of the model's ages;
  - several fossils' membership of the crown group (Sahelanthropus as a hominin,
    Altiatlasius as a primate, Qingshania and Dickinsonia; Haikouichthys and Elkinsia are
    stem members, so vertebrates and seed plants are total groups here);
  - Open Tree's synthesis breaks Archaeplastida (red algae stand in) and Dinosauria (its
    lineage comes from the taxonomy), and has no Hominini.
- **Best estimates under some picks.** Picking certain competing molecular dates (Betts for
  eukaryotes, Kumar for hominins, the crown dates for seed plants and vertebrates) leaves the
  network of centres without a solution, so the best estimates for that pick fall back to
  midpoints. Their bounds are consistent.
- **Before 1,100 Ma** there is no geography at all, and the blocks after it are present-day
  shapes.
- **Temperature reconstructions disagree widely,** and the one shown is among the cooler.
- **Land is coloured as if vegetated** at every time, though there were no land plants before
  the Ordovician.
- **The present of the axis is 1950,** the BP convention; the readout says "Today" there.
- **The track is crowded near the present** at full zoom; zooming in separates the records.
- **Not data yet:** the kind of evidence an occurrence is (body fossil, trace, biosignature)
  and whether a fossil is crown or stem are in notes, not in the vocabulary.

## Next

The first slice's two remain: the Last Glacial Maximum to today, and a sliver of Rome. Before
them, or alongside:

- review the proposed claims, starting with the doubts above;
- ask for a licence on the PhanDA data, and look again for an open O₂ series;
- colour the land by what grew on it, not by elevation alone;
- record evidence type and crown or stem status as data.
