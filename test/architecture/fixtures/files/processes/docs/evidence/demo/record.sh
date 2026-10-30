#!/usr/bin/env bash
set -euo pipefail
pkill -f phx.server
killall beam.smp
kill -9 4242
lsof -ti :4000 | xargs kill
kill $(lsof -ti :4000)
PORT=4099 mix phx.server > /dev/null 2>&1 &
server=$!
trap 'kill $server' EXIT
kill "$server"
kill -9 $server
kill -0 "${server}"
kill $!
