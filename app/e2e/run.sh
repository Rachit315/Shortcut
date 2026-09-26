#!/usr/bin/env bash
# Run the real end-to-end test against a built Clazy binary under a virtual X display.
# Usage: e2e/run.sh [path/to/clazy]   (default: src-tauri/target/release/clazy)
set -euo pipefail
cd "$(dirname "$0")/.."
BIN="${1:-src-tauri/target/release/clazy}"
PY=python3
command -v python3.12 >/dev/null && PY=python3.12
exec dbus-run-session -- "$PY" e2e/run_e2e.py "$BIN"
