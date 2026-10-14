#!/usr/bin/env bash
# Launches the whole Shopfront dev stack: installs deps if needed, starts the
# API and the web app, waits for both to come up, then opens the browser.
# Ctrl-C stops everything cleanly (including npm/tsx/vite's child processes).
set -euo pipefail
set -m # each background job gets its own process group, so we can kill it and its children together

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

API_PORT="${PORT:-8787}"
WEB_PORT="${WEB_PORT:-5173}"
LOG_DIR="$ROOT_DIR/.dev-logs"
mkdir -p "$LOG_DIR"

API_LOG="$LOG_DIR/api.log"
WEB_LOG="$LOG_DIR/web.log"

API_PID=""
WEB_PID=""

CLEANED_UP=""
cleanup() {
  if [ -n "$CLEANED_UP" ]; then return; fi
  CLEANED_UP=1
  echo
  echo "Stopping..."
  for pid in "$API_PID" "$WEB_PID"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait_for() {
  local url="$1" name="$2" tries=60
  until curl -s -o /dev/null "$url"; do
    tries=$((tries - 1))
    if [ "$tries" -le 0 ]; then
      echo "$name did not come up in time — check $LOG_DIR" >&2
      exit 1
    fi
    sleep 0.5
  done
}

require_free_port() {
  local port="$1" label="$2"
  if command -v lsof >/dev/null && lsof -i ":$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use — is $label already running?" >&2
    exit 1
  fi
}

if [ ! -d "$ROOT_DIR/node_modules" ]; then
  echo "Installing dependencies (first run)..."
  npm install
fi

require_free_port "$API_PORT" "the API"
require_free_port "$WEB_PORT" "the web app"

echo "Starting API on :$API_PORT..."
PORT="$API_PORT" npm run dev:api >"$API_LOG" 2>&1 &
API_PID=$!
wait_for "http://localhost:$API_PORT/api/health" "API"

echo "Starting web app on :$WEB_PORT..."
(cd "$ROOT_DIR/apps/web" && npx vite --port "$WEB_PORT") >"$WEB_LOG" 2>&1 &
WEB_PID=$!
wait_for "http://localhost:$WEB_PORT" "Web app"

echo
echo "Shopfront is running:"
echo "  Web  http://localhost:$WEB_PORT"
echo "  API  http://localhost:$API_PORT/api/health"
echo "  Logs $LOG_DIR"
echo
echo "Press Ctrl-C to stop."

if [[ "$OSTYPE" == "darwin"* ]] && [ -z "${CI:-}" ]; then
  open "http://localhost:$WEB_PORT" >/dev/null 2>&1 || true
fi

wait
