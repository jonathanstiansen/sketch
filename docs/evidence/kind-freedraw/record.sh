#!/usr/bin/env bash
set -euo pipefail
out="docs/evidence/kind-freedraw"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
E2E_RECORD_DIR="$work" npm --prefix e2e test -- draw -g "curvy stroke" > "$work/e2e.log"
a="$(ls "$work"/draw-a/*.webm)"
b="$(ls "$work"/draw-b/*.webm)"
ffmpeg -loglevel error -y -i "$a" -i "$b" -filter_complex \
  "[0:v]setpts=3*PTS[a];[1:v]setpts=3*PTS[b];[a][b]hstack,fps=10,scale=1200:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  "$out/freedraw-draw-move-resize.gif"
ffmpeg -loglevel error -y -sseof -0.3 -i "$a" -sseof -0.3 -i "$b" -filter_complex "[0:v][1:v]hstack,scale=1200:-1" -frames:v 1 \
  "$out/freedraw-draw-move-resize.png"
echo "recorded $(grep -oE '[0-9]+ passed' "$work/e2e.log")"
