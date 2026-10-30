#!/usr/bin/env bash
set -o pipefail
mix test test/sketch/properties/commit_model_test.exs test/sketch/canvas/concurrent_commits_test.exs --seed 0 2>&1 |
  grep -E '^\s+[0-9]+\) (test|property)|^Result' |
  sed -E 's/^ +//; s/ \(Sketch[^)]*\)$//'
exit "${PIPESTATUS[0]}"
