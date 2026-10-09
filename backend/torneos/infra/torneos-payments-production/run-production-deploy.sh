#!/usr/bin/env bash
# COMMERCE-PRODUCTION — operator wrapper of production-deploy.mjs (Deno Deploy app `torneos-payments`). Run in a real terminal.
#
#   bash run-production-deploy.sh plan
#   bash run-production-deploy.sh preflight
#   bash run-production-deploy.sh create CREATE TORNEOS PAYMENTS PRODUCTION APP torneos-payments <digest12>
#   bash run-production-deploy.sh deploy DEPLOY TORNEOS PAYMENTS PRODUCTION torneos-payments <digest12>
#   bash run-production-deploy.sh status
#
# Values typed here, echo off, only for the commands that need them: the Deno Deploy organization token (every command
# but plan) and, for preflight/create, the Mercado Pago PRODUCTION access token, the PRODUCTION webhook secret (Webhooks →
# Modo productivo → Clave secreta) and the seller id. They are piped to node through the printf builtin (never argv, env
# or a file) and cleared on exit. The DB login password and the internal HMAC key come from the Keychain, inside node.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
abort() { printf '\n!! %s\n' "$*" >&2; exit 1; }
[[ $# -ge 1 ]] || abort "usage: run-production-deploy.sh plan|preflight|create|deploy|status [phrase…]"
[[ -z "${CI:-}${GITHUB_ACTIONS:-}" ]] || abort "PRODUCTION_DEPLOY_REFUSED_NON_INTERACTIVE (CI)"
command -v node >/dev/null || abort "node missing"
CMD="$1"
if [[ "$CMD" == "plan" ]]; then printf '{}' | node "$HERE/production-deploy.mjs" "$@"; exit $?; fi
{ : < /dev/tty; } 2>/dev/null || abort "PRODUCTION_DEPLOY_BLOCKED_NO_TTY (run it in a terminal)"

DENO=""; MPT=""; MPS=""; SELLER=""
printf '\033[?2004l' > /dev/tty
clean() { local v="$1" esc=$'\033'; v="${v//${esc}\[200~/}"; v="${v//${esc}\[201~/}"; v="${v//$'\r'/}"; v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"; printf -v "$2" '%s' "$v"; }
trap 'DENO=""; MPT=""; MPS=""; SELLER=""; unset DENO MPT MPS SELLER' EXIT INT TERM HUP
ask() { # $1 prompt, $2 var, $3 regex, $4 name, $5 echo (yes|no)
  local v=""
  printf '%s%s: ' "$1" "$([[ "$5" == yes ]] && echo '' || echo ' (no echo)')" > /dev/tty
  if [[ "$5" == yes ]]; then IFS= read -r v < /dev/tty || abort "$4 not provided"; else IFS= read -rs v < /dev/tty || abort "$4 not provided"; printf '\n' > /dev/tty; fi
  clean "$v" v
  [[ "$v" =~ $3 ]] || abort "$4 malformed"
  printf -v "$2" '%s' "$v"; v=""
}
printf 'Arma2 Torneos — PAYMENTS PRODUCTION deploy (%s). Mercado Pago PRODUCTION: real charges.\n\n' "$CMD" > /dev/tty
ask 'Deno Deploy organization token (ddo_…)' DENO '^dd[op]_[A-Za-z0-9_-]{20,200}$' "Deno token" no
if [[ "$CMD" == "preflight" || "$CMD" == "create" ]]; then
  ask 'Mercado Pago PRODUCTION seller id (numeric, Tus integraciones → Credenciales de producción)' SELLER '^[1-9][0-9]{3,19}$' "seller id" yes
  ask 'Mercado Pago PRODUCTION Access Token (APP_USR-…)' MPT '^APP_USR-[0-9]{6,20}-[0-9]{6}-[0-9a-f]{32}-[0-9]{6,20}$' "MP access token" no
  ask 'Mercado Pago PRODUCTION webhook secret (Webhooks → Modo productivo → Clave secreta)' MPS '^[A-Za-z0-9]{32,128}$' "MP webhook secret" no
fi

set +e
printf '{"deno":"%s","mpToken":"%s","mpSecret":"%s","sellerId":"%s"}' "$DENO" "$MPT" "$MPS" "$SELLER" | node "$HERE/production-deploy.mjs" "$@"
RC=$?
set -e
DENO=""; MPT=""; MPS=""; SELLER=""
exit "$RC"
