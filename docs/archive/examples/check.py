#!/usr/bin/env python3
"""Reference and sanity checker for the example world records.

Not the real validator (section 9.2 of WORLD-MODEL.md). It checks what the
examples can check without a schema: refs resolve, vocabularies are used,
time values use a known form, and each entity's phases are ordered and
contiguous. Usage: python3 docs/archive/examples/check.py [world_dir]
"""
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import yaml

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "world"
PREFIXES = ("src:", "frame:", "field:", "gen:", "period:", "ds:", "tour:")
AGO_UNITS = {"ka": 1e3, "ma": 1e6, "ga": 1e9, "bp": 1, "yr_bp": 1}
FUTURE_UNITS = {"from_now_gyr": 1e9}
SPAN_UNITS = {"gyr": 1e9}
NOW = 2026.8
STATUS = {"proposed", "accepted", "disputed", "deprecated"}
RANK = {"preferred", "normal", "deprecated"}
BASIS = {"evidence", "reconstruction", "procedural", "projection", "derived"}
REF_KEYS = {"to", "subject", "ref", "from", "budget", "entity", "look_at", "agent",
            "via", "checks", "scenario", "value", "parent", "body"}
ENTITY_RE = re.compile(r"^[a-z0-9-]+(/[a-z0-9.-]+)+([@#][\w.-]+)?$")
TIME_KEYS = {"start", "end", "valid", "at", "world_time", "covers", "composed", "surveyed", "time", "era"}

errors, warnings = [], []


def err(f, msg): errors.append(f"{f}: {msg}")
def warn(f, msg): warnings.append(f"{f}: {msg}")


def load_all():
    docs = {}
    for p in sorted(ROOT.rglob("*.yaml")):
        rel = p.relative_to(ROOT)
        try:
            docs[rel] = yaml.safe_load(p.read_text())
        except yaml.YAMLError as e:
            err(rel, f"YAML parse error: {e}")
    return docs


def to_year(v, unit):
    """Convert one number in `unit` to a decimal astronomical year."""
    if unit in AGO_UNITS:
        return 1950 - v * AGO_UNITS[unit]
    if unit in FUTURE_UNITS:
        return NOW + v * FUTURE_UNITS[unit]
    return v


def time_bounds(v, f, where):
    """Return (lo, hi) in astronomical years for a literal time value, or None
    when it is derived or referenced. Warn on forms outside the convention."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return (v, v)
    if not isinstance(v, dict):
        warn(f, f"{where}: time value {v!r} is not a number or map")
        return None
    if {"derive", "ref", "pdf"} & v.keys():
        return None
    unit = v.get("unit", "year")
    known = {"lo", "hi", "mean", "sd", "unit", "note", "edge", "lag", "minus",
             "sampling", "interp", "step_ka", "slices", "slices_ma", "bins"}  # field time axes
    odd = set(v) - known
    if any(isinstance(v.get(k), dict) for k in ("lo", "hi", "mean")):
        warn(f, f"{where}: time bound is itself a map {v}; GAP-12")
        return None
    if odd:
        warn(f, f"{where}: non-canonical time form {v} (keys {sorted(odd)}); GAP-12")
        return None
    if unit not in AGO_UNITS | FUTURE_UNITS | {"year": 1}:
        warn(f, f"{where}: unknown time unit {unit!r}")
        return None
    nums = {k: v[k] for k in ("lo", "hi", "mean") if isinstance(v.get(k), (int, float))}
    if not nums:
        return None
    lo, hi = nums.get("lo", nums.get("mean")), nums.get("hi", nums.get("mean"))
    lo = float("-inf") if lo is None else to_year(lo, unit)   # open interval, e.g. hi: null
    hi = float("inf") if hi is None else to_year(hi, unit)
    if lo > hi:
        warn(f, f"{where}: lo is later than hi after converting {unit} to years ({v}); GAP-13")
        lo, hi = hi, lo
    if "mean" in nums and ("lo" in nums or "hi" in nums):
        m = to_year(nums["mean"], unit)
        if not lo <= m <= hi:
            warn(f, f"{where}: mean {nums['mean']} outside [lo, hi]; GAP-11")
    return (lo, hi)


def main():
    docs = load_all()
    vocab = ROOT / "schema" / "vocab"
    kinds_doc = docs.get(Path("schema/vocab/kinds.yaml"), {})["kinds"]
    kinds = set()
    for k, spec in kinds_doc.items():
        kinds.add(k)
        for c in (spec or {}).get("children", []):
            kinds.add(f"{k}/{c}")
    props_doc = docs[Path("schema/vocab/properties.yaml")]
    props, methods = props_doc["properties"], set(props_doc["methods"])
    rels = set()
    for fam in docs[Path("schema/vocab/relations.yaml")]["families"].values():
        rels |= set(fam) | set(fam.values())
    editors = docs.get(Path("sources/lightworld-editors.yaml"), {})
    people, machines = set(editors.get("people", {})), set(editors.get("machines", {}))

    # registries
    entities, locals_, by_type = {}, defaultdict(set), Counter()
    prefixed = set(f"ds:{k}" for k in docs[Path("manifest.yaml")]["datasets"])
    for f, d in docs.items():
        if not isinstance(d, dict) or "id" not in d:
            continue
        rid = d["id"]
        if str(f).startswith("entities/"):
            if rid in entities:
                err(f, f"duplicate entity id {rid} (also {entities[rid]})")
            entities[rid] = f
            by_type["entity"] += 1
            for ph in d.get("phases") or []:
                locals_[rid].add("@" + ph["id"])
            for sect in ("claims", "relations"):
                for k in (d.get(sect) or {}):
                    if "#" + k in locals_[rid]:
                        err(f, f"local id {k} used in both claims and relations")
                    locals_[rid].add("#" + k)
        else:
            prefixed.add(rid)
            by_type[str(f).split("/")[0]] += 1
    by_type["dataset"] = len(docs[Path("manifest.yaml")]["datasets"])

    unresolved = Counter()

    def check_ref(f, owner, s, where):
        if not isinstance(s, str):
            return
        if s.startswith(("@", "#")):
            if owner and s not in locals_[owner]:
                err(f, f"{where}: local ref {s} not defined in this entity")
            return
        if s.startswith("person:"):
            if s[7:] not in people:
                warn(f, f"{where}: {s} not in editor registry and not an entity; GAP-17")
            return
        if s.startswith("machine:"):
            if s[8:].split("@")[0] not in machines:
                warn(f, f"{where}: unknown machine author {s}")
            return
        if s.startswith(PREFIXES):
            base = s.split("@")[0].split("#")[0]
            if base not in prefixed:
                unresolved[base] += 1
                warn(f, f"{where}: unresolved {base}")
            return
        if ENTITY_RE.match(s):
            base = re.split(r"[@#]", s)[0]
            if base not in entities:
                unresolved[base] += 1
                warn(f, f"{where}: unresolved entity {base}")
            else:
                local = s[len(base):]
                if local and local not in locals_[base]:
                    err(f, f"{where}: {base} has no {local}")

    def walk(f, owner, node, path, prop_type=None):
        if isinstance(node, dict):
            for k, v in node.items():
                p = f"{path}.{k}" if path else str(k)
                if k in TIME_KEYS and isinstance(v, (int, float, dict)):
                    time_bounds(v, f, p)
                if k in TIME_KEYS and isinstance(v, str):
                    check_ref(f, owner, v, p)
                elif k in REF_KEYS and isinstance(v, str):
                    if k == "value" and prop_type != "ref":
                        continue
                    check_ref(f, owner, v, p)
                elif k in ("refs", "validated_by", "excludes", "of", "derive", "from") and isinstance(v, list):
                    for i, s in enumerate(v):
                        check_ref(f, owner, s, f"{p}[{i}]")
                elif k == "bind" and isinstance(v, dict):
                    for bk, bv in v.items():
                        check_ref(f, owner, bv, f"{p}.{bk}")
                else:
                    walk(f, owner, v, p, prop_type)
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(f, owner, v, f"{path}[{i}]", prop_type)
        elif isinstance(node, str) and node.startswith(PREFIXES) and " " not in node:
            check_ref(f, owner, node, path)

    stats = Counter()
    basis_count = Counter()
    for f, d in docs.items():
        if not isinstance(d, dict):
            continue
        owner = d.get("id") if str(f).startswith("entities/") else None
        if owner is None:
            walk(f, None, d, "")
            continue
        if d.get("kind") not in kinds:
            err(f, f"kind {d.get('kind')!r} not in kinds vocabulary")
        if "frame" not in d and not all("frame" in ph for ph in d.get("phases") or []):
            warn(f, "no entity frame and not every phase has one; GAP-49")
        # phases: basis, order, continuity
        prev_end = None
        for i, ph in enumerate(d.get("phases") or []):
            where = f"phases[{i}]({ph.get('id')})"
            b = ph.get("basis")
            basis_count[b] += 1
            if b not in BASIS:
                err(f, f"{where}: basis {b!r} not in {sorted(BASIS)}")
            s = time_bounds(ph.get("start"), f, f"{where}.start")
            e = time_bounds(ph.get("end"), f, f"{where}.end")
            if s and e and s[0] > e[1]:
                err(f, f"{where}: starts after it ends")
            if prev_end and s and s[0] > prev_end[1] + 1:
                warn(f, f"{where}: gap after previous phase ({prev_end[1]:.6g} → {s[0]:.6g}); GAP-61")
            if prev_end and s and s[1] < prev_end[0] - 1:
                warn(f, f"{where}: overlaps previous phase")
            prev_end = e
            walk(f, owner, {k: v for k, v in ph.items() if k not in ("start", "end")}, where)
            for k in ("start", "end"):
                if isinstance(ph.get(k), dict):
                    walk(f, owner, {x: y for x, y in ph[k].items() if x in ("derive", "ref")}, f"{where}.{k}")
        for k, c in (d.get("claims") or {}).items():
            stats["claims"] += 1
            where = f"claims.{k}"
            pspec = props.get(c.get("prop"))
            if pspec is None:
                err(f, f"{where}: prop {c.get('prop')!r} not in property vocabulary")
            if c.get("status", "accepted") not in STATUS:
                err(f, f"{where}: status {c.get('status')!r}")
            if c.get("rank", "normal") not in RANK:
                err(f, f"{where}: rank {c.get('rank')!r}")
            if "method" in c and c["method"] not in methods:
                err(f, f"{where}: method {c['method']!r} not in vocabulary")
            if "basis" in c and c["basis"] not in BASIS:
                err(f, f"{where}: basis {c['basis']!r}")
            if "source" not in c:
                stats["claims_without_source"] += 1
            author = str(c.get("author", ""))
            if author.startswith("machine:"):
                stats["machine_claims"] += 1
                if c.get("status") != "proposed":
                    err(f, f"{where}: machine claim must be status: proposed (section 8.3)")
            if c.get("status") == "disputed":
                stats["disputed_claims"] += 1
            if c.get("valid") is not None:
                time_bounds(c["valid"], f, f"{where}.valid")
            if (pspec or {}).get("type") == "time":
                time_bounds(c.get("value"), f, f"{where}.value")
            walk(f, owner, {x: y for x, y in c.items() if x != "valid"}, where,
                 (pspec or {}).get("type"))
        for k, r in (d.get("relations") or {}).items():
            stats["relations"] += 1
            where = f"relations.{k}"
            if r.get("rel") not in rels:
                err(f, f"{where}: rel {r.get('rel')!r} not in relation vocabulary")
            walk(f, owner, r, where)
        rest = {k: v for k, v in d.items() if k not in ("phases", "claims", "relations", "id")}
        walk(f, owner, rest, "")

    print(f"Loaded {len(docs)} files from {ROOT}")
    print("Records:", ", ".join(f"{k} {v}" for k, v in sorted(by_type.items())))
    print("Claims:", stats["claims"], "| relations:", stats["relations"],
          "| disputed:", stats["disputed_claims"], "| machine:", stats["machine_claims"],
          "| without source:", stats["claims_without_source"])
    print("Phase basis:", dict(basis_count))
    if unresolved:
        print(f"Unresolved targets ({len(unresolved)}):", ", ".join(sorted(unresolved)))
    print(f"\n{len(errors)} errors")
    for e in errors:
        print("  E", e)
    print(f"\n{len(warnings)} warnings")
    for w in warnings:
        print("  W", w)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
