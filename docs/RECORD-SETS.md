# The record sets

Status: where each of the [roadmap's](ROADMAP.md) twenty record sets stands, what it added, and what a
reviewer should look at first. All of it was written by machines and is `proposed`: nothing here has
been checked by a person, which is set 20. The three steps that come out of sets 1–3 are in
[SIXTH-SLICE.md](SIXTH-SLICE.md).

| # | Set | Stands | Where |
|---|---|---|---|
| 1 | Biomes through time | done, derived from a climate model rather than from lithologic indicators | `world/fields/earth/{climate,biome}.yaml`, `world/entities/life/transitions/`, `world/entities/life/fossil-forests/` |
| 2 | Life's great transitions | done, bar what is noted | `world/entities/life/transitions/`, `world/entities/life/occurrences/` |
| 3 | Dinosaurs from a PBDB snapshot | the Hell Creek's, not all of them | `world/snapshots/pbdb-hell-creek-2026-11-04.json`, `world/entities/life/hell-creek/` |
| 4 | The ice ages | series and records; no ice-sheet grids | `world/fields/earth/{co2-ice-core,methane-ice-core,antarctic-temperature,sea-level-stack}.yaml`, `world/entities/earth/ice-ages/` |
| 5 | Hominins and their tools | done | `world/entities/life/hominins/`, `world/entities/people/prehistory/` |
| 6 | Dispersals, with ancient DNA | done | `world/entities/people/dispersals/`, `world/alternatives/leaving-africa*`, `world/alternatives/peopling-of-the-americas*` |
| 7 | Megafauna extinctions | done | `world/entities/life/megafauna/`, `world/alternatives/megafauna-causes*` |
| 8 | Domestication worldwide | done | `world/entities/people/domestication/` |
| 9 | Population and land use (HYDE) | **part**: the world's population, cropland and grazing land as series; no grid | `world/fields/earth/{world-population,cropland,grazing-land}.yaml`, `world/snapshots/hyde-3.2.1-*.csv` |
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

## What to look at first

Each set's agent read what it cites, checked its quotes by script and listed its doubts. They are kept here
so that they are not lost with the sessions that raised them.

### The licences to check

- **Itiner-e** (`src:itinere-2024`). Its Zenodo record shows no license field; its About page says CC BY 4.0, and an older page was
  read as saying non-commercial. If that is right, the roads must go.
- **NOAA's hazards** (`src:noaa-hazards-2026-11-04`). Taken as public domain, as the work of a US government agency. Its metadata
  pages could not be reached to confirm it.
- **`CC-BY-3.0`** was added to `publish.licenses` by set 4: see below.

### The alternatives a build shows

What a build shows is a steward's decision (section 4.4 of the design), and no steward has made one. The five groups of sets 6, 7 and
19 are shown on a machine's proposal, behind the toolbar's **Alternatives** button: their `show:` lists are what to change. None is
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
- No `ice_reach` on the LGM: the planet's look uses a single latitude for ice, which would misdraw its sheets.
- PANGAEA generates its text files, so a change of metadata there would break their checksums.

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

- **Set 9's grids.** HYDE 3.3's hosts (`public.yoda.uu.nl`, `geo.public.data.uu.nl`) answer a script with a bot
  check, and getting past it was not tried. HYDE 3.2.1's archive on DANS can be fetched, but it is 5.3 GB of Deflate64 zips, which
  the build's zip reader refuses, and the globe has no gridded overlay for it yet.
- **The Silk Road's lines.** It has records and no lines: no dataset of them could be used. Ortelius AT-046 states CC BY 4.0, but it is
  14 legs for about 800–1200, and calls itself illustrative. No license for OWTRAD could be found. Lines on the globe work for
  whatever comes.
- **Set 20.** A review is a person checking a claim. The validator refuses a machine's `accepted`, as it should.
