#!/usr/bin/env bash
# Usage:
#   ./build.sh           — build for emulator (default)
#   ./build.sh --prod    — build for production (sets IS_EMULATOR=false, restores after)
#   ./build.sh --install — build for emulator and install on the running emery emulator

set -euo pipefail

INDEX_JS="src/pkjs/index.js"
MODE="${1:-}"

set_emulator_flag() {
  local value="$1"
  sed -i '' "s/^var IS_EMULATOR = .*;$/var IS_EMULATOR = ${value};/" "$INDEX_JS"
}

build_prod() {
  echo "==> Production build"
  echo "    Setting IS_EMULATOR = false"
  set_emulator_flag false

  # Restore IS_EMULATOR on exit (success or error)
  trap 'echo "    Restoring IS_EMULATOR = true"; set_emulator_flag true' EXIT

  pebble build

  # Trap fires on EXIT so restoration happens automatically.
  # Copy .pbw to project root for easy access.
  cp build/whoop-watchface.pbw ../whoop-watchface-release.pbw
  echo ""
  echo "==> Done. Release bundle: whoop-watchface-release.pbw"
  echo "    Upload this file to https://dev-portal.rebble.io"
}

build_emulator() {
  echo "==> Emulator build"
  pebble build
  echo ""
  echo "==> Done. Run: pebble install --emulator emery"
}

build_and_install() {
  echo "==> Emulator build + install"
  pebble build && pebble install --emulator emery
}

case "$MODE" in
  --prod)
    build_prod
    ;;
  --install)
    build_and_install
    ;;
  "")
    build_emulator
    ;;
  *)
    echo "Unknown option: $MODE"
    echo "Usage: ./build.sh [--prod | --install]"
    exit 1
    ;;
esac
