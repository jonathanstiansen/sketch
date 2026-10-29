#!/usr/bin/env bash
set -euo pipefail
out="docs/evidence/render-model"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
E2E_RECORD_DIR="$work" npm --prefix e2e test -- render-model -g "translated wrapper" > "$work/e2e.log"
a="$(ls "$work"/render-model-move-a/*.webm)"
b="$(ls "$work"/render-model-move-b/*.webm)"
ffmpeg -loglevel error -y -i "$a" -i "$b" -filter_complex \
  "[0:v]setpts=3*PTS[a];[1:v]setpts=3*PTS[b];[a][b]hstack,fps=10,scale=1200:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  "$out/move-and-resize.gif"
ffmpeg -loglevel error -y -sseof -0.3 -i "$a" -sseof -0.3 -i "$b" -filter_complex "[0:v][1:v]hstack,scale=1200:-1" -frames:v 1 \
  "$out/move-and-resize.png"
echo "recorded $(grep -oE '[0-9]+ passed' "$work/e2e.log")"
