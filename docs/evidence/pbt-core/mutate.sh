#!/usr/bin/env bash
set -u
patch="docs/evidence/pbt-core/mutations/$1.patch"
shift
git apply "$patch"
trap 'git apply -R "$patch"' EXIT
docs/evidence/pbt-core/run-tests.sh "$@"
status=$?
if [ "$status" -eq 0 ]; then
  echo "MUTATION SURVIVED"
  exit 1
fi
echo "Mutation killed (mix test exit $status)"
