#!/usr/bin/env bash
set -o pipefail
mix test "$@" 2>&1 |
  tr -d '\r' |
  sed -E 's/^(  \* .*\[L#[0-9]+\])  \* .*$/\1/; s/ \([0-9.]+ms\)//' |
  grep -vE '^(Compiling |Generated sketch app|Getting extensions|Running setup for|Running ExUnit with seed|Finished in )'
