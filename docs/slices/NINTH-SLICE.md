# Ninth slice: the faint Sun and the ice

Before the Cambrian the climate layer had nothing to answer with: no climate model's run reaches past 540 Ma, so the
planet's state stood in for it. Yet the deep past is where the climate's great questions are. The Sun was a quarter
dimmer when the oceans formed, and still the rocks record liquid water; and twice in the Proterozoic the ice reached the
equator. The third slice asked for "a simple energy-balance model, driven by the Sun and CO₂ series, as a check on when
the rocks say the Earth froze". This slice is that model: it runs on the world's own series of the Sun and of CO₂, and is
held to evidence it does not read.

- **An energy-balance model** (`model:earth/energy-balance`, [core/ebm.ts](../../core/ebm.ts)): the one-dimensional model
  of Budyko and Sellers as Rose's open textbook *The Climate Laboratory* writes it, with every parameter the book gives:
  ninety bands of latitude, each absorbing the year's sunlight less what its albedo reflects, giving off A + B·T, passing
  heat to its neighbours, and turning to ice below −10 °C.
- **The CO₂ at which the Earth freezes over and thaws** (`field:earth/snowball-co2`, `field:earth/thaw-co2`): under the Sun
  of every 10 Myr from 4.3 Ga to today. The ice-albedo feedback makes them far apart: a frozen Earth needs far more to thaw
  than an unfrozen one needs to stay so.
- **The CO₂ of the Archean air, as records** (`earth/samples/*-paleosol`, `field:earth/co2-paleosols`): four soils that
  weathered under rain between 2.77 and 2.46 Ga, each with the range of CO₂ its weathering gives, from Catling and
  Zahnle's review; and the CO₂ at the end of the Marinoan Snowball, from Hoffman et al. A new property, `co2_pressure`.
- **The model against the evidence** (coverage.json's `energyBalance`): the soils, the three glaciations that reached the
  equator, today's climate, and the temperature the rocks give for the last 420 million years
  (`field:earth/temperature-energy-balance`), with what agrees and what does not.
- **The climate layer answers before the Cambrian**: as the model, saying what CO₂ the Earth of the time needed to stay
  unfrozen.

## Running it

As for the other slices (see the [README](../../README.md)); nothing new is fetched. In the planet panel, from 4.3 Ga to
today, two rows give the CO₂ the model freezes below and thaws above, and from 2.77 to 2.46 Ga a row gives the soils' CO₂
beside them. A click on the globe before the Cambrian says the climate is the model's. The build logs each check:

```text
climate  energy balance at earth/samples/mt-roe-paleosol (2770 Ma, 0.03–0.15 bar): freezes below 0.01311 bar; 0 of 16 runs frozen
climate  energy balance for earth/events/marinoan-glaciation: freezes below 0.00007803 bar at its start, thaws above 4.924 bar at its end; the rocks give 0.028 bar
```

## Pass criteria

| # | Criterion | Test |
| --- | --- | --- |
| 1 | The model gives what the book's runs print, with the book's parameters read from the field the build uses: the ice edge at 70° among the edges that balance today, at 54° under 1300 W m⁻², a Snowball at 1200; a frozen Earth about −33 °C at the equator that thaws only between 1830 and 1840 W m⁻², to about 58 °C; all the ice gone when CO₂ doubles. Its sunlight is linear-checked too: the book's run without ice, D = 1, gives an equator-to-pole difference the model matches to 0.001 °C. | `core/ebm.test.ts` |
| 2 | The CO₂ to stay unfrozen falls as the Sun brightens, a thaw always asks far more, and a thaw that would need more than the model's limit has no value. | `core/ebm.test.ts`, `tools/world/test/energybalance.test.ts` |
| 3 | Today's climate, at today's Sun and the pre-industrial CO₂, lies within the band the temperature series gives for the present. | `energybalance.test.ts` |
| 4 | The Mt. Roe, Bird and Pronto paleosols, which weathered under rain, leave the model's Earth unfrozen at their CO₂. | `energybalance.test.ts` |
| 5 | What the model's record says it disagrees with is what the build finds: the Alpine Lake paleosol, the Marinoan's thaw, the Phanerozoic's warmth. | `energybalance.test.ts` |
| 6 | Each Snowball's start is asked its CO₂, and the oldest far more than the Cryogenian ones. | `energybalance.test.ts` |
| 7 | The climate layer answers model, not a stand-in, before the Cambrian; a climate run still answers first where one covers the time. | `core/resolve.test.ts`, `energybalance.test.ts` |
| 8 | Every quote of the new records is found, by script, in the text it was read in. | `npm run world -- quote-check` (the claims' `quoted` steps) |

## What was built

### The model

[core/ebm.ts](../../core/ebm.ts) solves the steady state of each band's balance: implicit in the outgoing radiation and the
diffusion, explicit in the albedo, step by step from where it starts until nothing moves. A warm start (the book's own,
12 − 40 P₂(sin φ) °C) finds the warm climate, a frozen one the Snowball, as the book's runs do; the thresholds are bisected
in the logarithm of CO₂ between a pressure that leaves the Earth frozen and one that does not. The year's sunlight at each
latitude is the daily mean from the Sun's declination and the hour of sunset, averaged over the year, for the orbit the book
gives (Berger's formulas, as climlab computes them). CO₂ lowers A by 4 W m⁻² a doubling, the book's figure, from Feulner's
pre-industrial 0.00028 bar. Every number is a parameter of `field:earth/snowball-co2`, and the model's record says where
each comes from; only the numerics are the code's.

### The thresholds

[build/energybalance.ts](../../tools/world/src/build/energybalance.ts) runs the model under the Sun of every 10 Myr, as
`field:sun/luminosity` gives it (Gough's fit), and writes two series in bar. To stay unfrozen the Earth needed about 0.2
bar of CO₂ at 4.3 Ga, 0.1 bar at 3.8 Ga, 0.01 bar at 2.7 Ga, 100 ppm in the Cryogenian and about 11 ppm today. Feulner's
review gives, for radiative-convective models at the early Archean's Sun, 0.06 bar for a mean of 0 °C and 0.3 bar for
today's: the same order as this model's threshold. To thaw a Snowball it needed about 5 bar in the Cryogenian and 1.4 bar
today; before about 1 Ga more than the model's limit of 10 bar.

### The evidence

The four paleosols are records (`kind: sample`, `evidence: paleosol`) with their date and their range of CO₂, as Table 1 of
Catling and Zahnle (2020) gives them; the Marinoan glaciation has its CO₂ at its end, 10² PAL in Hoffman et al. (2017),
converted at Feulner's pre-industrial level. The model runs on each sample as sixteen members across its range.

| Evidence | CO₂ (bar) | The model |
| --- | --- | --- |
| Mt. Roe paleosol, 2.77 Ga | 0.03–0.15 | freezes below 0.013: unfrozen in all 16 runs |
| Bird paleosol, 2.75 Ga | 0.02–0.75 | freezes below 0.013: unfrozen in all 16 runs |
| Alpine Lake paleosol, 2.69 Ga | 0.003–0.015 | freezes below 0.011: **frozen in 12 of 16 runs** |
| Pronto paleosol, 2.46 Ga | 0.05–0.15 | freezes below 0.0068: unfrozen in all 16 runs |
| Makganyene glaciation, from 2.44 Ga | — | to start, CO₂ below 0.0066 bar: less than a seventh of the least the Pronto soil gives, just before |
| Sturtian glaciation, from 717 Ma | — | to start, below 96 ppm |
| Marinoan glaciation, to 635 Ma | 0.028 at its end | to end, above 4.9 bar: **far more than the rocks record** |
| Today | — | 14.0 °C, within the series' 13.8–15.2 °C; the ice edge at 68° |
| The last 420 Myr, against `field:earth/surface-temperature` | — | **about 5 °C colder on average**, r = 0.50 |

## Decisions

- **The textbook's model, whole.** A model needs parameters with sources, and a textbook that prints its parameters and
  its runs gives both the numbers and the results to hold the code to. The book is CC BY 4.0, read from its source
  repository. The tests reproduce its printed runs, and say where a run lands on another of the balances a stepped ice
  line allows.
- **Thresholds, not a climate made up between the evidence.** Before 420 Ma the CO₂ is known at a handful of dates, and
  nothing fixes it between them. The model says what CO₂ each time needed, which rests only on the Sun and the model; the
  evidence is set beside it, and the climate is computed only where the evidence is.
- **The book's rule for CO₂, with its limit said.** A published fit valid to tens of bar (Haqq-Misra et al. 2016) gives its
  coefficients only in supplementary tables that could not be reached. The book's 4 W m⁻² a doubling is used for every
  doubling, the tests and the record say so, and thresholds are not sought beyond 10 bar.
- **Disagreement is written down.** The model's record lists the Alpine Lake soil, the Marinoan's thaw and the Phanerozoic
  as evidence it contradicts, and a build test holds the record to what the build finds, both ways.
- **Quotes checked by script.** The texts read were kept for the session, and every quote of the new records, and of the
  Snowball records the model is checked against, was found in them by `quote-check`, which recorded the step.

## Limitations

- **Sun, CO₂ and ice only.** No methane, which Catling and Zahnle credit with 10–15 K of Archean warming; no haze, no
  continents, no ocean currents, no clouds of its own, no change in the day's length (a faster spin carries less heat
  poleward) and today's orbit throughout.
- **Its rule for CO₂ is for small changes.** At the tens of doublings a thaw needs, real CO₂ keeps more heat, so the
  thaw is overstated; its ice has one albedo, with no dust and no bare sea ice, which overstates it again.
- **Several ice edges balance.** A stepped ice line on bands of 2° can rest at any of several neighbouring edges; the
  climate depends a little on where a run starts.
- **No spread on the thresholds.** The book gives no uncertainty for its parameters, so the thresholds have none; only the
  temperature carries the CO₂ series' band.
- **The globe does not draw it.** The model answers the climate layer and the planet panel, and the ice the globe draws is
  still the glaciations' records.

## Next

- A radiative scheme valid at high CO₂, and methane, so that the Archean's thresholds mean what they say;
- the Proterozoic's CO₂ as records, from the Mesoproterozoic paleosols and the calcified cyanobacteria;
- the day's length, from `field:earth/day-length`, slowing the diffusion of the deep past;
- the model's ice line on the globe where no glaciation's record covers the time;
- the continents of each time, as land and sea in each band.
