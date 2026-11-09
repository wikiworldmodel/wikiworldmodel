# Eleventh slice: the human landscape

Status: built, with its unit, build and browser tests passing; see *How it was checked*. The plan it comes from is
[HUMAN-LANDSCAPE.md](../HUMAN-LANDSCAPE.md). It takes the people layer, which until now was HYDE's
grid of how many people lived in each 1° cell, and makes it a landscape: at any place on land and any time since 10,000
BCE, what kind of place it was, how people lived there and how sure that is, and in a scene their settlements, houses and
fields, drawn from what is known and marked as generated.

It adds:

- **Anthromes, everywhere and every time.** Anthromes 12K's class of every 5′ cell of land at each of its 73 times, from
  wildlands to rice villages to cities, as tiles the viewer fetches for a place, and a picture of the globe under
  *Settlement* in the toolbar.
- **What the archaeologists say.** ArchaeoGLOBE's assessments of how widespread foraging, pastoralism, shifting and
  continuous farming were in each of 146 regions at ten times, and whether each had cities, with the spread of the
  answers, and the regions drawn into the same grid.
- **Cities through time.** Modelski's and Chandler's lists of cities and their people, as Reba, Reitsma and Seto placed
  them: the evidence for the cities HYDE's grid does not have.
- **A model of how people lived** (`model:people/lifeways`): the anthrome where it names a use of the land, the region's
  archaeologists where it does not, a tier that says which, and where the two disagree.
- **Building traditions as records**, a brief for writing them ([DWELLINGS.md](../DWELLINGS.md)), a first batch by
  region, and `npm run world -- dwellings-wanted` for the next.
- **A settlement generator** (`gen:people/settlement`): settlements, houses of each tradition's form, fields, pastures
  and yards in every scene of the land, seeded by the world's cells so that overlapping scenes agree.
- **A click on land** says how people lived there, from all of the above.

## Running it

As for the other slices (see the [README](../../README.md)). `npm run fetch` downloads Anthromes 12K (47 MB) and
ArchaeoGLOBE's regions (7.5 MB) from Harvard Dataverse; ArchaeoGLOBE's assessments and the lists of cities are snapshots
in [world/snapshots](../../world/snapshots).

- **The globe:** press *Settlement* in the toolbar and move through time: the land takes the legend's colours of its
  anthromes, from 10,000 BCE to 2015. Click any land, with or without it, for how people lived there.
- **A scene:** come down anywhere on land, at any time since 10,000 BCE, as for a living scene. Its bar says how people
  lived there and how many houses it draws; click a house for what it rests on.
- **Try:** Uruk in 3000 BCE (31.3°N, 45.6°E), the Nile delta in 1500 BCE, the Yangtze at Wuhan in 1500 CE, Tikal in
  700 CE, the Mongolian steppe in 1200 CE.
- **For someone writing traditions:** `npm run world -- dwellings-wanted`, and [DWELLINGS.md](../DWELLINGS.md).

## Pass criteria

| Criterion | Where it is checked |
|---|---|
| The tiles say what the dataset's grid says, cell by cell | `tools/world/test/landscape-build.test.ts`: says what the dataset's grid says, cell by cell, at a step |
| Each region is drawn where its outline is | `landscape-build.test.ts`: draws each region where its outline is (twelve cities, each in its region) |
| Eckert IV comes back to latitude and longitude, and an outline fills the grid with its holes | `tools/world/test/landscape.test.ts` |
| The ArchaeoGLOBE snapshot is the file the manifest pins, with every region at every time, read as its tables are spelt | `landscape.test.ts` |
| A city stands between its figures but not across a long silence; two lists' figures for one city are one city | `landscape.test.ts` |
| A 1° cell's people are shared over its 5′ cells to the same total | `landscape.test.ts`, a check of `model:people/lifeways` |
| The lifeway follows the anthrome's use of the land, asks the archaeologists where it names none, and says where they disagree | `landscape.test.ts` |
| HYDE farms nowhere the region's archaeologists found no farming | `landscape-build.test.ts`, a check of `model:people/lifeways` |
| A dwelling, a settlement form and a field system are checked word by word; a member inherits what it does not say; the most particular tradition draws the houses | `landscape.test.ts`; `npm run validate` |
| The generator holds as many people as the world puts in the land it draws | `world/generators/people/settlement/v1.test.ts`, a check of `gen:people/settlement` |
| No house stands in the water or on a cliff | `v1.test.ts` |
| Fields where people farmed, pasture where they herded, neither for foragers | `v1.test.ts` |
| A tradition's house where it holds, the generic one where none does, and whose each part is | `v1.test.ts` |
| A city of the lists where the anthromes have none | `v1.test.ts`; and Uruk in 3000 BCE from a build, in `landscape-build.test.ts` |
| A settlement is in the same place from two scenes that overlap | `v1.test.ts` |
| A town is round, its edge wandering, not a square | `v1.test.ts` |
| The people layer answers in a tier everywhere, now from the human landscape | the build's tests of `resolve`; `coverage.json` |
| *Settlement* paints the anthromes of the time, with a legend of the classes present, and stays in the link | `viewer/test/e2e/landscape.spec.ts` |
| A scene of land has its people, a delta a few metres above the sea among them, as many as HYDE puts there | `landscape.spec.ts` |
| A city of the lists is named in the scene's bar and drawn in its region's houses; the people layer of `resolve` answers in the browser as in the build | `landscape.spec.ts` |
| A click on a house says what it rests on, and what of it is invented | `landscape.spec.ts` |

## What was built

### The data

| Dataset | What | Licence | Kept as |
|---|---|---|---|
| Anthromes 12K (Ellis, Beusen & Klein Goldewijk 2020) | 73 grids of 5′ classes of HYDE 3.2, 10,000 BCE–2015 | CC0 | fetched from Dataverse |
| ArchaeoGLOBE Public Data (2019) | the consensus, least, median and most answers, urban centres, data quality, expertise | CC0 | its eight summary tables joined into one snapshot, `npm run world -- archaeoglobe-snapshot` |
| ArchaeoGLOBE Regions (2019) | the 146 regions' outlines, in Eckert IV | CC0 | fetched from Dataverse |
| Modelski's and Chandler's cities, placed by Reba, Reitsma & Seto (2016) | 154 and 1,597 cities, with their people at the years each list gives | CC BY 4.0 | the two files as figshare serves them, kept byte for byte |

HYDE 3.2.1's own grids of urban people, cropland, rice and irrigation were looked at and not brought in: the anthromes
already carry what a scene needs of them, at 5′. DANS's bot filter refuses a whole-archive download from here, though
range requests work, which is how HYDE's people were brought in before.

### The build

[tools/world/src/build/landscape.ts](../../tools/world/src/build/landscape.ts) reads the 73 grids one at a time, in
about 15 seconds, and keeps each cell's classes through time as runs: 5.7 million runs over 2.2 million cells of land,
2.6 a cell. It turns the regions' shapes back from Eckert IV, fills them into the same 5′ grid by scanlines, and gives a
cell of land outside every outline (a gap of the coast) the nearest region within twelve cells. It writes:

| File | What | Size |
|---|---|---|
| `people/anthromes/<north>_<west>.lwt` | 298 tiles of 10°: each cell's runs and region | 20.1 MB in all, about 67 KB a tile |
| `people/anthromes/globe.lwt` | the same at 0.25°, each cell its nine's commonest class | 3.5 MB |
| `people/assessments.json` | ArchaeoGLOBE's rows, by region and time | 158 KB |
| `people/cities.json` | both lists, each city's figures on the axis | 419 KB |
| `people/traditions.json` | the building traditions, each with what it inherits | 21 KB |
| `people/landscape.json` | the index, the classes, the generator's parameters | 8 KB |

The tiles are cached between builds by the checksums of what they come from.

### The model

[core/landscape.ts](../../core/landscape.ts) holds the model and everything the build and the viewer share: a cell's
class at a step, the region's assessment at the survey's time nearest, the lifeway, a city's people at a time, and a
scene's people put together from all of it. `resolve`'s people layer now answers from it: evidence where a list puts a
city near or the region's archaeologists support the way of life, model where only HYDE does or they disagree, generic
where foragers stand in for nothing known, and HYDE's grid alone beyond the anthromes.

### The traditions

A `tradition/building` record says where (`extent`: the ArchaeoGLOBE regions its sources place it in), when, and as
sourced claims its `dwelling`, `settlement_form` and `field_system`, whose words are in
[core/dwelling.ts](../../core/dwelling.ts) and which the validator checks. A member inherits what it does not say. The
first batch, 36 records, was written by agents working region by region, each reading its sources, keeping their texts
and checking every quote by script. Many lean on encyclopedia articles where the works those cite could not be reached,
and say so; twelve rest on papers alone ([RECORD-SETS.md](../RECORD-SETS.md#building-traditions)).

What the agents could not reach or write:

- **Not written, for want of a source that could be read:** the Iron Age round house of southern Africa (no source read
  gives its plan or roof); a later tradition of West Asia; Europe's medieval peasant house (a lead: Parkin & Adderley 2017,
  on Scottish earth-walled houses); a South Asian village house; Longshan's houses, most of them cave dwellings on the
  Loess Plateau, for which the vocabulary has no word; the Mississippian and Andean houses; the Hawaiian hale, the Māori
  whare, the huts of Aboriginal Australia, New Guinea's highland houses, and Khmer, Javanese and Philippine houses. The
  Plains earth lodge was not attempted.
- **Refused or blocked:** Springer and nature.com (through blocked login hosts), JSTOR, Cambridge, Wiley, Elsevier, De
  Gruyter, Taylor & Francis, UNESCO, archive.org, Google Books, tDAR, the ISAC's free volumes on Mesopotamian houses, the
  Amarna Project, SBL, J-STAGE, ScholarSpace (Bale & Ko 2006, the key work on Mumun houses), harappa.com, HAL, natmus.dk,
  the Archaeology Data Service, Sidestone, the NPS, Crow Canyon, OpenEdition, NZETC, Guampedia and ANU Press. PubMed
  Central was at times behind a captcha, Europe PMC's full text failed for spells, and Wikipedia's API limited the rate,
  so articles were read through their rendered pages at pinned revisions. Eriksen's 2026 chapter on Viking houses is
  embargoed.

### The generator

[world/generators/people/settlement/v1.ts](../../world/generators/people/settlement/v1.ts) lays out a scene's people in
its local metres. Each 5′ cell the scene reaches takes its people from HYDE through its class; its way of life says how
many houses stand together, how much ground each takes and how much of the land around is in fields; a jittered grid over
the whole cell, seeded by the cell and the step, places its settlements on ground above the water and not too steep; and
the tradition of its region and time, or the generic house, sets each house's form. The lists' cities come first, as one
dense cluster each, and no settlement of the anthromes stands inside one. A town or a city fills the lots of a street grid
nearest its middle, so it is round, with an edge that wanders by its seed; a room block keeps its rectangle. Houses past
the most a scene draws stand for more people each, and the plan says how many.

[world/generators/people/dwellings.ts](../../world/generators/people/dwellings.ts) raises a house from its dwelling on
the city's kit: round houses with conical, domed or tented roofs, rectangular and long houses with gabled, hipped, flat or
vaulted roofs, courtyard houses, room blocks, on stilts or platforms or sunk, at three levels of detail, in two new
materials, thatch and mud.

### The viewer

The living scene's stream builds the plan after its ground, keeps no tree where people cleared the land, and draws the
houses as instances alongside its plants and animals; its worker sends a second image of the ground (crops, pasture,
yards, flooded paddies), which the terrain's shader paints as plots shaped by the field system. A scene the living scene
takes for one of the sea, a place whose ground at its middle is under 12 m, has its people too, on the ground above its
water: the Nile's delta and the plain of Uruk are such places. Scenes are keyed by the anthromes' step as well as the
stage, so moving through the last ten thousand years brings new people. The scene's bar names how people lived at its
middle, the lists' cities it holds and how many houses it draws ("Uruk among herders' camps, 6,920 houses"); a click on a
house says which settlements of the scene have its form, what the form rests on, and what is invented. The globe draws the
anthromes in the legend's colours, with a legend of the classes present, named by HYDE's step; a click on land adds a
section on how people lived there to the panel; and the people layer of `resolve` answers in the browser as the build's
does, from the tiles it has fetched.

## Decisions

1. **Anthromes, not HYDE's grids.** The anthromes are HYDE's people and land use already classed at 5′, with published
   rules, under CC0. HYDE's own grids would have needed ten times the data for the same scene.
2. **ArchaeoGLOBE as evidence, beside HYDE, not mixed into it.** The archaeologists answer at the scale of a region; HYDE
   answers at 5′. The model asks them where HYDE says nothing of the use of the land, and otherwise sets the two side by
   side and says where they disagree, rather than correct one by the other.
3. **Regions as a tradition's extent.** Drawing a tradition's outline by hand would be inventing geometry. Naming the
   survey's regions its sources place it in is coarse, but it is what the sources support, and a narrower tradition can
   take over where it holds.
4. **The lists of cities as they are.** Two compilers' figures, often far from later archaeologists', are kept side by
   side: where both give a city, the larger is drawn and the other is shown beside it. A long silence in a list is not a
   city standing through it: Chandler's "St. Louis" has 15,000 people in 1000 CE and 925 in 1800.
5. **Keyed by the world.** The settlements of a 5′ cell are the cell's, at its step, whichever scene draws them; where the
   scene ends decides only whether one is drawn, not where it goes.
6. **The people are the people.** Every scene's houses add up to HYDE's people in the land it covers, the cities'
   besides; a house stands for more people where a scene would hold more than it can draw.
7. **Low land is still land.** The living scene takes a place whose ground is under 12 m for a scene of the sea, which is
   right for a coast and wrong for a delta. Rather than change that generator, the people stand on whatever ground of such
   a scene is above its water: deltas and lower plains are among the most crowded land there was.

## Limitations

- **HYDE's farming falls short of the archaeologists'.** Where they call farming widespread in a region, the anthromes
  farm more than a twentieth of it in only 17 of 49 regions at 2,000 BP and 37 of 82 in 1850 CE; where they found none,
  the anthromes agree everywhere but in two regions at 6,000 BP. A scene draws HYDE's fields, and says where the two
  disagree.
- **A class is a band.** A 5′ cell's people are its 1° cell's shared by the middle of each class's band of density, so
  they can be out by the factor the band spans; only the 1° total holds.
- **Regions are coarse.** ArchaeoGLOBE's regions are made from today's provinces and many are as large as a country; a
  tradition named in a region is drawn over all of it, and a scene near a region's edge can change tradition at the edge.
- **The traditions are few, and lean on encyclopedias.** Most regions and times draw generic houses: `dwellings-wanted`
  lists where, China and India in the last centuries first. 30 of the first batch's 68 sources are encyclopedia articles,
  cited by 74 of its 162 sourced claims, where the works they cite could not be reached from here. Nothing has been
  checked by a person.
- **A city is a cluster of houses.** No streets, walls, temples or districts: a city slice's work, as Rome's was.
- **The ground under a settlement is the scene's.** Two overlapping scenes put a settlement's spot in the same place, but
  each moves it off water and cliffs on its own ground, which may differ a little.
- **A delta is a coast to the living scene.** A place whose ground is under 12 m at the scene's middle is a scene of the
  sea to it ([TENTH-SLICE.md](TENTH-SLICE.md)): its water is the sea's, and it invents no river where the world gives
  none, so a delta's scene may have no branch of its river. Its people stand on its dry ground all the same.
- **Not drawn yet:** paths and roads between settlements, livestock, people, and the seasons of the fields.
- **The rows are not claims yet.** ArchaeoGLOBE's rows and the lists' cities are read as data, not as claims a record could
  correct by an overlay, as the PBDB's and Cliopatria's rows are.

## How it was checked

All of it here, in the session that made it: `npm run typecheck`; `npm test` (480 unit tests); `npm run validate --
--verbose`, with no errors or warnings over 3,277 entities; a full build with all 36 traditions, and its build tests;
and the browser tests of this slice, `viewer/test/e2e/landscape.spec.ts`, in software WebGL, as CI draws them.
BROWSER_GROUPS

It was also looked at, by an agent, in screenshots that `viewer/test/look-landscape.mts` takes: the globe under
*Settlement* in 2000 BCE, 1 CE and 1500 CE, and scenes of the Nile delta in 1500 BCE, of Uruk in 3000 BCE, from afar and
near, and of the Yangtze at Wuhan in 1500 CE. Looking found what the unit tests had not: the delta and Uruk's plain,
places under 12 m, had no people, because the stream gave none to a scene of the sea; the browser's `resolve` did not
ask the human landscape; a city was a square; the bar said nothing of a listed city in its scene; and the legend lay over
the planet's panel. Each is fixed, and the first four have tests. A person has not looked at it.

## Next

See [HUMAN-LANDSCAPE.md](../HUMAN-LANDSCAPE.md): more traditions by agents, region by region, from `dwellings-wanted`;
HYDE's cropland, rice and irrigation at 1° to hold each scene's fields to HYDE's share; paths and roads; livestock and
people; excavated settlements as evidence; ArchaeoGLOBE's rows and the lists' cities as claims.
