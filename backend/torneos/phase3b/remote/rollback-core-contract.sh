#!/usr/bin/env bash
# Phase 3B — R3 ROLLBACK on CORE STAGING (decision E, 2026-09-15). Operator-run. PREPARED, NOT RUN.
#
#   rollback-core-contract.sh --preflight-only   read-only: pins + current state + plan → STOP
#   rollback-core-contract.sh --dry-run          preflight + dry-run of the three writes (0 writes)
#   rollback-core-contract.sh                    preflight → HUMAN phrase → rollback → verify → evidence
#
# Reverts ONLY R3, in this order, each step state-checked (re-runnable):
#   1. DELETE the Edge Function torneos-core-contract (skipped when absent);
#   2. the pinned SQL contracts/core-contract-rollback.sql (sha256 pinned in core-contract.mjs and
#      checked here BEFORE the PAT): public.torneos_contract_execute, the 4 app_private functions,
#      the 2 app_private tables (+ their indexes) and the 2 ledger rows — ONLY if those rows carry
#      the digests R3 writes; ONE transaction with its own pre/post guards; no CASCADE;
#   3. DELETE the Edge secret TORNEOS_CONTRACT_SERVICE_SECRET (skipped when absent).
# NEVER: drop schema app_private, touch Core tables, tournament_* history, cron, storage, auth
# users, other functions or other secrets. The Keychain entry is kept (custody; keychain.py has no
# delete): a later re-apply reconciles the same value. Target pinned hhyvmhgpapyuzjgxfnqv;
# Production refused in host/path/body/token. Evidence: core-contract-rollback-<UTC>.json.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
trap 'cleanup_secrets' EXIT INT TERM HUP

CORE_REF="hhyvmhgpapyuzjgxfnqv"
CORE_NAME="arma2-torneos-staging"
SLUG="torneos-core-contract"
SECRET_NAME="TORNEOS_CONTRACT_SERVICE_SECRET"
MODE="${1:-rollback}"
case "$MODE" in rollback|--preflight-only|--dry-run) ;; *) abort "usage: rollback-core-contract.sh [--preflight-only|--dry-run]";; esac
assert_ref "core ref" "$CORE_REF"
require_tty; require_tools
CONTRACT="$HERE/core-contract.mjs"; MGMT_ROLLBACK="$HERE/mgmt-rollback.mjs"
[[ -f "$CONTRACT" && -f "$MGMT_ROLLBACK" ]] || abort "rollback modules missing"
mgmt_rollback() { printf '{"op":"%s","pat":"%s"%s}' "$1" "$PAT" "${2:-}" | node "$MGMT_ROLLBACK"; }
node_json() { node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const d=JSON.parse(s);Promise.resolve(eval(process.argv[1])).then(v=>process.stdout.write(typeof v==="string"?v:JSON.stringify(v)))})' "$1"; }

step "0. pins (before any credential is read)"
PINS="$(node --input-type=module -e "
import { loadRollbackSql, MIGRATIONS, renderAll } from '$CONTRACT';
const rb = loadRollbackSql(); const r = renderAll(process.argv[1]);
process.stdout.write(JSON.stringify({ rollback_sql_sha256: rb.sha256, rollback_sql_bytes: Buffer.byteLength(rb.text, 'utf8'), ledger_digests: MIGRATIONS.map(m => ({ version: m.version, statements_digest: m.ledger_digest })), migrations: r.map(m => ({ version: m.version, sha256: m.migration_sha256 })) }));
" "$REPO")" || abort "pin verification failed (rollback SQL or migration bytes differ from the certified values)"
ok "rollback sql $(printf '%s' "$PINS" | json_field rollback_sql_sha256) ($(printf '%s' "$PINS" | json_field rollback_sql_bytes) B); guards on ledger digests $(printf '%s' "$PINS" | node_json 'd.ledger_digests.map(x=>x.version+":"+x.statements_digest).join(" ")')"
read_pat

step "1. PREFLIGHT (read-only): project, function, secret, contract state, ledger rows"
PROJ="$(mgmt project ",\"ref\":\"$CORE_REF\"")"
printf '%s' "$PROJ" | json_field ok | grep -q true || { printf '%s\n' "$PROJ" >&2; abort "project read failed"; }
[[ "$(printf '%s' "$PROJ" | json_field project.name)" == "$CORE_NAME" ]] || abort "project $CORE_REF is not named $CORE_NAME — STOP"
ok "project $CORE_REF = $CORE_NAME $(printf '%s' "$PROJ" | json_field project.status)"
FN_NOW="$(mgmt function ",\"ref\":\"$CORE_REF\",\"slug\":\"$SLUG\"")"; printf '%s' "$FN_NOW" | json_field ok | grep -q true || abort "function read failed"
FN_PRESENT="$(printf '%s' "$FN_NOW" | json_field present)"
SECRETS_NOW="$(mgmt secret-names ",\"ref\":\"$CORE_REF\"")"; printf '%s' "$SECRETS_NOW" | json_field ok | grep -q true || abort "secret names read failed"
SECRET_PRESENT=false; printf '%s' "$SECRETS_NOW" | json_field secret_names | grep -q "\"$SECRET_NAME\"" && SECRET_PRESENT=true
LEDGER="$(mgmt core-ledger ",\"ref\":\"$CORE_REF\"")"; printf '%s' "$LEDGER" | json_field ok | grep -q true || abort "ledger read failed"
ACL_BEFORE="$(mgmt core-contract-acl ",\"ref\":\"$CORE_REF\"")"; printf '%s' "$ACL_BEFORE" | json_field ok | grep -q true || abort "acl read failed"
STATE="$(printf '%s' "$LEDGER" | node --input-type=module -e "
import { MIGRATIONS } from '$CONTRACT'; import { ledgerState } from '$HERE/mgmt-write.mjs';
let s=''; process.stdin.on('data',c=>s+=c).on('end',()=>{ const d=JSON.parse(s); const rows=Array.isArray(d.rows)?d.rows:[];
  const versions = MIGRATIONS.map(m => ({ version: m.version, installed: d.installed?.[m.version]?.installed === true, ledger: ledgerState(rows, m) }));
  process.stdout.write(JSON.stringify({ versions, foreign: versions.filter(v=>v.ledger==='foreign').map(v=>v.version), anything_to_revert: versions.some(v=>v.installed || v.ledger==='ours') })); });")"
printf '%s' "$STATE" | node_json 'd.versions.map(v=>"  "+v.version+": objects "+(v.installed?"INSTALLED":"absent")+", ledger "+v.ledger).join("\n")'; printf '\n'
[[ "$(printf '%s' "$STATE" | json_field foreign)" == "[]" ]] || abort "ledger rows for the R3 versions were NOT written by R3 (digest differs) — the rollback never deletes them; STOP"
ok "function present=$FN_PRESENT, secret present=$SECRET_PRESENT, objects/ledger to revert=$(printf '%s' "$STATE" | json_field anything_to_revert)"

step "rollback plan (nothing written yet)"
printf '  target    : %s (%s) — Production %s denylisted\n' "$CORE_REF" "$CORE_NAME" "$PROD_REF"
printf '  1 function: %s\n' "$([[ "$FN_PRESENT" == true ]] && printf 'DELETE /v1/projects/%s/functions/%s' "$CORE_REF" "$SLUG" || printf 'absent → skip')"
printf '  2 sql     : pinned %s (drop 5 functions, 2 tables+indexes, 2 ledger rows if ours; app_private kept; no CASCADE)\n' "$(printf '%s' "$PINS" | json_field rollback_sql_sha256 | cut -c1-12)…"
printf '  3 secret  : %s\n' "$([[ "$SECRET_PRESENT" == true ]] && printf 'DELETE /v1/projects/%s/secrets ["%s"] (Keychain entry kept)' "$CORE_REF" "$SECRET_NAME" || printf 'absent → skip')"
TMP="$(mktemp "$EVIDENCE_DIR/.rb-preflight-XXXXXX")"
printf '{"generated_at":"%s","tool":"phase3b/remote/rollback-core-contract.sh","mode":"%s","read_only":true,"core_ref":"%s","pins":%s,"function":%s,"secret_present":%s,"state":%s,"ledger_rows":%s,"acl_before":%s}\n' \
  "$STAMP" "$MODE" "$CORE_REF" "$PINS" "$(printf '%s' "$FN_NOW" | node_json '({present:d.present, fn:d.fn})')" "$SECRET_PRESENT" "$STATE" "$(printf '%s' "$LEDGER" | node_json '(d.rows||[]).filter(r=>["20260914120000","20260915120000"].includes(r.version))')" "$(printf '%s' "$ACL_BEFORE" | json_field acl)" > "$TMP"
promote_evidence "$TMP" "$EVIDENCE_DIR/rollback-preflight-$STAMP.json"
if [[ "$MODE" == "--preflight-only" ]]; then printf 'PHASE3B_R3_ROLLBACK_PREFLIGHT_ONLY_STOP (0 writes)\n'; exit 0; fi
if [[ "$MODE" == "--dry-run" ]]; then
  step "dry-run (0 writes)"
  for op in delete-function rollback-sql delete-secret; do
    OUT="$(mgmt_rollback "$op" ",\"ref\":\"$CORE_REF\",\"dryRun\":true")"; printf '%s' "$OUT" | json_field ok | grep -q true || { printf '%s\n' "$OUT" >&2; abort "$op dry-run failed"; }
    ok "$op: $(printf '%s' "$OUT" | node_json '(delete d.ok, delete d.op, delete d.acl_before, JSON.stringify(d))')"
  done
  printf 'PHASE3B_R3_ROLLBACK_DRYRUN %s (0 writes)\n' "$CORE_REF"; exit 0
fi

step "HUMAN AUTHORIZATION"
printf 'Type exactly  ROLLBACK R3 %s  to revert R3 on Core staging (anything else stops): ' "$CORE_REF" > /dev/tty
IFS= read -r CONFIRM < /dev/tty
[[ "$CONFIRM" == "ROLLBACK R3 $CORE_REF" ]] || abort "PHASE3B_R3_ROLLBACK_NOT_AUTHORIZED (0 writes)"

step "2. delete function $SLUG"
if [[ "$FN_PRESENT" == true ]]; then
  DF="$(mgmt_rollback delete-function ",\"ref\":\"$CORE_REF\"")"; printf '%s' "$DF" | json_field ok | grep -q true || { printf '%s\n' "$DF" >&2; abort "delete-function failed"; }
  ok "deleted"
else DF='{"skipped":"absent"}'; ok "absent → skipped"; fi

step "3. pinned rollback SQL (one transaction)"
RS="$(mgmt_rollback rollback-sql ",\"ref\":\"$CORE_REF\"")"; printf '%s' "$RS" | json_field ok | grep -q true || { printf '%s\n' "$RS" >&2; abort "rollback SQL failed (the transaction rolled back itself; nothing changed in the database)"; }
ok "objects and ledger rows reverted; residue check passed"

step "4. delete secret $SECRET_NAME"
if [[ "$SECRET_PRESENT" == true ]]; then
  DS="$(mgmt_rollback delete-secret ",\"ref\":\"$CORE_REF\"")"; printf '%s' "$DS" | json_field ok | grep -q true || { printf '%s\n' "$DS" >&2; abort "delete-secret failed"; }
  ok "deleted (Keychain entry kept)"
else DS='{"skipped":"absent"}'; ok "absent → skipped"; fi

step "5. post-verify (read-only)"
FN_AFTER="$(mgmt function ",\"ref\":\"$CORE_REF\",\"slug\":\"$SLUG\"")"; [[ "$(printf '%s' "$FN_AFTER" | json_field present)" == "false" ]] || abort "function still present — STOP"
SECRETS_AFTER="$(mgmt secret-names ",\"ref\":\"$CORE_REF\"")"; printf '%s' "$SECRETS_AFTER" | json_field secret_names | grep -q "\"$SECRET_NAME\"" && abort "secret still present — STOP"
ACL_AFTER="$(mgmt core-contract-acl ",\"ref\":\"$CORE_REF\"")"
RESIDUE="$(printf '%s' "$ACL_AFTER" | node --input-type=module -e "import { rollbackResidue } from '$CONTRACT'; let s=''; process.stdin.on('data',c=>s+=c).on('end',()=>process.stdout.write(JSON.stringify(rollbackResidue(JSON.parse(s).acl))));")"
[[ "$RESIDUE" == "[]" ]] || { printf '  %s\n' "$RESIDUE"; abort "residue after rollback — STOP"; }
LEDGER_AFTER="$(mgmt core-ledger ",\"ref\":\"$CORE_REF\"")"
LEFT="$(printf '%s' "$LEDGER_AFTER" | node_json '(d.rows||[]).filter(r=>["20260914120000","20260915120000"].includes(r.version)).length')"
[[ "$LEFT" == "0" ]] || abort "ledger rows left — STOP"
ok "function absent, secret absent, 0 contract objects, app_private kept, 0 ledger rows for R3"

TMP="$(mktemp "$EVIDENCE_DIR/.rb-XXXXXX")"
printf '{"generated_at":"%s","tool":"phase3b/remote/rollback-core-contract.sh","core_ref":"%s","mode":"rollback","authorized_by":"operator typed ROLLBACK R3 %s on /dev/tty","preflight":"rollback-preflight-%s.json","pins":%s,"steps":{"delete_function":%s,"rollback_sql":%s,"delete_secret":%s},"after":{"function_present":false,"secret_present":false,"residue":[],"ledger_rows_left":0,"acl":%s},"custody":{"keychain":"kept: %s/contract-secret"}}\n' \
  "$STAMP" "$CORE_REF" "$CORE_REF" "$STAMP" "$PINS" "$(printf '%s' "$DF" | node_json '(delete d.ok, delete d.op, d)')" "$(printf '%s' "$RS" | node_json '(delete d.ok, delete d.op, delete d.acl_after, d)')" "$(printf '%s' "$DS" | node_json '(delete d.ok, delete d.op, d)')" "$(printf '%s' "$ACL_AFTER" | json_field acl)" "$KC_CORE_SERVICE" > "$TMP"
promote_evidence "$TMP" "$EVIDENCE_DIR/core-contract-rollback-$STAMP.json"
printf 'PHASE3B_CORE_CONTRACT_ROLLED_BACK %s\n' "$CORE_REF"
