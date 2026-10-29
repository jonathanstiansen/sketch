#!/usr/bin/env bash
set -euo pipefail
base_url="$1"
head_url="$2"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
node docs/evidence/kind-registry/toolbar.mjs "$base_url" "$work/base.html"
node docs/evidence/kind-registry/toolbar.mjs "$head_url" "$work/head.html"
normalize() { perl -pe 's/ data-phx-loc="[0-9]+"//g; s/<!--.*?-->//g; s/ data-phx-id="[^"]*"//g' "$1"; }
normalize "$work/base.html" > "$work/base.dom"
normalize "$work/head.html" > "$work/head.dom"
echo "tool buttons: $(grep -o 'data-tool-button="[a-z]*"' "$work/head.html" | sed -E 's/.*="(.*)"/\1/' | tr '\n' ' ')"
if diff -u "$work/base.dom" "$work/head.dom"; then
  echo "toolbar and shortcuts help DOM, without dev-only debug annotations: identical to tool-eraser ($(wc -c < "$work/head.dom" | tr -d ' ') bytes)"
else
  echo "toolbar or shortcuts help DOM DIFFERS from tool-eraser"
  exit 1
fi
