#!/usr/bin/env python3
"""Compare base and head complexity measurements, write a PR report, and set the exit code.

Rules (limits live in thresholds.json):

  density      Production complexity per 1,000 lines may grow by at most fail_pct
               relative to the base. Above warn_pct it warns. Waivable with the label.
  new_hotspot  A function over its limit that did not exist in the base, or was under
               the limit there. Not waivable: split it.
  grew_hotspot A function already over its limit that got more complex. Not waivable:
               the ratchet only moves down.
  share        Share of complexity sitting in over-limit functions. Fails above
               share_fail_pct and only if it rose. Waivable with the label.

Usage: gate.py --base base.json --head head.json --report report.md [--labels a,b]
Exit code 1 when an unwaived failure remains.
"""
import argparse
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
WAIVER_LABEL = "complexity-exception"


def key(f):
    return f"{f['lang']}|{f['file']}|{f['name']}"


def limit_for(f, th):
    return th["elixir_fn_max"] if f["lang"] == "elixir" else th["ts_fn_max"]


def by_key(functions):
    out = {}
    for f in functions:
        k = key(f)
        if k not in out or f["cc"] > out[k]["cc"]:
            out[k] = f
    return out


def evaluate(base, head, th, labels):
    bt, ht = base["totals"], head["totals"]
    waived = WAIVER_LABEL in labels
    results = []  # (rule, status, message)

    # density
    if bt["density"] > 0:
        rel = (ht["density"] - bt["density"]) / bt["density"] * 100
        if rel > th["density_fail_pct"]:
            status = "waived" if waived else "fail"
        elif rel > th["density_warn_pct"]:
            status = "warn"
        else:
            status = "pass"
        results.append(("density", status, f"{rel:+.1f}% (warn above {th['density_warn_pct']}%, fail above {th['density_fail_pct']}%)"))
    else:
        results.append(("density", "pass", "no baseline density on the base; skipped"))

    bmap, hmap = by_key(base["functions"]), by_key(head["functions"])

    # new hotspot
    new_hot = []
    for k, f in hmap.items():
        if f["cc"] > limit_for(f, th):
            prev = bmap.get(k)
            if prev is None or prev["cc"] <= limit_for(prev, th):
                new_hot.append(f)
    results.append((
        "new_hotspot", "fail" if new_hot else "pass",
        "; ".join(f"{f['file']}:{f['line']} {f['name']} = {f['cc']}" for f in new_hot) or "none",
    ))

    # grew hotspot
    grew = []
    for k, f in hmap.items():
        prev = bmap.get(k)
        if prev and prev["cc"] > limit_for(prev, th) and f["cc"] > prev["cc"]:
            grew.append((prev, f))
    results.append((
        "grew_hotspot", "fail" if grew else "pass",
        "; ".join(f"{h['file']}:{h['line']} {h['name']} {p['cc']} -> {h['cc']}" for p, h in grew) or "none",
    ))

    # share
    hs, bs = ht["hotspot_share"], bt["hotspot_share"]
    if hs > th["share_fail_pct"] and hs > bs:
        status = "waived" if waived else "fail"
    else:
        status = "pass"
    results.append(("share", status, f"{bs}% -> {hs}% (fail above {th['share_fail_pct']}% and only if it rose)"))

    fails = [r for r in results if r[1] == "fail"]
    return results, fails, new_hot, grew


GUIDANCE = {
    "density": (
        "Production complexity per 1,000 lines grew more than the budget. Move the largest new branch "
        "out of the function it sits in: a named helper, a pattern-matched function head, or a data "
        "table instead of a chain of conditions. If the growth is intended, add the label "
        f"`{WAIVER_LABEL}` and say why in the PR body."
    ),
    "new_hotspot": (
        "A new function is over its limit (Elixir 9, TypeScript 10). Split it before merging: extract "
        "clauses into named helpers, turn nested `case`/`cond` into function heads or a lookup table, "
        "and keep per-kind or per-tool branching in the kind registry or a handler table."
    ),
    "grew_hotspot": (
        "A function that was already over its limit got more complex. Do not add branches to it. "
        "Extract the new branch into its own function first, then add to that."
    ),
    "share": (
        "Too much complexity sits in over-limit functions. Break down the largest one before adding "
        f"more. Waivable with `{WAIVER_LABEL}` for an intended, explained exception."
    ),
}


def report_markdown(base, head, th, results, fails, new_hot, grew, labels):
    bt, ht = base["totals"], head["totals"]
    status = "FAILED" if fails else "passed"
    lines = [
        "<!-- complexity-report -->",
        f"## Complexity budget: {status}",
        "",
        "Production code only (Elixir `lib/`, TypeScript `assets/js/`). Tests are not counted. "
        "Base is the PR's base commit. Limits are in `tools/complexity/thresholds.json`.",
        "",
        "| Metric | Base | Head | Change |",
        "|---|---:|---:|---:|",
    ]
    for label, k in [
        ("Complexity (sum)", "prod_cc"), ("Production lines", "prod_loc"),
        ("Density per 1,000 lines", "density"), ("Functions", "functions"),
        ("Functions over limit", "hotspot_fns"), ("Share in over-limit functions (%)", "hotspot_share"),
        ("Largest function", "max_cc"),
    ]:
        b, h = bt[k], ht[k]
        delta = h - b
        lines.append(f"| {label} | {b} | {h} | {delta:+g} |")
    lines += ["", "| Rule | Result | Detail |", "|---|---|---|"]
    icon = {"pass": "pass", "warn": "warn", "fail": "**fail**", "waived": "waived"}
    for rule, st, detail in results:
        lines.append(f"| {rule} | {icon[st]} | {detail} |")
    base_map = by_key(base["functions"])
    growers = sorted(
        ((h["cc"] - base_map.get(key(h), {}).get("cc", 0), h) for h in head["functions"]),
        key=lambda x: -x[0],
    )[:5]
    if growers and growers[0][0] > 0:
        lines += ["", "Largest increases by function:", ""]
        for delta, f in growers:
            if delta <= 0:
                break
            lines.append(f"- `{f['file']}:{f['line']}` {f['name']}: +{delta} (now {f['cc']})")
    if fails:
        lines += ["", "### What to do"]
        for rule, st, _ in results:
            if st == "fail":
                lines.append(f"- **{rule}**: {GUIDANCE[rule]}")
    if labels:
        lines += ["", f"Labels on this PR: {', '.join(sorted(labels))}"]
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--head", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--labels", default="")
    ap.add_argument("--thresholds", default=os.path.join(HERE, "thresholds.json"))
    args = ap.parse_args()
    base = json.load(open(args.base))
    head = json.load(open(args.head))
    th = json.load(open(args.thresholds))
    labels = {l.strip() for l in args.labels.split(",") if l.strip()}
    results, fails, new_hot, grew = evaluate(base, head, th, labels)
    md = report_markdown(base, head, th, results, fails, new_hot, grew, labels)
    with open(args.report, "w", encoding="utf-8") as f:
        f.write(md)
    print(md)
    raise SystemExit(1 if fails else 0)


if __name__ == "__main__":
    main()
