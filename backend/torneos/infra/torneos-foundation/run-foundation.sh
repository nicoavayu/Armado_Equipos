#!/usr/bin/env bash
# INFRA-1 R3 — Staging retirement + Arma2 Torneos Supabase foundation. Operator-run in a real terminal.
#
#   run-foundation.sh --staging-prepause    READ-ONLY PAT   Core Staging pre-pause gates → evidence → STOP
#   run-foundation.sh --pause-staging       WRITE PAT       + phrase → POST …/hhyvmhgpapyuzjgxfnqv/pause → INACTIVE
#   run-foundation.sh --create-preflight    READ-ONLY PAT   slot / plan / name / region / Keychain → STOP
#   run-foundation.sh --create-project      WRITE PAT       + phrase → Keychain → POST /v1/projects → ACTIVE_HEALTHY
#   run-foundation.sh --migrate             READ-ONLY PAT   + phrase → psql 0000..0003 (DB password from Keychain;
#                                                           the PAT only reads: project, pooler, marker SELECTs)
#   run-foundation.sh --certify             READ-ONLY PAT   catalog / grants / RLS / PostgREST / custom_jwks / commerce OFF
#
# No default mode, no --force/-y/--yes, no ref/name/region argument: they are pins of foundation-contract.mjs.
# The PAT is read from /dev/tty with echo off, piped to node through the printf builtin (never argv, env or a
# file) and cleared on exit. The confirmation phrase of a write mode is read by node itself from /dev/tty.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
abort() { printf '\n!! %s\n' "$*" >&2; exit 1; }
USAGE="usage: run-foundation.sh --staging-prepause | --pause-staging | --create-preflight | --create-project | --migrate | --certify"

[[ $# -eq 1 ]] || abort "FOUNDATION_USAGE — exactly one mode and nothing else ($USAGE)"
case "$1" in
  --staging-prepause|--create-preflight|--migrate|--certify) MODE="$1"; KIND="READ-ONLY" ;;
  --pause-staging|--create-project) MODE="$1"; KIND="TEMPORARY WRITE (projects:write)" ;;
  --force|-f|--yes|-y|--non-interactive|--no-confirm|--assume-yes|yes|y) abort "FOUNDATION_REFUSED: '$1' is not accepted — every write needs the typed phrase on /dev/tty" ;;
  *) abort "FOUNDATION_USAGE ($USAGE)" ;;
esac
[[ -z "${CI:-}${GITHUB_ACTIONS:-}${CONTINUOUS_INTEGRATION:-}" ]] || abort "FOUNDATION_REFUSED_NON_INTERACTIVE (CI environment)"
{ : < /dev/tty; } 2>/dev/null || abort "FOUNDATION_BLOCKED_NO_TTY (run it in a terminal)"
[[ -t 0 && -t 1 ]] || abort "FOUNDATION_REFUSED_NON_INTERACTIVE (stdin/stdout are not a terminal)"
command -v node >/dev/null || abort "node missing"
for f in foundation.mjs foundation-contract.mjs mgmt-foundation.mjs keychain-foundation.mjs keychain-foundation.py psql-foundation.mjs postgrest-probe.mjs; do
  [[ -f "$HERE/$f" ]] || abort "tooling file missing: $f"
done

PAT=""
trap 'PAT=""; unset PAT' EXIT INT TERM HUP
printf 'Arma2 Torneos INFRA-1 R3 — mode %s\n%s Supabase PAT (sbp_…), no echo: ' "$MODE" "$KIND" > /dev/tty
IFS= read -rs PAT < /dev/tty || { printf '\n' > /dev/tty; abort "PAT_NOT_PROVIDED (EOF on the tty)"; }
printf '\n' > /dev/tty
[[ "$PAT" =~ ^sbp_[A-Za-z0-9_]{20,160}$ ]] || abort "PAT malformed"

set +e
printf '{"pat":"%s"}' "$PAT" | node "$HERE/foundation.mjs" "$MODE"
RC=$?
set -e
PAT=""
exit "$RC"
