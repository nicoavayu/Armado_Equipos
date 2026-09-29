#!/usr/bin/env bash
# ANDROID ORIGIN REMOTE — operator session (G1 with the Deno leg, W1 gateway deploy, rollback). Run in a real terminal.
#
#   ARMA2_SESSION_DIR=<absolute dir, mode 0700> bash run-android-origin-session.sh read-only   # G1 / plans; every write refused
#   ARMA2_SESSION_DIR=<absolute dir, mode 0700> bash run-android-origin-session.sh deploy      # + w1 / rollback (phrase-gated)
#
# The human types ONE token here, with echo off: a Deno Deploy organization token (never one that was pasted in a chat or a
# log). It is piped to node through the printf builtin (never argv, env or a file) and cleared on exit. The bridge ring is
# read from the Keychain by node, in memory only. No DB credential and no Supabase PAT are used. After that the session takes
# commands and plan phrases from the FIFO $ARMA2_SESSION_DIR/ctl; every write prints its PLAN id and needs the exact phrase.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
abort() { printf '\n!! %s\n' "$*" >&2; exit 1; }
[[ $# -eq 1 ]] || abort "ANDROID_ORIGIN_USAGE — one argument: read-only | deploy"
MODE="$1"
[[ "$MODE" == "read-only" || "$MODE" == "deploy" ]] || abort "ANDROID_ORIGIN_USAGE — read-only | deploy"
[[ -z "${CI:-}${GITHUB_ACTIONS:-}" ]] || abort "ANDROID_ORIGIN_REFUSED_NON_INTERACTIVE (CI)"
{ : < /dev/tty; } 2>/dev/null || abort "ANDROID_ORIGIN_BLOCKED_NO_TTY (run it in a terminal)"
[[ -n "${ARMA2_SESSION_DIR:-}" ]] || abort "ARMA2_SESSION_DIR is required"
command -v node >/dev/null || abort "node missing"

DENO=""
printf '\033[?2004l' > /dev/tty
clean() { local v="$1" esc=$'\033'; v="${v//${esc}\[200~/}"; v="${v//${esc}\[201~/}"; v="${v//$'\r'/}"; v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"; printf -v "$2" '%s' "$v"; }
trap 'DENO=""; unset DENO' EXIT INT TERM HUP
printf 'Arma2 Torneos — ANDROID-ORIGIN session, mode %s (app torneos-gateway; live t5vxxvzp1t9f / 6c252863…, candidate 59573b50…)\n\nDeno Deploy organization token (ddo_…), no echo: ' "$MODE" > /dev/tty
IFS= read -rs DENO < /dev/tty || abort "DENO_TOKEN_NOT_PROVIDED"
printf '\n' > /dev/tty
clean "$DENO" DENO
[[ "$DENO" =~ ^dd[op]_[A-Za-z0-9_-]{20,200}$ ]] || abort "Deno token malformed"

set +e
printf '{"deno":"%s"}' "$DENO" | node "$HERE/android-origin-session.mjs" "$MODE"
RC=$?
set -e
DENO=""
exit "$RC"
