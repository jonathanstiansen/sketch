#!/usr/bin/env python3
"""Measure production code complexity for one checkout and write JSON.

Scope is production code only: Elixir under lib/ and TypeScript under assets/js/
(generated code and .d.ts files are left out). Tests are not counted here.

Elixir uses cc.exs, which reimplements Credo 1.7's Refactor.CyclomaticComplexity rule.
TypeScript uses lizard's cyclomatic number (CCN), which matches ESLint's complexity
rule on the samples checked when this was written.

The same copy of this script measures both the base and the head, so the two numbers
are comparable even when the branches changed the measurement tools.

Usage: measure.py --root <checkout> --out <file.json>
"""
import argparse
import csv
import glob
import io
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ELIXIR_RULE = os.path.join(HERE, "cc.exs")


def count_loc(path):
    """Non-blank lines that are not comments. Same definition used for every measurement."""
    n = 0
    with open(path, encoding="utf-8", errors="ignore") as f:
        for line in f:
            s = line.strip()
            if s and not s.startswith("#"):
                n += 1
    return n


def elixir_functions(root):
    files = sorted(
        glob.glob(os.path.join(root, "lib", "**", "*.ex"), recursive=True)
        + glob.glob(os.path.join(root, "lib", "**", "*.exs"), recursive=True)
    )
    if not files:
        return [], 0
    proc = subprocess.run(
        ["elixir", ELIXIR_RULE, *files], capture_output=True, text=True
    )
    parse_errors = [l for l in proc.stderr.splitlines() if l.startswith("PARSE_ERROR")]
    if proc.returncode != 0 or parse_errors:
        # A file that does not parse must fail the job, not silently drop out of the count.
        sys.exit(f"cc.exs failed for {root}: rc={proc.returncode} {parse_errors[:3]}")
    fns = []
    for line in proc.stdout.splitlines():
        path, module, name, lineno, cc = line.split("\t")
        fns.append(
            dict(
                lang="elixir",
                file=os.path.relpath(path, root),
                name=f"{module}.{name}",
                line=int(lineno),
                cc=int(cc),
            )
        )
    loc = sum(count_loc(f) for f in files)
    return fns, loc


def typescript_functions(root):
    if not os.path.isdir(os.path.join(root, "assets", "js")):
        return [], 0
    proc = subprocess.run(
        [
            sys.executable, "-m", "lizard", "--csv", "assets/js",
            "--exclude", "*/node_modules/*", "--exclude", "*/vendor/*", "--exclude", "*.d.ts",
        ],
        cwd=root, capture_output=True, text=True,
    )
    if proc.returncode != 0:
        sys.exit(f"lizard failed for {root}: {proc.stderr[:500]}")
    fns = []
    for rec in csv.reader(io.StringIO(proc.stdout)):
        if len(rec) < 10:
            continue
        ccn, file_, fn, start = rec[1], rec[6], rec[7], rec[9]
        f = os.path.normpath(file_)
        if f.startswith("assets/js/generated/"):
            continue
        fns.append(dict(lang="ts", file=f, name=fn, line=int(start or 0), cc=int(ccn)))
    ts_files = glob.glob(os.path.join(root, "assets", "js", "**", "*.ts"), recursive=True)
    loc = sum(
        count_loc(f) for f in ts_files
        if not f.endswith(".d.ts") and "/generated/" not in f
    )
    return fns, loc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    root = os.path.abspath(args.root)
    ex_fns, ex_loc = elixir_functions(root)
    ts_fns, ts_loc = typescript_functions(root)
    fns = ex_fns + ts_fns
    loc = ex_loc + ts_loc
    total = sum(f["cc"] for f in fns)
    thresholds = json.load(open(os.path.join(HERE, "thresholds.json")))
    over = [
        f for f in fns
        if f["cc"] > (thresholds["elixir_fn_max"] if f["lang"] == "elixir" else thresholds["ts_fn_max"])
    ]
    over_cc = sum(f["cc"] for f in over)
    result = dict(
        totals=dict(
            prod_cc=total,
            prod_loc=loc,
            density=round(total / loc * 1000, 2) if loc else 0.0,
            elixir_cc=sum(f["cc"] for f in ex_fns),
            elixir_loc=ex_loc,
            ts_cc=sum(f["cc"] for f in ts_fns),
            ts_loc=ts_loc,
            functions=len(fns),
            hotspot_fns=len(over),
            hotspot_share=round(over_cc / total * 100, 2) if total else 0.0,
            max_cc=max((f["cc"] for f in fns), default=0),
        ),
        functions=fns,
    )
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=1)
    t = result["totals"]
    print(
        f"{root}: prod_cc={t['prod_cc']} prod_loc={t['prod_loc']} density={t['density']} "
        f"hotspot_fns={t['hotspot_fns']} hotspot_share={t['hotspot_share']}%"
    )


if __name__ == "__main__":
    main()
