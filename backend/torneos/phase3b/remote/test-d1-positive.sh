#!/usr/bin/env bash
# Phase 3B — D1 POSITIVE test on Core staging (decision C, 2026-09-15). Operator-run, AFTER R3.
#
#   test-d1-positive.sh              list dedicated QA candidates (masked) → operator types the QA
#                                    email → login → /v1/session 200 → logout → 403 → session row gone
#   test-d1-positive.sh --list-only  only the read-only candidate listing → STOP
#
# Conditions enforced: ONLY a dedicated QA user of Core staging (email carrying qa|test|synthetic|
# phase3b|e2e as its own label, confirmed, password-capable, live, not banned, not anonymous); the
# runner never creates a user (no candidate → STOP); credentials typed on /dev/tty, no echo, kept
# in this shell only, passed to node through the printf builtin pipe; never in evidence/log/chat.
# Login through GoTrue (password grant), logout scope=local (only the test session). The contract
# secret comes from the Keychain (read into a variable, never printed). No profile/team/business
# data is read or written. Evidence: d1-positive-<UTC>.json (ids masked; no email; no token).
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
trap 'cleanup_secrets; unset CONTRACT_SECRET QA_PASSWORD CORE_ANON' EXIT INT TERM HUP

CORE_REF="hhyvmhgpapyuzjgxfnqv"
MODE="${1:-run}"
case "$MODE" in run|--list-only) ;; *) abort "usage: test-d1-positive.sh [--list-only]";; esac
assert_ref "core ref" "$CORE_REF"
require_tty; require_tools
D1="$HERE/d1-positive.mjs"; [[ -f "$D1" ]] || abort "d1-positive.mjs missing"
node_json() { node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const d=JSON.parse(s);Promise.resolve(eval(process.argv[1])).then(v=>process.stdout.write(typeof v==="string"?v:JSON.stringify(v)))})' "$1"; }

step "custody: contract secret must be in the Keychain ($KC_CORE_SERVICE / contract-secret)"
if keychain_check "$KC_CORE_SERVICE" contract-secret; then abort "Keychain has no contract-secret: R3 has not run on this machine — STOP"; fi
ok "present"
read_pat

step "1. dedicated QA candidates on Core staging (read-only, masked)"
FN="$(mgmt function ",\"ref\":\"$CORE_REF\",\"slug\":\"torneos-core-contract\"")"
[[ "$(printf '%s' "$FN" | json_field present)" == "true" && "$(printf '%s' "$FN" | json_field fn.status)" == "ACTIVE" ]] || abort "torneos-core-contract is not deployed/ACTIVE on Core staging — run R3 first"
QA="$(mgmt core-qa-users ",\"ref\":\"$CORE_REF\"")"
printf '%s' "$QA" | json_field ok | grep -q true || { printf '%s\n' "$QA" >&2; abort "qa users read failed"; }
printf '%s' "$QA" | node_json 'd.users.map(u=>"  "+(u.looks_like_qa&&u.confirmed&&u.has_password&&u.live&&u.not_banned&&!u.anonymous?"QA ":"   ")+u.email_masked+"  confirmed="+u.confirmed+" password="+u.has_password+" live="+u.live+" not_banned="+u.not_banned+" anonymous="+u.anonymous+" sessions="+u.sessions).join("\n")'; printf '\n'
CANDIDATES="$(printf '%s' "$QA" | json_field dedicated_candidates)"
[[ "$CANDIDATES" != "[]" ]] || abort "D1_POSITIVE_NO_DEDICATED_QA_USER — no clearly dedicated QA user exists on Core staging; STOP before creating one (decision C)"
ok "dedicated candidates: $CANDIDATES"
if [[ "$MODE" == "--list-only" ]]; then printf 'PHASE3B_D1_POSITIVE_LIST_ONLY_STOP\n'; exit 0; fi

step "2. operator input (tty, no echo for secrets)"
printf 'QA user email (must be one of the candidates above): ' > /dev/tty
IFS= read -r QA_EMAIL < /dev/tty
[[ "$QA_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+$ ]] || abort "email malformed"
MASKED="$(printf '%s' "$QA_EMAIL" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(s.replace(/^(.).*(@.*)$/,"$1***$2")))')"
printf '%s' "$CANDIDATES" | grep -qF "\"$MASKED\"" || abort "$MASKED is not a dedicated QA candidate — refused"
read_secret QA_PASSWORD "Password of $MASKED (Core staging), no echo" '^.{8,200}$'
read_secret CORE_ANON "Core staging anon key (eyJ…), no echo" '^eyJ[A-Za-z0-9._-]{40,}$'
assert_not_prod "anon key" "$CORE_ANON"
CONTRACT_SECRET="$(keychain_read "$KC_CORE_SERVICE" contract-secret)"; SECRETS_KNOWN+=("$CONTRACT_SECRET")
[[ "$CONTRACT_SECRET" =~ ^[0-9a-f]{64}$ ]] || abort "Keychain contract secret malformed"

step "3. login → /v1/session → logout(local) → /v1/session"
OUT="$(printf '{"ref":"%s","anon_key":"%s","email":%s,"password":%s,"secret":"%s"}' "$CORE_REF" "$CORE_ANON" "$(json_escape "$QA_EMAIL")" "$(json_escape "$QA_PASSWORD")" "$CONTRACT_SECRET" | node "$D1" || true)"
unset QA_PASSWORD CORE_ANON CONTRACT_SECRET
printf '%s' "$OUT" | json_field ok | grep -q true || { printf '%s\n' "$OUT" >&2; abort "d1 positive run failed"; }
printf '%s' "$OUT" | node_json 'd.steps.map(s=>"  "+(s.ok?"[ok]  ":"[FAIL]")+" "+s.step+" → "+s.status+(s.body?" "+JSON.stringify(s.body):"")).join("\n")'; printf '\n'
VERDICT="$(printf '%s' "$OUT" | json_field verdict)"
USER_ID="$(printf '%s' "$OUT" | json_field core_user_id)"; SESSION_ID="$(printf '%s' "$OUT" | json_field session_id)"

step "4. the test session must be gone (read-only)"
[[ "$VERDICT" == "D1_POSITIVE_PASS" ]] || abort "D1_POSITIVE_$VERDICT — see steps above (no evidence promoted)"
[[ "$SESSION_ID" =~ ^[0-9a-f-]{36}$ && "$USER_ID" =~ ^[0-9a-f-]{36}$ ]] || abort "ids unexpected"
SESS="$(mgmt core-session-exists ",\"ref\":\"$CORE_REF\",\"session_id\":\"$SESSION_ID\",\"user_id\":\"$USER_ID\"")"
printf '%s' "$SESS" | json_field ok | grep -q true || { printf '%s\n' "$SESS" >&2; abort "session probe failed"; }
[[ "$(printf '%s' "$SESS" | json_field session_present)" == "false" ]] || abort "the test session row still exists in auth.sessions — STOP"
BEFORE="$(printf '%s' "$QA" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const d=JSON.parse(s);const u=d.users.find(u=>u.email_masked===process.argv[1]);process.stdout.write(String(u?u.sessions:"null"))})' "$MASKED")"
AFTER="$(printf '%s' "$SESS" | json_field user_sessions)"
ok "session row deleted; user sessions before=$BEFORE after=$AFTER"

TMP="$(mktemp "$EVIDENCE_DIR/.d1pos-XXXXXX")"
printf '{"generated_at":"%s","tool":"phase3b/remote/test-d1-positive.sh","core_ref":"%s","mode":"run","qa_user":{"email_masked":"%s","user_id_prefix":"%s","dedicated":true},"steps":%s,"verdict":"%s","pass":true,"session":{"id_prefix":"%s","present_after":false,"user_sessions_before":%s,"user_sessions_after":%s},"scope":"GoTrue login + logout scope=local + contract session op; no profile/team/business data touched"}\n' \
  "$STAMP" "$CORE_REF" "$MASKED" "${USER_ID:0:8}" "$(printf '%s' "$OUT" | json_field steps)" "$VERDICT" "${SESSION_ID:0:8}" "$BEFORE" "$AFTER" > "$TMP"
promote_evidence "$TMP" "$EVIDENCE_DIR/d1-positive-$STAMP.json"
printf 'PHASE3B_D1_POSITIVE_PASS %s\n' "$CORE_REF"
