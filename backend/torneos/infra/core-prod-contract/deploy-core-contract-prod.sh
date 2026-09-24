#!/usr/bin/env bash
# INFRA-0.5 — Core PRODUCTION contract deployment (rcyuuoaqfwcembdajcss). Operator-run in a real
# terminal, never by an agent, never unattended.
#
#   deploy-core-contract-prod.sh --preflight-only   read-only observation + plan + evidence → STOP (0 writes)
#   deploy-core-contract-prod.sh --dry-run          + the exact write requests, computed locally → STOP (0 writes)
#   deploy-core-contract-prod.sh --apply            + phrase on /dev/tty → the 2 authorized migrations, the
#                                                   Production secret, torneos-core-contract, full certification
#   deploy-core-contract-prod.sh --acl-only         read-only post-deploy ACL certification
#
# There is no default mode and no flag that replaces the phrase (--force, -y, --yes, env vars: refused).
# The target is a constant of prod-contract.mjs; this script takes no ref. The PAT is read from /dev/tty
# with echo off, kept in a shell variable, piped to node through the printf builtin (never argv, never
# env, never a file) and unset on exit. The confirmation phrase is read by node itself from /dev/tty.
# This script deliberately does not source the Phase 3B shell library (its contract is non-production:
# it refuses Production and binds the non-production Keychain entries).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
abort() { printf '\n!! %s\n' "$*" >&2; exit 1; }
USAGE="usage: deploy-core-contract-prod.sh --preflight-only | --dry-run | --apply | --acl-only"

[[ $# -eq 1 ]] || abort "CORE_PROD_USAGE — exactly one mode and nothing else ($USAGE)"
case "$1" in
  --preflight-only|--dry-run|--apply|--acl-only) MODE="$1" ;;
  --force|-f|--yes|-y|--non-interactive|--no-confirm|--assume-yes|yes|y) abort "CORE_PROD_REFUSED: '$1' is not accepted — a Production write needs the typed phrase on /dev/tty" ;;
  *) abort "CORE_PROD_USAGE ($USAGE)" ;;
esac
[[ -z "${CI:-}${GITHUB_ACTIONS:-}${CONTINUOUS_INTEGRATION:-}" ]] || abort "CORE_PROD_REFUSED_NON_INTERACTIVE (CI environment)"
{ : < /dev/tty; } 2>/dev/null || abort "CORE_PROD_BLOCKED_NO_TTY (run it yourself in a terminal; an agent cannot)"
[[ -t 0 && -t 1 ]] || abort "CORE_PROD_REFUSED_NON_INTERACTIVE (stdin/stdout are not a terminal)"
command -v node >/dev/null || abort "node missing"
[[ -f "$HERE/core-prod-deploy.mjs" && -f "$HERE/prod-contract.mjs" && -f "$HERE/mgmt-prod.mjs" ]] || abort "tooling files missing"

PAT=""
trap 'PAT=""; unset PAT' EXIT INT TERM HUP
printf 'Core PRODUCTION rcyuuoaqfwcembdajcss — mode %s\nSupabase PAT (sbp_…), no echo: ' "$MODE" > /dev/tty
IFS= read -rs PAT < /dev/tty || { printf '\n' > /dev/tty; abort "PAT_NOT_PROVIDED (EOF on the tty)"; }
printf '\n' > /dev/tty
[[ "$PAT" =~ ^sbp_[A-Za-z0-9_]{20,160}$ ]] || abort "PAT malformed"

set +e
printf '{"pat":"%s"}' "$PAT" | node "$HERE/core-prod-deploy.mjs" "$MODE"
RC=$?
set -e
PAT=""
exit "$RC"
