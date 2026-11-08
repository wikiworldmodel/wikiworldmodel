# Example world data (format stress test)

Hand-written sample records for every record type in
[docs/WORLD-MODEL.md](../../WORLD-MODEL.md), laid out as its section 10
proposes. They exist to find where the format is underspecified. **They are
not data**: sources are real works, but values, locators and external IDs are
unchecked, and anything marked `# illustrative` is invented.

Where the doc doesn't say how to express something, the records pick an
answer and tag it `# GAP-xx`. [GAPS.md](GAPS.md) lists every gap with the
choice made here and the alternatives.

Run the reference checker:

```bash
python3 docs/archive/examples/check.py
```

## Conventions these records assume (none are in the doc yet)

**References** (GAP-01, GAP-02)

| Target | Form | Example |
|---|---|---|
| entity | bare id | `rome/colosseum` |
| phase | `entity@phase` | `rome/colosseum@flavian` |
| claim or relation | `entity#local` | `rome/colosseum#c2` |
| other record types | prefixed | `src:suetonius-lives`, `frame:rome/site-grid`, `field:earth/sea-level`, `gen:rome/insula`, `period:ics/cretaceous`, `ds:pbdb`, `tour:lifeforce-opening`, `asset:sha256:…` |
| external | `scheme:id` | `wikidata:Q10285`, `pbdb:occ:1234` |

Inside an entity file, `@phase` and `#c1` are local shorthand.

**Time values** (GAP-10, GAP-11). A bare number is a decimal astronomical
year (44 BCE = −43). Maps add uncertainty: `{lo, hi}`, `{mean, sd}`,
`{pdf: …}`, `{derive: [...]}`. Deep-time values may give `unit: ma | ga | ka`
(before 1950) or `unit: bp` (radiocarbon years before 1950), which the
loader converts to astronomical years; `unit: from_now_gyr` is used for
projections.

**Claims** (GAP-20…). Full form:

```yaml
c1:
  subject: "@flavian"          # default: the entity itself
  prop: begun_under            # from schema/vocab/properties.yaml
  value: rome/reign/vespasian
  valid: { lo: 69.5, hi: 79.5 } # when it holds; default = subject's interval
  source: { ref: src:suetonius-lives, loc: "Vesp. 9.1" }
  method: textual              # vocabulary in properties.yaml
  confidence: high             # low | medium | high, or a probability
  author: person:example-editor
  status: accepted             # proposed | accepted | disputed | deprecated
  rank: preferred              # preferred | normal | deprecated
```

Omitted `status` means `accepted`, omitted `rank` means `normal` (GAP-21).
