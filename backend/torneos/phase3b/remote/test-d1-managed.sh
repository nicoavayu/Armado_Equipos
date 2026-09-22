#!/usr/bin/env bash
# Authorized managed QA: creates and removes only its own ephemeral staging user.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
trap 'cleanup_secrets; unset CONTRACT_SECRET' EXIT
require_tty; require_tools
CONTRACT_SECRET="$(keychain_read "$KC_CORE_SERVICE" contract-secret)" || abort 'contract secret missing'
[[ "$CONTRACT_SECRET" =~ ^[0-9a-f]{64}$ ]] || abort 'contract secret invalid'
SECRETS_KNOWN+=("$CONTRACT_SECRET")
read_pat
step 'D1 automatico: crear QA exclusivo, probar sesion, logout, verificar y limpiar QA'
RC=0
OUT="$(printf '{"pat":"%s","secret":"%s"}' "$PAT" "$CONTRACT_SECRET" | node "$HERE/d1-managed.mjs")" || RC=$?
TMP="$(mktemp "$EVIDENCE_DIR/.d1-managed-XXXXXX")"
printf '%s\n' "$(redact_known "$OUT")" > "$TMP"
promote_evidence "$TMP" "$EVIDENCE_DIR/d1-managed-$STAMP.json"
printf '%s\n' "$(redact_known "$OUT")"
[[ "$RC" == 0 ]] || abort 'D1 did not pass; inspect evidence before any retry'
printf 'PHASE3B_D1_POSITIVE_PASS %s\n' 'hhyvmhgpapyuzjgxfnqv'
