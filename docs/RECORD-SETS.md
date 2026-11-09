# The record sets

Status: where each of the [roadmap's](archive/ROADMAP.md) twenty record sets stands, what it added, and what a
reviewer should look at first. All of it was written by machines and is `proposed`: nothing here has
been checked by a person, which is set 20. The three steps that come out of sets 1–3 are in
[SIXTH-SLICE.md](slices/SIXTH-SLICE.md).

| # | Set | Stands | Where |
|---|---|---|---|
| 1 | Biomes through time | done, derived from a climate model rather than from lithologic indicators | `world/fields/earth/{climate,biome}.yaml`, `world/entities/life/transitions/`, `world/entities/life/fossil-forests/` |
| 2 | Life's great transitions | done, bar what is noted | `world/entities/life/transitions/`, `world/entities/life/occurrences/` |
| 3 | Dinosaurs from a PBDB snapshot | the Hell Creek's, not all of them | `world/snapshots/pbdb-hell-creek-2026-11-04.json`, `world/entities/life/hell-creek/` |
| 4 | The ice ages | done, with the ice sheets of the last 80 kyr on the globe | `world/fields/earth/{co2-ice-core,methane-ice-core,antarctic-temperature,sea-level-stack,ice-sheets,ice-sheet-sea-level}.yaml`, `world/entities/earth/ice-ages/`, `world/snapshots/paleomist-1.0-ice-thickness.zip`, `world/alternatives/laurentide-mis3*` |
| 5 | Hominins and their tools | done | `world/entities/life/hominins/`, `world/entities/people/prehistory/` |
| 6 | Dispersals, with ancient DNA | done | `world/entities/people/dispersals/`, `world/alternatives/leaving-africa*`, `world/alternatives/peopling-of-the-americas*` |
| 7 | Megafauna extinctions | done | `world/entities/life/megafauna/`, `world/alternatives/megafauna-causes*` |
| 8 | Domestication worldwide | done | `world/entities/people/domestication/` |
| 9 | Population and land use (HYDE) | where people lived as a 1° grid over the globe, 10,000 BCE to 2015; the world's population, cropland and grazing land as series; no grid of land use | `world/fields/earth/{population,world-population,cropland,grazing-land}.yaml`, `world/snapshots/hyde-3.2.1-*.csv` |
| 10 | States worldwide from Cliopatria | done as rows, not records | `world/fields/earth/polities.yaml` |
| 11 | People and offices | done, for 42 rulers | `world/entities/people/rulers/`, `world/entities/people/polities/` |
| 12 | First cities, writing, languages | done; languages as rows | `world/fields/earth/languages.yaml`, `world/entities/people/first-cities/`, `world/entities/people/writing/` |
| 13 | Routes and trade | done, but for the Silk Road's lines | `world/fields/earth/roman-roads.yaml`, `world/entities/people/trade/` |
| 14 | Objects that move | done | `world/entities/people/objects/` |
| 15 | Disasters | done, as rows | `world/snapshots/noaa-hazards-2026-11-04.json`, `world/fields/earth/hazards.yaml` |
| 16 | Day length and the Moon | done | `world/entities/earth/day-length/`, `world/fields/earth/day-length.yaml` |
| 17 | Biodiversity through time | done for animals, uncorrected | `world/snapshots/pbdb-diversity-2026-11-04.csv`, `world/fields/earth/genera-through-time.yaml` |
| 18 | The present | land borders and cities; coasts remain the elevation field's | `world/fields/earth/present-day.yaml` |
| 19 | Futures | done | `world/entities/earth/futures/`, `world/alternatives/ipcc-ar6-scenarios*`, `world/alternatives/next-supercontinent*` |
| 20 | The first human reviews | **not done, and not a machine's to do** | |

## Rows over the globe

Sets 10, 12, 13, 15 and 18 add a new way of holding what has thousands of members: a field with
`grid: { kind: rows }`, whose rows stay rows of a pinned dataset, thinned for the globe, and are drawn on a
canvas over it (`core/layers.ts`, `tools/world/src/build/layers.ts`, `viewer/src/ui/layers.ts`). They are not
records: they are not searched, not dated by the solver, and a click says what the dataset says of a row.
Their tests are `tools/world/test/layers.test.ts` and `viewer/test/e2e/layers.spec.ts`.

- **States.** All of Cliopatria's rows at the time shown, tinted and outlined, the largest named; Rome's are
  left to its own records. The file is 18 MB (5 MB gzipped), loaded only once a past time is shown.
- **Roads.** Itiner-e's, thinned to about 2 km, from 300 BCE to 300 CE unless a stretch has dates of its own.
  Only about 2.7% of its 299,000 km is marked as certain, and the rest is drawn fainter.
- **Today's map.** From the time axis's present, 1950 (the datum geology dates from), although the lines are
  of about 2020. Its disputed lines are dashed.
- **Hazards.** 9,123 of NOAA's eruptions, earthquakes and tsunamis as rings around their years.
- **Languages.** Glottolog's points, by family, for the present only, behind a toolbar button.

## A grid over the globe

Set 9's people are the one layer that is not rows: a field with `grid: { kind: lonlat }` and `data.as: people`, which the build reads itself
into one binary file, `people.lwt` (`peopleLayer` in `tools/world/src/build/layers.ts`), and the toolbar's **People** button draws
(`PeopleLayer` in `viewer/src/ui/layers.ts`). Its tests are `tools/world/test/people.test.ts`, the people test in
`tools/world/test/build.test.ts` and three in `viewer/test/e2e/layers.spec.ts`.

- **Through the globe's shader, not on a canvas.** The other layers are drawn on canvases over the globe, and a better fit appeared for this one.
  A density is a picture of the surface, not rows at places. On a canvas it would be up to 15,000 quads a frame, each hanging over the
  sea along a coast. As a map texture, the way a polity's territory is drawn, its coasts are the field's and it costs nothing while the
  globe turns. The shader only reads it when the button is on, so the golden images do not move.
- **What goes with it.** It dims the land, so that people show against desert and ice alike. The clouds, which are made up, thin to
  30%, and the states of the world are drawn as outlines only, so that neither hides it.
- **What it says.** The legend says *reconstruction* and *not a count*, and gives the scale. A click on the land gives the cell's people, its density,
  what HYDE gives at the steps on either side, the authors' range at that time, and how the people were placed. Numbers come from the
  snapshot and the field's `params`: the scale and the range are in `world/fields/earth/population.yaml`, not in code.
- **A snapshot, not the archive.** [CONTRIBUTING.md](../CONTRIBUTING.md) says a different file is a different dataset, so this is one:
  `src:hyde-3.2.1-population-grid` has its own id, file and sha256, its title and credit say the cells were added up, and its header lists each
  of the 74 members it came from with its CRC-32 and sha256. It stands in for nothing pinned, and it is what that rule asks for: the rule forbids
  swapping a file under a pinned id, not deriving a new one. Pinning the archive instead was weighed and refused. It is 5.3 GB, four times every other dataset
  together, for grids that are an eighth of it, and `fetch` holds a download in memory and its zip reader refuses Deflate64. What is given up is the
  archive's SHA-1: neither archive was downloaded whole, so only each member's CRC-32 was checked, against the directory at the archive's end. What
  keeps it honest is that `npm run world -- hyde-snapshot` makes the file again from the archive, reading 690 MB by range requests, with its own small
  reader for Deflate64 (`tools/world/src/hyde.ts`, tested against a file 7-Zip made); it was run twice, to the same bytes. A test adds up each step against
  HYDE's own table: within 0.003%.
- **Why 1° and all 73 steps.** The globe's land is a 1° grid, so anything finer would be sharper than the coast it is clipped to, and 0.5° would be 17 MB.
  At 2° it would be 1.8 MB. The yearly steps from 2001 could go, for 1 MB, but keeping them needs no explaining.
- **What it costs.** 5.5 MB in the repository, the largest snapshot by far (2.4 MB gzipped); 4.5 MB in a build of 157 MB (2.8 MB gzipped), loaded only
  when the button is pressed.

## What to look at first

Each set's agent read what it cites, checked its quotes by script and listed its doubts. They are kept here
so that they are not lost with the sessions that raised them.

### The licences to check

- **Itiner-e** (`src:itinere-2024`). Its Zenodo record shows no license field; its About page says CC BY 4.0, and an older page was
  read as saying non-commercial. If that is right, the roads must go.
- **NOAA's hazards** (`src:noaa-hazards-2026-11-04`). Taken as public domain, as the work of a US government agency. Its metadata
  pages could not be reached to confirm it.
- **`CC-BY-3.0`** was added to `publish.licenses` by set 4: see below.
- **PaleoMIST 1.0** (`src:paleomist-1.0`). PANGAEA's page says CC BY 4.0, which is clear, but the archive was read by range requests and
  not whole. Its `calc_sl/` folder is GPL by its readme, and is not used. Its thickness was computed with RTopo-2 and ICEBRIDGE data under
  the ice, whose own licences were not read.

### The alternatives a build shows

What a build shows is a steward's decision (section 4.4 of the design), and no steward has made one. The five groups of sets 6, 7 and
19 and the one of set 4 are shown on a machine's proposal, behind the toolbar's **Alternatives** button: their `show:` lists are what to change. None is
anyone's default. They cost a build about two minutes and 18 MB. No build works out combinations: where two groups are chosen, a
record takes its time from the first of them that moves it.

### Set 1: biomes and fossil forests

- What may grow is gated by the transitions with a `cover` claim, and the rest is Li et al.'s climate read through Peel et al.'s
  thresholds. So a biome is a reading of a climate model, not a record of what grew there. Lithologic indicators (coals, evaporites,
  tillites) were not imported, and they are what would test it.
- **The Hell Creek reads cold.** The climate field has the coldest month below freezing there, where fossil leaves (Wilf et al. 2003)
  give mean annual temperatures of about 12–20 °C. The scene follows the field, and nothing yet sets the two side by side.
- Reefs are left empty from about 372 to 347 Ma and from the end-Permian to the Anisian, with notes; Cambro-Ordovician microbialite
  and Carboniferous episodes were added to the brief's list. Rudists as reef builders are disputed.
- Forests' `end` is a reading of "widespread *Archaeopteris*", and land plants' `end` is indirect. The microbial start of 3220 Ma has no
  uncertainty and is preferred over the 3.48 Ga hot springs editorially.
- Among the 15 fossil forests, Pine Island Bay is roots only though it has `in-situ-forest`; Collinson Ridge is Permian or Triassic;
  the Petrified Forest is `body-fossil`; Rusinga's stage is the PBDB's for the whole island; and seven sites are gazetteer points.
  Strathcona Fiord replaced Axel Heiberg in the list, and Bosques Petrificados replaced Cerro Cuadrado.
- The full texts of Davies 2024 and Berry & Marshall stopped at bot checks, and about 20 works were read as abstracts only.

### Set 2: life's great transitions

- 14 transitions with no `cover`, tied to 37 occurrences by a new relation, `evidenced-by`, which has no meaning in time:
  contested evidence must not bind the solver. A competing `start` names an occurrence as its value where the date is that
  occurrence's.
- Preferred ranks another reviewer might choose differently: eukaryotes, Javaux 2025 (one author, 1.78–1.73 Ga) over Porter's
  ca 1650 Ma; multicellularity, Qingshania over Bangiomorpha; animals, 558 Ma over Charnia at 574 Ma; amniotes, Hylonomus over
  Long 2025's tracks; Pneumodesmus, Wellman 2024 (Homerian) over Suarez 2017 (414 Ma), with a 2025 preprint against Wellman.
- Long 2025's tracks contradict the molecular intervals in `life/taxa/amniota` and `tetrapoda`, so they are placed only in
  `gnathostomata`. Those taxa may want a competing claim.
- Transition ends are readings: no source gives an end for eukaryotes, skeletons, animals on land, tetrapods or flowers.
- Several ± values have no stated level and are read as 1σ, Charnia's among them. Preondactylus, Delitzschala and
  Archaefructus use the PBDB's ages. The Francevillian's frame is the present-day one, as plate 701's polygon starts at 600 Ma.
- Coarse points: McDermott is basin-wide; Zachełmie, Barjarg, Ludford, Fortune Head and Weiach are gazetteer points near the sites.

### Set 3: the Hell Creek

- Sizes that look wrong or rest on little: *Pachycephalosaurus* at 7 m (Holtz) beside 370 kg; *Acheroraptor*'s sizes are *Deinonychus*'s,
  through a blog post by Evans; *Amesoneuron*'s 12 m is *Trachycarpus*'s as a stand-in; the *T. rex* hip of 4 m comes from a news report,
  with 3.66 m preferred; *Torosaurus*'s mass is from a restoration of "*Triceratops* or *Torosaurus*".
- *Triceratops*'s mass runs from 6,420 to 13,536 kg, with 7,400 preferred. Plant heights are the maxima of living species, *Sequoia* at 110 m.
- The agent found that Wilf's ages need about +0.5 Myr, and left them as they stand. Hirayama 2021 is in a Medwin journal.
- *Ginkgo* is drawn with the broadleaf kit, for want of its own.
- Not read: Falkingham 2026, Persons 2020, Sprain 2015 and 2018, Johnson 2002, the supplement of Wilson 2013. Evans 2013 was read as an abstract only.
- Six taxa are left out of the scene, each saying why: *Alphadon*, *Dryophyllum*, *Hydropteris*, *Marmarthia*, *Plesiobaena* and the ferns as a
  group. Birds, fish, amphibians, insects and most lizards have no body plan yet, so the scene is not all that lived there.

### Set 4: the ice ages

- `CC-BY-3.0` was added to `publish.licenses`: it fits "CC BY", but it widens the filter. Without it the
  Antarctic temperature and sea-level series go; CO₂ and methane stay.
- NOAA's own files state no license and name European contributors, so they were not taken as US government
  works. The series read openly licensed copies, compared row by row against NOAA's: the IPCC AR6 table of
  Figure 2.4, and PANGAEA's copies of Jouzel and of Spratt & Lisiecki.
- CO₂ and methane are not pure ice-core series: the last rows are from the IPCC's annex, and they are on two age
  scales that differ by a median of 0.8 kyr and up to 6 kyr.
- LGM dates prefer Clark 2009; LGM and Last Interglacial sea levels prefer the AR6 ranges; b2k ages are
  converted by subtracting 50; maximum counting errors are read as 2σ.
- No `ice_reach` on the LGM: a single latitude would misdraw its sheets, and in the field's span below the field takes its place anyway.
- PANGAEA generates its text files, so a change of metadata there would break their checksums.

**The ice sheets.** `field:earth/ice-sheets` draws PaleoMIST 1.0 (Gowan et al. 2021) on the globe from 80 ka on, and holds today's ice as the
elevation holds today's land. A click on the ice says what the dataset gives there and how far to trust it. `field:earth/ice-sheet-sea-level`
adds it up, beside the sea-level stack in the planet's panel. The tests are `tools/world/test/ice.test.ts`, the group `the ice sheets` in
`tools/world/test/build.test.ts` and `viewer/test/e2e/ice.spec.ts`. What each candidate's license says, as read on 4 November 2026:

| Dataset | Reach | What it says | Here |
|---|---|---|---|
| PaleoMIST 1.0 ([PANGAEA.905800](https://doi.org/10.1594/PANGAEA.905800)) | the world, 80 ka–now, every 2.5 kyr | "Creative Commons Attribution 4.0 International (CC-BY-4.0)" | imported, as a 1.1 MB snapshot |
| NADI-1 (Dalton et al. 2023, [Zenodo 8161764](https://doi.org/10.5281/zenodo.8161764)) | North America, 25–1 ka, every 500 yr, with minimum and maximum | Zenodo's field: CC BY 4.0 | checked against, below |
| DATED-1 (Hughes et al. 2016, [PANGAEA.848117](https://doi.org/10.1594/PANGAEA.848117)) | Eurasia, 40–10 ka, with minimum and maximum | "Creative Commons Attribution 3.0 Unported (CC-BY-3.0)" | checked against, below; PaleoMIST follows it after 40 ka |
| ICE-6G_C, ICE-7G_NA ([Peltier's data page](https://www.atmosp.physics.utoronto.ca/~peltier/data.php)) | the world, to 26 ka on PMIP4's grids, and ICE-6G_C's thickness to 122 ka | No license. Users "are requested to reference" the papers. PMIP4's copy says only "Please cite". | not imported. Its server sends no certificate chain, so it was read through the intermediate its certificate names |
| GLAC-1D (Tarasov et al.) | North America, Greenland and Antarctica, 120 ka–now; the world, to 26 ka, on PMIP4's page | No license. Tarasov's page: "Please cite appropriate references below when using these datasets". PMIP4's: "Please cite all the following papers". | not imported. Tarasov's page refused the connection and was read in the Wayback Machine, as of 22 May 2024 |
| Dalton et al. 2020 ([Ghub 4878](https://theghub.org/resources/4878)) | North America, 18–1 ka | "Licensed under", and then nothing. The page answers 404 now, and was read in the Wayback Machine, as of 14 November 2024 | not imported, and not needed: NADI-1 is its successor, from the same first author |
| Batchelor et al. 2019 ([OSF 7jen3](https://osf.io/7jen3/)) | the Northern Hemisphere, from the Quaternary's start | The article is CC BY 4.0. OSF's API gives its data `node_license: null` | not imported |

A reviewer should look at these first:

- **It starts at 80 ka.** The record of the Last Interglacial ends at 116 ka, so the last glacial cycle's first 36 kyr have no ice on the globe.
  ICE-6G_C, GLAC-1D and Batchelor et al. reach further, and none of them states a license.
- **The default picture draws the maximal scenario.** A judgement. The archive's plain files are the minimal one, and the paper prefers neither.
  The maximal one has ice on Hudson Bay throughout MIS 3, which suits a paper that calls the dates against it "near the limit of their
  reliability", and it is nearer the stack. The other is `alt:laurentide-mis3/hudson-bay-ice-free`, a sixth group behind **Alternatives**. It
  names no claims, so the build solves nothing for it and it costs no time. Its keyframes are kept only from 55 to 37.5 ka: elsewhere the two differ by none to four
  nodes of the margin and at most about 530 m of thickness, so choosing it draws the default there.
- **It disagrees with the stack, and says so.** The signs agree at every keyframe older than 5 ka, where the stack is scaled to 0 m (r over 0.8 for 5–80 ka). From 20 to 5 ka they are within about
  6 m. But the field's lowest is −116 m at 20 ka and the stack's −130 m at 24 ka; 22.5 and 25 ka differ by 16 and 27 m; and from 57 to 29 ka the
  field reads 17 to 54 m higher. At 60 ka they meet. The authors argue the proxies, not the ice, are wrong in MIS 3, and a stack of them is what
  this is being compared with: who is right is not settled here. `build.test.ts` holds both the agreement and the size of the gap.
- **Two sea levels in one table.** The grid's sum gives −115.8 m at 20 ka, within 0.7 m (rms) and at most 1.9 m of the "Calculated ESL" column of
  the paper's Supplementary Tables, and that is the −116 m in its text. The same tables' "SLE" column and the archive's `volume_sorted.txt` say
  106.3 m. The readme's formula on the grid's own volume gives the former. Why the tabulated volumes run 8% lower was not found out, though dividing
  by 0.91 closes most of it, so ice density may have been applied twice.
- **Two scenarios, how far apart.** The paper says their sea levels differ by at most "about 14 m". Its own Supplementary Tables and these grids reach 11 m,
  at 42.5 ka. The click gives the paper's figure and the grids'.
- **No error bars.** The click says so. Set against margins with bounds at 20 ka, south of 72°N and west of 55°W: PaleoMIST has 14.0 million km² of
  ice where NADI-1 has 13.7, between 10.3 and 15.0, with an intersection over union of 0.94, and 92% of the margin's nodes inside NADI-1's band.
  From 25 to 10 ka the intersection over union is 0.83 to 0.94, and that share 87% to 96%. In Eurasia north of 45°N: 5.7 where DATED-1 has 5.7, between
  5.0 and 6.1, with 0.99, but that is little test, as PaleoMIST took its margins from DATED-1. NADI-1 and DATED-1 could give each place bounds of its
  own; they are not drawn. `tools/world/importers/paleomist_check.py` makes these numbers.
- **The edge.** It is the 100 m contour of the 1° grids, chosen by checking against the archive's own margin files at five keyframes (intersection
  over union 0.97–0.99, north of 60°S; Antarctica's margin was not compared). Small ice caps and fjords do not survive. Between keyframes the edge
  moves evenly and the thickness goes in a straight line: 2,500 years is coarse for the deglaciation, and no one reconstructed those years. The
  Younger Dryas and Meltwater Pulse 1A cannot show.
- **What it leaves out.** Grounded ice only, by the name of its variable. No ice in the Alps, the Pyrenees, the Caucasus, the Himalaya, Tibet, the Altai,
  the southern Rockies, the tropical Andes, Tasmania or New Zealand, as checked at 20 ka: a peak stays white by its height alone, which is the
  renderer's, not a record. The paper says it leaves out smaller glaciers and ice caps, which it puts at 3–4 m of sea level.
- **Plates.** Each node moves with its plate, as the land does, from today's coordinates. In 80 kyr that is about 1 km on the big plates, and at most
  about 5 km under any ice, a twentieth of a node: the drawing would look no different without it.
- **Today's look changed.** Inside the field's span white comes from the field alone, and ground the climate holds frozen all year is left bare,
  because that reading would paint up to 3.5 million km² of land beyond the dataset's ice today (0.3 at 20 ka), 2.4 of it on the rim of Antarctica and
  most of the rest in the high Arctic. Some of that ground is icy today, in ice caps too small for the grid and on the land of the Antarctic
  rim, so those look barer than they are. Outside the span the climate's reading is back. No golden image was regenerated: five are the same to the
  pixel, and `today.png` differs in 79 pixels (0.008%, inside its tolerance), at the southern tip of Greenland and in Patagonia, where the ice is now the field's.
- **The rest of the globe does not know about the ice.** The climate field has no ice sheets before its pre-industrial run, so forest runs up to the
  Laurentide's edge. The coast stays at the elevation field's isoline, so Beringia and the shelves are not dry at the LGM even as the ice crosses
  them. PaleoMIST's paleotopography (not imported) would give both a start.

### Set 5: hominins and tools

- Liang Bua's `frame` is the present-day one: plate 679's polygon holds only at 0 Ma, so no plate frame passes there.
- Placement choices: Sima under `homo-neanderthalensis`, by Hublin's definition; Dmanisi under `homo-erectus`, though the
  PBDB says H. georgicus; Little Foot left at `hominini`. The tree is flat: every species hangs on `hominini`, and there
  is no record of the genus Homo.
- Preferred dates to check: about 200 ka for the Schöningen spears (Hutson 2025), over 337–300 and 400 ka; Nyayanga's wide
  range for the Oldowan's start; Blombos at 73 ka over 77 ka; Feldhofer's 44–42 ka is really given for a second individual.
- Weak: Laetoli uses the PBDB's composite point; the Mousterian's start is the Levant's only; several ages rest on
  sources that do not name the dating method, and the notes say so. About half of the 82 publications were read as
  abstracts only, and `verified.how` says which.

### Set 6: dispersals

- For the Americas, Sahul and East Asia the default picture gives only a bound both sides accept, and the
  alternatives carry the dates. So the default's arrival in the Americas shows at about 16 ka beside White
  Sands' older footprints: no contradiction, but odd.
- White Sands' `{ lo: 15.5 ka }` under the post-LGM picture is the agent's own arithmetic from an abstract's
  "at least ~7500 yr younger": the claim nearest to breaking the rule against invented numbers.
- Madjedbebe's figures are second-hand, from O'Connell et al.; Fuyan's dates are of other teeth than the original
  find's; one Arabian record holds Al Wusta and Alathar as competing dates; the Americas' post-LGM date is strictly
  the split of Native American branches.
- **Human remains.** Anzick-1 and Upward Sun River are remains of ancestors of living peoples. Section 4.2 of
  the design mentions handling notes, the schema has no field for them, and a person should decide.

### Set 7: megafauna

- A third alternative, people and climate together, was added beyond the brief, because Barnosky 2004 fits neither
  pure picture. The Americas are two events, north and south, as their sources and causes differ.
- `younger-dryas-cooling` is a thin event taking its dates by reference, because `caused-by` accepts only events.
- Stand-ins for "people arrive": Bacho Kiro in Bulgaria is a weak one for northern Eurasia.
- Weak dates: the moa's rests on a press release; Doedicurus has no calendar date; the calibrated ranges from
  Broughton & Weitzel's supplement state no confidence level; Wrangel's 3700 and about 4000 BP may be the same evidence.

### Set 8: domestication

- Preferred readings to check: the horse follows DOM2 over Botai; the dog starts as "by 15 ka", in eastern Eurasia;
  the chicken follows Peters 2022. Botai, Razboinichya and Nanzhuangtou keep a deprecated `part-of`, so they do not
  bind the date.
- Second-hand evidence: Guilá Naquitz squash and the Coxcatlán beans through Kennett 2023; Dja'de through its
  critics; Jiahu through Hongo 2021; Çayönü through Ottoni 2013.
- Weak domestic markers: Cishan, Donghulin (starch, offered as a hypothesis, and the preferred start for foxtail
  millet), Jiskairumoko, Shangshan.
- Development locations are editorial markers; dog's point is Wikidata's for Siberia.
- The horse's date is tagged `molecular-clock`, the nearest term.

### Set 9: population and land use

- Three series, `field:earth/{world-population,cropland,grazing-land}`, from the rows "Total" of HYDE 3.2.1's baseline tables, kept as
  snapshots with what they were read from. They were read by range requests: the tables' CRCs were checked, the archive's SHA-1 was not.
- Licence: the release's readme says CC BY 3.0, and DANS and DataCite say CC0 for the same files. The stricter is recorded.
- HYDE 3.3 supersedes it, and could not be reached. It follows the UN's 2008 figures, so 2015 reads 2.9% below the UN's of 2024. It
  stops at 2015. So the time axis's present, 1950, reads about 2.53 billion.
- It has no band: the lower and upper scenarios are only to be had from the author. The article's Table 6 says 7,301 million for 2015,
  where the table says 7,257. Its first step is labelled −10000, a year out against the axis, which the numbers cannot tell.
- Grazing land is pasture, rangeland and converted rangeland: HYDE's own table of rangeland leaves out the converted part. The article's
  Table 2 prints 20 for 1850 and 51 for 1920 in its world row, apparently misprints, where its other 15 match; Table 5's FAO row is about 3% above HYDE,
  though the article says it is followed exactly; its abstract has 667 Mha for 1700, where its tables have 664.
- **The grid says less about a place than it seems to.** A cell's number is the share of a province's estimate that HYDE's rules give it: the authors say
  "All allocation in the distant past is performed following general, globally applicable HYDE allocation rules", often from a Eurocentric point of view,
  with today's climate and biomes throughout. The panel says so. Iceland's cell shows how far that goes: 305 people at 1 CE, which looks like the rule
  rather than a finding (no source on Iceland's settlement was read for this).
- **Its range is the authors' and it is for their numbers as a whole.** ±95% at 10,000 BCE to ±1% in 2000, straight between as they do it; it is held at ±1% after 2000,
  which is this viewer's choice. They give none for a single place, and the panel says that too. Their wider range B is not shown.
- **Today's land.** HYDE has nobody on land the sea has since taken, and next to nobody under the ice of 10,000 BCE: 1,949 of 4.43 million in a rough box over northern
  Canada, 50–70°N and 110–60°W, chosen by eye and not from an ice map.
- **The scale is a choice.** A cell under 0.01 people per km² shows as empty, as the Ténéré's does at 1 CE with 59 people, though a click still says 59.
  Density is per km² of HYDE's `maxln_cr` land, as its own grids of density are, so a sliver of coast reads hot: the densest cell in 2015 is Lima's, on 264 km².
  The picture is smooth across cells and the numbers are not, so a click near a bright spot gets the whole cell's.
- **Step names.** The panel names steps as HYDE does, 0 AD and 10,000 BC, because the axis reads them as they stand, a year out before 1 CE, and would call them 1 BCE and 10,001 BCE.

### Set 11: people and offices

- 42 rulers: 27 Roman emperors from Augustus to Constantine (not Lucius Verus or Geta, nor most of the third century), and 15 elsewhere,
  from Djoser to Akbar. A reign is a phase of the person, and `held-office` puts it inside its polity. It stops at Akbar: no modern
  ruler has a record.
- Eleven polities were written for them, from Cliopatria's rows where those fit (`world/entities/people/polities/`): names, with the
  rows' first and last years. Four have no dates of their own (the First Dynasty of Babylon, the Old and New Kingdoms of Egypt,
  Palenque), because the chronologies compete or no row exists; Maurya and Han start with their first ruler's reign.
- Wikipedia is a last resort in four places, each said so: Diocletian's death, Charlemagne's birth, Hammurabi's 43 regnal years, the Long
  Count correlation.
- Worked out rather than stated, with the arithmetic in the notes: Nerva's birth and death, the birth years of Trajan and Titus,
  Macrinus's accession, Elagabalus's death, Pakal's Julian dates, Hammurabi's High, Low and ultra-low starts.
- The upper bound on Macrinus's death is the agent's own allowance. The Historia Augusta's later Lives are weak, and say so.
- A birthplace stands for the whole of a life on the globe, so Claudius sits at Lyon during his reign.
- New Dio and Suetonius source records were added beside the narrower ones, and may want merging.

### Set 12: first cities and writing

- 18 settlements, with `settlement_area` and `population` as claims, and 10 scripts tied to 13 dated finds. Scripts are a child
  kind, `development/script`; proto-cuneiform is part of the existing record of writing in Mesopotamia.
- Population figures preferred only for lack of anything better: Ur, Mohenjo-daro, Memphis and Anyang rest on the Chandler and
  Modelski compilations (Ur's 100,000 looks too high for a city of at least 50 ha). Hattusa's area and population rest on Wikipedia.
- Modelski's file lists Teotihuacan and Tikal in columns BC_900 to BC_600, which look like misplaced AD values: not used, and flagged.
- The Ahiram inscription's date is from a figure caption and a time line, and its dispute is not recorded as a claim.
- Editorial readings: proto-cuneiform's end at 2900 BCE; Mohenjo-daro's dates are the civilization's; the Dipylon jug stands for the
  8th-century Greek group.
- Lineage between scripts (Linear A to B, Phoenician to Greek) is only in notes: no relation type fits yet.

### Set 13: routes and trade

- 14 wrecks from Uluburun to the Mary Rose, under a new child kind, `event/shipwreck`, with `cargo` and `voyage`; and 10 dated records of
  the Silk Road, from Zhang Qian to the Tian Shan corridor.
- Placed elsewhere than they lie: Gelidonya at Kumluca, 20 km north, as the plate's polygon at the wreck exists only at present; Nanhai
  One at its museum; Mazotos, Yassıada and Bom Jesus at nearby places.
- Ranks that are judgements: Kyrenia, radiocarbon over the coin's 294–290 BCE; Belitung, a wide 826–850; the Protectorate, 60 over 59 BCE.
- Second-hand or weak: Uluburun's date through Manning 2009, which was not read; Gelidonya's radiocarbon from a footnote; Mahdia's from
  OxREP alone; the span of Xuanquan from a newspaper. Zhang Qian's first mission rests on a reign period plus 13 years, and 138 and 126 BCE
  come only from Wikipedia. Palmyra is indirect: Gawlikowski says its merchants used the sea route.
- `evidence: inscription` is stretched to ink on wood and paper. No final excavation report was read.
- OxREP's database is cited and not imported, as its copyright page answered 403. Historic England and centuries.co.uk could not be
  reached, and Heidelberg's bot check was not attempted.
- Four new plates (331, 514, 606, 619) have frames and no plate records.

### Set 14: objects that move

- 13 objects, each with a phase for each place it was in, and its marker moves as the slider passes the dates (`moves` on a
  feature, `placeAt` in `core/tileset.ts`). A gap phase, for a voyage or an unrecorded spell, has no place, and the marker stays
  where it was.
- They use a child kind, `artefact/moved`, because `artefact` is a moment and a moment may have no phases.
- Weak dates: the Rosetta Stone's 1479 at the fort is when the fort was finished, on the reasoning that the stone went in with the
  old blocks; the Louvre arrivals of the Code and of Naram-Sin's stele are one-sided; the Okukor's first start is the Benin Bronzes'
  range as a group; the Obelisk of Axum's date is a century, from a news report, UNESCO and Wikidata.
- Nefertiti's wartime moves rest mainly on a campaign site's chronology, with competing claims where sources differ.
- The Parthenon sculptures and the Pergamon Altar moved over years: they have ranges, and the marker jumps at the midpoint.
- Museums' pages (British Museum, UNESCO, New York City Parks, the Met) refused direct access and were read as Wayback copies.

### The first forms

Written by agents, one to each branch of the tree of life, for the [seventh slice](slices/SEVENTH-SLICE.md). All of it is `proposed`, and a form is
a machine's reconstruction unless its claim cites a source. Most forms were drawn from published skeletal figures and silhouettes that an agent looked
at; a few from memory, which their claims say. A reviewer should look at a form's sheet (`npm run world -- form-sheet <taxon>`) next to a skeletal drawing.

- **Sizes are mostly whole-group figures.** A clade's range stands for every member with no size of its own, so one wrong end moves many taxa. Many
  rest on a popular reference: for dinosaurs Holtz's genus list, whose lengths run high for some (*Diplodocus* 30 m, *Allosaurus* 12 m); and for much else Britannica or
  Wikipedia, each saying so. Wikipedia is 41 of the 114 citations for early tetrapods and fish, and many of the upper ends for mammals. PanTHERIA's lengths for mammals leave out tails.
- **What has no size, and so is not drawn or takes a range from far above:** among dinosaurs, *Nyasasaurus*, and *Richardoestesia* and *Paronychodon* take a clade's range. Among mammals, Hyopsodontidae (1,226
  rows), Tillodontia, Apatotheria, Cimolestidae, pangolins, aardvarks and Mesozoic stems. Among plants, *Cooksonia*, liverworts, *Sphenophyllum*, Czekanowskiales, Caytoniales,
  Voltziales and Lycopsida take the node above's. Among insects, Palaeodictyopterida, Grylloblattodea and other stem groups take Insecta's, and giant fossil scorpions have none of their own.
  Tetrapoda and Amniota have no plan on purpose: one would draw every unwritten reptile and mammal as a stem tetrapod.
- **Values to doubt:** Ichthyostegidae's 1.5 m looks far too long for its 4.4 kg. Therocephalia's lower end is an agent's own arithmetic, and says so. The griffinfly's 410 mm is from Guinness. Blattaria's range is of
  forewings. Freshwater mollusc families rest on British species. Walchians borrow living small conifers' heights, peltasperms *Dicroidium*'s 10 m and other seed ferns *Medullosa*'s, and each says it is a stand-in.
- **Spores and pollen:** 4,920 rows of them hang on Plantae, which stands in as a low plant: they say something grew, and little of what.
- **Mass or length, not both:** multituberculates, sparassodonts, hyaenodonts and oxyaenids have mass only, and oreodonts length only. The other follows from the plan's shape.
- **Reptiles and birds:** Squamata has no size on purpose, so that the mosasaurs filed directly under it, not all flagged marine, are not drawn on land; a lizard's size comes
  from the groups within it, and those lengths are snout to vent, as the plan's length is. Pterosaurs have mass only. Proterochampsia, Younginiformes and Protorothyrididae had no size an agent could
  source, and are not drawn. Some sizes rest on Wikipedia. Confuciusornithiformes hang from Avialae and not where the database files them, because Aves here is the crown group, and its dates would squeeze
  theirs: the relation's note says so. The database flags most crocodiles and pterosaurs as marine, so a flag is now refused only for what does not keep to the air, the water's edge or wet ground.
- **Some megafauna repeat their forms.** Eleven records in `world/entities/life/megafauna/` hang directly on Mammalia, so they could not inherit from the clade nodes written since.

What agents found the form language lacks, for the next version of it: a spike that curves; a foreleg with an elbow and a wrist, a human leg and a flat foot (`digitigrade` bends at fixed places); parts that follow the neck, such as a mane;
a row that is not straight; a forking `tuft`, a swollen foot to a stem, a liverwort's thallus; a wing given by its span, and a body that bends sideways; and a depth for what swims, as fish are listed and not drawn.

### The sea's forms

Written by an agent for the [tenth slice](slices/TENTH-SLICE.md), in `world/plans/` and `world/entities/life/taxa/sea/`: fifteen plans and
twenty-five records, which take the share of the sea snapshot's rows that can be drawn from 35% to 63%, and to 62% once a genus the
database puts on land or in fresh water alone is left out of the sea (`npm run world -- forms-wanted --sea`). Every plan was looked at on its sheet; each says it is a machine's reconstruction.

- **Sizes, and where they rest.** Papers read in full from Europe PMC give the trilobites (Sun et al. 2025), the cephalopods' large end (Klug et al. 2025),
  the brachiopods' ends (Lüter et al. 2026; Vermeij 2016), the corals (Zapalski et al. 2025; Coward et al. 2020), the whales (Sun et al. 2019), the
  ichthyosaurs' large end (Pimiento et al. 2024) and the clams' ends (Czekanski-Moir & Rundell 2020; Vermeij 2016). The rest rest on Wikipedia, at a
  pinned revision, each saying which better work it cites and should be replaced by: the smallest ammonoid, bryozoans, sponges, sea urchins, mosasaurs,
  plesiosaurs, eurypterids, sea turtles, rugose corals and the ichthyosaurs' small end.
- **Values to doubt.** Anthozoa's 2 m is what a survey calls a large colony, not the largest: real colonies reach far more, and the note says the
  smaller figure was kept so that a scene's corals stay of a plausible size. Clams' 0.5 mm is a nut clam outside the subclass it stands for. Sea urchins'
  3 cm is the usual smallest, not the least. Sea turtles' range is of living species only. A bryozoan's small end is a single zooid.
- **What has a body and no size, and so is not drawn:** crinoids (10,311 rows) and sea stars (1,072): no smallest size could be sourced.
- **Bodies that stand in for what they do not fit:** endoceratids and multiceratids, which are numbers of the sea's snapshot only, inherit the coiled shell;
  heteromorph ammonoids, octopuses, feather stars, pliosaurs and sand dollars take their group's general body. Gastropods are drawn with the land snail's
  plan and sizes.
- **The land's lists.** Bivalves and sea turtles the database calls marine are now left out on land, as the land atlas intends, so 82 more of the land's
  taxa have no form; freshwater bivalves under Autobranchia with no record of their own take the clam's body, which a scene on land never places, and
  Unionida and Sphaeriidae keep the mussel's.
- **Blocked:** the CC0 body sizes of marine genera (Heim, Payne et al., on Dryad), which would give most genera a size of their own, could not be
  downloaded from here.

What the form language lacked, for the sea: radial symmetry of five or more; a coil (an ammonoid's shell is some sixty rings worked out by hand, so
an involute or a heteromorph is no simple change); a tube whose section is not a whole ellipse, for two valves that meet at an edge or a concavo-convex
shell; a sheet that is not flat; spines at angles other than 45°; and a pose for swimming.

### Set 16: day length and the Moon

- 21 measurements from the Moodies Group (3.22 Ga) to today, 13 with the Earth–Moon distance, as records; the series are read
  from their claims (`data.prop`), so nothing is typed twice.
- Weeli Wolli shows 18.8 h, as Williams argues, but Mitchell & Kirscher exclude both readings and Joffre, 9 Myr older, reads
  16.9 h: the jump in the series comes from this. Big Cottonwood prefers Sonett & Chan's 18.9 h, which Williams doubts. Elatina's
  date is 640 Ma over 620 Ma.
- Unstated ± are read as 1σ, and Mitchell & Kirscher's uncertainty column is not a true σ.
- Meyers & Malinverno's hours are sidereal days. Lucaogou's numbers and the second Elatina claim are Farhat's model values, not
  the studies' own.
- A `{ lo, hi }` plots at its middle, so Moodies draws at 12.7 h where its source's central value is 12.9.
- Several points are representative only; Moodies and Cheshire have none, because plate 701's polygon stops at 600 Ma.
- Wells's corals rest on Williams 2000's summary, the original being unreadable; the studies behind Mitchell & Kirscher's rows
  were not read.

### Set 19: futures

- All the IPCC's amounts sit on one record, `climate-to-2100`, under five alternatives. Warming ranges are the report's very
  likely ones, sea-level ranges its likely ones. SSP3-7.0's sea level comes from Chapter 9, as the Summary omits it.
- `east-african-breakup` rests on a passing statement in a plant-genetics paper, "within 10 million years": it solves to about 5 Myr,
  which means nothing. Consider dropping the default claim.
- `next-glacial-inception` prefers Talento & Ganopolski's "highly unlikely in the next 120 kyr", the only one for emissions already
  made: a judgement call.
- Aurica prefers 250 Myr (Davies, Way) to Duarte's own "approximately 300 Ma". Pangaea Proxima's name and its 225 Myr are second-hand.
- Supercontinents use the moment kind `event/formation`, a slight stretch. `gibraltar-subduction-invasion` was added as the one
  dated start for the Atlantic's closing that does not depend on a scenario.

## Not done

- **Ice sheets before 80 ka.** Of the datasets read that reach further, none states a license (see set 4), and a search found no open one. The cycle's
  first 36 kyr have no ice on the globe, and neither have the cycles before it, which the sea-level stack and the ice cores do reach.
- **Set 9's land use on a grid.** Cropland and grazing land are series only. Their grids are in the same archive (`baseline/asc/<step>_lu/`), and the tool
  and the layer for people would read them the same way. HYDE 3.3 would reach 2023: its hosts (`public.yoda.uu.nl`, `geo.public.data.uu.nl`) answer a script with
  a bot check, and getting past it was not tried.
- **The Silk Road's lines.** It has records and no lines: no dataset of them could be used. Ortelius AT-046 states CC BY 4.0, but it is
  14 legs for about 800–1200, and calls itself illustrative. No license for OWTRAD could be found. Lines on the globe work for
  whatever comes.
- **Set 20.** A review is a person checking a claim. The validator refuses a machine's `accepted`, as it should.
