#!/usr/bin/env bash
set -o pipefail
npm --prefix e2e test -- "$@" 2>&1 | grep -oE '^ +[0-9]+ (passed|failed|flaky)' | sed -E 's/^ +//'
