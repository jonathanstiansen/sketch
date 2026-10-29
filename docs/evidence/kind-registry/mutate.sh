#!/usr/bin/env bash
set -u
patch="docs/evidence/kind-registry/mutations/$1.patch"
shift
git apply "$patch"
trap 'git apply -R "$patch"' EXIT
"$@"
status=$?
if [ "$status" -eq 0 ]; then
  echo "MUTATION SURVIVED"
  exit 1
fi
echo "Mutation killed (exit $status)"
