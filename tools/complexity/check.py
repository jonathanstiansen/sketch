#!/usr/bin/env python3
"""Fail when a PR adds or grows a TypeScript function over the complexity limit.

Measures assets/js/**/*.ts (generated code and .d.ts excluded) with lizard, for the
base checkout and the head checkout. A function fails the check when, in the head,
it is over LIMIT and either it did not exist in the base, it was at or under LIMIT
there, or it is over LIMIT and got more complex.

Elixir is not measured here: `mix credo --strict` already fails above Credo's
limit of 9 for every function in lib/ and test/.

Usage: check.py --base DIR --head DIR --report FILE
"""
import argparse
import csv
import io
import os
import subprocess
import sys

LIMIT = 10  # McCabe's classic threshold; lizard's own default is 15


def functions(root):
    """Return {(file, name): max cc} for production TypeScript under root."""
    if not os.path.isdir(os.path.join(root, "assets", "js")):
        return {}
    proc = subprocess.run(
        [
            sys.executable, "-m", "lizard", "--csv", "assets/js",
            "--exclude", "*/node_modules/*", "--exclude", "*/vendor/*",
            "--exclude", "*.d.ts", "--exclude", "*/generated/*",
        ],
        cwd=root, capture_output=True, text=True,
    )
    if proc.returncode != 0:
        sys.exit(f"lizard failed in {root}: {proc.stderr[:500]}")
    out = {}
    for rec in csv.reader(io.StringIO(proc.stdout)):
        if len(rec) < 10:
            continue
        cc, file_, name, line = int(rec[1]), os.path.normpath(rec[6]), rec[7], int(rec[9] or 0)
        k = (file_, name)
        if k not in out or cc > out[k][0]:
            out[k] = (cc, line)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--head", required=True)
    ap.add_argument("--report", required=True)
    args = ap.parse_args()

    base = functions(args.base)
    head = functions(args.head)

    failures = []
    for (file_, name), (cc, line) in sorted(head.items()):
        if cc <= LIMIT:
            continue
        before = base.get((file_, name), (0, 0))[0]
        if before == 0:
            why = "new function over the limit"
        elif before <= LIMIT:
            why = f"was {before}, now over the limit"
        elif cc > before:
            why = f"grew from {before}"
        else:
            continue
        failures.append((file_, line, name, cc, why))

    over_now = sum(1 for cc, _ in head.values() if cc > LIMIT)
    over_base = sum(1 for cc, _ in base.values() if cc > LIMIT)
    lines = [
        "<!-- complexity-report -->",
        f"## Complexity check: {'FAILED' if failures else 'passed'}",
        "",
        f"Functions over {LIMIT} in TypeScript production code: {over_base} on the base, {over_now} on this PR.",
    ]
    if failures:
        lines += ["", "| Function | Complexity | Why |", "|---|---:|---|"]
        for file_, line, name, cc, why in failures:
            lines.append(f"| `{file_}:{line}` {name} | {cc} | {why} |")
        lines += [
            "",
            f"Split each function above before adding to it: move a branch into a named helper, "
            f"or replace a chain of conditions with a lookup table or per-tool handler.",
        ]
    with open(args.report, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
