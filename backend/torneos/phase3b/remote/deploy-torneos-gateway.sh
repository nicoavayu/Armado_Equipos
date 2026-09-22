#!/usr/bin/env bash
# Phase 3B — Fase 4: deploy the Edge gateway to the TORNEOS NON-PRODUCTION project. Operator-run.
#
#   deploy-torneos-gateway.sh <torneos_ref> <core_anon_key> <torneos_anon_key> [allowed_origin] [--dry-run]
#
# The two anon keys are PUBLIC (browser) keys: Kong requires them as `apikey`; they are not
# secrets. allowed_origin is the future staging frontend origin (default: a placeholder that
# matches nothing; server-to-server certification sends no Origin). Steps:
#   1. RS256 key ring: generated in this shell with jose (2 keys, kid p3b-k1 active/trusted,
#      p3b-k2 standby), stored in the Keychain (arma2-torneos-nonprod-bridge / keys);
#   2. Edge secrets (all server-side): gateway config, Core URLs, contract secret (Keychain),
#      the two Torneos DB logins over the Session Pooler (Keychain) with the Supabase CA
#      (verify-full), the key ring. Never a service role, never a Core DB login;
#   3. deploy torneos-gateway (verify_jwt=false, 9 files);
#   4. register the public JWKS as third-party auth on the Torneos project (B03: hosted PostgREST
#      must trust the bridge's RS256 tokens) — outcome recorded, not assumed;
#   5. probe /health and /.well-known/jwks.json on the deployed function.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
trap 'cleanup_secrets' EXIT INT TERM HUP

REF="${1:-}"; CORE_ANON="${2:-}"; TORNEOS_ANON="${3:-}"; ORIGIN="${4:-https://torneos-staging.placeholder.invalid}"; DRY="${5:-}"
[[ "$ORIGIN" == "--dry-run" ]] && { DRY="--dry-run"; ORIGIN="https://torneos-staging.placeholder.invalid"; }
CORE_REF="hhyvmhgpapyuzjgxfnqv"
assert_ref "torneos ref" "$REF"; assert_ref "core ref" "$CORE_REF"
[[ "$REF" != "$CORE_REF" ]] || abort "Torneos and Core must be different projects"
[[ "$CORE_ANON" =~ ^(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_publishable_[A-Za-z0-9_-]+)$ ]] || abort "core anon key malformed (public anon/publishable key expected)"
[[ "$TORNEOS_ANON" =~ ^(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_publishable_[A-Za-z0-9_-]+)$ ]] || abort "torneos anon key malformed"
[[ "$ORIGIN" =~ ^https://[a-z0-9.-]+$ ]] || abort "allowed origin must be a bare https origin"
assert_not_prod "core anon" "$CORE_ANON"; assert_not_prod "torneos anon" "$TORNEOS_ANON"
require_tty; require_tools; require_psql
LAB_NM="$REPO/integration/torneos-core-contracts/node_modules"
[[ -d "$LAB_NM/jose" ]] || abort "jose missing: npm ci --prefix integration/torneos-core-contracts --ignore-scripts"
read_pat

step "1. RS256 key ring"
if keychain_check "$KC_BRIDGE_SERVICE" keys; then
  KEYS="$(NODE_PATH="$LAB_NM" node --input-type=module -e '
    import { generateKeyPair, exportJWK, exportPKCS8 } from "jose";
    const keys = [];
    for (const kid of ["p3b-k1", "p3b-k2"]) {
      const pair = await generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
      keys.push({ kid, privateKey: await exportPKCS8(pair.privateKey), publicKey: { ...await exportJWK(pair.publicKey), kid, alg: "RS256", use: "sig" } });
    }
    process.stdout.write(JSON.stringify({ keys, activeKid: "p3b-k1", trustedKids: ["p3b-k1"] }));')"
  [[ "$KEYS" == *"BEGIN PRIVATE KEY"* ]] || abort "key generation failed"
  SECRETS_KNOWN+=("$KEYS")
  [[ "$DRY" == "--dry-run" ]] || keychain_add "$KC_BRIDGE_SERVICE" keys "$KEYS" || abort "Keychain add failed (key ring)"
  ok "generated (kids p3b-k1 active, p3b-k2 standby)$([[ "$DRY" == "--dry-run" ]] && echo '; dry-run: not stored')"
else
  KEYS="$(keychain_read "$KC_BRIDGE_SERVICE" keys)" || abort "Keychain read failed"
  SECRETS_KNOWN+=("$KEYS")
  ok "reusing the Keychain key ring"
fi
JWKS="$(printf '%s' "$KEYS" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const d=JSON.parse(s);process.stdout.write(JSON.stringify({keys:d.keys.filter(k=>d.trustedKids.includes(k.kid)).map(k=>({...k.publicKey,kid:k.kid,alg:"RS256",use:"sig"}))}))})')"
[[ "$JWKS" != *'"d":'* ]] || abort "JWKS carries private material"

step "2. secrets"
POOLER="$(mgmt_write pooler ",\"ref\":\"$REF\"")"
printf '%s' "$POOLER" | json_field ok | grep -q true || abort "pooler lookup failed"
PHOST="$(printf '%s' "$POOLER" | json_field host)"; assert_not_prod "pooler" "$PHOST"
W_PASS="$(keychain_read "$KC_DB_SERVICE" torneos_edge_identity_writer)" || abort "Keychain: torneos_edge_identity_writer missing (run bootstrap-torneos.sh)"
A_PASS="$(keychain_read "$KC_DB_SERVICE" torneos_edge_core_adapter)" || abort "Keychain: torneos_edge_core_adapter missing"
CONTRACT_SECRET="$(keychain_read "$KC_CORE_SERVICE" contract-secret)" || abort "Keychain: contract-secret missing (run deploy-core-contract.sh)"
SECRETS_KNOWN+=("$W_PASS" "$A_PASS" "$CONTRACT_SECRET")
[[ "$CONTRACT_SECRET" =~ ^[0-9a-f]{64}$ ]] || abort "contract secret malformed"
CA_B64="$(base64 < "$CA_CERT" | tr -d '\n')"
KEYS_B64="$(printf '%s' "$KEYS" | base64 | tr -d '\n')"
# Every value reaches node through the printf BUILTIN → stdin (json_escape); no secret in argv.
urlenc() { printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(encodeURIComponent(s)))'; }
W_URL="postgres://torneos_edge_identity_writer.$REF:$(urlenc "$W_PASS")@$PHOST:6543/postgres"
A_URL="postgres://torneos_edge_core_adapter.$REF:$(urlenc "$A_PASS")@$PHOST:6543/postgres"
SECRETS_KNOWN+=("$W_URL" "$A_URL")
SECRETS_JSON="$(printf '[{"name":"TORNEOS_GATEWAY_PUBLIC_URL","value":"https://%s.supabase.co/functions/v1/torneos-gateway"},{"name":"TORNEOS_ALLOWED_ORIGIN","value":"%s"},{"name":"CORE_AUTH_URL","value":"https://%s.supabase.co/auth/v1"},{"name":"CORE_JWT_ISSUER","value":"https://%s.supabase.co/auth/v1"},{"name":"CORE_ANON_KEY","value":"%s"},{"name":"CORE_CONTRACT_URL","value":"https://%s.supabase.co/functions/v1/torneos-core-contract"},{"name":"TORNEOS_CONTRACT_SERVICE_SECRET","value":"%s"},{"name":"TORNEOS_REST_URL","value":"https://%s.supabase.co/rest/v1"},{"name":"TORNEOS_ANON_KEY","value":"%s"},{"name":"TORNEOS_DB_IDENTITY_WRITER_URL","value":%s},{"name":"TORNEOS_DB_CORE_ADAPTER_URL","value":%s},{"name":"TORNEOS_DB_SSL_CA","value":"%s"},{"name":"TORNEOS_BRIDGE_KEYS","value":"%s"}]' \
  "$REF" "$ORIGIN" "$CORE_REF" "$CORE_REF" "$CORE_ANON" "$CORE_REF" "$CONTRACT_SECRET" "$REF" "$TORNEOS_ANON" "$(json_escape "$W_URL")" "$(json_escape "$A_URL")" "$CA_B64" "$KEYS_B64")"
unset W_URL A_URL
unset W_PASS A_PASS CONTRACT_SECRET KEYS KEYS_B64
if [[ "$DRY" == "--dry-run" ]]; then ok "dry-run: $(printf '%s' "$SECRETS_JSON" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).map(x=>x.name).join(", ")))')"; else
  SET="$(printf '{"op":"set-secrets","pat":"%s","ref":"%s","secrets":%s}' "$PAT" "$REF" "$SECRETS_JSON" | node "$MGMT_WRITE")"
  printf '%s' "$SET" | json_field ok | grep -q true || { printf '%s\n' "$SET" >&2; abort "set-secrets failed"; }
  ok "set: $(printf '%s' "$SET" | json_field wrote)"
fi
unset SECRETS_JSON

step "3. deploy torneos-gateway"
DEP="$(mgmt_write deploy-function ",\"ref\":\"$REF\",\"slug\":\"torneos-gateway\",\"repo\":$(json_escape "$REPO")$([[ "$DRY" == "--dry-run" ]] && printf ',"dryRun":true')")"
printf '%s' "$DEP" | json_field ok | grep -q true || { printf '%s\n' "$DEP" >&2; abort "deploy failed"; }
printf '  %s\n' "$(printf '%s' "$DEP" | json_field files)"

step "4. third-party auth (B03): register the bridge JWKS on the Torneos project"
if [[ "$DRY" == "--dry-run" ]]; then ok "dry-run: would POST custom_jwks"; TPA='{"dryRun":true}'; else
  TPA="$(printf '{"op":"third-party-auth","pat":"%s","ref":"%s","jwks":%s}' "$PAT" "$REF" "$JWKS" | node "$MGMT_WRITE")" || true
  printf '  %s\n' "$TPA"
  printf '%s' "$TPA" | json_field ok | grep -q true && ok "registered" || printf '  !! third-party auth NOT registered (recorded; B03 stays open)\n'
fi

step "5. probes"
HEALTH="000"; JW="000"
if [[ "$DRY" != "--dry-run" ]]; then
  HEALTH="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "https://$REF.supabase.co/functions/v1/torneos-gateway/health" || echo 000)"
  JW="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "https://$REF.supabase.co/functions/v1/torneos-gateway/.well-known/jwks.json" || echo 000)"
  ok "health → $HEALTH, jwks → $JW"
fi
TMP="$(mktemp "$EVIDENCE_DIR/.gw-XXXXXX")"
printf '{"generated_at":"%s","tool":"phase3b/remote/deploy-torneos-gateway.sh","torneos_ref":"%s","core_ref":"%s","mode":"%s","allowed_origin":"%s","pooler_host":"%s","deploy":%s,"third_party_auth":%s,"probes":{"health":"%s","jwks":"%s"},"jwks_public":%s,"custody":{"key_ring":"keychain:%s/keys","db_logins":"keychain:%s","contract_secret":"keychain:%s/contract-secret"}}\n' \
  "$STAMP" "$REF" "$CORE_REF" "${DRY:-apply}" "$ORIGIN" "$PHOST" "$(printf '%s' "$DEP" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const d=JSON.parse(s);delete d.ok;process.stdout.write(JSON.stringify(d))})')" "$TPA" "$HEALTH" "$JW" "$JWKS" "$KC_BRIDGE_SERVICE" "$KC_DB_SERVICE" "$KC_CORE_SERVICE" > "$TMP"
promote_evidence "$TMP" "$EVIDENCE_DIR/gateway-deploy-$STAMP.json"
printf 'PHASE3B_GATEWAY_%s %s\n' "$([[ "$DRY" == "--dry-run" ]] && echo DRYRUN || echo DEPLOYED)" "$REF"
