#!/usr/bin/env bash
set -o pipefail
remigrate() {
  MIX_ENV=test mix ecto.rollback --step 1 --quiet > /dev/null 2>&1
  MIX_ENV=test mix ecto.migrate --quiet > /dev/null 2>&1
}
remigrate
trap 'git apply -R docs/evidence/styling/mutations/check-accepts-fill-on-line.patch; remigrate; git apply docs/evidence/styling/mutations/check-accepts-fill-on-line.patch' EXIT
mix test test/sketch/canvas/element_style_test.exs --seed 0 2>&1 |
  grep -E '^\s+[0-9]+\) test|^Result|fill_color_fits_kind' |
  sed -E 's/^ +//; s/ \(Sketch[^)]*\)$//' |
  awk '!seen[$0]++'
exit "${PIPESTATUS[0]}"
