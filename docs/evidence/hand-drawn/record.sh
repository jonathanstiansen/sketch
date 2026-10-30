#!/usr/bin/env bash
set -euo pipefail
out="docs/evidence/hand-drawn"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
E2E_RECORD_DIR="$work" npm --prefix e2e test -- hand-drawn -g "a resize keeps" > "$work/e2e.log"
a="$(ls "$work"/hand-drawn-resize-a/*.webm)"
b="$(ls "$work"/hand-drawn-resize-b/*.webm)"
ffmpeg -loglevel error -y -i "$a" -i "$b" -filter_complex \
  "[0:v]setpts=3*PTS,crop=640:480:0:110[a];[1:v]setpts=3*PTS,crop=640:480:0:110[b];[a][b]hstack,fps=12,scale=1240:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  "$out/two-browsers-same-wobble.gif"
ffmpeg -loglevel error -y -sseof -0.3 -i "$a" -sseof -0.3 -i "$b" -filter_complex \
  "[0:v]crop=640:480:0:110[a];[1:v]crop=640:480:0:110[b];[a][b]hstack" -frames:v 1 \
  "$out/two-browsers-same-wobble.png"
echo "recorded $(grep -oE '[0-9]+ passed' "$work/e2e.log")"
