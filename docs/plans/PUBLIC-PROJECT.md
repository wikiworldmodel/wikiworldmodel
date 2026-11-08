# WikiWorldModel in public: plan for an open project and a public site

Status: proposal. It turns [WORLD-MODEL.md](../WORLD-MODEL.md)'s sections on contribution
(8.2), process (9.3), serving (11), storage (12) and licensing (13) into a plan that can be
carried out. It covers what has to be decided, built and written before anyone outside can
contribute, and before anyone at all can open the site.

## 1. Goal

"Public" means three things:

- **Anyone can look.** A public site where anyone can fly through the world with no
  install and no account, and links that keep working for years.
- **Anyone can contribute.** A reviewer, a historian, a mapper or a programmer each has a
  path in that suits them. Each contribution is checked by machines, then by a person, and
  shows up on the site soon after.
- **Everything is open.** Code, records, builds and the decisions behind them are public,
  licensed for reuse, and reproducible from the repository.

## 2. Where it stood

This section describes the repository when the plan was written. Since then: the licenses are
chosen and in place (Apache-2.0 for code, CC0 for records and documents, the DCO for
contributions; section 4), each build writes its `ATTRIBUTION.md`, CI is green and runs in
tiers, master is published to `worldmodelzero.com` on Cloudflare Pages, and
[CONTRIBUTING.md](../../CONTRIBUTING.md), a code of conduct, a security policy, templates and
`CODEOWNERS` exist. Still open: no claim has been reviewed by a person, the datasets still come
from third parties, there are no policies, releases or previews, and only the latest build is
served, so a link pinned to an older one stops working. Section 11 tracks the rest.

Master (`db3dbf9`) had five slices, from the Hadean to Rome in 315 CE, and the backbone an
open-data project needs:

| Have | Notes |
|---|---|
| Records in git, one per file, with JSON Schemas and vocabularies | 416 entity files and 163 source files; one OpenHistoricalMap snapshot, imported as 746 more records |
| Validators run in CI | schema, references and wanted records, vocabularies, review status, ranks, licenses, chronology per alternative, plate frames |
| Reproducible builds | content-hashed build ids; `build.json` records the data commit, dataset checksums, generator versions and seeds |
| A static viewer | links pin a build; no server is needed to view |
| A license filter | a published build takes only CC0, CC BY and public-domain inputs |
| Provenance in the viewer | sources, locators and quotes; machine-made and proposed claims are marked as such |

What is missing:

| Gap | Why it matters |
|---|---|
| **Nobody has reviewed anything.** All 6,445 claims and relations are machine-made (`machine:ohm-import` 4,319, `machine:claude-code` 1,216, `machine:ics-periods` 910) and all are `proposed`; 112 have no source. | The design promises "accurate and honest". Opening a site whose every fact is an unreviewed machine proposal, without saying so loudly, would spend the project's credibility on day one. |
| **No license.** There is no `LICENSE` for code or data, and no contributor terms. | Section 13: "Choose the data license before the first outside contribution." Until then nobody can safely reuse or contribute. |
| **CI is red on master.** Run 11 (`rome city`) fails: four city browser tests time out under SwiftShader, and the 15-minute limit stops 34 more from running. | A newcomer's pull request cannot go green, so nobody can tell their change from an existing failure. |
| **The datasets are fetched from third parties.** 11 datasets, 165 MB, come from publishers' sites, GitHub copies, Zenodo, OpenTopography, INGV and NOAA, pinned by sha256. | One host going away or blocking a region breaks every build. One of them, `static-content.springer.com`, is unreachable from the environment this plan was written in. |
| **No hosting, domain, releases or previews.** | There is no public URL, and no way to see a pull request's effect without building it locally. |
| **Contributing means writing YAML.** There is no contributor guide or scaffolding, and no route from the viewer to an edit. | That suits a few technical contributors, not historians or casual readers. |
| **No policies.** Nothing covers sourcing standards, contested history, sensitive content, machine contributions or conduct. | The design's neutral presentation (section 9.3) needs rules people can point to. |

## 3. Principles

1. **Keep the architecture.** The viewer stays a static app, and builds stay immutable files
   on a CDN. Git stays the record store until its limits are reached (section 12). The only
   new servers are small: a sign-in exchange, and later an edit API.
2. **Nothing is "accepted" until a person accepts it.** Machine and imported claims stay
   `proposed`, and the site says so on every one. Review is a first-class contribution, not
   a gate kept by a few maintainers.
3. **The validators are the first reviewer.** Every path in, whether a pull request, the
   in-viewer editor or a later API, goes through the same schema, reference, license and
   chronology checks before a person sees it.
4. **Show the effect, not just the diff.** A reviewer sees which dates moved, what the
   viewer looks like before and after, and a link to the change in place.
5. **Federate, don't fork** (section 13). Map geometry goes to OpenHistoricalMap and comes
   back through a snapshot. Corrections to upstream datasets are filed upstream, and
   identifiers come from Wikidata, Pleiades, the PBDB and PeriodO.
6. **Cheap to run.** Hosting should cost tens of dollars a month until traffic is large, so
   that one maintainer can keep it alive.

## 4. Licensing and contributor terms

**Decide this before anything else is opened.**

| What | Recommendation | Why | Alternative |
|---|---|---|---|
| Code (`core/`, `tools/`, `viewer/`, generators) | **Apache-2.0** | permissive, with a patent grant; generators run in other people's apps | MIT (simpler, no patent clause) |
| WikiWorldModel's own records, vocabularies and docs | **CC0-1.0** | the same as Wikidata and OpenHistoricalMap, so facts can flow upstream and back; no attribution stacking for reusers | CC BY 4.0: credit to contributors, but records could not be copied into Wikidata |
| Quotes inside records | stay under their works' terms | they are short quotations (the schema caps them at 400 characters) used as evidence; CC0 cannot relicense them | — |
| Generated output (clouds, the city fabric, renders) | CC0-1.0 | it is made by our code from our records | — |
| Builds | mixed, with credits | the license filter admits only CC0, CC BY and public domain; each build ships `ATTRIBUTION.md` and the viewer shows the credits (it already does) | — |
| Assets (glTF, scans) | per asset, through the same filter | section 13: a license per source and per asset | — |
| Contributor terms | **DCO** (`git commit -s`), inbound = outbound | lighter than a CLA, and common in open data and code | a CLA, if relicensing later must stay possible |

The datasets keep their own licenses: CC BY 4.0 for PALEOMAP, Cliopatria and TINITALY; CC0
for the OHM snapshot; public domain for SRTM and ETOPO. Their credits stay in the manifest.

Also:

- **Domain.** `worldmodelzero.com`, registered.
- **Name.** Check the name for trademark conflicts before launch.

## 5. Governance

### Roles

| Role | Does | How one becomes it |
|---|---|---|
| Contributor | opens issues and pull requests, reviews claims | anyone |
| Reviewer | accepts, disputes or corrects proposed claims in an area | 20 reviews in the area that a steward agreed with |
| Steward | owns an area (a region × era, or a domain such as deep time); merges in it; decides its default alternatives | appointed by the maintainers, with the agreement of the area's existing stewards |
| Maintainer | owns the code, the schema, infrastructure and releases | appointed by the maintainers |

At first the founder is the only maintainer and steward. The aim is to recruit stewards for
the slices that exist: deep time and geology; life; Rome the state; Rome the city.

### Areas as data

Section 9.3 asks for stewardship by region × era, "written with the same references and time
values as records". A file `world/stewards.yaml` lists the areas:

```yaml
areas:
  rome-city:
    stewards: [github-handle-1, github-handle-2]
    covers:
      places: [places/rome]                       # and everything part-of or within it
      time: { lo: 753 BCE, hi: 1600 CE }
    disputed_needs: 2                             # disputed topics need two stewards
```

A bot maps each changed record to its areas by its location, frame, `part-of` chain and
dates, and requests review from those stewards. Until that bot exists, `CODEOWNERS`
assigns by path (`world/entities/rome/` → the Rome stewards).

### Decisions

- **Day-to-day:** lazy consensus in issues and pull requests.
- **Changes to the model, schema or vocabularies:** a short RFC in `docs/rfcs/`, open for
  at least a week. A new term proposed with the first records that need it (section 4.9)
  needs only a steward's approval.
- **Disputes between stewards:** the maintainers decide, and the decision and its reasons
  are recorded on the alternative or in the group record (section 9.3).
- **More maintainers:** once there are five regular ones, form a small steering group with
  a written charter.

### Policies

Each is a short page in `docs/policies/`, linked from the site:

1. **Sourcing.** What counts as a source: primary works, peer-reviewed work, reference
   works, and datasets with versions. Tertiary sources such as Wikipedia are pointers,
   cited only when nothing better can be read. Every claim needs a locator, and quotes stay
   short.
2. **Contested history.** Disagreements become competing claims or alternatives, each
   attributed to a source, never silently resolved (section 9.3). The default picture is a
   steward decision with a recorded reason, and language stays neutral.
3. **People and remains.**
   - No claims about living private individuals.
   - Human remains and sacred sites carry handling notes, which the viewer and tours honour.
4. **Machine contributions.** Machine work is welcome and labelled:
   - It enters as `proposed`, with `author: machine:<tool>`.
   - Its quotes are verified against the source text by script, as the Rome quotes were.
   - Bulk machine pull requests need a steward's agreement before they are opened.
   - Nothing machine-made is accepted in bulk.
5. **Conduct.** Contributor Covenant 2.1, with named contacts for enforcement.
6. **Takedown.** A route to have a quote, an asset or a record removed, with a response
   time.
7. **Security.** `SECURITY.md`, with a private reporting address.

## 6. Contribution paths

### The ladder

| Step | Contribution | Skill needed | Phase |
|---|---|---|---|
| 1 | **Report a problem** from the viewer: a prefilled issue with the link (build, place, time, selection) and the record | none | 0 |
| 2 | **Review a claim:** read the quote, follow the locator, then accept, correct, dispute or "can't verify" | reading | 1 |
| 3 | **Add or correct a claim** with its citation, from the inspect panel | knowing a source | 2 (1 by pull request) |
| 4 | **Write a record** in YAML, with the scaffolding and cookbook | some git | 1 |
| 5 | **Map geometry** in OpenHistoricalMap, then refresh the snapshot | mapping | 1 |
| 6 | **Import a dataset:** a manifest entry, an importer and tests | programming | 1 |
| 7 | **Code:** generators, forms, the renderer and tools, with tests and goldens | programming | 1 |
| 8 | **Steward an area** | expertise and time | 1 |

Review (step 2) is the most needed and the easiest start. Every claim on the site is
waiting for it.

### What a pull request gets (Phase 1)

A bot comments on every pull request, updating the comment on each push:

- **Validation.** The validator's report, inline on the changed lines.
- **Semantic diff.** A build of the base and the head, compared record by record:
  - claims added, removed and changed;
  - status changes;
  - derived dates that moved (for example "`earth/orogens/himalaya` start: 59 → 70 Ma");
  - coverage before and after;
  - new wanted records.

  This needs a `world diff <base> <head>` command over two builds.
- **Render diffs.** Before and after images at the places and times the changed records
  touch, chosen from their locations and dates, in the same harness as the goldens.
- **A preview link,** deployed from the pull request's build and opening at the changed
  record: `https://pr-123.worldmodelzero.pages.dev/world/?sel=…&t=…`.

Pull requests from forks build in an untrusted job with no secrets. A separate
`workflow_run` job, which never checks out the pull request's code, uploads the
artifacts to the preview bucket and posts the comment.

### Reviewing what is already there

The 6,445 proposed claims are the backlog. They need two things:

- **Where reviews are recorded.** A claim gains a `review` list in its file, and the
  status follows it:

  ```yaml
  review:
    - { by: github-handle, on: 2027-01-12, verdict: accept, how: "read p. 412 of the 1929 edition" }
  ```

  - A claim becomes `accepted` when a reviewer other than its author accepts it.
  - A disputed topic needs two stewards.
  - A `dispute` verdict sets `disputed` and opens an issue.
  - The validator checks that every `accepted` claim has a qualifying review, which closes
    the gap left by "accepted" being only a field anyone can type.
- **A review queue.** A page on the site lists proposed claims by area and priority. The
  priority comes from where people go (section 8.4), from what tours declare, and from
  claims whose quote failed its script check. Each item shows the claim, the quote, the
  locator, a link to the source, and the record in the viewer. In Phase 1 a verdict turns
  into a small pull request opened for the reviewer; in Phase 2 it is one click in the
  site.

Imported records (`machine:ohm-import`) are reviewed upstream: a mapper fixes the element in
OpenHistoricalMap and the snapshot is refreshed. WikiWorldModel reviews only the claims it adds,
such as adopting an element under a written record.

### Contributor tooling (Phase 1)

| Tool | What it does |
|---|---|
| `CONTRIBUTING.md` | the ladder above, setup in ten minutes, how review works |
| A record cookbook (`docs/cookbook/`) | worked examples of each record type, as in `examples/`, written to the current schema |
| `npm run world -- new <kind> <id>` | scaffolds a record with the kind's usual properties and a source stub |
| `npm run world -- cite <doi>` | makes a source record from Crossref's metadata |
| Issue templates | report a problem, propose a record, propose a term, propose a dataset |
| A good-first-issue bot | files issues for wanted records, unsourced claims and quotes that failed their check, from each build's `coverage.json` |
| A docs site | the design doc, slices, policies, cookbook, glossary and vocabulary pages, generated from `world/schema/vocab/` |

### Editing in the viewer (Phase 2)

Section 12 says: "First, add an in-viewer editor that opens pull requests."

1. **Entry points.** Three buttons in the inspect panel: "Suggest a correction" on a claim,
   "Add a claim" on a record, and "Review" on a proposed claim.
2. **Forms from the vocabulary.** The property decides the widget:
   - time, with units and uncertainty;
   - a point, picked on the globe;
   - a quantity, in its unit;
   - a reference, searched;
   - text, with its language.

   A citation is required: pick a source, or paste a DOI or URL to make one.
3. **Validation in the browser.** The loader and validators move behind a small
   file-system interface, so the same code checks the edited record against the current
   build's world in the page. The temporal-network solver already runs in `core/`, so a
   contradiction is shown before submitting, as the CI would show it.
4. **Submit as a pull request.**
   - The contributor signs in with GitHub, through a GitHub App and a Cloudflare Worker
     that exchanges the OAuth code.
   - The editor commits to a branch of their fork, editing the YAML with comments kept
     (the `yaml` library's Document API).
   - It then opens a pull request with the reason and the source.
5. **Follow-up.** The contributor gets the preview link and the bot's comment, like any
   other pull request.
6. **No GitHub account.** Later, a bot account can open the pull request on the
   contributor's behalf, with their name in a trailer. That route needs rate limits and
   abuse checks first.

### Beyond git (Phase 3)

The move should be triggered by measures, not by date:

- review latency over a week for a month;
- more than about 50 outside pull requests a week;
- or the repository passing a few hundred thousand files.

Then, as section 12 says, the records move to Postgres or PostGIS behind an edit API with
OpenStreetMap-style changesets:

- the validators become the API's gatekeeper;
- git becomes a nightly export, so builds stay reproducible from a commit;
- the stable ids and one-record-per-file habits make the import a script.

## 7. The public site

### Layout

```
GitHub ── merge to main ──► CI: validate, build (content-hashed), test
                              │
                              ├─► object store:  builds/<build id>/…       immutable, kept by policy
                              │                  releases.json             channels: stable, next
                              ├─► static host:   worldmodelzero.com        the landing page; the viewer at /world/
                              │                  next.worldmodelzero.com   the viewer, next channel
                              │                  pr-<n>.preview…           per pull request
                              └─► entity pages:  worldmodelzero.com/w/<id> static HTML per record
```

| URL | What |
|---|---|
| `/` | the landing page ([site/](../../site/)): a still from the viewer with a way in, what the world holds, and how to contribute |
| `/world/` | the viewer, on the latest stable build |
| `/world/?b=<build>&t=…&sel=…` | a pinned view, as today |
| `/w/<entity id>` | a record's page: name, kind, when, where, claims with sources, reviews, and "open in 3D" |
| `/review` | the review queue (Phase 1, read-only; Phase 2, interactive) |
| `/coverage` | the coverage map as an overlay, with a table of wanted and unsourced records (section 8.4) |
| `/data/<build>/` | downloads: records as NDJSON or JSON-LD, the tile set, and `build.json` |
| `/about`, `/policies`, `/credits` | the project, its rules, and every dataset's credit and license |

### Releases

- **next.** Every merge to `main` is built and published here within the CI run.
- **stable.** A maintainer promotes a `next` build, weekly or when it is ready, after a
  smoke test.
  - Promotion writes release notes from the semantic diff against the previous stable
    build: what was added, what was accepted, and what moved.
  - Each stable release is deposited on Zenodo with a DOI, so researchers can cite the
    data they used.
- **Retention.** Stable builds are kept forever, since links pin them. `next` and preview
  builds are deleted after 90 days.
- **Old links and new viewers.** A link pins a build, but the viewer changes. Each build
  records the tile format it was written in (`lightworld-tile@3` and so on). The viewer
  keeps readers for every format still used by a stable build. Where that becomes too
  costly, each viewer release is kept under `/v/<version>/`, and the root sends an old
  build to the newest viewer that reads it.

### Serving

- **Hosting.** Cloudflare R2 for builds and the dataset mirror. It has no egress fees,
  which matters for a viewer that streams tiles (section 12). Cloudflare Pages serves the
  landing page, the viewer and the entity pages.
- **Today.** The Build workflow publishes `master` to Cloudflare Pages at
  worldmodelzero.com once the build's checks pass, and any branch it is run on by hand to a
  preview address on `worldmodelzero.pages.dev`.
  Each deployment carries the landing page, the viewer and the latest build, put together by
  `npm run build:site` (`tools/world/src/site.ts`). That is enough while a build is tens of
  megabytes and one is kept; builds move to R2 when pinned links need older builds, or when
  a build outgrows Pages' limits of 25 MiB a file and 20,000 files, which the step checks.
- **Headers.**
  - Builds: `Cache-Control: public, max-age=31536000, immutable`.
  - `releases.json` and the HTML: a short TTL.
  - CORS open for reads.
- **Compression.** Tiles are uncompressed today (a limitation in FIRST-SLICE). The build
  writes `.br` or `.gz` beside each tile, with `Content-Encoding` stored on the object.
- **The dataset mirror.** See [Datasets: storage and backup](#datasets-storage-and-backup).
- **Entity pages.** The build renders them from the records: plain HTML with JSON-LD
  (schema.org `Place`, `Event`, `CreativeWork`) and an Open Graph image. They load fast,
  work without WebGL, can be indexed by search engines, and are what people share and cite.

### Datasets: storage and backup

The datasets are not records, and they are not in the repository. A build reads 11 files,
165 MB, each named in the manifest with its URL and sha256, and the importers turn them into
fields and layers; only researched facts become records (section 12 of the design). The one
exception is the OpenHistoricalMap snapshot (380 kB), kept in `world/snapshots/` because no
stable URL serves an extract of a changing database. Everything else comes from its
publisher on every fresh build:

| Host | Datasets | Size |
|---|---|---|
| GitHub (raw and LFS) | the PALEOMAP plate model, the PaleoDEMs, Cliopatria | 50 MB |
| NOAA | two ETOPO 2022 tiles | 50 MB |
| INGV | a TINITALY tile | 44 MB |
| OpenTopography | two SRTM tiles | 21 MB |
| Springer, Elsevier | the CO₂ and sea-level supplementary tables | 0.3 MB |

A pin detects a changed file but cannot replace a lost one, and one missing host breaks every
build. Sandboxes often reach only a few hosts: the one this plan was written in reached GitHub
and none of the others. So the datasets need a copy the project controls:

- **A mirror, addressed by hash.** Each pinned file is copied to `blobs/sha256/<hash>`.
  Fetch tries the mirrors first, then the publisher's URL, and checks the hash either way, so
  a mirror can never change what a build reads. Every dataset in use is CC0, CC BY or public
  domain, so redistributing them is allowed; their credits travel with each build as now.
- **On GitHub first.** Until R2 exists, a release of this repository (`datasets-<date>`)
  holds the same files as assets, uploaded by a workflow run by hand. It costs nothing, and
  it lets agents in sandboxes that reach GitHub and little else build the world.
- **On R2 with the site.** The mirror moves to the object store when the site does.
- **An archive with each stable release.** The exact inputs of a stable build are deposited
  on Zenodo with its DOI (see Releases), so the data behind a citation outlives the
  project's own storage.
- **Changing databases** (OpenHistoricalMap, the PBDB, Wikidata) are kept as dated
  snapshots with the query that made them: in `world/snapshots/` while they are small, in
  the blob store when they are not.
- **Not backed up:** what the importers make of the datasets (`.cache/import`) and the
  tiles of `next` builds. Both are made again from the datasets and the code; CI caches them
  only for speed.

### What visitors' devices need

- **WebGL 2.** Without it, the visitor gets the entity pages and a still image.
- **Quality tiers.** The globe runs widely. The city renderer needs tiers: shadows, ambient
  occlusion, MSAA and bloom switch off on small GPUs, and the tier is chosen by a
  first-frame benchmark. The same lowest tier can make the city tests fast under
  SwiftShader in CI.
- **Budgets, checked in CI** (Lighthouse CI, and a Playwright trace on a throttled
  profile):
  - the first globe within three seconds on a mid-range phone on 4G;
  - 60 fps while flying on a mid-range laptop;
  - viewer JavaScript under 150 KB compressed.
- **Accessibility.**
  - The panels, the search and the time strip work from the keyboard.
  - Readouts are announced.
  - Colours pass contrast.
  - Evidence mode does not rely on colour alone.
- **Languages.** Names are already multilingual claims. Translating the interface comes
  with the docs site, through a translation platform with a free plan for open projects.

### Privacy and measurement

- **No cookies and no third-party trackers.** Page views come from Cloudflare Web
  Analytics or a self-hosted Plausible.
- **Where people go.** Section 8.4 wants an anonymous heat map of place and time. The
  viewer sends a sampled beacon with a coarse cell and time bin, and no id, to a Worker.
  The Worker counts them, and the counts are published with each build's coverage.
- **Errors.** Errors are reported without personal data (GlitchTip or Sentry), with the
  build and viewer versions.

## 8. Infrastructure and cost

Rough monthly costs at modest traffic, as of late 2026 (check current prices):

| Item | Assumption | Cost |
|---|---|---|
| Domain | one | about $15 a year |
| R2 storage | ~100 MB a build; 300 stable and recent builds kept; plus the 165 MB mirror | ~30 GB: under $1 |
| R2 reads | 100,000 sessions a month, ~200 tile and file requests each | ~20 M requests: about $4 after the free 10 M |
| Pages, Workers | static sites; sign-in and beacon Workers | free tier, or $5 |
| CI | GitHub Actions on a public repository, standard runners | free |
| GPU runner, optional | for the city's goldens at full quality, run nightly rather than per pull request | pay per minute, a few dollars a month |
| Errors and analytics | free tiers or self-hosted | $0–20 |
| **Total** | | **roughly $10–50 a month** |

Fixed costs stay small because nothing renders on a server. What can grow is CI time: a
full build takes several minutes, and the browser tests 10–15 on SwiftShader, minutes a view
for the city at full quality. So CI is in tiers, and only the first runs on every pull
request:

- **Checks**, a few minutes: the typecheck, the validators and the unit tests, from the
  code, the records and the plate model alone. Their cost grows with the world, so keep it
  near-linear: the plate-frame lookups are cached per location, and a world-wide pass that
  turns quadratic is a bug. Two have been: `claimOf`, at 13 of validation's 19 seconds; and
  the competing dates, every one solved in every picture against the whole world, 6,656
  solves at 1,429 entities. Now each competing date is solved only in the piece of the
  network it is in (`solveChanged` in `core/stn.ts`). The largest piece, the time scale and
  the tree of life with all that is dated by them, is still more than half the network; it is
  the next to split.
- **Build**, when `master` changes or a pull request changes how the world is built: every
  dataset, the build (once), checks on it, and the deployment. Records alone don't trigger it; the
  validators are their check. The import is cached by its input hash.
- **Nightly**: the browser tests against their goldens, and a second build compared to the
  byte with the first. A failure means a picture or a byte changed, for a person to look at.

## 9. Security and trust

- **Secrets never reach fork code.** Preview and comment jobs use `workflow_run` on
  artifacts and never check out the pull request. Deploy credentials use OIDC to
  Cloudflare, scoped to a bucket prefix.
- **Supply chain.**
  - Dependencies are pinned, with lockfiles.
  - Dependabot proposes updates; CI tests them.
  - `npm ci` and `pip install --require-hashes` (or `uv` with a lockfile).
- **A content security policy** on the site, with no inline scripts. Sources' URLs are
  rendered as links, never as HTML.
- **Generators are code.** A generator runs in the visitor's browser. Changes to
  `world/generators/` need a maintainer's review, as code does, not just a steward's.
- **Vandalism and spam.**
  - Everything enters by pull request, so nothing is live before review.
  - The in-viewer editor adds rate limits per account.
  - New accounts face a lower limit.
  - The bot flags pull requests that change many records at once.
- **Trust on the site.**
  - Every claim shows whether a person has reviewed it.
  - A banner says how much of what is on screen has been reviewed.
  - The about page explains that the world was drafted by machines from cited sources,
    and is being checked by people.

## 10. Community and sustainability

- **Where people talk.**
  - GitHub Discussions for questions and proposals.
  - One chat space (Matrix or Discord) for working together.
  - A short monthly note: what was added and reviewed, what is wanted.
- **First contributors.** Recruit before launching: each slice has a natural community.
  - Paleobiology Database users for the fossils.
  - The Pleiades and OpenHistoricalMap communities for Rome and the city.
  - Geology teachers for the deep-time states.
  - Ask a few of them to steward an area, and to review its claims before launch.
- **A launch that shows the method.**
  - Open first to these invited reviewers.
  - Launch publicly once the showcase areas have been reviewed by people: Rome in 315 and
    the end-Cretaceous.
  - The first impression should be "every fact has a source, and a person checked it",
    not "a machine wrote this".
- **Money.**
  - A fiscal host (Open Source Collective, or a foundation later) for donations and
    grants.
  - Digital-humanities and open-science grants fund specific slices.
  - Running costs are small enough not to need sponsors.
- **Partnerships.** Upstream projects gain from WikiWorldModel's validators finding errors in
  their data. Report what is found, and credit them prominently in the viewer.

## 11. Roadmap

### Phase 0: ready to open (2–4 weeks)

- [x] Make CI green on `main`, and quick: checks on every pull request, the build when
      the code that makes it changes, the renders nightly (section 10).
- [x] Choose and add the licenses (section 4): `LICENSE` (code), `LICENSE-DATA` (records),
      the DCO check, `ATTRIBUTION.md` written by the build.
- [x] `README` for newcomers, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`,
      issue and pull-request templates, `CODEOWNERS`.
- [ ] Policies: sourcing, contested history, people and remains, machine contributions,
      takedown.
- [ ] Mirror the datasets by sha256, with fetch trying the mirror first: a GitHub release
      now, R2 with the site (section 7).
- [ ] Deploy pipeline:
  - the domain and R2;
  - `next` on every merge;
  - promotion to `stable`;
  - precompressed tiles;
  - cache headers;
  - retention.
- [ ] "Report a problem" in the viewer, opening a prefilled issue.
- [ ] Privacy-respecting page analytics and error reporting.

Done when a stranger can clone, build and get a green pull request within an hour, and
`worldmodelzero.com` serves the stable build.

### Phase 1: contributions by pull request (1–3 months after)

- [ ] The pull-request bot: validation, semantic diff (`world diff`), render diffs,
      preview deploys from forks.
- [ ] Review records (`review:` on claims), the validator rule for `accepted`, and the
      read-only review queue on the site, where a verdict opens a pull request.
- [ ] Entity pages, with JSON-LD and Open Graph images; data downloads per build.
- [ ] Scaffolding (`world new`, `world cite`), the record cookbook, the docs site.
- [ ] `world/stewards.yaml`, the areas bot, the first outside stewards for the four
      showcase areas.
- [ ] The good-first-issue bot, from `coverage.json`.
- [ ] Quality tiers, and the performance budgets in CI.
- [ ] Soft launch to invited reviewers, then a public launch once the showcase areas are
      reviewed.

Done when 10 people outside the founders have merged contributions, 1,000 claims have
been accepted by a person, and the median time to review a pull request is under a week.

### Phase 2: edit in the viewer (3–6 months after)

- [ ] The loader and validators behind a file-system interface, so they run in the
      browser.
- [ ] Sign-in with GitHub (GitHub App and a Worker), and forms generated from the
      vocabulary.
- [ ] Suggest, add and review from the inspect panel, opening pull requests; DOI lookup
      for sources.
- [ ] The interactive review queue for reviewers and stewards.
- [ ] Interface translation; the "where people go" heat map in coverage.

Done when most new claims arrive through the viewer, and a reviewer can work through the
queue without leaving the site.

### Phase 3: beyond git (when the measures in section 6 say so)

- [ ] An edit API over Postgres and PostGIS with changesets, the validators as its
      gatekeeper, and git as a nightly export.
- [ ] Accounts beyond GitHub, with moderation tools.

## 12. Decisions needed

1. **Licenses:** decided: Apache-2.0 for code, CC0 for records and documents.
2. **Contributor terms:** decided: the DCO.
3. **Domain and hosting account:** Cloudflare recommended. The project's name also needs
   checking.
4. **Governance at the start:** the founder as maintainer and steward, with stewards
   appointed per area. Who are the first stewards to ask?
5. **Default branch:** stay on `master`, or move to `main` before contributors arrive.
   This plan says `main`.
6. **The machine-made content at launch:** keep all of it visible and marked `proposed`
   (recommended), or show only reviewed claims by default with a switch for the rest.
7. **When to launch publicly:** after the showcase areas are reviewed (recommended), or
   as soon as Phase 0 is done, with a clear "early, machine-drafted" banner.

## 13. Risks

| Risk | Mitigation |
|---|---|
| The site is judged as machine-written history | review before public launch; unreviewed claims marked everywhere; method explained up front |
| Review does not keep up | review is the easiest contribution; the queue is prioritised by where people go; machine pre-checks of quotes; stewards recruited per area |
| Edit wars over contested history | alternatives instead of overwrites; the contested-history policy; two stewards on disputed topics |
| A dataset or host disappears | the sha256 mirror; snapshots kept for changing databases |
| A license mistake gets into a build | the license filter in CI, a license per asset, DCO, a takedown route |
| Hosting costs or abuse spike | no egress fees; immutable caching; rate limits on the Workers and the editor |
| Low-end devices can't run the city | quality tiers; entity pages work without WebGL |
| One maintainer | written policies, a documented release process, a second maintainer recruited in Phase 1 |
