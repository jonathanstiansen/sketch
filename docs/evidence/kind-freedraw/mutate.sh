#!/usr/bin/env bash
set -u
patch="docs/evidence/kind-freedraw/mutations/$1.patch"
shift
git apply "$patch"
trap 'git apply -R "$patch"; git checkout -- assets/js/generated assets/test/fixtures' EXIT
"$@"
status=$?
if [ "$status" -eq 0 ]; then
  echo "MUTATION SURVIVED"
  exit 1
fi
echo "Mutation killed (exit $status)"
