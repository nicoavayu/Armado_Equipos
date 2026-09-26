#!/usr/bin/env bash
# PAYMENTS TEST — operator session of the hosted Mercado Pago Checkout Pro TEST certification. Run in a real terminal.
#
#   ARMA2_SESSION_DIR=<absolute dir, mode 0700> bash run-payments-session.sh
#
# The human pastes four values here, echo off: the READ-ONLY Supabase scoped PAT, the Deno Deploy organization token,
# the Mercado Pago TEST seller access token and the Mercado Pago TEST webhook secret. They are piped to node through the
# printf builtin (never argv, env or a file) and cleared on exit. After that the session takes commands and plan phrases
# from the FIFO $ARMA2_SESSION_DIR/ctl (payments-session.mjs); every write prints its PLAN id and needs the exact phrase.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
abort() { printf '\n!! %s\n' "$*" >&2; exit 1; }
[[ $# -eq 0 ]] || abort "PAYMENTS_SESSION_USAGE — no arguments"
[[ -z "${CI:-}${GITHUB_ACTIONS:-}" ]] || abort "PAYMENTS_SESSION_REFUSED_NON_INTERACTIVE (CI)"
{ : < /dev/tty; } 2>/dev/null || abort "PAYMENTS_SESSION_BLOCKED_NO_TTY (run it in a terminal)"
[[ -n "${ARMA2_SESSION_DIR:-}" ]] || abort "ARMA2_SESSION_DIR is required"
command -v node >/dev/null || abort "node missing"

NEEDS="$(node --input-type=module -e 'const C = await import(process.argv[1]); process.stdout.write(C.patText());' "$HERE/payments-test-contract.mjs")" || abort "PAT requirement unavailable"

PAT=""; DENO=""; MPT=""; MPS=""
printf '\033[?2004l' > /dev/tty
clean() { local v="$1" esc=$'\033'; v="${v//${esc}\[200~/}"; v="${v//${esc}\[201~/}"; v="${v//$'\r'/}"; v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"; printf -v "$2" '%s' "$v"; }
trap 'PAT=""; DENO=""; MPT=""; MPS=""; unset PAT DENO MPT MPS' EXIT INT TERM HUP
ask() { # $1 prompt, $2 var, $3 regex, $4 name
  local v=""
  printf '%s (no echo): ' "$1" > /dev/tty
  IFS= read -rs v < /dev/tty || abort "$4 not provided"
  printf '\n' > /dev/tty
  clean "$v" v
  [[ "$v" =~ $3 ]] || abort "$4 malformed"
  printf -v "$2" '%s' "$v"; v=""
}
printf 'Arma2 Torneos — PAYMENTS TEST session (Mercado Pago TEST only)\n\n%s\n\n' "$NEEDS" > /dev/tty
ask 'Supabase PAT (sbp_…)' PAT '^sbp_[A-Za-z0-9_]{20,160}$' PAT
ask 'Deno Deploy organization token (ddo_…)' DENO '^dd[op]_[A-Za-z0-9_-]{20,200}$' "Deno token"
ask 'Mercado Pago TEST seller Access Token (APP_USR-…)' MPT '^APP_USR-[0-9]{6,20}-[0-9]{6}-[0-9a-f]{32}-[0-9]{6,20}$' "MP access token"
ask 'Mercado Pago TEST webhook secret (Webhooks → Modo de prueba → Clave secreta)' MPS '^[A-Za-z0-9]{32,128}$' "MP webhook secret"

set +e
printf '{"pat":"%s","deno":"%s","mpToken":"%s","mpSecret":"%s"}' "$PAT" "$DENO" "$MPT" "$MPS" | node "$HERE/payments-session.mjs"
RC=$?
set -e
PAT=""; DENO=""; MPT=""; MPS=""
exit "$RC"
