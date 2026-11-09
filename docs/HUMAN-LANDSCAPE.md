# The human landscape: zoom in anywhere and see how people lived there

Status: the plan and what is built of it, November 2026. The [eleventh slice](slices/ELEVENTH-SLICE.md) builds its first
steps. It does for people what [LIVING-WORLD.md](LIVING-WORLD.md) does for life: at any place on land and any time since
10,000 BCE, the settlements, houses and fields of the people who lived there, drawn from what is known and honest about
which is which. It is the anonymous landscape, the villages and farmsteads nobody wrote about one by one. Named places,
Rome's monuments and the first cities, stay records of their own, and a city slice draws a city's fabric as Rome's is.

## The idea

**A settlement is a function, not a file.** As a living scene is, the people of a scene are made in the browser from a
few small, sourced inputs, and nothing they make is stored:

```text
HYDE 3.2 (people, land use)  →  Anthromes 12K: every 5′ cell's class, 73 times        the lists of cities (Chandler, Modelski)
ArchaeoGLOBE: 146 regions × 10 times, how each way of life was spread                  building traditions: records, by region and time
            ↓ the build: tiles of 5′ cells, the regions drawn into them, the assessments, the cities, the traditions
model:people/lifeways: at a place and time, how people lived, how many, and how sure that is
            ↓ a few tiles and lists, in the browser
gen:people/settlement: settlements, houses of a tradition's form, fields, pastures, yards
            ↓
drawn in the living scene, on its ground, around its rivers, its trees cleared where the fields are
```

Four questions, each with one answer that scales.

## 1. Were there people here, and how many?

HYDE 3.2.1 is the only reconstruction of where people lived, year by year, over the whole Earth since 10,000 BCE. The
world reads it twice:

- **Its people**, added up to 1° cells (`field:earth/population`), for how many.
- **Its anthromes** (`field:people/anthromes`): Anthromes 12K classes each 5′ cell of HYDE 3.2 into urban, villages of
  rice, irrigation, rainfed crops or herds, croplands, rangelands, woodlands and treeless lands with few people, and
  wildlands with none, by thresholds on its people and the share of its land in each use. Its classes are bands of
  density: a village needs at least 100 people to the km², residential land 10, populated land 1.

A scene's 5′ cells take their 1° cell's people in proportion to their class's band, so a scene's houses add up to HYDE's
people. A class is a reading of HYDE's model, not a map anyone drew, and HYDE's own range is 75% either way at 1 CE.

**Cities** come from two lists of cities with their people through time, Modelski's for the ancient world and
Chandler's to 1975, as Reba, Reitsma and Seto placed them on the map (`field:people/cities-ancient`, `field:people/cities`).
They are evidence of a kind HYDE's grid does not have: at 5′ HYDE has no Uruk in 3000 BCE, Tikal in 700 CE or Cahokia in
1100, and the lists do.

## 2. How did they live?

The anthrome says what at least a fifth of a cell's land was used for, where it was. Where it says nothing (people in
woodland or open country, too few or too scattered to use a fifth of it), **the archaeologists say**: ArchaeoGLOBE asked
255 archaeologists how widespread foraging, pastoralism, shifting and continuous farming were in each of 146 regions at
ten times, and whether there were cities (`field:people/land-use-assessment`). The most widespread of them is the way of
life drawn (`model:people/lifeways`):

| Pattern | Where |
|---|---|
| A city, towns | urban and dense cells, and the lists' cities |
| Villages | village classes: rice, irrigated, rainfed or pastoral |
| Hamlets, farmsteads | residential and populated croplands; woodland where farming is the region's way of life |
| Shifting cultivators | woodland where shifting cultivation is |
| Herders' camps | rangelands, and open country where herding is |
| Foragers' camps | remote land where foraging is, or where nothing more is known |
| No one | wildlands |

Each answer says how sure it is, in the tiers every layer answers in:

| Tier | What it means | What a click says |
|---|---|---|
| **Evidence** | a list of cities puts a city here, or the region's archaeologists say this way of life was there then | which list, or what the archaeologists said |
| **Model** | only HYDE says it, or the archaeologists disagree | where they disagree |
| **Generic** | HYDE has people and nothing says how they lived: foragers stand in | that it is a stand-in |
| **Unknown** | no land, or before the anthromes' first step | nothing is drawn |

The two readings disagree, and the world says so rather than choose. Where the archaeologists found no farming, HYDE's
anthromes almost never farm; but where they call farming widespread, the anthromes farm a twentieth of the region or
more in only about a third to a half of those regions. Every build counts it again (`coverage.json`, `landscape`).

## 3. What were the houses like?

**Every house has a form, and the regions' traditions fill every gap.** A building tradition is a record
(`tradition/building`): where it was (`extent`, the ArchaeoGLOBE regions its sources place it in), when (`start`, `end`),
and as sourced claims, its dwelling (plan, size, walls, roof, floor), how its houses stood together, how many lived in
each, and its fields. A narrower tradition is a member of a broader one and says only what differs. At a place and time
the most particular tradition that holds there draws the houses; where none does, a generic house for the way of life and
the climate stands in, and says so. Agents write them, region by region; [DWELLINGS.md](DWELLINGS.md) is the brief.

## 4. How is it drawn?

- **In the living scene.** The settlement generator runs in the scene's worker, after its ground and before its trees:
  where people cleared fields, pastures and yards, no tree stands.
- **Keyed by the world.** Settlements are seeded by the world's 5′ cells and the anthromes' step, so two scenes that
  overlap put them in the same places.
- **Houses as instances**, one mesh for each dwelling and detail, as the bodies of the living scene are, ranked so that
  a far view draws the top of the list a near view draws in full, and within the frame's budget.
- **Fields painted on the ground**: the generator gives where they are; the shader draws their plots by the tradition's
  field system (strips, blocks, paddies flooded within their banks, swidden plots).
- **On the globe**, the anthromes' classes in the legend's colours, under *Settlement* in the toolbar; and a click on
  land says how people lived there, from all of the above.

## What it will not do

- A house, a village, a field: none of them was there. Only their numbers, their way of life and their type rest on
  anything, and a click says which.
- HYDE's people within a country rest on its allocation rules, and its anthromes on thresholds: a cell near one is a coin
  toss. Before 1500 CE its numbers are rough, and its farming falls well short of the archaeologists'.
- ArchaeoGLOBE's regions are made from today's provinces and are as large as a country; a tradition named in a region is
  drawn over all of it.
- The lists of cities lean to the cities historians wrote about, and their figures differ from later archaeologists' by a
  factor of two or more. A city is a dense cluster of houses, with no streets, walls or temples of its own.
- Paths, roads, boundaries, livestock and people are not drawn yet.

## The order

1. **The substrate:** the anthromes, the assessments, the lifeway at any place and time, on the globe and in the panel.
   *Built.*
2. **Settlements in scenes:** houses, fields and pastures from the lifeway and HYDE's people, cities from the lists.
   *Built.*
3. **Traditions as records**, with a brief, and a first batch by region. *A first batch is written.*
4. **More traditions,** by agents, from `npm run world -- dwellings-wanted`, until every region and era that HYDE peoples
   has one.
5. **HYDE's land use as grids:** cropland, rice and irrigation at 1°, to hold each scene's fields to HYDE's share of
   cropland, not only to the class's.
6. **Paths and roads** between settlements, the Roman roads where Itiner-e has them; **livestock** in the pastures;
   **people** in the villages.
7. **Sites as evidence:** dated, excavated settlements as records, so that a scene near one draws it there.
