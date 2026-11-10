#!/bin/sh
set -eu

VENV_PATH="${FUNDSTUECK_RICARDO_VENV:-/app/data/.venvs/ricardo}"
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

# Headless Firefox (camoufox) needs OS-level shared libraries (libgtk-3,
# libasound2, libnss3, ...) that a bare Python venv install does not provide.
# The official Fundstueck Docker image already bakes these in (see
# Dockerfile), so this is a no-op there; it exists for anyone installing on a
# bare-metal/VM Debian or Ubuntu host directly, where those libraries may
# still be missing and would otherwise surface later as a confusing
# "libgtk-3.so.0: cannot open shared object file" crash the first time a
# search actually launches the browser, rather than here at install time.
if [ "$(id -u)" = "0" ] && command -v apt-get >/dev/null 2>&1; then
  "$PYTHON_BIN" -m playwright install-deps firefox || \
    echo "Warning: could not install Firefox's OS-level dependencies automatically. If searches later fail with a missing .so error, install them manually (see README: Ricardo.ch)." >&2
else
  echo "Skipping automatic OS dependency install (not root, or apt-get unavailable.) If this is not the official Fundstueck Docker image, make sure headless Firefox's runtime libraries (libgtk-3, libasound2, libnss3, ...) are installed yourself — see README: Ricardo.ch." >&2
fi

# Warm up the pinned browser build so the first health check/search is
# faster, and so a broken browser launch (missing libraries, blocked sandbox
# syscalls, ...) is caught here — loudly, in the install log — instead of
# silently during someone's first real search.
if ! "$VENV_PATH/bin/ricardo-scraper" "fundstueck" --no-detail --max-results 1 --locale de --out /tmp/fundstueck-ricardo-warmup --quiet 2>/tmp/fundstueck-ricardo-warmup.err; then
  echo "Warning: the Ricardo warmup search failed. The adapter is installed but may not work yet. Last diagnostic line:" >&2
  tail -n 1 /tmp/fundstueck-ricardo-warmup.err >&2 || true
  echo "Full log: $(tail -n 20 /tmp/fundstueck-ricardo-warmup.err 2>/dev/null | tr '\n' ' ')" >&2
fi
rm -f /tmp/fundstueck-ricardo-warmup.json /tmp/fundstueck-ricardo-warmup.csv /tmp/fundstueck-ricardo-warmup.err

echo "Ricardo scraper installed in $VENV_PATH"
