#!/usr/bin/env bash
set -o pipefail
cd "$(dirname "$0")/../../../assets" || exit 1
node --test --test-concurrency=1 --test-reporter=spec "$@" 2>&1 |
  sed -E 's/ \([0-9.]+m?s\)$//' |
  grep -E '^(✔|✖) |^ℹ (tests|pass|fail) |Counterexample|Shrunk'
