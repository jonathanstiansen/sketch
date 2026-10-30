#!/usr/bin/env bash
set -o pipefail
cd "$(dirname "$0")/../../../assets" || exit 1
node --test test/random_parity.test.ts test/render_parity.test.ts 2>&1 |
  grep -E '^(✔|✖) ' |
  sed -E 's/ \([0-9.]+m?s\)$//' |
  awk '!seen[$0]++'
exit "${PIPESTATUS[0]}"
