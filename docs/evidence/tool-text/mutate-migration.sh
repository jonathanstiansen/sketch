#!/usr/bin/env bash
set -u
patch="docs/evidence/tool-text/mutations/$1.patch"
shift
remigrate() {
  MIX_ENV=test mix ecto.rollback --step 1 --quiet >/dev/null 2>&1
  MIX_ENV=test mix ecto.migrate --quiet >/dev/null 2>&1
}
git apply "$patch"
trap 'git apply -R "$patch"; remigrate' EXIT
remigrate
"$@"
status=$?
if [ "$status" -eq 0 ]; then
  echo "MUTATION SURVIVED"
  exit 1
fi
echo "Mutation killed (exit $status)"
