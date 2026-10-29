#!/usr/bin/env bash
set -euo pipefail
port=4032
PORT=$port mix phx.server > /dev/null 2>&1 &
server=$!
trap 'kill $server' EXIT
until curl -sf "http://127.0.0.1:$port/" > /dev/null; do sleep 1; done
node docs/evidence/render-model/dom.mjs "http://127.0.0.1:$port/" "$@"
