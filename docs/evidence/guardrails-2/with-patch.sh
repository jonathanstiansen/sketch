#!/usr/bin/env bash
set -u
name=$1
patch="docs/evidence/guardrails-2/mutations/$name.patch"
shift
git apply "$patch"
trap 'git apply -R "$patch"' EXIT
"$@"
status=$?
echo "Exit $status with $name applied"
