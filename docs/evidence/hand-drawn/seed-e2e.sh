#!/usr/bin/env bash
set -o pipefail
npm --prefix assets run --silent typecheck || exit 2
npm --prefix assets test 2>&1 | grep -E '^ℹ (pass|fail) ' || exit 2
npm --prefix e2e test -- hand-drawn 2>&1 |
  grep -oE '^ +[0-9]+ (passed|failed)|Error: expect\(locator\)\.[A-Za-z]+\(expected\) failed|Locator: +locator\(.*\)$|Expected: "[0-9]+"' |
  sed -E 's/^ +//; s/Expected: "[0-9]+"/Expected: "<A'"'"'s seed>"/' |
  awk '!seen[$0]++'
exit "${PIPESTATUS[0]}"
