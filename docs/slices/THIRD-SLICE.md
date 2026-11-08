# Third slice: Earth's states

Status: built and passing its tests. The second slice ([SECOND-SLICE.md](SECOND-SLICE.md))
covered the whole span coarsely, but before 1,100 Ma the globe was a plain sphere, and a
Snowball Earth looked like any other time. This slice draws the planet as the world says it
was: what covered its surface, what its atmosphere was, and where there was ice.

It adds:

- **Earth as a record,** `space/bodies/earth`, whose phases cover its life from the start of
  its accretion: a proto-Earth, the rock-vapour atmosphere and the magma ocean left by the
  Moon-forming impact, oceans of water, and, about 2 Gyr from now, a planet without them.
  Each phase says what covered the
  surface and, where it matters, what the atmosphere was, as claims with sources. Their
  dates come from the chronology: they are tied to the Solar System's first solids and to the
  Moon-forming impact, so picking another date for the impact moves the magma ocean with it.
- **Ice as a claim on a glaciation,** `ice_reach`: the lowest latitude the ice reached. The
  two Cryogenian Snowballs reach the equator, with a competing claim that leaves a strip of
  open tropical sea; a new record, the Makganyene glaciation of about 2.43 Ga, is the
  Paleoproterozoic Snowball.
- **A surface generator,** `gen:earth/surface`, that makes the patterns the states are drawn
  with: plates of crust on a cooling magma ocean, and a ragged edge for the ice. Like the
  clouds, it runs to the same bytes in the build and in the browser.
- **The renderer and the viewer:** the states drawn over whatever geography the time has,
  a row for them in the planet panel, a band under the time control's track, and the state
  in the panel for a click on the globe.

## Running it

As for the other slices (see the [README](../../README.md)). Nothing new is fetched.

## Pass criteria

| Criterion | Where it is checked | Result |
|---|---|---|
| Earth's phases follow the claims they rest on, in every scenario | `tools/world/test/build.test.ts`, `tools/world/test/planet.test.ts` | the proto-Earth ends at the impact and the magma ocean 2 Myr after it; picking Maurice et al.'s date moves the magma ocean to 4,425 Ma |
| The state at a time follows the picks and alternatives | `planet.test.ts` | a pick moves a phase; an alternative's claims replace the default's |
| The surface generator is deterministic, and the browser reproduces the build's bytes | `world/generators/earth/surface/v1.test.ts`, `build.test.ts`, `viewer.spec.ts` | same SHA-256 in Node and in Chromium |
| The viewer shows each state and says which record it comes from | `viewer.spec.ts`: Earth's states, Snowball Earth | nothing before Earth formed; molten rock after the impact; oceans at 2 Ga; ice to the equator in the Sturtian, open water when the competing claim is picked |
| The vocabulary is enforced | `tools/world/test/validate.test.ts` | a string outside its property's values, a lag without an edge, and a planet's property on another kind are errors |
| Earlier renders are unchanged | `golden.spec.ts` | the three earlier goldens match without being regenerated; two new ones, the magma ocean and the Sturtian Snowball |

## What was built

### Earth's record

`space/bodies/earth` is of a new kind, `body/planet`. Its phases, in the default picture:

| Phase | From → to | Surface | Atmosphere | Sources |
|---|---|---|---|---|
| Proto-Earth | 4,566.8 Ma, within 1 Myr of the first solids → the Moon-forming impact, 4,537.3 Ma | crust over magma | — | Zahnle et al. 2007; Elkins-Tanton 2012; Jacobson et al. 2014 |
| Rock-vapour atmosphere | the impact → 1 kyr after it | magma | rock vapour | Zahnle et al. 2007 |
| Magma ocean under steam | → 2 Myr after the impact, 4,535.3 Ma | magma | steam | Zahnle et al. 2007 |
| Oceans | → 2 Gyr from now | oceans | — | Zahnle et al. 2007; Goldblatt & Watson 2012 |
| Without oceans | → no end recorded | bare rock | — | Goldblatt & Watson 2012 |

- **The impact's date** is the world's preferred claim, Barboni et al. (2017): within 60 Myr
  of the first solids. Picking Jacobson et al.'s (2014) moves the impact and the magma ocean
  to 4,472 Ma, Maurice et al.'s (2020) to 4,425 Ma.
- **The Jack Hills zircon** (4,404 Ma) is now recorded as grown during the oceans' phase:
  its oxygen isotopes record rock altered by liquid water (Wilde et al. 2001). Under every
  pick the oceans had begun by then.
- **The oceans' end** competes: about 2 Gyr from now (Goldblatt & Watson 2012, preferred),
  or at least 1.5 Gyr from now (Wolf & Toon 2014, a lower bound).
- **New properties,** of planets: `surface` (magma, crust over magma, oceans, bare rock) and
  `atmosphere` (rock vapour, steam), each a string with declared values.

### Ice

`ice_reach`, a new property of glaciations, is the lowest latitude at which ice reached sea
level, as sea ice or grounded ice: 0 is ice to the equator.

| Glaciation | Ice reached | Competing claim |
|---|---|---|
| Makganyene, 2,443 → 2,425.5 Ma (new) | the equator: a global glaciation, from deposits at low latitude (Gumsley et al. 2017; Kopp et al. 2005) | 11°, where its glacial rocks were laid down (Evans et al. 1997, palaeomagnetic): the least the evidence requires |
| Sturtian, 716.9 → 658.9 Ma | the equator: grounded ice at sea level at all latitudes (Hoffman et al. 2017) | 10°: the Jormungand state, sea ice to within 5–15° of the equator (Abbot et al. 2011, with the latitude from Hoffman et al. 2017) |
| Marinoan, 644.5 → 635.4 Ma | the same | the same |

The Makganyene's dates are Gumsley et al.'s (2017): the first Paleoproterozoic global
glaciation began between 2,460 and 2,426 Ma, and the Ongeluk lavas over its last deposits
date its end to 2,425.5 Ma. Kopp et al.'s (2005) older dating, about 2.3–2.2 Ga, is kept as a
deprecated claim; the validator notes that it contradicts the preferred end.

### The states file

The build writes `planet.json` (`tools/world/src/build/planet.ts`): Earth's phases in order
and the episodes that change its look, each with its interval in the default picture and in
every scenario that moves it, and the claims that decide how it looks (`surface`,
`atmosphere`, `ice_reach`) with their ranks and alternatives. The look itself is derived in
the viewer, by `lookAt` in `core/planet.ts`: the phase that holds at the time, how far
through it the time is, and the lowest latitude any glaciation's ice reaches, each claim
chosen as the chronology chooses (a pick, else the preferred claim, else the only one).

Records now carry each phase's interval under the scenarios that move it, so the inspect
panel dates Earth's phases by the picks in force.

### The surface generator

`gen:earth/surface` (version 1) makes one RGBA texture, 512 × 256, over an equirectangular
grid: when each spot crusts over as a magma ocean cools (plate interiors first, from a
cellular pattern on the sphere; the cracks between plates last), hot and cool patches of
melt, a smooth field that makes the ice's edge ragged, and fine texture. It takes nothing
from the world: which channel shows, and how much of it, follows the states. How the
renderer uses it is in the record too: a magma ocean crusts over evenly through its phase,
from none of it to 96%; a surface of crust over magma is 82% crust; and the ice's edge strays
up to 5° either side of its claimed reach. It reuses the cloud generator's noise and, like
it, uses only arithmetic, `floor`, `Math.sqrt` and 32-bit integer operations, so every
engine makes the same bytes. It runs in about 0.3 s.

### The renderer

The states go over the geography mode the time has (elevation, the blocks, or none):

| State | Drawn as |
|---|---|
| Not formed yet | the sky only |
| Rock-vapour atmosphere | a glowing ball, the surface hidden |
| Magma | molten rock, giving its own light, with plates of dark crust that spread through the phase |
| Crust over magma | dark crust with melt glowing in its cracks, and no atmosphere drawn, since none is claimed |
| Steam atmosphere | an overcast of the cloud pattern, lit from below by the magma |
| Oceans, where the map is unknown | an ocean world with a faint graticule: where the land was is not known, so none is drawn |
| Ice | ice sheets over land and sea ice over water, poleward of the claimed reach |

Clouds need water: they are drawn over oceans and in a steam atmosphere, thinner over a
Snowball Earth, and not over magma or bare rock. In evidence mode the state patterns are
procedural, magenta like the clouds. With no state, each mode draws exactly as before.

### The viewer

- The planet panel has a row for Earth's phase and, during a glaciation, one for its ice;
  each opens its record.
- A thin band under the time control's track shows the phases and, over them, the
  glaciations. Pointing at it names the state; a click opens its record, moving into the
  state if the time shown is outside it.
- A click on the globe adds the planet's state to the panel, with links to its records.
- Before Earth's record starts, only the sky is drawn, and the notice says when it began to
  form.

## Decisions

1. **States are phases of the planet's record,** as the design has it (section 4.2), not a
   series of values. Their dates come from the chronology, so they move with the claims they
   rest on; a series would have repeated those dates.
2. **Ice is a claim on the glaciation** (`ice_reach`), not a field. A latitude is what a
   Snowball Earth is claimed to be, and what the alternative claims instead. For the ice
   ages of the last 540 Myr a latitude band would be wrong (Siberia is not under ice today),
   so they wait for ice grids.
3. **No invented land.** Where no map is known, the oceans are drawn without land rather
   than with continents generated to a land fraction.
4. **The patterns are procedural and say so,** like the clouds: a generator with a seed, a
   version and a test of its bytes, and evidence mode marks them.
5. **A phase is of its entity's kind** when the validator checks which properties fit it, so
   a phase of a planet takes the planet's properties.
6. **A lag counts from an edge.** A time that refers to another record with a lag but no
   edge was accepted, and its lag ignored; it is now an error.
7. **String values can be declared** (`values` in properties.yaml), and the validator keeps
   claims to them; the inspect panel shows what a value means.

## Limitations

- **Claims need review.** Every new claim is machine-made and proposed. Values that could not
  be fully checked:
  - Elkins-Tanton (2012), Abbot et al. (2011), Wolf & Toon (2014), Evans et al. (1997) and
    Kopp et al. (2005) were read only in their abstracts, the Abbot abstract only in a
    reconstructed copy; Zahnle et al. (2007) was read in full;
  - the Jormungand ice margin, 10°, is the middle of Hoffman et al.'s 5–15°, citing Abbot et
    al.; Abbot's abstract gives no latitude;
  - Goldblatt & Watson's "around 2 billion years" is a round figure that the paper does not
    derive; Caldeira & Kasting (1992) and Leconte et al. (2013) give other horizons;
  - the Makganyene's start is the bracket of the first global glaciation as Gumsley et al.
    correlate it across cratons; they suggest the Fennoscandian ages may bracket it to under
    7 Myr, about 10 Myr before the Ongeluk lavas.
- **One model for each duration.** The rock-vapour atmosphere's thousand years and the magma
  ocean's two million are Zahnle et al.'s (2007); other models of how fast a magma ocean
  freezes are not recorded yet as competing claims.
- **The proto-Earth is one state** for the whole of its accretion: crust over magma. It was
  remelted by giant impacts at times nobody has dated, and it is drawn at today's size,
  though it was growing.
- **The impact itself** is a moment: the globe changes at it, but nothing shows the impact.
- **No Moon,** no length of day, and the light does not dim with the young Sun.
- **Ice is a latitude band.** That is what a Snowball Earth is claimed to be, and the
  competing claim's strip of open sea is drawn at its latitude with a generated edge. The
  ice ages of the last 540 Myr have no ice yet, and today's ice sheets are still coloured by
  their elevation.
- **Oceans without land where the map is unknown.** There was land (cratons, and later
  supercontinents), but nothing in the world says where, so none is drawn; the panel for a
  click on the globe says so.
- **States change at their best dates.** Evidence mode does not yet fade a state across the
  uncertainty of its boundaries, as it does for markers.
- **The patterns are simple:** one scale of plates and cracks, and the weather's cloud
  pattern for a steam atmosphere.
- **The atmosphere of the oceans' phase is not claimed,** so today's blue sky is drawn
  throughout it, including the late Archean, which may have had an orange haze.

## Next

- the Moon at its distance, and the length of the day, from tidal and cyclostratigraphic
  records;
- Earth's size as it accreted, with the accretion models as competing claims;
- competing durations for the magma ocean;
- the Archean's atmosphere and its haze;
- ice sheets from grids, for the last glacial cycle first (the first slice's Last Glacial
  Maximum), then the older ice ages;
- the impact as a tour: a replay drawn after the impact model picked;
- a simple energy-balance model, driven by the Sun and CO₂ series, as a check on when the
  rocks say the Earth froze;
- the far future's states: a steam atmosphere after the oceans evaporate, a molten surface
  under the swelling Sun, and the Earth's end, engulfed by the Sun about 0.5 Myr before the
  tip of the red-giant branch (Schröder & Smith 2008, already the source of that event).
