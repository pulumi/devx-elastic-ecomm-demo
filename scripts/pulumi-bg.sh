#!/usr/bin/env bash
# Runs a pulumi command for infra/pulumi detached from the calling shell, so
# long runs (image builds, `up`, `destroy`) survive the caller's timeout.
# Output goes to .pulumi-logs/<timestamp>-<command>.log (latest.log links to it).
#
#   scripts/pulumi-bg.sh preview
#   scripts/pulumi-bg.sh up --yes
#   scripts/pulumi-bg.sh status          # is a run still going? tail of latest log
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
logs="$repo/.pulumi-logs"
mkdir -p "$logs"

if [[ "${1:-}" == "status" ]]; then
  if [[ -f "$logs/latest.pid" ]] && kill -0 "$(cat "$logs/latest.pid")" 2>/dev/null; then
    echo "running (pid $(cat "$logs/latest.pid"))"
  else
    echo "not running"
  fi
  tail -n "${2:-25}" "$logs/latest.log" 2>/dev/null || true
  exit 0
fi

[[ $# -gt 0 ]] || { echo "usage: $0 <pulumi args...> | status" >&2; exit 2; }

if [[ -f "$logs/latest.pid" ]] && kill -0 "$(cat "$logs/latest.pid")" 2>/dev/null; then
  echo "a pulumi run is already in progress (pid $(cat "$logs/latest.pid")); see $logs/latest.log" >&2
  exit 1
fi

log="$logs/$(date +%Y%m%d-%H%M%S)-$1.log"
ln -sf "$log" "$logs/latest.log"
cd "$repo/infra/pulumi"
# --non-interactive keeps output plain (no spinners) and never waits for input.
nohup pulumi "$@" --non-interactive >"$log" 2>&1 </dev/null &
echo $! >"$logs/latest.pid"
echo "started: pulumi $* (pid $!)"
echo "log:     $log"
