#!/usr/bin/env bash
# Phase 3B — Fase 2 (b): bootstrap the TORNEOS NON-PRODUCTION database. Operator-run.
#
#   bootstrap-torneos.sh <torneos_ref> [--verify-only]
#
# Installs, ONCE, ENTIRE and ATOMIC (the file is its own BEGIN…COMMIT), the certified Phase 2D
# baseline (sha256 f857bd09…) and then the staging v1 RPC exposure gate (00000000000001),
# exactly as the local lab does — no replay of the 48 historical migrations. Then creates the
# two LOGIN roles the Edge gateway uses (NOINHERIT members of the baseline's NOLOGIN roles),
# sets PostgREST's pre-request hook (private.check_token) on `authenticator`, and verifies the
# catalog against the Phase 2C/2D numbers. Transport: psql over the Session Pooler,
# user postgres.<ref>, sslmode=verify-full with the Supabase CA, PGPASSWORD from the Keychain
# (arma2-torneos-nonprod-db / postgres). A second run refuses before any change (the baseline's
# own guard requires an empty public schema; this script refuses earlier when torneos_identity
# exists). On any failure: STOP; never repair by hand; see ROLLBACK.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
trap 'cleanup_secrets' EXIT INT TERM HUP

REF="${1:-}"; MODE="${2:-}"
assert_ref "torneos ref" "$REF"
require_tty; require_tools; require_psql
BASELINE="$REPO/backend/torneos/supabase/migrations/00000000000000_torneos_baseline_v1.sql"
GATE="$REPO/backend/torneos/supabase/migrations/00000000000001_staging_v1_rpc_exposure.sql"
GATE_JSON="$REPO/backend/torneos/phase2d/staging-v1-rpc-gate.json"
CERTIFIED_BASELINE="f857bd0939054bc1a32a3855894b7b20e14a0c7456c9d5c8c5e8432e5b8ed19f"
CERTIFIED_GATE="3df4b96eecc7321eaeda84a480f089fe4bff2b28c20aa4479db92caf33457e62"
# Shared verification contract V2 (Phase 3B R2, contracts/README.md): the local isolated runner
# certifies the same query and the same expectations. The rendered SQL (placeholder → the 33 gated
# names) is pinned; v2 differs from the inline v1 text ONLY in the lazy cron_jobs/storage_buckets
# probes (v1 failed to parse where cron.job/storage.buckets were absent). Expect pinned as a file.
VERIFY_TEMPLATE="$REPO/backend/torneos/phase3b/contracts/torneos-bootstrap-verify.sql"
EXPECT_JSON="$REPO/backend/torneos/phase3b/contracts/torneos-bootstrap-expect.json"
CERTIFIED_VERIFY_SQL="0d6ef458d0d46375d8332c6a85e014597a7d30f0d4891d1b62e12df88c9c844c"
CERTIFIED_EXPECT="2c0772c2bda3433e60a44c00b62a8ef79de976c205a7a88379c9e44dfdb81118"

step "source integrity"
[[ "$(shasum -a 256 "$BASELINE" | cut -d' ' -f1)" == "$CERTIFIED_BASELINE" ]] || abort "baseline differs from the certified Phase 2D candidate"
[[ "$(shasum -a 256 "$GATE" | cut -d' ' -f1)" == "$CERTIFIED_GATE" ]] || abort "gate differs from the certified Phase 2D file"
ok "baseline $CERTIFIED_BASELINE"; ok "gate $CERTIFIED_GATE"
GATED_NAMES="$(node -e 'const g=require(process.argv[1]);const n=[...new Set(g.functions.map(f=>f.name))];if(n.length!==33||n.some(x=>!/^[a-z_]+$/.test(x)))process.exit(2);console.log(n.map(x=>"'"'"'"+x+"'"'"'").join(","))' "$GATE_JSON")" || abort "gate manifest unexpected"
[[ "$(shasum -a 256 "$EXPECT_JSON" | cut -d' ' -f1)" == "$CERTIFIED_EXPECT" ]] || abort "bootstrap expect document differs from the certified one"
VERIFY_SQL="$(cat "$VERIFY_TEMPLATE")"; VERIFY_SQL="${VERIFY_SQL//__GATED_NAMES__/$GATED_NAMES}"
[[ "$(printf '%s' "$VERIFY_SQL" | shasum -a 256 | cut -d' ' -f1)" == "$CERTIFIED_VERIFY_SQL" ]] || abort "rendered verification SQL differs from the certified text"
ok "verify sql $CERTIFIED_VERIFY_SQL (rendered)"; ok "expect $CERTIFIED_EXPECT"

step "target ($REF) — pooler host from the control plane"
read_pat
POOLER="$(mgmt_write pooler ",\"ref\":\"$REF\"")"
printf '%s' "$POOLER" | json_field ok | grep -q true || { printf '%s\n' "$POOLER" >&2; abort "pooler lookup failed"; }
PGHOST_VALUE="$(printf '%s' "$POOLER" | json_field host)"
[[ "$PGHOST_VALUE" =~ ^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$ ]] || abort "unexpected pooler host"
assert_not_prod "pooler host" "$PGHOST_VALUE"
ok "pooler $PGHOST_VALUE:5432 (session mode)"

step "credentials (Keychain → PGPASSWORD; never argv)"
PGPASSWORD="$(keychain_read "$KC_DB_SERVICE" postgres)" || abort "no db password in the Keychain ($KC_DB_SERVICE/postgres)"
[[ -n "$PGPASSWORD" ]] || abort "empty db password"
SECRETS_KNOWN+=("$PGPASSWORD")
export PGHOST="$PGHOST_VALUE" PGPORT=5432 PGUSER="postgres.$REF" PGDATABASE=postgres PGSSLMODE=verify-full PGSSLROOTCERT="$CA_CERT" PGCONNECT_TIMEOUT=20 PGPASSWORD
psql_q() { "$PSQL_BIN" -X --no-psqlrc -v ON_ERROR_STOP=1 -A -t -q "$@"; }

step "preflight (read-only)"
PRE="$(printf '%s' "select json_build_object('installer', current_user, 'server_version', current_setting('server_version'), 'public_relations', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','m','S')), 'pgcrypto_available', (select count(*) from pg_available_extensions where name='pgcrypto'), 'torneos_roles', (select count(*) from pg_roles where rolname like 'torneos%'), 'identity_table', to_regclass('public.torneos_identity') is not null, 'db_host_ref', current_database())" | psql_q)"
printf '  %s\n' "$PRE"
INSTALLED="$(printf '%s' "$PRE" | json_field identity_table)"
if [[ "$MODE" == "--verify-only" ]]; then
  [[ "$INSTALLED" == "true" ]] || abort "nothing installed to verify"
else
  [[ "$INSTALLED" == "false" ]] || abort "torneos_identity already exists: bootstrap is single-shot (use --verify-only)"
  [[ "$(printf '%s' "$PRE" | json_field public_relations)" == "0" ]] || abort "public schema is not empty — STOP (never install over remains)"
  [[ "$(printf '%s' "$PRE" | json_field pgcrypto_available)" == "1" ]] || abort "pgcrypto unavailable"
  [[ "$(printf '%s' "$PRE" | json_field torneos_roles)" == "0" ]] || abort "torneos roles already exist — STOP"

  step "install baseline (one atomic transaction, $(wc -c < "$BASELINE" | tr -d ' ') bytes)"
  psql_q -f "$BASELINE" > /dev/null || abort "baseline install failed — transaction rolled back by PostgreSQL; STOP and inspect"
  ok "baseline installed"
  step "install staging v1 RPC exposure gate"
  psql_q -f "$GATE" > /dev/null || abort "gate install failed — baseline is installed, gate is not: STOP (ROLLBACK: keep gateway closed)"
  ok "gate installed"

  step "server logins for the Edge gateway (NOINHERIT members; passwords → Keychain)"
  W_PASS="$(gen_secret 40)"; A_PASS="$(gen_secret 40)"; SECRETS_KNOWN+=("$W_PASS" "$A_PASS")
  keychain_check "$KC_DB_SERVICE" torneos_edge_identity_writer && keychain_add "$KC_DB_SERVICE" torneos_edge_identity_writer "$W_PASS" || abort "Keychain already has torneos_edge_identity_writer"
  keychain_check "$KC_DB_SERVICE" torneos_edge_core_adapter && keychain_add "$KC_DB_SERVICE" torneos_edge_core_adapter "$A_PASS" || abort "Keychain already has torneos_edge_core_adapter"
  printf '%s' "begin; create role torneos_edge_identity_writer login noinherit password '$W_PASS'; create role torneos_edge_core_adapter login noinherit password '$A_PASS'; grant torneos_identity_writer to torneos_edge_identity_writer; grant torneos_core_adapter to torneos_edge_core_adapter; alter role authenticator set pgrst.db_pre_request = 'private.check_token'; commit; notify pgrst, 'reload config'; notify pgrst, 'reload schema';" | psql_q > /dev/null || abort "role/pre-request setup failed"
  unset W_PASS A_PASS
  ok "torneos_edge_identity_writer, torneos_edge_core_adapter created; pgrst.db_pre_request set"
fi

step "verification (read-only catalog against Phase 2C/2D)"
VER="$(printf '%s' "$VERIFY_SQL" | psql_q)" || abort "verification query failed"
printf '  %s\n' "$VER"
expect() { local got; got="$(printf '%s' "$VER" | json_field "$1")"; [[ "$got" == "$2" ]] || abort "verification: $1 = $got (expected $2)"; ok "$1 = $got"; }
EXPECT_COUNT=0
while IFS=$'\t' read -r k v; do expect "$k" "$v"; EXPECT_COUNT=$((EXPECT_COUNT + 1)); done < <(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const [k,v] of Object.entries(d))process.stdout.write(k+"\t"+(typeof v==="object"?JSON.stringify(v):String(v))+"\n")' "$EXPECT_JSON")
[[ "$EXPECT_COUNT" == 16 ]] || abort "verification: $EXPECT_COUNT expectations evaluated (expected 16)"

TMP="$(mktemp "$EVIDENCE_DIR/.bootstrap-XXXXXX")"
printf '{"generated_at":"%s","tool":"phase3b/remote/bootstrap-torneos.sh","ref":"%s","mode":"%s","baseline_sha256":"%s","gate_sha256":"%s","verify_sql_sha256":"%s","expect_sha256":"%s","pooler_host":"%s","preflight":%s,"verification":%s,"custody":{"db_password":"keychain:%s/postgres","edge_logins":"keychain:%s/torneos_edge_identity_writer, torneos_edge_core_adapter"}}\n' \
  "$STAMP" "$REF" "${MODE:-install}" "$CERTIFIED_BASELINE" "$CERTIFIED_GATE" "$CERTIFIED_VERIFY_SQL" "$CERTIFIED_EXPECT" "$PGHOST_VALUE" "$PRE" "$VER" "$KC_DB_SERVICE" "$KC_DB_SERVICE" > "$TMP"
promote_evidence "$TMP" "$EVIDENCE_DIR/bootstrap-$STAMP.json"
printf 'PHASE3B_TORNEOS_BOOTSTRAP_VERIFIED %s\n' "$REF"
