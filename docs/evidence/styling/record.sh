#!/usr/bin/env bash
set -euo pipefail
out="docs/evidence/styling"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
E2E_RECORD_DIR="$work" E2E_EVIDENCE_DIR="$PWD/$out" npm --prefix e2e test -- styling -g "A sets a stroke colour" > "$work/e2e.log"
a="$(ls "$work"/styling-restyle-a/*.webm)"
b="$(ls "$work"/styling-restyle-b/*.webm)"
ffmpeg -loglevel error -y -i "$a" -i "$b" -filter_complex \
  "[0:v]setpts=3*PTS,crop=640:400:0:76[a];[1:v]setpts=3*PTS,crop=640:400:0:76[b];[a][b]hstack,fps=12,scale=1240:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  "$out/two-browsers-restyle.gif"
echo "recorded $(grep -oE '[0-9]+ passed' "$work/e2e.log")"
