#!/usr/bin/env bash
set -o pipefail
mix test test/sketch/canvas/element_style_test.exs --seed 0 2>&1 |
  grep -E '^\s+[0-9]+\) test|^Result|refute changeset.valid|database rejects' |
  sed -E 's/^ +//; s/ \(Sketch[^)]*\)$//' |
  awk '!seen[$0]++'
exit "${PIPESTATUS[0]}"
