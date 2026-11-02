# Complexity budget

Every pull request gets a complexity comment from the `complexity` CI job, and the job fails
when the change breaks a rule. The job compares the PR with its base commit, so stacked PRs
are measured against their parent branch.

## What is measured

- Production code only: Elixir under `lib/`, TypeScript under `assets/js/`.
  Generated files and tests are not counted.
- Elixir uses `cc.exs`, a re-implementation of Credo's `Refactor.CyclomaticComplexity` rule.
  Credo itself also runs in `elixir-static` with the same limit (9), so the two agree.
- TypeScript uses lizard's cyclomatic number. ESLint's `complexity` rule gives about 10% higher
  numbers on the same code, so compare TypeScript numbers only with other lizard numbers.
- **Density** is complexity per 1,000 lines of production code. It is the number to watch,
  because total complexity mostly tracks size.
- **Hotspot share** is the share of complexity sitting in functions over their limit.

## Rules and limits

Limits are in `thresholds.json`. Changing a limit is a change to the enforcement policy
(SPEC section 9) and needs review.

| Rule | Passes when | Fails when | Waivable |
|---|---|---|---|
| density | growth is within 5% of the base | growth is above 15% | yes, with the label |
| new_hotspot | new functions are within the limit (Elixir 9, TypeScript 10) | a new function is over its limit | no |
| grew_hotspot | an over-limit function does not get more complex | it gets more complex | no |
| share | hotspot share stays within 5% | it is above 5% and rose | yes, with the label |

## What to do when the job fails

1. Read the rule in the PR comment. It names the function and the file line.
2. Split the function before adding to it. Patterns that work here:
   - Move a branch into a named helper.
   - Replace a chain of `if` or `cond` with pattern-matched function heads.
   - Replace per-kind or per-tool branching with a lookup table or the kind registry.
   - For `canvas.ts`, put each gesture or tool in its own handler and call it from the pointer
     dispatcher. PR 38 (`guardrails-3`) shows the pattern: the largest cognitive score in the file
     fell from 21 to 10.
3. Use the `complexity-exception` label only for an intended, explained growth. Write the reason
   in the PR body. The label does not waive `new_hotspot` or `grew_hotspot`.

## Running it locally

```sh
python3 tools/complexity/measure.py --root . --out /tmp/head.json
git worktree add --detach /tmp/base origin/main
python3 tools/complexity/measure.py --root /tmp/base --out /tmp/base.json
python3 tools/complexity/gate.py --base /tmp/base.json --head /tmp/head.json --report /tmp/report.md
```

Requirements: Elixir (for `cc.exs`) and `pip install lizard==1.25.0`.
