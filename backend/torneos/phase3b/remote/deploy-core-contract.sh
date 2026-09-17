#!/usr/bin/env bash
# Phase 3B — R3: the certified Core contract (v1 + v1.1) on CORE STAGING. Operator-run.
#
#   deploy-core-contract.sh --preflight-only     read-only: pins, Keychain, ledger shape, state, plan → STOP
#   deploy-core-contract.sh --dry-run            preflight + dry-run of the writes (manifest, decisions), 0 writes
#   deploy-core-contract.sh                      preflight → HUMAN phrase → apply (idempotent) → evidence
#
# Target is pinned: hhyvmhgpapyuzjgxfnqv (decision 2026-09-15: the monolithic Staging clone is the
# Core non-production project). Production (rcyuuoaqfwcembdajcss) is refused everywhere.
#
# Decisions of 2026-09-15 (R3 pre-apply) implemented here:
#   D  ledger strategy A: each migration is applied as ONE transaction = file bytes + the CLI-shaped
#      row INSERT INTO supabase_migrations.schema_migrations(version, name, statements) (statements =
#      parser.SplitAndTrim, cli_parser.mjs); the hosted ledger shape observed on the platform is
#      verified read-only BEFORE any write and again inside the apply op; the 7 CLI-shaped rows
#      of Core staging must be reproduced by the local files (live validation of the splitter) and
#      the 2 legacy single-blob rows must equal their pinned fingerprints (core-contract.mjs);
#      probe-first on objects AND ledger → re-runs skip/reconcile, inconsistent states STOP.
#   B1 secret idempotent: Keychain × Core state machine (absent/absent → generate+store+set;
#      PRESENT/absent → re-set the Keychain value; PRESENT/PRESENT → the signed probe decides and a
#      mismatch is reconciled from the Keychain; absent/PRESENT → STOP). Value never printed, never
#      argv, never a persistent env var (stdin pipe from the printf builtin only).
#   B2 strict: DEPLOYED requires the signed harness (9 exact answers incl. 401/403/REPLAY) and
#      the ACL probe (has_function_privilege / has_table_privilege for anon, authenticated,
#      service_role on every contract object) — a 503/404 is a failure, never "deployed".
#   E  a pinned rollback exists (rollback-core-contract.sh); it is NOT run here.
# Nothing here touches other functions, other secrets, Auth settings, Core tables or Production.
#
# Capture contract (2026-09-17): under `set -e` a failing `X="$(mgmt… )"` kills the shell in the assignment
# itself, before the abort that would have printed node's error JSON (the APPLY of 17:08Z was cut at step 2
# with EXIT=1 and nothing on disk). Every capture therefore ends in `|| stage_failed …` / `|| preflight_failed …`
# on the SAME line: the captured output goes to stderr (redacted), the exit code + output + everything the
# run knew so far are persisted (r3-preflight-failed-* before the phrase, r3-failed-* after it), then abort.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
trap 'cleanup_secrets; unset CONTRACT_SECRET' EXIT INT TERM HUP

CORE_REF="hhyvmhgpapyuzjgxfnqv"
CORE_NAME="arma2-torneos-staging"
SLUG="torneos-core-contract"
SECRET_NAME="TORNEOS_CONTRACT_SERVICE_SECRET"
MODE="${1:-apply}"
case "$MODE" in apply|--preflight-only|--dry-run) ;; *) abort "usage: deploy-core-contract.sh [--preflight-only|--dry-run]";; esac
assert_ref "core ref" "$CORE_REF"
require_tty; require_tools
CONTRACT="$HERE/core-contract.mjs"; PROBE="$HERE/probe-core-contract.mjs"
[[ -f "$CONTRACT" && -f "$PROBE" && -f "$HERE/cli_parser.mjs" && -f "$HERE/mgmt-rollback.mjs" ]] || abort "R3 modules missing"
node_json() { node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const d=JSON.parse(s);Promise.resolve(eval(process.argv[1])).then(v=>process.stdout.write(typeof v==="string"?v:JSON.stringify(v)))})' "$1"; }

# ── failure evidence from ANY stage (defined before the first capture; tolerant of stages that never ran) ──
# Never a secret value: CONTRACT_SECRET and PAT are never passed here, node redacts its own output, the captured
# text is passed through redact_known, and promote_evidence refuses the file if a known secret appears anyway.
jv() { # $1=variable name [$2=dotted field] → JSON for the evidence: the value (or field) when it parses, the raw text as a JSON string when it does not, null when the stage never ran
  local v="${!1:-}"; [[ -n "$v" ]] || { printf 'null'; return 0; }
  printf '%s' "$v" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{let d;try{d=JSON.parse(s)}catch{process.stdout.write(JSON.stringify(s.slice(0,4000)));return}const p=process.argv[1];const v=p?p.split(".").reduce((a,k)=>a?.[k],d):d;process.stdout.write(v===undefined?"null":JSON.stringify(v))})' "${2:-}" || printf 'null'
}
r3_failure_evidence() { # $1=family (r3-preflight-failed | r3-failed) $2=stop code $3=detail (JSON)
  local tmp ro=false; tmp="$(mktemp "$EVIDENCE_DIR/.$1-XXXXXX")" || abort "mktemp failed"
  [[ "$1" != r3-preflight-failed ]] || ro=true
  printf '{"generated_at":"%s","tool":"phase3b/remote/deploy-core-contract.sh","mode":"%s","read_only":%s,"stop":"%s","failed_at":"%s","detail":%s,"core_ref":"%s","project":%s,"pins":%s,"keychain":"%s","remote_secret":"%s","secret_action":%s,"ledger":%s,"ledger_raw":%s,"function_before":%s,"acl_before":%s,"migrations":%s,"deploy":%s,"function":%s,"probe":%s,"acl_after":%s,"acl_failures":%s,"ledger_after":%s}\n' \
    "$STAMP" "$MODE" "$ro" "$2" "$2" "$3" "$CORE_REF" "$(jv PROJ project)" "$(jv PINS)" "${KC_STATE:-unread}" "${REMOTE_SECRET:-unread}" "$(jv SECRET_ACTION)" "$(jv LEDGER_EVAL)" "$(printf '%s' "${LEDGER:-}" | node_json '({shape:d.shape, rows:d.rows, installed:d.installed, all_versions:d.all_versions})' 2>/dev/null || printf 'null')" "$(jv FN_NOW)" "$(jv ACL_BEFORE acl)" "$(jv MIG migrations)" "$(jv DEP)" "$(jv FN_AFTER fn)" "$(jv PROBE_OUT)" "$(jv ACL_AFTER acl)" "$(jv ACL_FAILS)" "$(jv LEDGER_AFTER rows)" > "$tmp"
  promote_evidence "$tmp" "$EVIDENCE_DIR/$1-$STAMP.json" || true
}
failure_detail() { # $1=exit code $2=captured output (already redacted) → {"exit_code":N,"output":…}
  local out="$2"; printf '{"exit_code":%s,"output":%s}' "${1:-1}" "$(jv out)"
}
preflight_failed() { # $1=stop code $2=exit code $3=captured output $4=message — before the phrase (read-only)
  local out; out="$(redact_known "$3")"
  [[ -z "$out" ]] || printf '%s\n' "$out" >&2
  r3_failure_evidence r3-preflight-failed "$1" "$(failure_detail "$2" "$out")"
  abort "$4 (exit $2; evidence r3-preflight-failed-$STAMP.json)"
}
stage_failed() { # $1=stage $2=exit code $3=captured output $4=message — after the phrase
  local out; out="$(redact_known "$3")"
  [[ -z "$out" ]] || printf '%s\n' "$out" >&2
  r3_failure_evidence r3-failed "$1" "$(failure_detail "$2" "$out")"
  abort "$4 (stage: $1, exit $2; evidence r3-failed-$STAMP.json)"
}
preflight_stop_evidence() { r3_failure_evidence r3-preflight-failed "$1" "$2"; } # $1=stop code $2=detail (JSON)

step "0. pins (before any credential is read)"
PINS="$(node --input-type=module -e "
import { renderAll, loadRollbackSql, CLI_PARSER_SHA256, sha256, MIGRATIONS } from '$CONTRACT';
import fs from 'node:fs';
const repo = process.argv[1];
const r = renderAll(repo);
const rb = loadRollbackSql();
const parser = sha256(fs.readFileSync('$HERE/cli_parser.mjs'));
if (parser !== CLI_PARSER_SHA256) { console.error('cli_parser.mjs differs from the validated port'); process.exit(2); }
process.stdout.write(JSON.stringify({ migrations: r.map(m => ({ version: m.version, file: m.file, sha256: m.migration_sha256, apply_sql_sha256: m.apply_sql_sha256, apply_sql_bytes: m.apply_sql_bytes, ledger: { name: m.name, statements_count: m.row.statements_count, statements_digest: m.row.statements_digest, statements_bytes: m.row.statements_bytes } })), rollback_sql_sha256: rb.sha256, cli_parser_sha256: parser }));
" "$REPO")" || abort "pin verification failed (migration bytes, rendered apply SQL, rollback SQL or cli_parser differ from the certified values)"
printf '%s' "$PINS" | node_json 'd.migrations.map(m=>"  [ok] "+m.version+" file "+m.sha256.slice(0,12)+"… apply-sql "+m.apply_sql_sha256.slice(0,12)+"… ("+m.apply_sql_bytes+" B) ledger "+m.ledger.statements_count+" stmts md5 "+m.ledger.statements_digest).join("\n")+"\n  [ok] rollback sql "+d.rollback_sql_sha256.slice(0,12)+"…  cli_parser "+d.cli_parser_sha256.slice(0,12)+"…\n"'

step "custody preflight (Keychain $KC_CORE_SERVICE / contract-secret)"
KC_STATE="ABSENT"; if keychain_check "$KC_CORE_SERVICE" contract-secret; then :; else KC_STATE="PRESENT"; fi
ok "Keychain: $KC_STATE"
read_pat

step "1. PREFLIGHT (read-only): project, ledger shape, CLI rows, contract state, secret, function"
PROJ="$(mgmt project ",\"ref\":\"$CORE_REF\"")" || preflight_failed PROJECT_READ_FAILED "$?" "$PROJ" "project read failed"
printf '%s' "$PROJ" | json_field ok | grep -q true || preflight_failed PROJECT_READ_FAILED 1 "$PROJ" "project read failed"
[[ "$(printf '%s' "$PROJ" | json_field project.name)" == "$CORE_NAME" ]] || abort "project $CORE_REF is not named $CORE_NAME — STOP"
[[ "$(printf '%s' "$PROJ" | json_field project.status)" == "ACTIVE_HEALTHY" ]] || abort "project not ACTIVE_HEALTHY — STOP"
ok "project $CORE_REF = $CORE_NAME ACTIVE_HEALTHY ($(printf '%s' "$PROJ" | json_field project.classification))"

LEDGER="$(mgmt core-ledger ",\"ref\":\"$CORE_REF\"")" || preflight_failed LEDGER_READ_FAILED "$?" "$LEDGER" "ledger read failed"
printf '%s' "$LEDGER" | json_field ok | grep -q true || preflight_failed LEDGER_READ_FAILED 1 "$LEDGER" "ledger read failed"
LEDGER_EVAL="$(printf '%s' "$LEDGER" | node --input-type=module -e "
import { ledgerShapeDiff, compareLedgerRows, cliRowsVerdict, localLedgerDigests, CLI_WRITTEN_VERSIONS, MIGRATIONS, writerPrivilegeFailures } from '$CONTRACT';
import { ledgerState, applyDecision } from '$HERE/mgmt-write.mjs';
let s=''; process.stdin.on('data',c=>s+=c).on('end',()=>{
  const d=JSON.parse(s); const repo=process.argv[1];
  const shape_diff = ledgerShapeDiff(d.shape);
  const cli = compareLedgerRows(Array.isArray(d.rows)?d.rows:[], localLedgerDigests(repo, CLI_WRITTEN_VERSIONS));
  const cli_verdict = cliRowsVerdict(cli);
  const versions = MIGRATIONS.map(m => { const installed = d.installed?.[m.version]?.installed === true; const ledger = ledgerState(Array.isArray(d.rows)?d.rows:[], m); return { version: m.version, installed, ledger, decision: applyDecision(installed, ledger) }; });
  const writer_failures = writerPrivilegeFailures(d.writer);
  process.stdout.write(JSON.stringify({ shape_diff, shape_ok: shape_diff.length===0, writer: d.writer, writer_failures, writer_ok: writer_failures.length===0, totals: d.shape?.totals ?? null, standard_conforming_strings: d.shape?.standard_conforming_strings ?? null, cli_rows: cli, cli_verdict, cli_matched: cli_verdict.reproduced, cli_legacy_matched: cli_verdict.legacy_matched, cli_mismatched: cli_verdict.mismatched, cli_absent: cli_verdict.absent, all_versions: Array.isArray(d.all_versions)?d.all_versions.map(v=>v.version):null, versions, stop: versions.some(v=>v.decision.startsWith('STOP')) }));
});" "$REPO")" || preflight_failed LEDGER_EVAL_FAILED "$?" "$LEDGER_EVAL" "ledger evaluation failed"
printf '%s' "$LEDGER_EVAL" | json_field shape_ok | grep -q true || { printf '  ledger shape differs from the hosted shape observed on the platform (2026-08-07):\n'; printf '%s' "$LEDGER_EVAL" | json_field shape_diff; printf '\n'; abort "LEDGER_SHAPE_UNEXPECTED — STOP (decision D: never write the ledger on a shape that was not verified)"; }
ok "ledger shape == hosted shape (6 columns, PK version, UNIQUE idempotency_key NULLS DISTINCT); rows=$(printf '%s' "$LEDGER_EVAL" | json_field totals.total_rows) max=$(printf '%s' "$LEDGER_EVAL" | json_field totals.max_version) standard_conforming_strings=$(printf '%s' "$LEDGER_EVAL" | json_field standard_conforming_strings)"
printf '%s' "$LEDGER_EVAL" | json_field writer_ok | grep -q true || { printf '  writer privileges: '; printf '%s' "$LEDGER_EVAL" | json_field writer_failures; printf '\n'; abort "WRITER_PRIVILEGES_INSUFFICIENT — the platform role postgres cannot apply (CREATE on database/schemas, INSERT/DELETE on the ledger) — STOP"; }
ok "catalog privileges for postgres (effective PAT role checked separately before apply): database owner $(printf '%s' "$LEDGER_EVAL" | json_field writer.database_owner), CREATE on database/public/app_private, INSERT+DELETE on the ledger; app_private owner $(printf '%s' "$LEDGER_EVAL" | json_field writer.app_private_owner)"
CLI_MATCHED="$(printf '%s' "$LEDGER_EVAL" | json_field cli_matched)"; CLI_LEGACY="$(printf '%s' "$LEDGER_EVAL" | json_field cli_legacy_matched)"; CLI_MISMATCHED="$(printf '%s' "$LEDGER_EVAL" | json_field cli_mismatched)"; CLI_ABSENT="$(printf '%s' "$LEDGER_EVAL" | json_field cli_absent)"
if ! printf '%s' "$LEDGER_EVAL" | json_field cli_verdict.ok | grep -q true; then
  # Fail closed AND keep the observation: the exact remote fingerprints are the only way to explain a
  # discrepancy afterwards (2026-09-16: the first STOP here left no evidence on disk).
  printf '%s' "$LEDGER_EVAL" | json_field cli_rows; printf '\n'
  preflight_stop_evidence CLI_ROWS_NOT_REPRODUCED "$(jv LEDGER_EVAL cli_verdict)"
  abort "canonical rows of Core staging not reproduced (splitter reproduced=$CLI_MATCHED/$(printf '%s' "$LEDGER_EVAL" | json_field cli_verdict.expected.reproduced), legacy fingerprints=$CLI_LEGACY/$(printf '%s' "$LEDGER_EVAL" | json_field cli_verdict.expected.legacy), mismatched=$CLI_MISMATCHED, absent=$CLI_ABSENT; evidence r3-preflight-failed-$STAMP.json) — STOP"
fi
ok "canonical rows of Core staging: $CLI_MATCHED CLI-shaped rows reproduced byte-for-byte by cli_parser + $CLI_LEGACY legacy single-blob rows equal to their pinned fingerprints (mismatched $CLI_MISMATCHED, absent $CLI_ABSENT)"
# Every later preflight STOP persists the observation too (same file family, its own stop code): a STOP
# without evidence cannot be explained afterwards. Read-only; the JSON carries no secret value.
printf '%s' "$LEDGER_EVAL" | node_json 'd.versions.map(v=>"  "+v.version+": objects "+(v.installed?"INSTALLED":"absent")+", ledger "+v.ledger+" → "+v.decision).join("\n")' || true; printf '\n'
printf '%s' "$LEDGER_EVAL" | json_field stop | grep -q true && { preflight_stop_evidence CONTRACT_LEDGER_STATE_INCONSISTENT "$(printf '%s' "$LEDGER_EVAL" | json_field versions)"; abort "inconsistent contract/ledger state on Core staging — STOP (never reapply over a foreign ledger row, never record objects that are not there)"; }

SECRETS_NOW="$(mgmt secret-names ",\"ref\":\"$CORE_REF\"")" || preflight_failed SECRET_NAMES_READ_FAILED "$?" "$SECRETS_NOW" "secret names read failed"
printf '%s' "$SECRETS_NOW" | json_field ok | grep -q true || preflight_failed SECRET_NAMES_READ_FAILED 1 "" "secret names read failed (the inventory is never persisted)"
REMOTE_SECRET="absent"; printf '%s' "$SECRETS_NOW" | json_field secret_names | grep -q "\"$SECRET_NAME\"" && REMOTE_SECRET="PRESENT"
case "$KC_STATE/$REMOTE_SECRET" in
  ABSENT/absent) SECRET_PLAN="generate 32 random bytes (hex) → Keychain add → set-secrets on Core → verify by signed probe";;
  PRESENT/absent) SECRET_PLAN="Keychain value → set-secrets on Core (reconcile; the value is never printed) → verify by signed probe";;
  PRESENT/PRESENT) SECRET_PLAN="no write unless the signed probe reports SECRET_MISMATCH → then set-secrets with the Keychain value and re-probe";;
  ABSENT/PRESENT) SECRET_PLAN="STOP";;
esac
[[ "$SECRET_PLAN" != "STOP" ]] || { preflight_stop_evidence SECRET_REMOTE_PRESENT_KEYCHAIN_ABSENT "{\"secret_name\":\"$SECRET_NAME\",\"remote\":\"PRESENT\",\"keychain\":\"$KC_STATE\"}"; abort "SECRET_REMOTE_PRESENT_KEYCHAIN_ABSENT: Core holds a $SECRET_NAME whose value is not in the Keychain; the runner never rotates silently — restore the Keychain entry or delete the Core secret deliberately (rollback-core-contract.sh), then re-run"; }
ok "secret: Keychain $KC_STATE / Core $REMOTE_SECRET → $SECRET_PLAN"

FN_NOW="$(mgmt function ",\"ref\":\"$CORE_REF\",\"slug\":\"$SLUG\"")" || preflight_failed FUNCTION_READ_FAILED "$?" "$FN_NOW" "function read failed"
printf '%s' "$FN_NOW" | json_field ok | grep -q true || preflight_failed FUNCTION_READ_FAILED 1 "$FN_NOW" "function read failed"
FN_PRESENT="$(printf '%s' "$FN_NOW" | json_field present)"
ok "function $SLUG: present=$FN_PRESENT$([[ "$FN_PRESENT" == true ]] && printf ' (version %s, ezbr %s, verify_jwt %s)' "$(printf '%s' "$FN_NOW" | json_field fn.version)" "$(printf '%s' "$FN_NOW" | json_field fn.ezbr_sha256 | cut -c1-12)…" "$(printf '%s' "$FN_NOW" | json_field fn.verify_jwt)")"
ACL_BEFORE="$(mgmt core-contract-acl ",\"ref\":\"$CORE_REF\"")" || preflight_failed ACL_READ_FAILED "$?" "$ACL_BEFORE" "acl read failed"
printf '%s' "$ACL_BEFORE" | json_field ok | grep -q true || preflight_failed ACL_READ_FAILED 1 "$ACL_BEFORE" "acl read failed"

step "R3 plan (nothing written yet)"
printf '  target           : %s (%s) — Production %s denylisted\n' "$CORE_REF" "$CORE_NAME" "$PROD_REF"
printf '  migrations       : '; printf '%s' "$LEDGER_EVAL" | node_json 'd.versions.map(v=>v.version+"→"+v.decision).join(", ")'; printf '\n'
printf '  ledger           : strategy A (INSERT (version,name,statements) in the SAME transaction; CLI row shape)\n'
printf '  secret           : %s\n' "$SECRET_PLAN"
printf '  function         : deploy %s (verify_jwt=false, 3 files, CLI-shaped multipart) → read back → signed harness (9 exact answers) → ACL probe\n' "$SLUG"
printf '  rollback         : rollback-core-contract.sh (pinned %s…), prepared, NOT run here\n' "$(printf '%s' "$PINS" | json_field rollback_sql_sha256 | cut -c1-12)"
TMP="$(mktemp "$EVIDENCE_DIR/.r3-preflight-XXXXXX")" || abort "mktemp failed"
printf '{"generated_at":"%s","tool":"phase3b/remote/deploy-core-contract.sh","mode":"%s","read_only":true,"core_ref":"%s","project":%s,"pins":%s,"keychain":"%s","remote_secret":"%s","secret_plan":%s,"function":%s,"ledger":%s,"ledger_raw":%s,"acl_before":%s}\n' \
  "$STAMP" "$MODE" "$CORE_REF" "$(printf '%s' "$PROJ" | json_field project)" "$PINS" "$KC_STATE" "$REMOTE_SECRET" "$(json_escape "$SECRET_PLAN")" "$(printf '%s' "$FN_NOW" | node_json '({present:d.present, fn:d.fn})')" "$LEDGER_EVAL" "$(printf '%s' "$LEDGER" | node_json '({shape:d.shape, rows:d.rows, installed:d.installed})')" "$(printf '%s' "$ACL_BEFORE" | json_field acl)" > "$TMP"
promote_evidence "$TMP" "$EVIDENCE_DIR/r3-preflight-$STAMP.json"
if [[ "$MODE" == "--preflight-only" ]]; then printf 'PHASE3B_R3_PREFLIGHT_ONLY_STOP (0 writes)\n'; exit 0; fi

if [[ "$MODE" == "--dry-run" ]]; then
  step "dry-run of the writes (0 writes)"
  MIG="$(mgmt_write apply-core-contract ",\"ref\":\"$CORE_REF\",\"repo\":$(json_escape "$REPO"),\"dryRun\":true")" || preflight_failed DRYRUN_APPLY_FAILED "$?" "$MIG" "apply dry-run failed"
  printf '%s' "$MIG" | json_field ok | grep -q true || preflight_failed DRYRUN_APPLY_FAILED 1 "$MIG" "apply dry-run failed"
  DEP="$(mgmt_write deploy-function ",\"ref\":\"$CORE_REF\",\"slug\":\"$SLUG\",\"repo\":$(json_escape "$REPO"),\"dryRun\":true")" || preflight_failed DRYRUN_DEPLOY_FAILED "$?" "$DEP" "deploy dry-run failed"
  printf '%s' "$DEP" | json_field ok | grep -q true || preflight_failed DRYRUN_DEPLOY_FAILED 1 "$DEP" "deploy dry-run failed"
  printf '  %s\n' "$(printf '%s' "$DEP" | json_field files)"
  TMP="$(mktemp "$EVIDENCE_DIR/.r3-dryrun-XXXXXX")" || abort "mktemp failed"
  printf '{"generated_at":"%s","tool":"phase3b/remote/deploy-core-contract.sh","mode":"dry-run","core_ref":"%s","preflight":"r3-preflight-%s.json","migrations":%s,"deploy":%s}\n' "$STAMP" "$CORE_REF" "$STAMP" "$(printf '%s' "$MIG" | json_field migrations)" "$(printf '%s' "$DEP" | node_json '(delete d.ok, delete d.op, d)')" > "$TMP"
  promote_evidence "$TMP" "$EVIDENCE_DIR/r3-dryrun-$STAMP.json"
  printf 'PHASE3B_CORE_CONTRACT_DRYRUN %s (0 writes)\n' "$CORE_REF"; exit 0
fi

step "HUMAN AUTHORIZATION"
printf 'Type exactly  APPLY R3 %s  to apply on Core staging (anything else stops): ' "$CORE_REF" > /dev/tty
IFS= read -r CONFIRM < /dev/tty || CONFIRM=""
[[ "$CONFIRM" == "APPLY R3 $CORE_REF" ]] || abort "PHASE3B_R3_NOT_AUTHORIZED (0 writes)"

step "2. Core contract migrations + ledger rows (one transaction each, probe-first)"
MIG="$(mgmt_write apply-core-contract ",\"ref\":\"$CORE_REF\",\"repo\":$(json_escape "$REPO")")" || stage_failed "2. migrations" "$?" "$MIG" "migrations failed (each version is one transaction: a failed one is rolled back by the server; verify with --preflight-only before any re-run)"
printf '%s' "$MIG" | json_field ok | grep -q true || stage_failed "2. migrations" 1 "$MIG" "migrations failed (each version is one transaction: a failed one is rolled back by the server; verify with --preflight-only before any re-run)"
printf '%s' "$MIG" | node_json 'd.migrations.map(m=>"  [ok] "+m.version+" "+m.decision+(m.applied?" → applied":" (no write)")+" ledger "+m.ledger_after+(m.apply_elapsed_ms==null?"":" ("+m.apply_elapsed_ms+" ms)")).join("\n")' || true; printf '\n'

step "3. service secret ($SECRET_NAME): Keychain $KC_STATE / Core $REMOTE_SECRET"
set_secret_from_var() { # CONTRACT_SECRET must be set; pipes it through the printf builtin only
  [[ "$CONTRACT_SECRET" =~ ^[0-9a-f]{64}$ ]] || abort "contract secret malformed"
  SET="$(mgmt_write set-secrets ",\"ref\":\"$CORE_REF\",\"secrets\":[{\"name\":\"$SECRET_NAME\",\"value\":\"$CONTRACT_SECRET\"}]")" || stage_failed "3. set-secrets" "$?" "$SET" "set-secrets failed"
  printf '%s' "$SET" | json_field ok | grep -q true || stage_failed "3. set-secrets" 1 "$SET" "set-secrets failed"
  AFTER="$(mgmt secret-names ",\"ref\":\"$CORE_REF\"")" || stage_failed "3. set-secrets verify" "$?" "$AFTER" "secret names read failed after set-secrets"
  printf '%s' "$AFTER" | json_field secret_names | grep -q "\"$SECRET_NAME\"" || stage_failed "3. set-secrets verify" 1 "" "set-secrets did not take effect ($SECRET_NAME not listed) — STOP"
}
SECRET_ACTION=""
case "$KC_STATE/$REMOTE_SECRET" in
  ABSENT/absent)
    CONTRACT_SECRET="$(gen_hex 32)" || stage_failed "3. secret generation" "$?" "" "secret generation failed (nothing set on Core)"; SECRETS_KNOWN+=("$CONTRACT_SECRET")
    [[ "$CONTRACT_SECRET" =~ ^[0-9a-f]{64}$ ]] || abort "secret generation failed"
    keychain_add "$KC_CORE_SERVICE" contract-secret "$CONTRACT_SECRET" || stage_failed "3. keychain add" "$?" "" "Keychain add failed (nothing set on Core; re-run: the Keychain is the source of truth)"
    KC_STATE="PRESENT"
    set_secret_from_var; SECRET_ACTION="generated+stored+set"
    ok "generated, stored in Keychain, set on Core (value never printed)";;
  PRESENT/absent)
    CONTRACT_SECRET="$(keychain_read "$KC_CORE_SERVICE" contract-secret)" || stage_failed "3. keychain read" "$?" "" "Keychain read failed (nothing set on Core)"; SECRETS_KNOWN+=("$CONTRACT_SECRET")
    set_secret_from_var; SECRET_ACTION="reconciled-from-keychain"
    ok "Keychain value set on Core (reconciled; value never printed)";;
  PRESENT/PRESENT)
    CONTRACT_SECRET="$(keychain_read "$KC_CORE_SERVICE" contract-secret)" || stage_failed "3. keychain read" "$?" "" "Keychain read failed (nothing written)"; SECRETS_KNOWN+=("$CONTRACT_SECRET")
    [[ "$CONTRACT_SECRET" =~ ^[0-9a-f]{64}$ ]] || stage_failed "3. keychain read" 1 "" "Keychain contract secret malformed"
    SECRET_ACTION="reused-pending-probe"
    ok "both present: the signed probe decides whether they agree";;
esac
REMOTE_SECRET="PRESENT"

step "4. deploy $SLUG (verify_jwt=false)"
DEP="$(mgmt_write deploy-function ",\"ref\":\"$CORE_REF\",\"slug\":\"$SLUG\",\"repo\":$(json_escape "$REPO")")" || stage_failed "4. deploy" "$?" "$DEP" "deploy failed"
printf '%s' "$DEP" | json_field ok | grep -q true || stage_failed "4. deploy" 1 "$DEP" "deploy failed"
printf '  %s\n' "$(printf '%s' "$DEP" | json_field files)"
FN_AFTER="$(mgmt function ",\"ref\":\"$CORE_REF\",\"slug\":\"$SLUG\"")" || stage_failed "4. deploy read-back" "$?" "$FN_AFTER" "function read failed after deploy"
[[ "$(printf '%s' "$FN_AFTER" | json_field present)" == "true" ]] || stage_failed "4. deploy read-back" 1 "$FN_AFTER" "function not readable after deploy — STOP"
[[ "$(printf '%s' "$FN_AFTER" | json_field fn.status)" == "ACTIVE" ]] || stage_failed "4. deploy read-back" 1 "$FN_AFTER" "function status $(printf '%s' "$FN_AFTER" | json_field fn.status) ≠ ACTIVE — STOP"
[[ "$(printf '%s' "$FN_AFTER" | json_field fn.verify_jwt)" == "false" ]] || stage_failed "4. deploy read-back" 1 "$FN_AFTER" "verify_jwt must be false — STOP"
[[ "$(printf '%s' "$FN_AFTER" | json_field fn.ezbr_sha256)" =~ ^[0-9a-f]{64}$ ]] || stage_failed "4. deploy read-back" 1 "$FN_AFTER" "ezbr_sha256 missing — STOP"
ok "deployed: version $(printf '%s' "$FN_AFTER" | json_field fn.version), ezbr $(printf '%s' "$FN_AFTER" | json_field fn.ezbr_sha256 | cut -c1-12)…, verify_jwt=false, ACTIVE"

step "5. signed harness (9 exact answers; secret from the Keychain via stdin only; retries for propagation)"
run_probe() { printf '{"ref":"%s","secret":"%s","retries":%s,"interval_ms":10000}' "$CORE_REF" "$CONTRACT_SECRET" "$1" | node "$PROBE"; }
PROBE_OUT="$(run_probe 8 || true)"
VERDICT="$(printf '%s' "$PROBE_OUT" | json_field verdict)" || VERDICT="PROBE_OUTPUT_NOT_JSON"
if [[ "$VERDICT" == "SECRET_MISMATCH" && "$SECRET_ACTION" == "reused-pending-probe" ]]; then
  printf '  Core answers 401 to a request signed with the Keychain value → reconciling from the Keychain\n'
  set_secret_from_var; SECRET_ACTION="reconciled-after-mismatch"
  PROBE_OUT="$(run_probe 8 || true)"; VERDICT="$(printf '%s' "$PROBE_OUT" | json_field verdict)" || VERDICT="PROBE_OUTPUT_NOT_JSON"
fi
unset CONTRACT_SECRET
if [[ "$VERDICT" != "SIGNED_HARNESS_PASS" ]]; then
  printf '%s' "$PROBE_OUT" | node_json '(d.checks||[]).map(c=>"  "+(c.ok?"ok  ":"FAIL")+" "+c.name+" → "+JSON.stringify(c.observed&&{status:c.observed.status,body:c.observed.body,raw:c.observed.raw})).join("\n")' 2>/dev/null || printf '%s\n' "$PROBE_OUT"
  printf '\n'; stage_failed "5. signed harness" 1 "{\"verdict\":$(json_escape "$VERDICT")}" "SIGNED_HARNESS_$VERDICT — NOT deployed (rollback-core-contract.sh reverts R3 if required)"
fi
printf '%s' "$PROBE_OUT" | node_json 'd.checks.map(c=>"  [ok] "+c.name+" → "+c.observed.status+" "+JSON.stringify(c.observed.body)).join("\n")+"\n  attempts "+d.attempts.length' || true; printf '\n'

step "6. ACL probe (anon / authenticated / service_role on every contract object)"
ACL_AFTER="$(mgmt core-contract-acl ",\"ref\":\"$CORE_REF\"")" || stage_failed "6. acl probe" "$?" "$ACL_AFTER" "acl read failed"
printf '%s' "$ACL_AFTER" | json_field ok | grep -q true || stage_failed "6. acl probe" 1 "$ACL_AFTER" "acl read failed"
ACL_FAILS="$(printf '%s' "$ACL_AFTER" | node --input-type=module -e "import { aclFailures } from '$CONTRACT'; let s=''; process.stdin.on('data',c=>s+=c).on('end',()=>process.stdout.write(JSON.stringify(aclFailures(JSON.parse(s).acl))));")" || stage_failed "6. acl evaluation" "$?" "$ACL_FAILS" "acl evaluation failed"
[[ "$ACL_FAILS" == "[]" ]] || { printf '  %s\n' "$ACL_FAILS"; stage_failed "6. acl expectations" 1 "$ACL_FAILS" "ACL expectations not met — NOT deployed (rollback-core-contract.sh reverts R3 if required)"; }
printf '%s' "$ACL_AFTER" | node_json 'd.acl.functions.map(f=>"  [ok] "+f.signature+" execute anon="+f.execute.anon+" authenticated="+f.execute.authenticated+" service_role="+f.execute.service_role+" secdef="+f.security_definer).concat(d.acl.tables.map(t=>"  [ok] "+t.name+" rls="+t.rls+" privileges anon="+t.privileges.anon+" authenticated="+t.privileges.authenticated+" service_role="+t.privileges.service_role+" indexes="+JSON.stringify(t.indexes))).join("\n")' || true; printf '\n'
LEDGER_AFTER="$(mgmt core-ledger ",\"ref\":\"$CORE_REF\"")" || stage_failed "6. ledger after" "$?" "$LEDGER_AFTER" "ledger read failed after apply"
printf '%s' "$LEDGER_AFTER" | json_field ok | grep -q true || stage_failed "6. ledger after" 1 "$LEDGER_AFTER" "ledger read failed after apply"

TMP="$(mktemp "$EVIDENCE_DIR/.core-XXXXXX")" || abort "mktemp failed"
printf '{"generated_at":"%s","tool":"phase3b/remote/deploy-core-contract.sh","core_ref":"%s","mode":"apply","authorized_by":"operator typed APPLY R3 %s on /dev/tty","preflight":"r3-preflight-%s.json","pins":%s,"migrations":%s,"ledger_strategy":%s,"ledger_rows_after":%s,"secret":{"name":"%s","keychain":"PRESENT","remote":"PRESENT","action":"%s"},"deploy":%s,"function":%s,"probe":%s,"acl":{"failures":[],"acl":%s},"custody":{"contract_secret":"keychain:%s/contract-secret + Core Edge secret %s"}}\n' \
  "$STAMP" "$CORE_REF" "$CORE_REF" "$STAMP" "$PINS" "$(printf '%s' "$MIG" | json_field migrations)" "$(printf '%s' "$MIG" | node_json 'JSON.stringify(d.ledger_strategy)')" "$(printf '%s' "$LEDGER_AFTER" | node_json '(d.rows||[]).filter(r=>["20260914120000","20260915120000"].includes(r.version))')" "$SECRET_NAME" "$SECRET_ACTION" "$(printf '%s' "$DEP" | node_json '(delete d.ok, delete d.op, d)')" "$(printf '%s' "$FN_AFTER" | json_field fn)" "$(printf '%s' "$PROBE_OUT" | node_json '(delete d.ok, d)')" "$(printf '%s' "$ACL_AFTER" | json_field acl)" "$KC_CORE_SERVICE" "$SECRET_NAME" > "$TMP"
promote_evidence "$TMP" "$EVIDENCE_DIR/core-contract-$STAMP.json"
printf 'PHASE3B_CORE_CONTRACT_DEPLOYED %s\n' "$CORE_REF"
