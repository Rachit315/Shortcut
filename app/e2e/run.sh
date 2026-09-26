#!/usr/bin/env bash
# Run the real end-to-end test against a built Shortcut binary under a virtual X display.
# Usage: e2e/run.sh [path/to/shortcut]   (default: src-tauri/target/release/shortcut)
set -euo pipefail
cd "$(dirname "$0")/.."
BIN="${1:-src-tauri/target/release/shortcut}"
PY=python3
command -v python3.12 >/dev/null && PY=python3.12
exec dbus-run-session -- "$PY" e2e/run_e2e.py "$BIN"
