#!/usr/bin/env bash
# Phase 3B — Fase 2 (a) = R2: create the TORNEOS NON-PRODUCTION Supabase project. Operator-run.
#
#   create-torneos-project.sh --plan-only <organization_slug> [region=us-east-1] [name=arma2-torneos-isolated-staging]
#   create-torneos-project.sh             <organization_slug> [region=us-east-1] [name=arma2-torneos-isolated-staging]
#
# Both modes run the same READ-ONLY preflight first (mgmt.mjs: GET only):
#   • the organization is resolved by slug/id and its PLAN is read (Free: 2 active projects max,
#     creation impossible while 2 are active; Pro/Team: one more Micro ≈ USD 10/month, billed
#     hourly at USD 0.01344/h, outside the spend cap; Nano cannot be launched on paid plans);
#   • every project of the PAT is listed: Production (rcyuuoaqfwcembdajcss) must be present and is
#     denylisted; active projects are counted; a project with the SAME NAME refuses the run
#     (the Core staging is literally `arma2-torneos-staging`);
#   • name/org/region and the expected cost are printed; the preflight is written as evidence
#     (`r2-preflight-<UTC>.json`, never `project-create-*`, so summarize.py cannot mistake it
#     for a created project).
# `--plan-only` STOPS there (exit 0, nothing created). Without it the runner still stops for
# HUMAN authorization: only the exact phrase `CREATE <name>` typed on /dev/tty continues.
#
# Creation (only after that phrase): POST /v1/projects with a db password generated in this
# shell (40 URL-safe chars), stored in the macOS Keychain (service arma2-torneos-nonprod-db,
# account postgres; pty-based add, never argv); waits until ACTIVE_HEALTHY; writes sanitized
# evidence `project-create-<UTC>.json`. The name MUST mark non-production (mgmt-write refuses
# otherwise). Nothing here can address Production.
#
# PAT: personal access tokens are not scoped — a PAT carries the whole account's privileges.
# The MINIMUM that can create a project is a PAT of an account holding the Administrator (or
# Owner) role in the organization (Developer/Read-only cannot create projects). Generate it with
# a short expiry for this run and revoke it afterwards.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
trap 'cleanup_secrets' EXIT INT TERM HUP

PLAN_ONLY=0
if [[ "${1:-}" == "--plan-only" ]]; then PLAN_ONLY=1; shift; fi
ORG="${1:-}"; REGION="${2:-us-east-1}"; NAME="${3:-arma2-torneos-isolated-staging}"
[[ "$ORG" =~ ^[a-z0-9][a-z0-9-]{1,63}$ ]] || abort "usage: create-torneos-project.sh [--plan-only] <organization_slug> [region] [name]"
[[ "$ORG" != *"$PROD_REF"* ]] || abort "organization argument carries the Production ref — refused"
[[ "$NAME" =~ ^arma2-torneos(-[a-z0-9]+)*-(staging|nonprod|preprod)(-[a-z0-9]+)*$ ]] || abort "name must mark non-production (label staging|nonprod|preprod)"
case "-$NAME-" in *-prod-*|*-production-*|*-live-*|*-main-*) abort "name carries a production label — refused";; esac
[[ "$REGION" == "us-east-1" ]] || abort "region must be us-east-1 (the Core staging region; change the runner deliberately, not by argument)"
require_tty; require_tools
step "custody preflight"
if keychain_check "$KC_DB_SERVICE" postgres; then ok "Keychain has no db password for $KC_DB_SERVICE/postgres yet"; else abort "Keychain already holds $KC_DB_SERVICE/postgres — a project was created before; use bootstrap-torneos.sh"; fi
read_pat

step "preflight (read-only): organization, plan, projects"
ORGS="$(mgmt orgs)"
printf '%s' "$ORGS" | json_field ok | grep -q true || { printf '%s\n' "$ORGS" >&2; abort "orgs read failed"; }
ORG_ROW="$(printf '%s' "$ORGS" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const d=JSON.parse(s);const want=process.argv[1];const o=(d.organizations||[]).find(o=>o.slug===want||o.id===want);process.stdout.write(o?JSON.stringify(o):"")})' "$ORG")"
[[ -n "$ORG_ROW" ]] || abort "organization $ORG is not visible to this PAT — STOP"
ORG_SLUG="$(printf '%s' "$ORG_ROW" | json_field slug)"; ORG_NAME="$(printf '%s' "$ORG_ROW" | json_field name)"
[[ "$ORG_SLUG" =~ ^[a-z0-9][a-z0-9-]{1,63}$ ]] || abort "organization slug malformed"
ORG_INFO="$(mgmt org ",\"slug\":\"$ORG_SLUG\"")"
printf '%s' "$ORG_INFO" | json_field ok | grep -q true || { printf '%s\n' "$ORG_INFO" >&2; abort "organization plan read failed"; }
PLAN="$(printf '%s' "$ORG_INFO" | json_field organization.plan)"
[[ "$PLAN" =~ ^(free|pro|team|enterprise|platform)$ ]] || abort "organization plan unreadable: '$PLAN' — STOP"
ok "organization $ORG_SLUG ($ORG_NAME), plan=$PLAN"

PROJECTS="$(mgmt projects)"
printf '%s' "$PROJECTS" | json_field ok | grep -q true || { printf '%s\n' "$PROJECTS" >&2; abort "projects read failed"; }
printf '%s' "$PROJECTS" | json_field production_present | grep -q true || abort "Production ($PROD_REF) is NOT visible to this PAT — the denylist cannot be confirmed against the control plane; STOP"
SUMMARY="$(printf '%s' "$PROJECTS" | node -e '
  let s=""; process.stdin.on("data",c=>s+=c).on("end",()=>{
    const d=JSON.parse(s); const org=process.argv[1]; const name=process.argv[2]; const prod=process.argv[3];
    const rows=(d.projects||[]).filter(p=>p.organization_slug===org||p.organization_id===org);
    const active=rows.filter(p=>p.status==="ACTIVE_HEALTHY"||p.status==="ACTIVE_UNHEALTHY"||p.status==="COMING_UP"||p.status==="RESTORING"||p.status==="UPGRADING"||p.status==="RESIZING"||p.status==="RESTARTING");
    process.stdout.write(JSON.stringify({
      projects_in_org: rows.map(p=>({id:p.id,name:p.name,region:p.region,status:p.status,classification:p.classification})),
      active_in_org: active.length,
      existing_names: rows.map(p=>p.name),
      name_taken: rows.some(p=>p.name===name),
      production_in_org: rows.some(p=>p.id===prod),
      production_denylisted: true }));
  });' "$ORG_SLUG" "$NAME" "$PROD_REF")"
ACTIVE="$(printf '%s' "$SUMMARY" | json_field active_in_org)"
printf '%s' "$SUMMARY" | json_field name_taken | grep -q true && abort "a project named '$NAME' already exists in $ORG_SLUG — refused (pick a distinct non-production name)"
EXISTING_NAMES="$(printf '%s' "$SUMMARY" | json_field existing_names)"
ok "projects in org: $(printf '%s' "$SUMMARY" | json_field projects_in_org | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(String(JSON.parse(s).length)))'), active=$ACTIVE, Production present and denylisted"

# Expected cost/plan — figures from supabase.com/pricing and docs/guides/platform/compute-and-disk
# (read 2026-09-15). The plan decides; the runner never changes the plan or the spend cap.
case "$PLAN" in
  free)
    COST="USD 0 (Free plan) — BUT the Free plan allows 2 active projects; $ACTIVE are active now"
    if [[ "$ACTIVE" -ge 2 ]]; then CREATABLE=0; COST="$COST → creation will be REFUSED by the platform; upgrading the organization is a billing decision outside this runner"; else CREATABLE=1; fi ;;
  pro|team|enterprise|platform)
    CREATABLE=1
    COST="one more Micro compute instance ≈ USD 10/month (USD 0.01344/h, billed hourly while the project exists; outside the spend cap; the plan's USD 10 compute credit is already consumed by an existing project). 8 GB disk / 3000 IOPS included; no add-ons. Nano cannot be launched on a paid plan: the smallest size (desired_instance_size omitted) is Micro. Deleting the project stops the charge." ;;
esac

step "R2 plan (nothing created yet)"
printf '  name              : %s\n' "$NAME"
printf '  organization      : %s (%s)\n' "$ORG_SLUG" "$ORG_NAME"
printf '  region            : %s (same as Core staging hhyvmhgpapyuzjgxfnqv)\n' "$REGION"
printf '  plan              : %s\n' "$PLAN"
printf '  active projects   : %s\n' "$ACTIVE"
printf '  expected cost     : %s\n' "$COST"
printf '  Production        : %s present in the control plane; denylisted in host/path/body/token by mgmt.mjs + mgmt-write.mjs + lib.sh (never a target)\n' "$PROD_REF"
printf '  PAT requirement   : account with Administrator (or Owner) role in %s; PATs are unscoped (whole-account privileges) → short expiry, revoke after R2\n' "$ORG_SLUG"
printf '  request           : POST /v1/projects {organization_slug, name, region_selection:{type:specific,code:%s}, db_pass} (no desired_instance_size)\n' "$REGION"
printf '  custody           : db password → Keychain %s/postgres (never printed)\n' "$KC_DB_SERVICE"

TMP="$(mktemp "$EVIDENCE_DIR/.r2-preflight-XXXXXX")"
printf '{"generated_at":"%s","tool":"phase3b/remote/create-torneos-project.sh","mode":"%s","read_only":true,"created":false,"plan":{"name":"%s","organization":%s,"plan":"%s","region":"%s","summary":%s,"expected_cost":%s,"creatable_under_plan":%s,"pat_requirement":"unscoped PAT of an Administrator/Owner of the organization; short expiry; revoke after R2","request_shape":{"organization_slug":"%s","name":"%s","region_selection":{"type":"specific","code":"%s"},"desired_instance_size":"omitted (smallest possible)"}}}\n' \
  "$STAMP" "$([[ $PLAN_ONLY -eq 1 ]] && printf 'plan-only' || printf 'create')" "$NAME" "$ORG_ROW" "$PLAN" "$REGION" "$SUMMARY" "$(json_escape "$COST")" "$([[ $CREATABLE -eq 1 ]] && printf 'true' || printf 'false')" "$ORG_SLUG" "$NAME" "$REGION" > "$TMP"
promote_evidence "$TMP" "$EVIDENCE_DIR/r2-preflight-$STAMP.json"

if [[ $PLAN_ONLY -eq 1 ]]; then
  printf 'PHASE3B_R2_PLAN_ONLY_STOP (nothing created; authorize with: create-torneos-project.sh %s)\n' "$ORG_SLUG"
  exit 0
fi
[[ $CREATABLE -eq 1 ]] || abort "PHASE3B_R2_NOT_CREATABLE_UNDER_PLAN ($PLAN, $ACTIVE active)"

step "HUMAN AUTHORIZATION"
printf 'Type exactly  CREATE %s  to create the project (anything else stops): ' "$NAME" > /dev/tty
IFS= read -r CONFIRM < /dev/tty
[[ "$CONFIRM" == "CREATE $NAME" ]] || abort "PHASE3B_R2_NOT_AUTHORIZED (nothing created)"

step "create project ($NAME, $REGION)"
DB_PASS="$(gen_secret 40)"; SECRETS_KNOWN+=("$DB_PASS")
OUT="$(mgmt_write create-project ",\"organization_slug\":\"$ORG_SLUG\",\"name\":\"$NAME\",\"region\":\"$REGION\",\"db_pass\":\"$DB_PASS\",\"existing_names\":$EXISTING_NAMES")"
printf '%s' "$OUT" | json_field ok | grep -q true || { printf '%s\n' "$OUT" >&2; abort "create-project failed"; }
REF="$(printf '%s' "$OUT" | json_field project.id)"
assert_ref "new project ref" "$REF"
ok "created $REF"

step "custody: db password → Keychain ($KC_DB_SERVICE / postgres)"
keychain_add "$KC_DB_SERVICE" postgres "$DB_PASS" || abort "Keychain add failed — the password is only in this shell; re-run add manually before it is lost"
unset DB_PASS
ok "stored (value never printed)"

step "wait for ACTIVE_HEALTHY"
STATUS=""
for i in $(seq 1 60); do
  STATUS="$(mgmt project ",\"ref\":\"$REF\"" | json_field project.status)"
  [[ "$STATUS" == "ACTIVE_HEALTHY" ]] && break
  printf '  … %s (%s)\n' "$STATUS" "$i"; sleep 10
done
[[ "$STATUS" == "ACTIVE_HEALTHY" ]] || abort "project not healthy after 10 minutes: $STATUS"
ok "ACTIVE_HEALTHY"

TMP="$(mktemp "$EVIDENCE_DIR/.create-XXXXXX")"
printf '{"generated_at":"%s","tool":"phase3b/remote/create-torneos-project.sh","authorized_by":"operator typed CREATE %s on /dev/tty","preflight":"r2-preflight-%s.json","plan":"%s","project":%s,"custody":{"db_password":"keychain:%s/postgres"}}\n' "$STAMP" "$NAME" "$STAMP" "$PLAN" "$(printf '%s' "$OUT" | json_field project)" "$KC_DB_SERVICE" > "$TMP"
promote_evidence "$TMP" "$EVIDENCE_DIR/project-create-$STAMP.json"
printf 'PHASE3B_TORNEOS_PROJECT_CREATED %s\n' "$REF"
