#!/usr/bin/env bash
set -u
mix sketch.gen.render_fixtures --check 2>&1 | grep -E "stale|up to date"
mix sketch.gen.render_fixtures > /dev/null 2>&1
"$(dirname "$0")/client-parity.sh"
