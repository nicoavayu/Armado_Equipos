#!/usr/bin/env bash
# GATEWAY/AUTH (G2) — Production gateway/auth tooling for Arma2 Torneos. Operator-run in a real terminal.
#
#   run-gateway-auth.sh --preflight          READ-ONLY PAT   state of W1 / W2+W3 / KR / W5, installer privileges → STOP
#   run-gateway-auth.sh --auth-lockdown      WRITE PAT       + phrase → PATCH config/auth (W1)
#                                                            (Auth Config: Read-write + Project Settings: Read-write)
#   run-gateway-auth.sh --db-bootstrap       READ-ONLY PAT   + phrase → ONE psql transaction (W2 + W3); installer password
#                                                            from the Keychain, login passwords generated into the Keychain
#   run-gateway-auth.sh --keyring-generate   READ-ONLY PAT   + phrase → LOCAL ring k1/k2 → Keychain + public JWKS pin
#   run-gateway-auth.sh --b03                WRITE PAT       + phrase → POST third-party-auth custom_jwks (W5)
#                                                            (Auth Config: Read-write)
#   run-gateway-auth.sh --deploy-preflight   READ-ONLY PAT   gateway Production env vs the real config.ts → STOP
#   run-gateway-auth.sh --certify            READ-ONLY PAT   post-gateway/auth certification
#
# Each mode prints the scoped PAT it needs (derived from its endpoint list in gateway-auth-contract.mjs → patRequirement).
# No default mode, no --force/-y/--yes, no ref/key/URL argument: they are pins of gateway-auth-contract.mjs.
# The PAT is read from /dev/tty with echo off, piped to node through the printf builtin (never argv, env or a file) and
# cleared on exit. The confirmation phrase of a write mode is read by node itself from /dev/tty.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
abort() { printf '\n!! %s\n' "$*" >&2; exit 1; }
USAGE="usage: run-gateway-auth.sh --preflight | --auth-lockdown | --db-bootstrap | --keyring-generate | --b03 | --deploy-preflight | --certify"

[[ $# -eq 1 ]] || abort "GATEWAY_AUTH_USAGE — exactly one mode and nothing else ($USAGE)"
case "$1" in
  --preflight|--deploy-preflight|--certify) MODE="$1"; KIND="READ-ONLY" ;;
  --db-bootstrap|--keyring-generate) MODE="$1"; KIND="READ-ONLY (the write is local: psql / Keychain, after the phrase)" ;;
  --auth-lockdown|--b03) MODE="$1"; KIND="TEMPORARY WRITE" ;;
  --force|-f|--yes|-y|--non-interactive|--no-confirm|--assume-yes|yes|y) abort "GATEWAY_AUTH_REFUSED: '$1' is not accepted — every write needs the typed phrase on /dev/tty" ;;
  *) abort "GATEWAY_AUTH_USAGE ($USAGE)" ;;
esac
[[ -z "${CI:-}${GITHUB_ACTIONS:-}${CONTINUOUS_INTEGRATION:-}" ]] || abort "GATEWAY_AUTH_REFUSED_NON_INTERACTIVE (CI environment)"
{ : < /dev/tty; } 2>/dev/null || abort "GATEWAY_AUTH_BLOCKED_NO_TTY (run it in a terminal)"
[[ -t 0 && -t 1 ]] || abort "GATEWAY_AUTH_REFUSED_NON_INTERACTIVE (stdin/stdout are not a terminal)"
command -v node >/dev/null || abort "node missing"
for f in gateway-auth.mjs gateway-auth-contract.mjs mgmt-gateway-auth.mjs keychain-gateway-auth.mjs keychain-gateway-auth.py keyring.mjs psql-gateway-auth.mjs bridge-probe.mjs gateway-loader.mjs; do
  [[ -f "$HERE/$f" ]] || abort "tooling file missing: $f"
done

NEEDS="$(node --input-type=module -e 'const G = await import(process.argv[1]); process.stdout.write(G.patRequirementText(process.argv[2]));' "$HERE/gateway-auth-contract.mjs" "$MODE")" \
  || abort "PAT requirement unavailable for $MODE"

PAT=""
trap 'PAT=""; unset PAT' EXIT INT TERM HUP
printf 'Arma2 Torneos GATEWAY/AUTH — mode %s\n%s\n%s Supabase PAT (sbp_…), no echo: ' "$MODE" "$NEEDS" "$KIND" > /dev/tty
IFS= read -rs PAT < /dev/tty || { printf '\n' > /dev/tty; abort "PAT_NOT_PROVIDED (EOF on the tty)"; }
printf '\n' > /dev/tty
[[ "$PAT" =~ ^sbp_[A-Za-z0-9_]{20,160}$ ]] || abort "PAT malformed"

set +e
printf '{"pat":"%s"}' "$PAT" | node "$HERE/gateway-auth.mjs" "$MODE"
RC=$?
set -e
PAT=""
exit "$RC"
