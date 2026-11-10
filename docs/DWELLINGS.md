# Writing a building tradition

A building tradition is a way of building houses and setting them out that archaeologists or historians recognize
across many sites: the Iron Age roundhouse of Britain, the Ancestral Puebloan room block, the Mongolian felt tent. It
is a record with a few sourced claims (what the house was like, how the houses stood together, the fields around them,
where and when), and the settlement generator draws every house of the human landscape from it. This is the brief for an
agent, or a person, writing them. The plan it serves is [HUMAN-LANDSCAPE.md](HUMAN-LANDSCAPE.md); the rules in
[CONTRIBUTING.md](../CONTRIBUTING.md) and [RECORDS.md](RECORDS.md) all apply. Never invent a source, a size or a date,
and everything a machine writes is `proposed`.

Where no tradition is written for a place and a time, the generator draws a generic house for the way of life and the
climate there (a forager's hut, a herder's tent, a farmer's house of mud, timber or thatch), and the panel says that it
is generic. So there is no need to do everything at once. A broad tradition covering a large region for a long time is
worth a lot: it draws every house there until someone writes a narrower one.

## The line

```sh
npm run world -- dwellings-wanted               # the regions and times where people lived and no tradition is written
npm run world -- dwellings-wanted --region 59   # one region's times, and the traditions that cover it
npm run world -- quote-check src:<source> <text file>   # find every quote of a source in the text you read
npm run validate -- --no-frames                 # every tradition is checked
```

`dwellings-wanted` ranks a region and a time by how many people HYDE puts there, so the top of the list is where most
houses are drawn as generic. Work from the top down.

## Where a tradition goes

In `world/entities/people/traditions/`, one file per tradition:

```yaml
# The shape of one: every value here must come from what you read, with its quote.
id: people/traditions/iron-age-roundhouse-britain
kind: tradition/building
summary: >-
  The round house of later prehistoric Britain and Ireland: a circle of posts or a ring of stone or turf walls under a
  conical thatched roof, standing alone or in small groups among their fields.
author: machine:claude-code
claims:
  name:
    prop: name
    value: { en: Iron Age roundhouse of Britain and Ireland }
    unsourced: An editorial label.
  start:
    prop: start
    value: { lo: 1500 BCE, hi: 800 BCE }
    source: { ref: src:…, loc: "p. …", quote: "…" }
    method: expert-estimate
  end:
    prop: end
    value: 100 CE
    source: { ref: src:…, loc: "p. …", quote: "…" }
    method: expert-estimate
  extent:
    prop: extent
    value: { from: src:archaeoglobe-2019-regions, names: ["38"] }
    source: { ref: src:…, loc: "p. …", quote: "…" }
    method: editorial
    note: The regions the source places it in; it does not say the house covered all of them.
  dwelling:
    prop: dwelling
    value: { plan: round, diameter: { lo: 5, hi: 15 }, walls: wattle-and-daub, roof: conical, roof_material: thatch }
    source: { ref: src:…, loc: "p. …", quote: "…" }
    method: excavation
  settlement:
    prop: settlement_form
    value: { pattern: dispersed, houses: { lo: 1, hi: 5 } }
    source: { ref: src:…, loc: "p. …", quote: "…" }
    method: expert-estimate
relations:
  broader:
    rel: member-of
    to: people/traditions/…
    unsourced: An editorial grouping.
```

Write one claim for each property. When different sources give different parts of a dwelling, cite them all in its
`source:` list, each with its own locator and quote, and say in a `note` which gives which. Two claims of one property
are competing claims, for when sources disagree: rank one `preferred` and say why ([RECORDS.md](RECORDS.md)). Keep a
parameter you cannot source out of the claim: what no claim says is the generator's guess, and the panel shows it as such.

## What a tradition can say

| Property | What it holds |
|---|---|
| `start`, `end` | when the tradition held, as the source dates it: a year, a range, or a period's record |
| `extent` | the ArchaeoGLOBE regions it was found in, as `{ from: src:archaeoglobe-2019-regions, names: ["59", "61"] }`. A region named is a region where the tradition was, not a claim that it covered all of it. A tradition with no extent takes its parent's |
| `dwelling` | the house: `plan`, `diameter` or `width` and `length`, `wall_height`, `height`, `storeys`, `rooms`, `walls`, `roof`, `roof_material`, `floor`, `court` |
| `settlement_form` | how the houses stood together: `pattern`, `houses` (in one settlement), `spacing` (metres between them), `household` (people in one house) |
| `field_system` | the fields: `kind`, `plot` (hectares), `bounds` |
| `member-of` | the broader tradition it belongs to: it inherits every parameter it does not state |

The words each may take are in [core/dwelling.ts](../core/dwelling.ts), each with what it means. Lengths are in metres
and plots in hectares; a number is a number or `{ lo, hi }` as the source gives it. If a source's word for a material or a
plan is not there, use the nearest and say so in a note, or add the word to `core/dwelling.ts` with its meaning in the
same pull request.

`household` matters most to the generator after the house itself: it turns HYDE's people into houses. Cite it only where a
source gives it for this tradition; otherwise leave it out and the generator's stated choice stands in.

## Which tradition draws a place

At a place and a time, of the traditions whose `extent` names the place's region and whose span holds the time, the
generator takes the most particular: the deepest in the tree, then the one that names the fewest regions, then the latest
to start. So:

- **Write broad traditions first.** "Mudbrick houses of Mesopotamia, 3000–500 BCE" before "the houses of Ur in the Isin–Larsa
  period". The narrower one, when it comes, takes over where and when it holds, and inherits what it does not say.
- **Split by time when the house changed.** Two records, each with its own span, are better than one that averages them.
- **Do not stretch a tradition to fill a map.** A region named without a source that places the tradition there is an
  invention. A region nobody has written stays generic, and says so.

## Sources

The best sources are excavation reports and syntheses of a region's houses, then reviews and handbooks, then
encyclopedias, cited only when nothing better can be read and saying so in a note ([RECORDS.md](RECORDS.md)). Read the
source; keep its text; check every quote by script with `quote-check`; give the page or section as the locator. A size
needs a sentence that states it. "Houses of 5–7 m across" is a source for `diameter: { lo: 5, hi: 7 }`; a photograph is not.

## What it will not do

- A tradition is a type, not a house: every house the generator draws is one sample of it, and none of them was there.
- A region is coarse. Where a tradition held only part of one, the generator draws it over all of it: the panel says the
  tradition was found in the region, not here.
- Colour, decoration and the inside of a house are the generator's, and marked so.
