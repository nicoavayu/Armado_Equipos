#!/usr/bin/env bash
# GATEWAY REMOTE — operator session (Phase A KR + B03, Phase B/C Deno Deploy gateway). Run in a real terminal.
#
#   ARMA2_SESSION_DIR=<absolute dir, mode 0700> bash run-remote-session.sh
#
# The human types two tokens here, with echo off: the Supabase scoped PAT and the Deno Deploy organization token. They
# are piped to node through the printf builtin (never argv, env or a file) and cleared on exit. After that the session
# takes commands and plan phrases from the FIFO $ARMA2_SESSION_DIR/ctl (remote-session.mjs); every write still prints
# its PLAN id and needs the exact phrase for it. Ctrl-C ends the session.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
abort() { printf '\n!! %s\n' "$*" >&2; exit 1; }
[[ $# -eq 0 ]] || abort "GATEWAY_REMOTE_USAGE — no arguments"
[[ -z "${CI:-}${GITHUB_ACTIONS:-}" ]] || abort "GATEWAY_REMOTE_REFUSED_NON_INTERACTIVE (CI)"
{ : < /dev/tty; } 2>/dev/null || abort "GATEWAY_REMOTE_BLOCKED_NO_TTY (run it in a terminal)"
[[ -n "${ARMA2_SESSION_DIR:-}" ]] || abort "ARMA2_SESSION_DIR is required"
command -v node >/dev/null || abort "node missing"

NEEDS="$(node --input-type=module -e 'const R = await import(process.argv[1]); process.stdout.write(R.sessionPatText());' "$HERE/remote-contract.mjs")" || abort "PAT requirement unavailable"

PAT=""; DENO=""
# Terminals may wrap a paste in bracketed-paste markers (ESC[200~ … ESC[201~) that `read` keeps: turn the mode off for
# this tty and strip markers, CR and surrounding blanks with builtins only (no external command sees the value).
printf '\033[?2004l' > /dev/tty
clean() { local v="$1" esc=$'\033'; v="${v//${esc}\[200~/}"; v="${v//${esc}\[201~/}"; v="${v//$'\r'/}"; v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"; printf -v "$2" '%s' "$v"; }
trap 'PAT=""; DENO=""; unset PAT DENO' EXIT INT TERM HUP
printf 'Arma2 Torneos — GATEWAY REMOTE session\n\n%s\n\nSupabase PAT (sbp_…), no echo: ' "$NEEDS" > /dev/tty
IFS= read -rs PAT < /dev/tty || abort "PAT_NOT_PROVIDED"
printf '\n' > /dev/tty
clean "$PAT" PAT
[[ "$PAT" =~ ^sbp_[A-Za-z0-9_]{20,160}$ ]] || abort "PAT malformed"
printf 'Deno Deploy organization token (ddo_…), no echo: ' > /dev/tty
IFS= read -rs DENO < /dev/tty || abort "DENO_TOKEN_NOT_PROVIDED"
printf '\n' > /dev/tty
clean "$DENO" DENO
[[ "$DENO" =~ ^dd[op]_[A-Za-z0-9_-]{20,200}$ ]] || abort "Deno token malformed"

set +e
printf '{"pat":"%s","deno":"%s"}' "$PAT" "$DENO" | node "$HERE/remote-session.mjs"
RC=$?
set -e
PAT=""; DENO=""
exit "$RC"
