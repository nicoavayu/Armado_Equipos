#!/usr/bin/env bash
# R4.2 hybrid gateway certification — operator entrypoint (TTY required: the PAT is typed here).
#   run-r42.sh            the certified matrix run
#   run-r42.sh minimal    post-fix clock-skew reproduction only (1 QA user, exchanges + session verdicts, 0 fixtures)
# Reads the Core contract secret from the Keychain (nonce-replay probe only), the PAT from /dev/tty,
# and hands both to operator.mjs on stdin (printf builtin pipe: never argv, env or disk). The node
# process redacts its own output; the terminal log is checked for every known secret before it is kept.
set -euo pipefail
MODE="${1:-matrix}"
[[ "$MODE" == "matrix" || "$MODE" == "minimal" ]] || { printf 'usage: run-r42.sh [matrix|minimal]\n' >&2; exit 64; }
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../remote" && pwd)/lib.sh"
trap 'cleanup_secrets; unset CONTRACT_SECRET' EXIT
require_tty; require_tools
R42="$HERE/../r42"
[[ -f "$R42/operator.mjs" && -f "$HERE/../r4/runner.mjs" && -f "$HERE/../r4/audit.mjs" ]] || abort 'R4.2 tooling missing'
[[ -x /Applications/Docker.app/Contents/Resources/bin/docker ]] || abort 'docker missing'
CONTRACT_SECRET="$(keychain_read "$KC_CORE_SERVICE" contract-secret)" || abort 'contract secret missing'
[[ "$CONTRACT_SECRET" =~ ^[0-9a-f]{64}$ ]] || abort 'contract secret invalid'
SECRETS_KNOWN+=("$CONTRACT_SECRET")
read_pat
LOG="$EVIDENCE_DIR/r4-terminal-$STAMP.log"
[[ ! -e "$LOG" ]] || abort "terminal log exists $LOG"
step "R4.2 HYBRID GATEWAY $([[ "$MODE" == minimal ]] && printf 'MINIMAL REPRODUCTION' || printf 'CERTIFICATION') — run $STAMP (Core staging $(printf '%s' hhyvmhgpapyuzjgxfnqv))"
set +e
printf '{"pat":"%s","secret":"%s","stamp":"%s","mode":"%s"}' "$PAT" "$CONTRACT_SECRET" "$STAMP" "$MODE" | node "$R42/operator.mjs" 2>&1 | tee "$LOG"
RC=${PIPESTATUS[1]}
set -e
# The log must not carry any secret the shell knew (node redacted its own registry already).
CONTENT="$(cat "$LOG")"
for s in ${SECRETS_KNOWN[@]+"${SECRETS_KNOWN[@]}"}; do
  [[ -n "$s" && ${#s} -ge 8 ]] || continue
  if [[ "$CONTENT" == *"$s"* ]]; then rm -f "$LOG"; abort 'TERMINAL_LOG_REJECTED_SECRET_LEAK'; fi
done
[[ "$CONTENT" != *"\"ref\":\"$PROD_REF\""* ]] || { rm -f "$LOG"; abort 'TERMINAL_LOG_NAMES_PRODUCTION'; }
chmod 600 "$LOG"
printf 'TERMINAL LOG %s\n' "$LOG"; shasum -a 256 "$LOG"
[[ "$RC" == 0 ]] || abort "R4.2 $MODE did not pass (exit $RC); inspect r4-summary-$STAMP.json"
if [[ "$MODE" == minimal ]]; then printf 'R4_MINIMAL_PASS %s\n' "$STAMP"; else printf 'R4_HYBRID_GATEWAY_CERTIFIED %s\n' "$STAMP"; fi
