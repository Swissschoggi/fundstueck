#!/bin/sh
set -eu

VENV_PATH="${FUNDSTUECK_RICARDO_VENV:-/app/.venvs/ricardo}"
PYTHON_BIN="${VENV_PATH}/bin/python"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is missing from the Fundstueck runtime image." >&2
  exit 127
fi

python3 -m venv "$VENV_PATH"
"$PYTHON_BIN" -m pip install --upgrade pip
"$PYTHON_BIN" -m pip install ricardo-scraper

# The project pins a known-good Camoufox build. Bundle the helper beside the
# installed package so ricardo-scraper imports the same pin used by Fundstueck.
"$PYTHON_BIN" -c 'import os, shutil, ricardo_scraper, sys; shutil.copyfile(sys.argv[1], os.path.join(os.path.dirname(ricardo_scraper.__file__), "pin_camoufox_browser.py"))' "$SCRIPT_DIR/pin_camoufox_browser.py"

# Warm up the pinned browser build so the first health check/search is faster.
"$VENV_PATH/bin/ricardo-scraper" "fundstueck" --no-detail --max-results 1 --locale de --out /tmp/fundstueck-ricardo-warmup --quiet >/dev/null 2>&1 || true
rm -f /tmp/fundstueck-ricardo-warmup.json /tmp/fundstueck-ricardo-warmup.csv

echo "Ricardo scraper installed in $VENV_PATH"
