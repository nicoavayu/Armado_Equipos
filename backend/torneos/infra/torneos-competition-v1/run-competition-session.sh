#!/usr/bin/env bash
# COMPETITION-V1 REMOTE — operator session (G1 with the Deno leg, W1, W2 and their rollbacks). Run in a real terminal.
#
#   ARMA2_SESSION_DIR=<absolute dir, mode 0700> bash run-competition-session.sh
#
# The human types ONE token here, with echo off: a NEW Deno Deploy organization token (never one that was pasted in a
# chat or a log). It is piped to node through the printf builtin (never argv, env or a file) and cleared on exit. The
# installer password and the bridge ring are read from the Keychain by node, in memory only. No Supabase PAT is used.
# After that the session takes commands and plan phrases from the FIFO $ARMA2_SESSION_DIR/ctl; every write prints its
# PLAN id and needs the exact phrase for it. Ctrl-C ends the session.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
abort() { printf '\n!! %s\n' "$*" >&2; exit 1; }
[[ $# -eq 0 ]] || abort "COMPETITION_V1_USAGE — no arguments"
[[ -z "${CI:-}${GITHUB_ACTIONS:-}" ]] || abort "COMPETITION_V1_REFUSED_NON_INTERACTIVE (CI)"
{ : < /dev/tty; } 2>/dev/null || abort "COMPETITION_V1_BLOCKED_NO_TTY (run it in a terminal)"
[[ -n "${ARMA2_SESSION_DIR:-}" ]] || abort "ARMA2_SESSION_DIR is required"
command -v node >/dev/null || abort "node missing"

DENO=""
printf '\033[?2004l' > /dev/tty
clean() { local v="$1" esc=$'\033'; v="${v//${esc}\[200~/}"; v="${v//${esc}\[201~/}"; v="${v//$'\r'/}"; v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"; printf -v "$2" '%s' "$v"; }
trap 'DENO=""; unset DENO' EXIT INT TERM HUP
printf 'Arma2 Torneos — COMPETITION-V1 session (target onzpwnqxnvlgsevivngf, app torneos-gateway)\n\nNEW Deno Deploy organization token (ddo_…), no echo: ' > /dev/tty
IFS= read -rs DENO < /dev/tty || abort "DENO_TOKEN_NOT_PROVIDED"
printf '\n' > /dev/tty
clean "$DENO" DENO
[[ "$DENO" =~ ^dd[op]_[A-Za-z0-9_-]{20,200}$ ]] || abort "Deno token malformed"

set +e
printf '{"deno":"%s"}' "$DENO" | node "$HERE/competition-session.mjs"
RC=$?
set -e
DENO=""
exit "$RC"
