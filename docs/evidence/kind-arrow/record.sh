#!/usr/bin/env bash
set -euo pipefail
out="docs/evidence/kind-arrow"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
E2E_RECORD_DIR="$work" npm --prefix e2e test -- arrow -g "translated wrapper" > "$work/e2e.log"
a="$(ls "$work"/arrow-move-a/*.webm)"
b="$(ls "$work"/arrow-move-b/*.webm)"
ffmpeg -loglevel error -y -i "$a" -i "$b" -filter_complex \
  "[0:v]setpts=3*PTS[a];[1:v]setpts=3*PTS[b];[a][b]hstack,fps=10,scale=1200:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  "$out/arrow-draw-move-endpoints.gif"
ffmpeg -loglevel error -y -sseof -0.3 -i "$a" -sseof -0.3 -i "$b" -filter_complex "[0:v][1:v]hstack,scale=1200:-1" -frames:v 1 \
  "$out/arrow-draw-move-endpoints.png"
echo "recorded $(grep -oE '[0-9]+ passed' "$work/e2e.log")"
