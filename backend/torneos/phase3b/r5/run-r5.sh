#!/usr/bin/env bash
# R5 hybrid end-to-end certification — operator entrypoint (TTY required: the PAT is typed here).
# Same credential contract as r42/run-r42.sh: the Core contract secret from the Keychain (nonce-replay
# probe only) and the PAT from /dev/tty reach operator.mjs on stdin through the printf builtin (never
# argv, env or disk); node redacts its own output; the terminal log is checked for every known secret.
# operator.mjs mode=r5 drives the R4-certified gateway lifecycle unchanged (handoff → guards → preflight →
# start-gateway → smoke) and then the R5 journey producer (r5/journey.mjs) instead of the R4.2 matrix.
set -euo pipefail
[[ $# -eq 0 ]] || { printf 'usage: run-r5.sh (no arguments)\n' >&2; exit 64; }
MODE="r5"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../remote" && pwd)/lib.sh"
trap 'cleanup_secrets; unset CONTRACT_SECRET' EXIT
require_tty; require_tools
R42="$HERE/../r42"; R5="$HERE/../r5"
[[ -f "$R42/operator.mjs" && -f "$R5/journey.mjs" && -f "$R5/flow.mjs" && -f "$HERE/../r4/runner.mjs" && -f "$HERE/../r4/audit.mjs" ]] || abort 'R5 tooling missing'
[[ -x /Applications/Docker.app/Contents/Resources/bin/docker ]] || abort 'docker missing'
CONTRACT_SECRET="$(keychain_read "$KC_CORE_SERVICE" contract-secret)" || abort 'contract secret missing'
[[ "$CONTRACT_SECRET" =~ ^[0-9a-f]{64}$ ]] || abort 'contract secret invalid'
SECRETS_KNOWN+=("$CONTRACT_SECRET")
read_pat
LOG="$EVIDENCE_DIR/r5-terminal-$STAMP.log"
[[ ! -e "$LOG" ]] || abort "terminal log exists $LOG"
step "R5 HYBRID END-TO-END CERTIFICATION — run $STAMP (Core staging $(printf '%s' hhyvmhgpapyuzjgxfnqv) → local gateway → Torneos R2)"
set +e
printf '{"pat":"%s","secret":"%s","stamp":"%s","mode":"%s"}' "$PAT" "$CONTRACT_SECRET" "$STAMP" "$MODE" | node "$R42/operator.mjs" 2>&1 | tee "$LOG"
RC=${PIPESTATUS[1]}
set -e
CONTENT="$(cat "$LOG")"
for s in ${SECRETS_KNOWN[@]+"${SECRETS_KNOWN[@]}"}; do
  [[ -n "$s" && ${#s} -ge 8 ]] || continue
  if [[ "$CONTENT" == *"$s"* ]]; then rm -f "$LOG"; abort 'TERMINAL_LOG_REJECTED_SECRET_LEAK'; fi
done
[[ "$CONTENT" != *"\"ref\":\"$PROD_REF\""* ]] || { rm -f "$LOG"; abort 'TERMINAL_LOG_NAMES_PRODUCTION'; }
chmod 600 "$LOG"
printf 'TERMINAL LOG %s\n' "$LOG"; shasum -a 256 "$LOG"
[[ "$RC" == 0 ]] || abort "R5 did not pass (exit $RC); inspect r5-summary-$STAMP.json — STOP, no automatic rerun"
printf 'R5_HYBRID_E2E_CERTIFIED %s\n' "$STAMP"
