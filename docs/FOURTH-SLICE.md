# Fourth slice: Rome

Status: built and passing its tests. The first three slices are geology, climate and the
planet's states, measured in millions of years. This one is a small slice of human history,
chosen to test what they did not: time at the scale of years and days, a polity whose
borders change, and evidence that is written down rather than measured. It follows the
Roman state from its legendary founding in 753 BCE to the fall of Constantinople in 1453.

It adds:

- **Dates to the day.** Records can write `15 March 44 BCE` or `March 44 BCE`, in the calendar
  then in use, and the viewer reads them back the same way. The time control zooms from the
  whole span to a window of four years. In the calendar's range it is ticked in years BCE and
  CE, its readout gives the month or the day as you zoom, and links keep the time to a
  thousandth of a year.
- **A polity and its territory.** The Roman state is one record whose phases are its forms of
  government: kingdom, republic, empire, and the empire in the east once the west was gone.
  Its land comes from Cliopatria, an open dataset of the world's polities year by year since
  3400 BCE. A claim names the dataset's rows that are this state, and the viewer draws them
  on the globe for the years they hold. The Western Roman Empire is a polity of its own, part
  of Rome from 395 to 476.
- **Written evidence.** Ancient and medieval texts are sources, each with when it was written
  and what kind of evidence it is: an eyewitness, a historian writing later, or a tradition.
  The founding of Rome has the competing dates the ancient writers reckoned, all marked as
  tradition; the city of Rome has its start from archaeology. The end of the Republic and of
  the west each have competing dates.
- **Names that change.** Byzantium becomes Constantinople and then Istanbul, and its marker is
  labelled by the name in use at the time shown.

## Running it

As for the other slices (see the [README](../README.md)). `npm run fetch` now also downloads
Cliopatria (46 MB). The build reads the rows it needs once and caches them in `.cache/import/`.

## Pass criteria

| Criterion | Where it is checked | Result |
|---|---|---|
| Dates to the day are read and written in the calendar then in use | `tools/world/test/time.test.ts` | 15 March 44 BCE is 73 days into its year; the axis runs on across the Gregorian reform of 1582 without a gap; days a calendar lacks are errors |
| A time is named by the year it falls in | `time.test.ts` | the middle of 3200 BCE is 3200 BCE (it was shown as 3199 BCE before) |
| The territory is the dataset's rows for the state, within its lifetime | `tools/world/test/build.test.ts`, `tools/world/test/territory.test.ts` | six of Cliopatria's names make one state; rows after 1453 are left out; at its height in 117–126 CE, 5.3 million km²; two courts in 420 |
| The territory follows the picks | `territory.test.ts` | a competing claim swaps the rows; a competing end date moves where they stop |
| The viewer draws the territory and opens the state's record from a click | `viewer/test/e2e/viewer.spec.ts`: Rome | "Rome · Empire" in 120 CE; a click says which row is drawn there; nothing before the founding or after 1453 |
| The time control reaches a day | `viewer.spec.ts`: the time control | "15 March 44 BCE" in the readout and in the record of Caesar's assassination; the link keeps it; zooming stops at four years |
| A city is labelled by its name at the time | `viewer.spec.ts`: a city | Byzantium in 300, Constantinople in 400, Istanbul today |
| Opening a historical record fits the time control and finds a polity's land | `viewer.spec.ts`: opening a record | the Western Roman Empire opens on 17 January 395, in a window under 500 years, over its land |
| Earlier renders are unchanged | `golden.spec.ts` | the five earlier images match; today's list of markers gains the cities of Rome and Istanbul, which exist today; one new golden, the Roman Empire in 120 CE |

## What was built

### Time

Records may now write a calendar date or month as a time point: `15 March 44 BCE`,
`March 44 BCE`, or `25 October 1917 CE Julian` to name the calendar.

- **Calendars.** A date is in the calendar then in use: the Julian before 15 October 1582,
  the Gregorian from then on. Earlier Julian dates are proleptic.
- **On the axis.** A day's place is its year plus its count of days into the year over the
  year's length, so whole years stay whole numbers, and 1582 has 355 days.
- **As moments.** A date as a moment means that whole day, as a bare year means that whole
  year.
- **Lags.** They may be written in days.

Showing a time names the calendar unit it falls in. Before, a time was rounded to the nearest
year, so a moment that meant a whole year, held at its middle, was shown as the year after.

In the viewer:

- **Zoom.** The time control zooms to four years. Within 10 kyr of the present its ruler is
  ticked in calendar years, at a step chosen so the ticks fall at least 72 pixels apart.
- **Readout.** It gives the year, the month or the day, by how many years a pixel spans.
- **Links.** They carry times within 10 kyr of the present as a decimal year to a thousandth,
  about nine hours, and deep times in Ma as before.
- **Markers.** An instant stays visible for a dozen pixels of the strip either side; the
  floor of 20 kyr on that is gone.
- **Opening a record.** Opening a record of the last 10 kyr from search or the track fits the
  time control to it when the window shown is far too wide.

### Records

Fourteen records and 34 new sources, all machine-made and proposed:

| Record | Kind | When | Sources |
|---|---|---|---|
| `people/polities/rome`, the Roman state | polity | from the founding to the fall of Constantinople. Its phases: kingdom, to the expulsion of the kings; republic, to Octavian named Augustus (preferred) or the battle of Actium; empire, to the end of the western line; empire in the east | Livy 1.7.3 and 1.60.3; Bury (1893) and Haverfield (1915) for 27 BCE; Cassius Dio 51.1 for Actium; Marcellinus Comes, a. 476; Bury (1923); its territory from Cliopatria and Angold (1975) |
| `people/polities/western-roman-empire` | polity, part of Rome | 17 January 395 to 4 September 476 (preferred) or 9 May 480 | Socrates 6.1; Bury (1923), who has the laws of either emperor hold throughout one empire; Marcellinus Comes |
| `places/rome`, the city | settlement | by the late second millennium BCE, from radiocarbon dates in the Forum Boarium | Brock & Terrenato (2016); Pleiades |
| `places/constantinople` | settlement | 659/658 BCE (Jerome's Chronicle, preferred) or 668/667 BCE (Herodotus 4.144, counted from Jerome's Chalcedon); named Byzantium until 10 May 330, Constantinople from 11 May 330, Istanbul today | Pleiades; Socrates 1.16; the Chronicon Paschale |
| Founding of Rome | political event | 21 April 753 BCE, Varro's reckoning (preferred); 814/813, 752/751, 751/750, 748/747 and 729/728 BCE after Timaeus, Cato, Polybius, Fabius Pictor and Cincius Alimentus. All are tradition | Censorinus 21.6; Plutarch, Romulus 12.1; Dionysius 1.74 |
| Expulsion of the kings | political event | 509 BCE (preferred), 508/507 or 508 BCE; tradition | Livy 1.60; Dionysius 5.1; Polybius 3.22 |
| Assassination of Julius Caesar | political event | 15 March 44 BCE | Cicero, Letters to Atticus 14.14, written six weeks after; Suetonius, Divus Julius 80 |
| Battle of Actium | battle | 2 September 31 BCE | Cassius Dio 51.1 |
| Octavian named Augustus | political event | 16 January 27 BCE (preferred) or 17 January | the Fasti Praenestini, as quoted by Neumann (1896); Censorinus 21.8; Res Gestae 34 |
| Dedication of Constantinople | political event | 11 May 330 | Consularia Constantinopolitana; Chronicon Paschale; Bury (1923) |
| Death of Theodosius I; the empire divided between his sons | political event | 17 January 395, at Milan | Socrates 5.26 and 6.1 |
| Deposition of Romulus Augustulus | political event | 4 September 476, at Ravenna | Fasti Vindobonenses priores; Anonymus Valesianus 8.37–38 |
| Death of Julius Nepos | political event | 9 May 480 (preferred), 22 June or 25 April, at Salona | Fasti Vindobonenses priores; Auctarium Havniense |
| Fall of Constantinople | conquest | 29 May 1453 | the diary of Nicolò Barbaro, who was there, quoted in its Venetian |

Every event has a place, from Pleiades where it has one, on the plate the model puts it on:
Italy (307), or the Black Sea (511) for Constantinople. Ancient texts are quoted from
public-domain translations (Loeb volumes on LacusCurtius, Foster's Livy on Perseus, the NPNF
Socrates) or, where none exists, in the original language with an English paraphrase in the
note. Every quote was checked by script against the downloaded texts, and against page
images where the OCR was poor; Livy 1.7.3 was checked again by hand on Perseus.

### Territory

`territory` is a new property of polities, whose value is a geometry taken from a dataset:

```yaml
territory:
  prop: territory
  value:
    from: src:cliopatria-0.2.1
    names: [Roman Kingdom, Roman Republic, Roman Empire, Eastern Roman Empire, Nicaean Empire, Byzantine Empire]
```

- **Rows.** The build reads the dataset's rows with those names. Their years are inclusive
  and negative for BCE, so a row of −500 to −481 holds from the start of 500 BCE to the end
  of 481 BCE.
- **Format.** Each row's polygons go into `territory.json` in hundredths of a degree, with
  the row's name, years, area and a point for its label.
- **Left out.** Rows that lie wholly outside the polity's lifetime, in every scenario, are
  dropped, and the build says which; Cliopatria has one Byzantine row after 1453.
- **Competing claims.** They are chosen as for any claim, and the viewer shows a row only
  while its polity exists in the scenario shown.

The viewer loads `territory.json` (1.9 MB) behind the first globe:

- **Drawing.** It fills the rows that hold at the time shown into an equirectangular
  texture, one polity per colour channel, and the globe shader tints the land with each and
  outlines its frontiers.
- **Coasts.** Territory is drawn only over the elevation field's land, so the coasts are the
  field's. The dataset's coasts are coarser, its vertices a quarter of a degree apart, so the
  fill is widened by about 0.1° to reach the coast, and a click finds a polity within a
  quarter of a degree.
- **Labels.** Each polity gets a label at its largest row's centre, named for its phase at
  the time: "Rome · Republic".
- **Clicks.** A click inside opens its record, which says which of the dataset's rows is
  drawn there, for which years, and how large it was.

## Decisions

1. **One state, many names.** Cliopatria and Wikidata split Rome into a kingdom, a republic,
   an empire, an eastern and a western empire and a Byzantine empire. Here the Roman state is
   one record, as the design's rule that identity follows the thing (section 4.2) asks, and
   those names are its phases or rows of its territory. The Western Roman Empire is a
   separate polity, part of Rome, because for 81 years it had a court and borders of its own.
2. **The dataset's names are kept.** Where the dataset changes name and where a phase
   changes need not agree. Cliopatria starts its Roman Empire in 31 BCE, the year of Actium,
   while the default end of the Republic here is 27 BCE. The record's phases and the
   dataset's rows are both shown, each for what it is.
3. **The empire of Nicaea is the state in exile,** from the Latin conquest of 1204 to the
   recovery of Constantinople in 1261, after Angold (1975). Cliopatria keeps the name
   Nicaean Empire until 1278.
4. **Legend is marked on the claim.** One work can hold both history and legend; Livy's
   first book is legend. So a founding date is a claim with method `tradition` and basis
   reconstruction, while the source's kind says what the work is as a whole.
5. **Territory is drawn in today's coordinates.** The oldest row is from 750 BCE, and the
   plates have moved a few tens of metres since.
6. **Fitting the time control.** Opening a record of the last 10 kyr fits the window to it
   if it would take under a thirtieth of the strip, and opening a polity flies to its land.
7. **History's moments use the time control's scale.** A moment shows within a dozen pixels
   of the cursor, so it can be found at any zoom. This slice first hid history's moments
   until a dozen pixels spanned under a thousand years, because the strip then gave all of
   history a pixel or two. The time control's scale has since given it room (see
   [`timescale.ts`](../viewer/src/ui/timescale.ts)), so at 120 CE a dozen pixels are about 150
   years, even zoomed right out, and that rule is gone. Lasting things, such as the cities,
   show as before.
8. **A name that ended at an unknown time** is shown up to the present, where today's name
   takes over. No reliable source for when Constantinople became Istanbul in English use
   could be read (the 1930 postal measure usually cited is told in several ways), so that end
   is unknown in the record.
9. **Open ends of a name's validity stay open.** The build wrote them as infinities, which
   JSON turns into null and the viewer then read as year 0, so a name valid from 330 CE "until
   unknown" never matched. Constantinople's are the first names in the world with a
   validity, which is how the fault came to light.

## Limitations

- **Claims need review.** Every new claim is machine-made and proposed. Points to check
  first:
  - Octavian was named Augustus on 16 January in the Fasti Praenestini, read only as quoted
    in Neumann's article (1896); Censorinus 21.8 reads "ante diem XVI kal. Febr.", 17
    January, which is the competing claim;
  - no source dates the deposition of Romulus Augustulus itself: the Fasti Vindobonenses
    date the killing of Paulus at Ravenna to 4 September 476, and the Anonymus has Odoacer
    then depose Augustulus;
  - the city of Rome's start rests on an abstract (Brock & Terrenato 2016); the dates behind
    "late second millennium" were not seen;
  - Byzantion's founding depends on which row of the online table of Jerome's Chronicle the
    entry sits in;
  - LacusCurtius marks its Dionysius, Polybius and Dio as not yet proofread; the Chronicon
    Paschale is cited without a quote;
  - Angold (1975) is cited for the reading its title states; only its catalogue record was
    checked;
  - the leap years of the early Julian calendar were kept irregularly until 8 BCE, so its
    dates in the 40s and 20s BCE may sit a day or two off the proleptic Julian calendar;
    they are kept as written.
- **Source kinds are coarse.** The Res Gestae and the Fasti Praenestini are marked
  `eyewitness`; an official record is a kind of its own, not added yet.
- **One reading of the borders.** Cliopatria encodes no uncertainty and no disputes. Its
  rows are sampled years drawn from hand-coloured maps, and its coasts are coarse.
- **Quirks of the dataset:**
  - a few rows carry a year 0, read here as 1 BCE;
  - its Roman Kingdom and Republic rows overlap from 500 to 481 BCE, and both are drawn;
  - it has a 4,000 km² Byzantine row for 1206–1226 beside the Nicaean rows;
  - it has a Byzantine row that runs to 1467, which the viewer stops at 1453;
  - its Wikidata ids for the Roman Empire and the Eastern Roman Empire are the same.
- **No people yet.** Events have no participants; emperors, their reigns and offices are the
  next slice of this kind.
- **The Roman calendar before 45 BCE is not modelled.** Dates from that time are written in
  years, or as the conventional Julian day of a tradition (21 April 753 BCE).
- **Three polities at most** are drawn at once, one per colour channel.
- **Labels sit at the centre of a polity's largest row,** which for an empire around a sea is
  in the sea.

## Next

- people and offices: emperors as records, their reigns, and succession as constraints on
  the dates;
- every polity in Cliopatria, coarsely, so the globe shows the world's states through the
  last five thousand years;
- the Roman calendar before 45 BCE, as a form of time value that converts with its
  uncertainty;
- a check that the dataset's names change near the phase boundaries they correspond to;
- the city of Rome itself, the first slice's sliver: a site grid, phases with gaps, and
  buildings dated from the evidence.
