# What a complete history needs: an outline of the data still to gather

Status: a working outline, to be kept up to date as data comes in. It lists what World Model
Zero needs to hold a complete history of Earth, life and civilization, at every scale from the
planet to a street, and where that could come from. It is the menu for contributors, human and
machine: pick a row marked *missing* in an area you can research well (see
[AGENTS.md](../AGENTS.md)).

## How to read it

Each domain lists its needs in a table:

| Column | Meaning |
|---|---|
| **Need** | what the world should hold |
| **Here** | ✓ have it · ◐ partly · ○ missing (as of the seventh slice and the [record sets](RECORD-SETS.md)) |
| **Sources** | candidate datasets and works. Datasets named here exist; check their current version. |
| **License** | ✓ CC0, CC BY or public domain, so a build may use it · ✗ share-alike, non-commercial or closed: may be cited, quoted briefly and linked, but not imported · ? not confirmed here, check before importing |
| **As** | **D** a dataset in the manifest with an importer · **R** researched records · **F** a field (gridded or a series) · **G** a generator · **C** a check (evidence a derived value is tested against) |

Three rules hold throughout:

- **Datasets are referenced, not copied** into records (section 12 of the design). A
  10,000-row database becomes a manifest entry, an importer and a field or layer. Records are
  for what someone researched, and for the claims the viewer needs to name and date things.
- **Licenses decide what can be imported.** Many of the best humanities datasets are
  share-alike or non-commercial. Such datasets may still be cited, quoted briefly and linked,
  and their facts can often be found in compatible sources. Ask the maintainers before building
  anything on one; they sometimes grant permission.
- **Identifiers come from the commons:** Wikidata (CC0), Pleiades (CC BY), PeriodO (CC0),
  GeoNames (CC BY), the PBDB (CC BY), Glottolog (CC BY). An id in `same_as` costs little and
  links the world to everything else.

Coverage today: about 1,160 entities and 6,400 claims, from the Hadean to the far future,
densest for Rome. Every claim is machine-made and proposed.

---

## 1. Foundations

What every other domain leans on.

### 1.1 Time

| Need | Here | Sources | License | As |
|---|---|---|---|---|
| The geologic time scale, Phanerozoic | ✓ | ICS chart v2020/03 | ✓ | R |
| The geologic time scale, Precambrian | ✓ | ICS chart | ✓ | R |
| Newer ICS charts as alternatives (v2023/09 and later) | ○ | stratigraphy.org; GTS2020 (Gradstein et al.) | ? | R |
| Boundary uncertainties and GSSPs as records | ○ | ICS chart; GSSP table at stratigraphy.org | ? | R |
| Regional stages (North American land-mammal ages, Chinese stages) | ○ | literature; PBDB interval tables | ✓ PBDB | R |
| Archaeological and historical periods | ○ | PeriodO | ✓ CC0 | D |
| Calendars and eras: Olympiads, regnal years, AUC, Hijri, Chinese reign eras, Maya Long Count | ◐ Julian and Gregorian | standard conversion algorithms; regnal lists as records | — | code + R |
| Radiocarbon calibration curves | ○ | IntCal20, SHCal20, Marine20 | ? | D |
| Orbital solutions (insolation, eccentricity, obliquity) | ○ | Laskar et al. 2004, 2011 | ? | D/F |

### 1.2 Place

| Need | Here | Sources | License | As |
|---|---|---|---|---|
| Present-day gazetteer | ◐ some ids | GeoNames; Wikidata | ✓ | D |
| Ancient places, Mediterranean and Near East | ◐ ids on Rome records | Pleiades | ✓ CC BY | D |
| Historical places worldwide | ○ | World Historical Gazetteer | ? | D |
| Islamic world places | ○ | al-Ṯurayyā | ? | D |
| China | ○ | CHGIS | ? | — |
| Present-day borders, coastlines, rivers, lakes | ◐ land borders and cities, as a layer | Natural Earth | ✓ PD | D |
| Plate assignment of every located record | ✓ | PALEOMAP polygons | ✓ | check |
| More plate models as alternatives | ○ | Merdith et al. 2021 (1 Ga to now); Müller et al. 2019 and 2022 | ✓ CC BY (check each) | D |

### 1.3 Identity

| Need | Here | Sources | License | As |
|---|---|---|---|---|
| Wikidata ids on every record that has one | ◐ | Wikidata | ✓ CC0 | R |
| People of the past as entities, with life dates | ◐ 42 rulers | Wikidata; standard biographies | ✓ CC0 | R |
| A contributor registry (accounts, machine tools) | ○ | — | — | R |

---

## 2. The cosmos and the Solar System

| Need | Here | Sources | License | As |
|---|---|---|---|---|
| Formation of the Solar System: CAIs, chondrules, the giant planets | ◐ milestones | primary literature (Pb–Pb, Al–Mg ages) | — | R |
| The Moon-forming impact, and hypotheses as alternatives | ✓ | literature | — | R |
| Early bombardment, and the Late Heavy Bombardment debate | ○ | literature; lunar sample ages | — | R + alternative |
| The Sun's luminosity, radius and activity through time | ✓ series | stellar evolution models (literature) | — | F |
| The Earth's orbit and spin: day length, obliquity, precession | ◐ day length and the Moon's distance, from 21 measurements; no orbital solutions | Laskar solutions; tidal rhythmites and fossil growth bands for day length | ? | F + C |
| Meteorites and falls | ○ | Meteoritical Bulletin Database | ? | D |
| Impact structures on Earth, with ages and sizes | ◐ Chicxulub | Earth Impact Database; Impact Earth (Osinski et al. 2022) | ? | D/R |
| The Solar System's journey around the galaxy, passing stars | ○ | literature (Gaia-based encounter studies) | — | R |
| Spaceflight: launches, spacecraft, their trajectories | ◐ | GCAT (McDowell); JPL Horizons ephemerides | ? GCAT; ✓ Horizons (US government) | D |
| The far future: the Sun's red giant phase, Andromeda, the end of plate tectonics | ◐ | literature | — | R (projection) |

---

## 3. The solid Earth

| Need | Here | Sources | License | As |
|---|---|---|---|---|
| Plate motions 0–540 Ma | ✓ | PALEOMAP | ✓ | D |
| Plate motions 0.54–1 Ga and before | ◐ blocks to 1,100 Ma from PALEOMAP, and to 1,800 Ma from Cao et al. 2024, each moved with its own model's rotations; not yet each model as the other's alternative where both reach | Cao et al. 2024 (CC BY 4.0, Zenodo 13628813); Merdith et al. 2021; Li et al. 2023 (2000–540 Ma); literature for older cratons | ✓ Cao, Merdith, Li | D |
| Deforming continents (Andes, Himalaya, the Mediterranean) | ○ | Müller et al. 2019 deforming model | ✓ (check) | D |
| Paleogeography (elevation, bathymetry) 0–540 Ma | ✓ | PaleoDEMs (Scotese & Wright 2018) | ✓ | F |
| Paleogeography of the glacial cycles (0–798 ka) | ◐ today's relief at 0.1°, its hollows filled from today's ocean, under the sea level of the stack: the land bridges of each lowstand; not the crust's sinking and rebound under the ice, nor sediment, reefs and faults | ETOPO 2022; Spratt & Lisiecki 2016; Natural Earth's ocean and lakes; GIA models (ICE-6G_C, not licensed as read) | ✓ PD, CC BY | F (model) |
| Paleogeography before 540 Ma | ○ | reconstructions in literature; generated from the plate model where none exists | — | F/G |
| Present-day relief, global | ✓ at 0.1°, from ETOPO 2022's 60″ grid; two 15″ tiles around Rome | ETOPO 2022; GEBCO | ✓ PD; ? GEBCO | F |
| Present-day relief, fine (30 m) | ◐ Rome | SRTM GL1; Copernicus GLO-30; national DEMs (TINITALY…) | ✓ SRTM; ? Copernicus | F |
| Ocean-floor age and spreading | ○ | Seton et al. 2020 age grids | ? | F |
| Geologic map units with ages and lithology | ○ | Macrostrat | ✓ CC BY (check) | D |
| Large igneous provinces with dated phases | ◐ Deccan, Siberia, CAMP | LIP Commission records; literature | — | R |
| Volcanoes and eruptions, Holocene | ◐ NOAA's significant eruptions, as a layer | Smithsonian Global Volcanism Program; NOAA NCEI | ? GVP; ✓ PD NOAA | D |
| Big eruptions in the ice cores (VEI 6+) | ○ | eVolv2k (Toohey & Sigl 2017) | ? | D |
| Earthquakes and tsunamis, historical | ✓ as a layer | NOAA NCEI significant earthquake and tsunami databases (from 2150 BCE) | ✓ PD | D |
| Earthquakes, instrumental | ○ | USGS ComCat | ✓ PD | D |
| Mountain ranges as entities, with their growth | ◐ Himalaya | literature | — | R |
| Ore deposits and their mining | ○ | USGS MRDS; literature | ✓ PD (MRDS) | D/R |

---

## 4. Oceans, atmosphere and climate

| Need | Here | Sources | License | As |
|---|---|---|---|---|
| Sea level, Phanerozoic | ✓ | van der Meer et al. 2022 | ✓ | F |
| Sea level, Cenozoic | ○ | Miller et al. 2020 | ? | F |
| Sea level, last glacial cycle and Holocene | ◐ the last 800 kyr to 5 ka: Spratt & Lisiecki's stack, and the Last Glacial Maximum's and Last Interglacial's levels as claims | Lambeck et al. 2014; regional relative sea-level databases | ? | F + C |
| CO₂, Phanerozoic | ✓ | Foster et al. 2017 | ✓ | F |
| CO₂, Cenozoic | ○ | CenCO2PIP (2023); Rae et al. 2021 | ? | F |
| CO₂ and methane, ice cores (800 kyr) | ✓ series | the IPCC AR6 table of Figure 2.4 (Bereiter et al. 2015; Loulergue et al. 2008) | ✓ CC BY; ? NOAA's own copies state no license | F |
| Global temperature, Phanerozoic | ◐ series | Judd et al. 2024 (PhanDA); Scotese et al. 2021 | ? | F |
| Temperature, last 24 kyr (fields) | ○ | Osman et al. 2021 (LGMR) | ? | F |
| Temperature, Holocene | ○ | Kaufman et al. 2020 (Temp12k) | ? | F |
| Temperature, last 2,000 years | ○ | PAGES 2k | ✓ CC BY | F |
| Temperature, instrumental | ○ | HadCRUT5; Berkeley Earth | ? HadCRUT (Open Government Licence); ✓ Berkeley (CC BY, check) | F |
| Climate fields for past times (precipitation, seasons) | ◐ one model, Cambrian to the pre-industrial, every 10 Myr: Li et al. 2022; and the last 120 kyr every 1–2 kyr at 1°: Beyer et al. 2020 | Li et al. 2022 (CESM); Beyer et al. 2020 and Krapp et al. 2021 (HadCM3 downscaled, 120 kyr and 800 kyr); Pohl et al. 2022; HadCM3 "BRIDGE" runs (Valdes et al.); PMIP4 and CMIP6 | ✓ Li, Beyer, Krapp, Pohl; ? BRIDGE; ✓ CMIP6 (mostly CC BY 4.0) | F |
| Ice sheets, last glacial cycle | ◐ the last 80 kyr, on the globe: PaleoMIST 1.0, with its two scenarios; not the 36 kyr before | PaleoMIST 1.0; NADI-1; DATED-1; ICE-6G_C, ICE-7G_NA; GLAC-1D; Batchelor et al. 2019 | ✓ PaleoMIST, NADI-1, DATED-1; ✗ ICE-6G_C, ICE-7G_NA, GLAC-1D, Batchelor et al. 2019: no license stated, as read (see [RECORD-SETS](RECORD-SETS.md)) | F + C |
| Ice sheets, deep time (Snowball, Karoo, Antarctic onset) | ◐ Snowball glaciations | literature | — | R + F |
| Sea ice | ○ | modern: NSIDC; past: model output | ? | F |
| Biomes and vegetation, past | ◐ derived from the climate field and the transitions, Phanerozoic; no pollen-based maps | BIOME 6000; LandCover6k pollen-based reconstructions | ? | F + C |
| Oxygen in the atmosphere and oceans | ◐ GOE, deoxygenation events | literature (O₂ curves) | — | R + F |
| Climate indicators: coals, evaporites, tillites, reefs, bauxites | ○ | Boucot et al. 2013 compilation; Macrostrat lithologies | ? | C |
| Monsoons and ocean circulation as entities (AMOC, Tethys seaway) | ○ | literature | — | R |
| Weather and clouds over time | ◐ generic clouds | climate fields above, as the cloud generator's constraints | — | G |

---

## 5. Life

| Need | Here | Sources | License | As |
|---|---|---|---|---|
| Tree of life: topology | ◐ 26 clades from cellular organisms to Homo sapiens, the Hell Creek's taxa with their parents from the PBDB, and every taxon that has a form, with a panel; the land's 104,000 taxa as rows | Open Tree of Life synthetic tree; PBDB | ✓ (check) | D |
| Tree of life: divergence times | ◐ | TimeTree; fossil calibrations (Benton et al. 2015) | ? TimeTree | D/R |
| Fossil occurrences with paleo-coordinates | ◐ 26 written, 16 fossil forests, a snapshot of the Hell Creek's 5,277 rows, of the land's 245,000 and of the sea's 1.4 million over the Phanerozoic; the sea's listed by genus with no forms, so none is drawn | Paleobiology Database | ✓ CC0 by the service's notice of November 2026 (earlier CC BY) | D (snapshot) |
| Quaternary fossils and pollen | ○ | Neotoma | ✓ CC BY | D |
| Present-day species occurrences | ○ | GBIF (licensed per dataset: keep CC0 and CC BY) | ◐ | D |
| Species ranges through time | ○ | derived from occurrences (alpha hulls), as the design proposes | — | F (derived) |
| The origin of life and early microbial evidence | ◐ | literature (stromatolites, isotopic evidence); alternatives for contested claims | — | R + alternative |
| Major transitions: eukaryotes, multicellularity, Ediacara, the Cambrian explosion, land plants, flight, amniotes, flowers, grasses | ✓ as records with their evidence: 14 of life's, and the land's covers; reef builders in seven episodes | literature | — | R |
| The five mass extinctions and the smaller ones | ✓ five | literature; PBDB-derived diversity curves | ✓ | R + F |
| Biodiversity through time | ◐ animal genera by stage, uncorrected | PBDB-derived curves; Sepkoski's compendium | ✓ PBDB | F |
| Dinosaurs, mammals and other famous groups, as taxa with ranges and specimens | ◐ the Hell Creek's, with sizes and postures; and a form and a size range for most groups on land, written by agents | PBDB; museum records; literature | ✓ | D + R |
| Museum specimens (the T. rex you can click in Chicago) | ○ | GBIF and iDigBio specimen records; museum open data (Smithsonian, CC0) | ✓ | D + R |
| Megafauna extinctions | ◐ five regions, 13 genera and species, three pictures of the cause among the alternatives | literature; dated last occurrences | — | R |
| Domestication of plants and animals | ◐ worldwide, from the sources of each, as 47 records | literature; archaeobotanical and zooarchaeological databases | ? | R |

---

## 6. Humans before history

| Need | Here | Sources | License | As |
|---|---|---|---|---|
| Hominin species and their fossils, sites and dates | ◐ 14 taxa and 20 dated finds, by hand | ROCEEH Out of Africa Database (ROAD); literature | ? | D/R |
| Stone tool industries and their spread | ◐ eight industries, not their spread | ROAD; literature | ? | R |
| Ancient DNA: individuals, ages, locations, ancestries | ◐ individuals named by the dispersal records; no database | Allen Ancient DNA Resource (AADR) | ? | D |
| Dispersal of Homo sapiens; contact with Neanderthals and Denisovans | ◐ 14 dispersals and 3 admixtures, with whole pictures among the alternatives | literature; aDNA | — | R + alternatives |
| Radiocarbon-dated sites | ○ | p3k14c; XRONOS; regional databases (CARD, etc.) | ? | D |
| The first farming in each centre, and its spread | ◐ | literature; radiocarbon databases | — | R + F |
| Population, 10,000 BCE to now (grid) | ✓ a 1° grid of people to 2015, over the globe, and the world's total as a series | HYDE 3.2.1 (on DANS: its grids read one by one, CC BY 3.0 by its readme); HYDE 3.3 (to 2023, behind a bot check) | ✓ 3.2.1 | F |
| Land use: cropland, pasture, irrigation | ◐ the world's cropland and grazing land as series; no grid, no irrigation | HYDE 3.2.1 (its grids of land use, read as its grids of people are); LandCover6k | ✓ 3.2.1 | F |
| Rock art and early symbolic artefacts | ◐ six artefacts | literature | — | R |

---

## 7. History, region by region

Each region needs the same layers. The table gives the layers once; the list after it, each
region's sources.

| Layer | Here | Sources (worldwide) | License | As |
|---|---|---|---|---|
| Polities and their borders, year by year | ◐ all of Cliopatria's as a layer of rows, and Rome as records | Cliopatria; OpenHistoricalMap | ✓ | D |
| Polities, other compilations | ○ | Seshat (CC BY-NC-SA); CShapes 2.0 (1886–2019); GeaCron and Euratlas (closed) | ✗ / ? | cite only |
| Rulers, offices and reigns | ◐ 42 rulers, 27 of them Roman | Wikidata; regnal lists in standard references | ✓ | R |
| Cities: founding, size, population through time | ◐ Rome, Constantinople, 18 first cities with area and population | Reba, Reitsma & Seto 2016 (6,000 years of urbanization); Chandler, Modelski | ? | D + R |
| Events: battles, treaties, foundations, disasters | ◐ Rome | Wikidata; primary and secondary literature | ✓ | R |
| People | ◐ rulers | Wikidata | ✓ | R |
| Roads and routes | ◐ Roman roads, as a layer | Itiner-e (Roman roads); ORBIS; OpenHistoricalMap | ✓ Itiner-e; ? others | D |
| Objects that moved, and where they were | ◐ 13, from obelisks to the Bust of Nefertiti | museums; literature | — | R |
| Trade and shipwrecks | ◐ 14 wrecks and the Silk Road's dated evidence, as records | Strauss (2013) shipwreck database; OxREP (cited: its terms could not be read); literature | ? | D |
| Languages and their families | ◐ Glottolog's points and families, as a layer for today | Glottolog (locations, families); WALS | ✓ CC BY | D |
| Religions and their spread | ○ | literature | — | R |
| Writing systems, technologies, inventions | ◐ 10 scripts, with their first finds | literature | — | R |
| Economy: GDP, prices, wages | ○ | Maddison Project Database | ✓ CC BY | F |
| Epidemics, famines, climate shocks | ○ | literature | — | R |
| Texts as sources | ◐ Latin and Greek historians | LacusCurtius and Perseus (cite and quote); Open Greek and Latin; papyri.info; national digital libraries | ✓ to quote | sources |
| Inscriptions, coins | ○ | Epigraphic Database Heidelberg (CC BY-SA); EDCS; Nomisma and OCRE | ✗ / ? | sources |
| Historical maps as backdrops for tracing | ○ | Library of Congress (mostly PD); Nolli 1748; David Rumsey (mostly CC BY-NC-SA) | ✓ / ✗ | sources |

**Regions and their particular sources** (each needs a steward and a slice):

- **The Mediterranean and Europe:**
  - Pleiades, the Barrington Atlas and DARE for antiquity;
  - OpenHistoricalMap;
  - the PBDB's Pleistocene;
  - national heritage registers (open in some countries).
- **West Asia and North Africa:**
  - Pleiades;
  - the Cuneiform Digital Library Initiative (check);
  - al-Ṯurayyā for the Islamic world;
  - Egyptian king lists, with their alternative chronologies.
- **Sub-Saharan Africa:**
  - radiocarbon databases;
  - aDNA;
  - literature on Great Zimbabwe, Aksum, the Sahel empires and the Bantu expansion.
- **South Asia:**
  - the Indus sites;
  - Mauryan and Gupta polities from literature;
  - Glottolog for the language map.
- **East Asia:**
  - CHGIS and CBDB (both to check);
  - dynastic chronologies;
  - Japanese and Korean state histories.
- **Southeast Asia and Oceania:**
  - Austronesian expansion (aDNA, radiocarbon);
  - Angkor (lidar studies);
  - Pacific settlement dates.
- **The Americas:**
  - radiocarbon databases (p3k14c, CARD);
  - DINAA (eastern North America);
  - Mesoamerican chronologies with the Long Count;
  - Andean states;
  - contact and colonial records.
- **The Arctic and Antarctica:** settlement (Paleo-Inuit, Norse), exploration.

---

## 8. Places in detail: cities and buildings

| Need | Here | Sources | License | As |
|---|---|---|---|---|
| Rome, 315 CE | ✓ | OpenHistoricalMap; Platner and Ashby; the Regionary Catalogues | ✓ | R + D + G |
| Rome at other times (growth, fires, the medieval city, Nolli's 1748) | ○ | Lanciani's Forma Urbis Romae; Nolli; OHM | ✓ PD | R + G |
| A second ancient city (Ostia, Constantinople, Athens, Alexandria) | ○ | OHM; excavation reports; Pleiades | ✓ | slice |
| Cities of other cultures (Chang'an, Tenochtitlan, Teotihuacan, Angkor, Babylon, Mohenjo-daro) | ○ | literature; lidar and excavation plans | — | slices |
| Ground levels and ancient topography | ◐ around the Forum | geoarchaeological studies; Lanciani | — | R + F |
| Building typologies for each culture and era (houses, temples, markets) | ◐ Roman insula, domus | architectural histories | — | G |
| 3D models of surviving monuments | ○ | Smithsonian 3D (CC0); Sketchfab (per model: keep CC0 and CC BY); Europeana (mixed) | ◐ | assets |
| Interiors (the Pantheon, the Hagia Sophia) | ○ | surveys; literature | — | assets + R |
| Population and density of a city, by district | ◐ Rome's regions | Regionary Catalogues; census records | ✓ | R |

---

## 9. The present

| Need | Here | Sources | License | As |
|---|---|---|---|---|
| Today's land cover | ○ | ESA WorldCover | ✓ CC BY | F |
| Today's built-up areas and population | ○ | GHSL; WorldPop | ✓ CC BY | F |
| Night lights | ○ | VIIRS (Earth Observation Group) | ? | F |
| Satellite imagery for the globe's surface | ○ | Sentinel-2 cloudless (2016 release is CC BY; later releases are not) | ◐ | F |
| Countries, cities, infrastructure | ◐ land borders and the larger cities | Natural Earth (PD); Overture Maps (mixed); OpenStreetMap (ODbL: not importable) | ◐ | D |
| Development indicators | ○ | World Bank (CC BY); UN World Population Prospects (CC BY 3.0 IGO); Our World in Data (CC BY) | ✓ | F |
| Climate, reanalysis | ○ | ERA5 (Copernicus licence) | ? | F |

---

## 10. The future

| Need | Here | Sources | License | As |
|---|---|---|---|---|
| Emissions scenarios as alternatives (SSP1-2.6 … SSP5-8.5) | ◐ among the alternatives | IPCC AR6 WGI data; IIASA SSP database | ✓ AR6 (CC BY); ? SSP | alternatives + F |
| Sea level and temperature projections to 2100 and 2300 | ◐ AR6's ranges for 2100, as claims | IPCC AR6 projections | ✓ CC BY | F (projection) |
| Population projections | ○ | UN World Population Prospects | ✓ | F (projection) |
| Plate motions forward (Pangaea Proxima, Amasia, Aurica) | ◐ as alternatives, with no plates moved | literature, as alternatives | — | alternatives + F |
| The far future of the Earth and the Sun | ◐ | literature | — | R (projection) |
| Spacecraft beyond tracking (Voyager, Pioneer) | ○ | JPL Horizons; literature | ✓ | D (projection) |

---

## 11. Generators still to write

| Generator | Constraints it should follow | Here |
|---|---|---|
| Clouds that follow the climate of their time | temperature, CO₂, land and sea fields | ◐ one generic layer |
| Surface paint: biomes, deserts, ice, vegetation | biome reconstructions, climate fields | ◐ planet states |
| Fields and farms around settlements | population, land use (HYDE), soils | ○ |
| Cities of other cultures and eras | typologies, density from records | ◐ Rome |
| Roads and paths where no map exists | settlements, terrain | ○ |
| Ships, carts, crowds | routes, population | ◐ crowds |
| Night lights | population, buildings | ○ |
| Fossil landscapes (forests of the Carboniferous, reefs) | biome and climate fields, occurrences | ○ |

---

## 12. Checks still to write

Evidence that tests a derived value, kept out of the derivation it tests (section 9.2 of the
design):

- **Climate against lithology.** Coals are wet, evaporites arid, tillites glacial: none should
  fall in a desert or a tropical sea.
- **Biomes against fossils.** A forest fossil should not fall in a reconstructed desert.
- **Shorelines against sea level.** Ostia was on the shore; ancient harbours were at the
  water's edge. Written for the land bridges of the Last Glacial Maximum, in `build.test.ts`: Beringia,
  Doggerland, the Sunda Shelf and the Torres Strait are dry at the lowstand and sea today, and the
  stack's lowstand lies within the range the world's claims give it.
- **Ice volume against sea level.** Their budgets must agree. Written for the last 80 kyr, in `build.test.ts`: they agree in sign and from 20 to 5 ka,
  and differ by tens of metres in MIS 3, which [RECORD-SETS](RECORD-SETS.md) states.
- **City populations against regional population.** A city should not hold more people than
  its region.
- **Day length against fossil growth bands.** Corals record the days in a year.

---

## 13. Where to start

Twenty tasks that are bounded, sourced and checkable, roughly in order of value:

1. Wikidata and Pleiades ids for every record that lacks them.
2. Sources for the 112 unsourced claims, or confirmation that none exist.
3. PeriodO periods for the Mediterranean and West Asia, as period entities.
4. The other Phanerozoic large igneous provinces, with their dated main phases.
5. The smaller extinction events (end-Ediacaran, end-Capitanian, Toarcian, PETM…).
6. A Cenozoic CO₂ series (CenCO2PIP) and an 800 kyr ice-core series.
7. The Judd et al. 2024 temperature series, beside the existing one, as a competing reading.
8. The Merdith et al. 2021 plate model as an alternative frame set, 1 Ga to now.
9. A PBDB snapshot for one famous group (dinosaurs, or the Cambrian fauna), with an importer.
10. Hominin species and their key fossil sites.
11. The first farming centres, with radiocarbon dates.
12. HYDE's cropland and grazing land as grids, as its people already are.
13. Cliopatria's other polities, beyond Rome.
14. Emperors and kings of a few states, from standard regnal lists.
15. Glottolog's language families as a layer.
16. IPCC AR6 scenarios as alternatives, with sea level and temperature to 2100.
17. A second city slice: Ostia, or Constantinople in 550.
18. Natural Earth for present-day borders and coastlines.
19. Historical earthquakes and tsunamis from NOAA's databases.
20. Holocene volcanic eruptions as events.
