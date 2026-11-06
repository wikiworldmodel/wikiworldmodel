# The catalog: what is built and what remains

Status: proposal, November 2026. Nothing in it is built. It designs one place, kept up to date by
the build, that says what the world holds, what it still needs and who is working on what. It is
meant for people browsing the site and for agents choosing a task. It goes with
[OPEN-CONTRIBUTION.md](OPEN-CONTRIBUTION.md). Section 11 says what becomes of the documents that
do this job today.

## 1. Why

Five places say what is built and what remains, and they overlap:

| Where | Says | Kept by |
|---|---|---|
| [DATA-OUTLINE.md](DATA-OUTLINE.md) | 140 needs by domain, each ✓ ◐ ○, with candidate sources and licences; twenty places to start | hand |
| [ROADMAP.md](ROADMAP.md) | twenty record sets in order, with a "Stands" column | hand |
| [RECORD-SETS.md](RECORD-SETS.md) | the same twenty sets, where each stands, what to review first | hand |
| the slice documents | what each slice built, its pass criteria and its "Next" | hand |
| `coverage.json`, `forms-wanted` | unsourced claims, wanted records, basis by tile; taxa that most want a form | the build |

The hand-kept ones have already drifted:

- DATA-OUTLINE gives "about 1,160 entities and 6,400 claims" and "112 unsourced claims". The last
  build here has 1,429 entity files, 11,639 claims and 221 unsourced.
- About half of its twenty "Where to start" tasks are done: the PBDB dinosaurs, hominins, the
  ice-core series, Glottolog, the IPCC scenarios, Natural Earth, NOAA's hazards and Cliopatria's
  other polities.
- A set's status is written three times: ROADMAP, RECORD-SETS and an outline row.

That is a symptom, not carelessness. A status is a value derived from the world, and the project's
fifth rule says derived values are never stored. Dates and coastlines are computed by the build
rather than written down, so that they cannot disagree with their evidence. The status of the work
should be computed the same way.

The computed lists show what works. `forms-wanted` is always current, and it ranks by real demand:
how often the atlas needs a taxon. An agent can act on it without reading any prose.

## 2. The idea

Keep three things apart, each in the place that suits it:

| | What | Written by | Lives in | Changes |
|---|---|---|---|---|
| **Declared** | what the world should hold, and how to tell when it does | people and agents, reviewed | `catalog/` in the repository | slowly |
| **Measured** | how much of each need is met, and by what | the build, never by hand | `catalog.json` in each build | every build |
| **Claimed** | who is working on what | contributors | GitHub: draft pull requests and issues | daily |

The catalog is the three joined: needs, how full each is, and who is on it.

Two guardrails keep the numbers honest:

- **No percentage without a denominator taken from a source.** "102 of the ICS chart's stages" is
  a fraction. "The history of China" is not, and is shown as counts.
- **Filled is not checked.** Every bar shows how much of what is there a person has accepted.
  Today that is none of it.

## 3. What the catalog holds

The catalog holds different kinds of thing, not one long to-do list:

| Noun | What | Example | Count today, roughly |
|---|---|---|---|
| **Domain** | a top-level area, from the outline's sections | Life; History, region by region | 12 |
| **Need** | something the world should hold, with a way to measure it | the Phanerozoic large igneous provinces, with dated main phases | 140 outline rows |
| **Item** | one missing piece of a need, computed, never written down | the Ontong Java LIP, which has no record; a taxon with no form; a claim with no source | thousands |
| **Capability** | something the system should be able to do: a generator, a check, a viewer feature, a record type | night lights from population; climate against lithology | about 20 (outline sections 11 and 12) |
| **Candidate dataset** | a dataset someone looked at, with its licence verdict, imported or not | Seshat: CC BY-NC-SA, so cite only | about 80 named in the outline |
| **Milestone** | a bundle of needs and capabilities with pass criteria: a slice or a record set | Set 13, routes and trade; the eighth slice | 7 slices, 20 sets |
| **Doubt** | something an expert could settle on existing records | whether the Laurentide ice of MIS 3 was small or large | the "look at first" notes in RECORD-SETS |

Needs and capabilities are the backbone. Items are what a contributor actually picks up. Milestones
are the roadmap. Candidate datasets save the next agent from researching a licence again. Doubts
are review work, and they live as GitHub issues on their records, as OPEN-CONTRIBUTION section 11
proposes.

## 4. How it is organised

**One tree, by domain.** It keeps the outline's sections: foundations, the cosmos, the solid
Earth, oceans and climate, life, humans before history, history region by region, places in detail,
the present and the future. Code sits beside them as capabilities. This tree works because it is
how a contributor's expertise is shaped: someone who knows Roman epigraphy or Ordovician
brachiopods looks there first. It is also how the outline already reads, so it costs no new
learning.

**Everything else is a facet.** No second tree is needed. Each need carries:

| Facet | Values | Used for |
|---|---|---|
| `as` | records, dataset, field, generator, check, form, viewer | what the work is; who can do it |
| `where` | a region, a bounding box or the globe | the "missing here" panel on the globe |
| `when` | a time span on the axis | the same, and the time strip |
| `who` | agent, person, either | a paywalled or physical source needs a person |
| `size` | small, medium, large | about one PR, a few, a milestone |
| `licence` | ok, cite only, unknown | from its candidate datasets |
| `milestone` | a set or slice id | the roadmap view |
| `depends` | other needs or capabilities | what it unblocks |

**History, region by region, is a matrix.** Outline section 7 already lists its layers once
(polities, rulers, cities, events, roads…), and then the regions. The catalog keeps it that way.
A need there is a layer × region cell, such as rulers × East Asia. Coverage shows as a grid, which
makes the gaps obvious: every region but Rome is thin in the same few layers.

**Place and time are not the tree.** They are the coverage map's job, which the design already
assigns (WORLD-MODEL section 8.4: "That overlay is the project's to-do list"). The catalog feeds
that overlay through `where` and `when`, so it never has to be organised by place.

## 5. Needs as data

One file per need under `catalog/needs/<domain>/`, with a stable, meaningless id, as records have.
A need is not a fact about the world, so it does not live in `world/`. The only exception is its
denominator, which is a sourced number and is checked like any other.

**A need with a sourced denominator.** This one is complete today:

```yaml
# catalog/needs/foundations/ics-stages.yaml
id: need:foundations/ics-stages
title: The stages of the geologic time scale, Phanerozoic
why: Records dated by a stage follow the chart; a missing stage is a date nobody can write.
as: records
when: { lo: 538.8 Ma, hi: now }
measure:
  select: { kind: period/stage, path: periods/ics }
  of: { count: 102, source: { ref: src:ics-chart-2020-03, loc: the chart } }
  done_when: [date, name]        # what an item needs before it counts
milestone: slice:first
author: machine:claude-code
```

**A need whose denominator is a list from the commons.** Identifiers come from Wikidata, the PBDB,
Pleiades, Glottolog or PeriodO. The list is a dated snapshot, kept with the query that made it, as
`world/snapshots/` already does for OpenHistoricalMap and the PBDB. Items are the list's ids that
no record's `same_as` names. That makes the matching exact, not a fuzzy match on names.

```yaml
id: need:history/rulers-roman-emperors
title: Roman emperors, with their reigns
as: records
where: { region: mediterranean }
when: { lo: 27 BCE, hi: 1453 CE }
measure:
  select: { kind: person, relation: held-office }
  of: { list: catalog/lists/wikidata-roman-emperors-2026-11.json }   # ids, and the query that made them
  done_when: [held-office, name]
who: either
size: medium
```

The list says what to count, not what is true. A reign's dates still come from Suetonius or a
regnal list, never from the list itself.

**An open need, with no denominator.**

```yaml
id: need:places/rome-other-times
title: Rome at other times: growth, the fires, the medieval city, Nolli's 1748
as: records
measure:
  select: { path: rome, dated_outside: { lo: 300 CE, hi: 330 CE } }   # counts, never a percentage
candidates: [dataset:lanciani-forma-urbis, dataset:nolli-1748]
size: large
```

**A dataset need.** Its measure is a ladder through the pipeline, not a count:

```yaml
id: need:history/economy-maddison
title: GDP, population and wages by country from 1 CE (Maddison Project)
as: dataset
measure: { dataset: dataset:maddison-project }   # candidate → licence checked → pinned → imported → drawn → checked
```

**A capability.** It is done when its named test exists and passes in the nightly run. The slices
already have a test for each pass criterion, so this follows their pattern.

```yaml
id: cap:generators/night-lights
title: Night lights from population and buildings
as: generator
depends: [need:humans/population-grid]
measure: { test: "night lights follow the population field" }
```

**Candidate datasets** sit in `catalog/datasets/`, one per dataset, whether or not it was
imported. Each records its licence verdict, how the verdict was read, and the manifest id if it was
pinned. Seshat, the EDH and the Rumsey maps go here as "cite only". That way the next agent does
not research them again.

**Measures stay small.** A selector names a kind, a path, a property or relation, a `same_as`
scheme, or a span of time or place. A denominator is a count or a list. That is all. Anything a
selector cannot express is a capability's test. The measure language is a new format, so it is red
by OPEN-CONTRIBUTION's own rule, and it should stay small enough that it is never tempting to
extend.

## 6. Measuring

The build gains a catalog step after the solver. For each need it reports:

- **matched records,** and the items missing against the denominator;
- **the ladder:** for each matched record, how far it has got:

  ```
  named → sourced → placed (date, and place if it has one) → identified (same_as) → accepted
  ```

  An item counts toward a bar only from *placed* up, and only through sourced claims. So filling a
  need with unsourced stubs moves nothing. This is the guard against gaming that a visible
  progress bar invites.
- **demand:** how many references name the need's missing items (wanted records), how many atlas
  rows they would draw (the `forms-wanted` count, generalised), and how often viewers look at the
  need's place and time (WORLD-MODEL section 8.4, once the site counts it);
- **activity:** filled last by which pull requests and contributors, from the build's commit range.

The output is `catalog.json` beside `coverage.json` in every build, and the site publishes the
latest one at a fixed URL. It is derived, so it is never committed. Builds stay reproducible
because activity comes from git, not from the GitHub API. Who is working on what is joined in by
the site, not by the build (section 8).

`coverage.json`'s unsourced claims and wanted records become items of two standing needs,
"every claim sourced" and "every reference written". The validator still lists them as it does
now.

## 7. What to show first

Not a clever score. Show the inputs and sort simply:

1. needs in the current milestone;
2. then by demand: wanted references, atlas rows, views;
3. then by what they unblock: capabilities and needs that depend on them.

A maintainer can pin a need to the top. An agent can sort however it likes, because the JSON
carries every input.

## 8. Claiming and working beside others

There is no database. A claim is a draft pull request, or an issue, whose body has a line
`Need: need:history/rulers-roman-emperors`, plus the items it covers if not all of them. The site
reads open pull requests and issues through GitHub's search API, cached for a few minutes, and
shows them on the need:

- **Claimed** while the draft pull request is open and has been pushed to in the last 14 days.
  After that the claim lapses, and the need shows as free again, with a link to the stale work.
- **Overlap** is warned about, not blocked. The bot already warns when two open pull requests write
  the same ids (OPEN-CONTRIBUTION section 11). It adds the same warning when they claim the same
  items.
- **A large need** is split by items, not by people. Two agents can work on rulers × East Asia at
  once if one takes the Tang and the other the Song.

## 9. The human interface

The aim is gratification: see a hole, fill it, see it filled. So the catalog is shown where people
already are, in the world, as well as on a page of its own.

**On the globe: "missing here".** At any place and time, a small panel lists the needs whose
`where` and `when` cover the view, and their open items there. Over Rome in 315 CE it shows the
city's monuments with no Pleiades id, and its unsourced claims. At the Hell Creek it shows taxa
drawn from a stand-in form. Over China in 900 CE it shows that the world has no ruler there. Each item
has a **Contribute** button, which gives a ready brief to paste into your agent (section 10) and a
link to claim it. The coverage overlay the design calls for shades thin places and times beside
it. Holes are drawn as holes.

**On a record: "improve this".** The record's own items: unsourced claims, no `same_as`, no form,
open doubts, a competing reading wanted. They come from the same `catalog.json`.

**`/catalog`** is the whole tree:

```
Life                                         ▓▓▓▓▓▓░░░░  61 of 140 needs met · 0% checked
  Fossil occurrences, marine                 ○ none          dataset · PBDB · licence ok      [claim]
  Tree of life: divergence times             ◐ 26 of …       records + dataset · ? TimeTree
  Mass extinctions, the smaller ones         ◐ 3 written     records · agent · small          ⚑ claimed by #212
  Forms for taxa                             ▓▓▓░  4,100 of 9,800 atlas taxa drawn from their own or a family's
History, region by region                    [ matrix: layers × regions, each cell shaded by fill ]
Capabilities
  Climate against lithology (check)          ○               depends on: lithologic indicators
```

The numbers in this sketch are placeholders. Filters cover what a contributor can actually do:
by `who`, `size`, licence, region and era. A need's page shows its brief, its items, its ladder,
the work claimed on it, and **recently filled**, with contributors' names and links into the
viewer at what they added. That is the credit, and the reason to come back.

**`/milestones`** is the roadmap, computed: each slice and record set, its needs, and how full each
is. ROADMAP's "Stands" column becomes this view.

**`/changes`** is a feed of what went live in each build: records added, needs moved, who did it.
It is the "recent changes" page every wiki has, and the patrol's starting point (OPEN-CONTRIBUTION
section 9).

**In the pull request.** The bot's comment says which needs the change fills and by how much, for
example "LIPs: 3 → 7 of 12; first sourced dates for Ontong Java", an illustration, since no
list of LIPs has been chosen. That is the first moment of
gratification, before the build is live.

## 10. The agent interface

An agent should be able to go from a URL to a claimed task without cloning anything.

**`/catalog.json` on the site** is the latest build's catalog, joined with claims.
AGENTS.md tells an agent to read it first, pick an unclaimed item that fits what it can reach, and
claim it.

**The brief.** Every need renders as a brief, in the JSON and as `/catalog/<need>.md`. An agent
needs nothing else to start:

- what the need is and why it matters;
- the items left, with their ids in the commons;
- the cookbook entry to copy (OPEN-CONTRIBUTION section 5), and one or two finished records as
  examples;
- candidate sources, with licence verdicts and what earlier agents found or could not reach;
- what counts as done (`done_when`), and the command that measures it.

This brief is what the **Contribute** button gives a person to paste into their own agent.

**Commands.** These replace `tasks` in OPEN-CONTRIBUTION section 11:

| Command | What |
|---|---|
| `npm run world -- catalog [--domain life] [--who agent] [--json]` | the tree, or the open needs that fit, sorted as section 7 sorts |
| `npm run world -- need <id>` | the brief, with the items left, measured against the local world |
| `npm run world -- need <id> --check` | the measure before and after the working tree's changes: what this pull request will fill |
| `npm run world -- forms-wanted` | kept as it is; it becomes the measure of the forms need |

`--check` is the agent's own gratification loop. It sees the bar move before it opens the pull
request. The reviewer also uses it to classify the pull request: filling a declared need's items is
"fill a gap" by definition, which makes the reviewer's job easier and the lane greener.

**No MCP server at first.** The JSON and the CLI cover it, and every agent can use both. A server
is worth adding once people ask for one.

## 11. What becomes of today's documents

| Today | Becomes |
|---|---|
| DATA-OUTLINE's tables | need files and candidate-dataset files, converted mechanically, about 140 + 80. The document keeps its introduction and rules, and its tables are generated from the catalog, or replaced by a link to `/catalog` |
| DATA-OUTLINE section 13, "Where to start" | the catalog's default sort |
| ROADMAP's table | milestones in the catalog; the prose (the aim, the order and why) stays |
| RECORD-SETS' status table | computed; its "what to look at first" notes become doubts, filed as issues on their records |
| the slice documents | unchanged: they are the record of decisions. Each "Next" section becomes needs or capabilities, with a link back |
| `coverage.json` | unchanged, and read by the catalog |
| `forms-wanted` | unchanged, and the measure of one need |

The rule after this: **prose for reasons, data for anything with a status.** A document may say why
something matters or how it was decided. It never says how far along something is, because that
would be stale by the next merge.

## 12. Review and lanes

These fit the lanes and policy in OPEN-CONTRIBUTION:

| Change | Lane | Why |
|---|---|---|
| filling a need's items | by content, as now | the usual case; usually green |
| a new need in an existing domain, with a measure that only selects | green | steering effort is easy to undo, and a proposed need is a useful contribution in itself ("this is missing") |
| editing a need's `why`, facets or candidates | green | |
| a need's denominator or `done_when` changed | amber | it moves what counts as done, and could make a bar read full |
| a need marked `wont: <reason>` (out of scope, or not knowable) | amber | it closes a door for everyone |
| a new domain, the measure language, the ladder | red | form, which others will copy |
| a candidate dataset's licence verdict | amber | the verdict is what lets data in (OPEN-CONTRIBUTION, major risk on rules) |

`catalog/**` joins policy.yaml's `by_content` paths, with these rules beside the existing ones.

## 13. Building it

1. **The schema and the conversion.** The need and candidate-dataset schemas, then DATA-OUTLINE's
   rows converted one to one, with `author: machine:claude-code`. They are checked by a script
   that maps each row to a file. No measures yet.
2. **Measures for the needs that have denominators:** the time scale, the rulers of a few states,
   the LIPs, the extinctions, forms, sources and wanted references. Then `catalog.json` from the
   build, and `world -- catalog` and `world -- need`.
3. **Generated tables** in DATA-OUTLINE and ROADMAP, and RECORD-SETS' status table removed. A
   check fails if a hand-written status reappears in docs.
4. **`/catalog` and `/milestones`** on the site, read from `catalog.json`, with claims from
   GitHub's search API.
5. **"Missing here" and "improve this"** in the viewer, and the Contribute brief.
6. **The bot's line** in pull requests, and `need --check`.

Steps 1–3 are worth doing before the project opens, because they make the menu true. Steps 4–6
are what make contributing feel immediate.

## 14. Decisions needed

1. **Where needs live:** `catalog/` at the root (recommended), or `world/needs/`. A need is about
   the project, not the world, and keeping them apart keeps the world's validator and build simple.
2. **Whether DATA-OUTLINE stays** as a generated document, or gives way to `/catalog` with only its
   introduction kept (recommended: generated for now, since it is what agents read today).
3. **Claims through draft pull requests** (recommended), or through issues opened for each need.
   A draft costs nothing until someone starts. An issue for each of 140 needs is noise.
4. **The lapse** for an idle claim: 14 days is proposed.
5. **Whether views count toward demand** once the site counts them, given PUBLIC-PROJECT's privacy
   rules.

## 15. Open questions

- **How wide a need should be.** "Rulers × East Asia" is a good size. "Every ruler" is a slogan.
  The outline's rows vary. Some will need splitting when converted, and the rule of thumb is that a
  need's measure should move visibly after one pull request.
- **Denominators that are themselves contested.** How many mass extinctions there are depends on
  whom you ask. A need may name competing lists, as claims compete, with one preferred.
- **Needs that are really doubts.** "Is the Laurentide of MIS 3 small or large?" is a question
  about an alternative, not a gap. It belongs on the `/questions` page OPEN-CONTRIBUTION proposes,
  and the catalog links to it rather than holding it.
- **Capabilities measured by tests in the nightly run** depend on that run's results being
  published. The nightly workflow would upload a small results file the site can read.
