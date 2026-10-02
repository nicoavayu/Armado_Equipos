#!/bin/bash
# SOCIAL-V1 audit — disposable local lab. Never touches Staging, Production or another lab:
#   own Postgres (supabase/postgres 17.6.1.143) on a private docker network, no published port, random password,
#   everything removed on exit. Sequence: 0000…0007 (= Production POST_0007) → season-scope fixture →
#   ACL/body catalog of the Social RPCs → authorize_tournament_social_export as `authenticated` (closed, as in Prod) →
#   lab-only GRANT (what SOCIAL-V1 0008 would do) → FREE / role / NULL cases → read RPCs.
# Evidence goes to ../evidence/. Exit 0 only if every observation equals the expectation written here; the NULL
# cases are expected to be AUTHORIZED today (finding F1), so this script turns red the day 0008 fixes them.
set -euo pipefail
export PATH=$PATH:/Applications/Docker.app/Contents/Resources/bin
HERE=$(cd "$(dirname "$0")" && pwd); TORNEOS=$(cd "$HERE/../.." && pwd); EVID="$HERE/../evidence"
MIG="$TORNEOS/supabase/migrations"; FIXTURE="$TORNEOS/season-scope-fix/lab/fixture.sql"
TAG="social-v1-audit-$$"; LAB_DB="arma2-$TAG-db"; NET="arma2-$TAG-net"
cleanup() { docker rm -f "$LAB_DB" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT
psql_apply() { docker exec -i "$LAB_DB" psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 < "$1" > /dev/null; }
sql() { docker exec -i "$LAB_DB" psql -U supabase_admin -d postgres -X -A -t -q -v ON_ERROR_STOP=1; }

docker network create --internal "$NET" > /dev/null
docker run -d --name "$LAB_DB" --network "$NET" -e POSTGRES_PASSWORD="$(openssl rand -hex 16)" \
  public.ecr.aws/supabase/postgres:17.6.1.143 postgres -D /etc/postgresql > /dev/null
for _ in $(seq 1 90); do docker exec "$LAB_DB" pg_isready -U postgres -q 2>/dev/null && break; sleep 2; done
sleep 5  # the image restarts once after its init scripts
for _ in $(seq 1 30); do docker exec "$LAB_DB" psql -U supabase_admin -d postgres -X -q -c 'select 1' >/dev/null 2>&1 && break; sleep 2; done
for f in "$MIG"/0000000000000[0-7]_*.sql; do psql_apply "$f"; echo "applied $(basename "$f")"; done
psql_apply "$FIXTURE"; echo "applied season-scope fixture"

mkdir -p "$EVID"
# ── Catalog: the 4 client RPCs + their helpers (ACL, owner, definer, search_path, body md5) ──────────────
sql > "$EVID/catalog-post0007.txt" <<'EOF'
select p.oid::regprocedure, md5(p.prosrc), p.prosecdef, p.provolatile, p.proconfig, pg_get_userbyid(p.proowner),
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role,
  exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like '%social%' order by 1;
EOF
sql > "$EVID/acl-counts-post0007.txt" <<'EOF'
select 'authenticated='||count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ||' anon='||count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE'))
from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f';
EOF
cat "$EVID/acl-counts-post0007.txt"

U=11111111-1111-4111-8111-111111111111; UC=a1111111-1111-4111-8111-111111111111   # owner A
V=22222222-2222-4222-8222-222222222222; VC=a2222222-2222-4222-8222-222222222222   # not a member of A
W=33333333-3333-4333-8333-333333333333; WC=a3333333-3333-4333-8333-333333333333   # collaborator of A (social.read)
OA=aaaaaaaa-0000-4000-8000-00000000000a; OB=bbbbbbbb-0000-4000-8000-00000000000b
TA=7a7a7a7a-0000-4000-8000-0000000000a1   # Copa A, season A, FREE (default_free), no published fixture
PASS=0; FAIL=0
run() { # name expect sub core call ; expect = OK:<substring> | ERR:<substring>
  local name=$1 expect=$2 sub=$3 core=$4 call=$5 claims now out got
  now=$(date +%s)
  if [ "$sub" = none ]; then claims='{"role":"authenticated"}'; else
    claims=$(printf '{"role":"authenticated","iss":"urn:arma2:local:identity-bridge","aud":"arma2-torneos-local","sub":"%s","core_user_id":"%s","session_id":"s","jti":"j","iat":%s,"nbf":%s,"exp":%s}' "$sub" "$core" "$now" "$now" $((now + 120))); fi
  out=$(sql 2>&1 <<EOF || true
begin;
set local role authenticated;
select set_config('request.jwt.claims','$claims',true);
select coalesce(($call)::text,'NULL');
rollback;
EOF
)
  if echo "$out" | grep -q 'ERROR:'; then got="ERR:$(echo "$out" | grep 'ERROR:' | head -1 | sed 's/^.*ERROR:  //')"
  else got="OK:$(echo "$out" | grep -v '^$' | tail -1)"; fi
  local kind=${expect%%:*} needle=${expect#*:}
  if [ "${got%%:*}" = "$kind" ] && [[ "$got" == *"$needle"* ]]; then PASS=$((PASS + 1)); r=PASS; else FAIL=$((FAIL + 1)); r=FAIL; fi
  printf '%-4s %-58s expect=%-40s | %s\n' "$r" "$name" "$expect" "$got"
}
A="public.authorize_tournament_social_export"
{
  echo "## authorize_tournament_social_export — ACL as in Production POST_0007 (closed)"
  run "A0 owner FREE round_results/base, ACL closed"            "ERR:permission denied for function"       $U $UC "$A('$OA','$TA','round_results','base',true)"
} > "$EVID/sql-cases-post0007.txt"
echo "grant execute on function $A(uuid,uuid,text,text,boolean) to authenticated;" | sql
{
  echo "## after the lab-only GRANT (what 0008 would add)"
  run "A1 owner FREE round_results/base/branding"                "OK:\"includeArma2Branding\": true"         $U $UC "$A('$OA','$TA','round_results','base',true)"
  run "A2 owner FREE standings/base/branding"                    "OK:\"plan\": \"FREE\""                     $U $UC "$A('$OA','$TA','standings','base',true)"
  run "A3 owner FREE next_fixture/base/branding"                 "OK:\"authorized\": true"                   $U $UC "$A('$OA','$TA','next_fixture','base',true)"
  run "A4 owner FREE mvp/base (premium piece)"                   "ERR:TORNEOS_SOCIAL_PREMIUM_REQUIRED"       $U $UC "$A('$OA','$TA','mvp','base',true)"
  run "A5 owner FREE round_results/heritage (premium theme)"     "ERR:TORNEOS_SOCIAL_PREMIUM_REQUIRED"       $U $UC "$A('$OA','$TA','round_results','heritage',false)"
  run "A6 owner FREE round_results/base without Arma2"           "ERR:TORNEOS_BRANDING_PREMIUM_REQUIRED"     $U $UC "$A('$OA','$TA','round_results','base',false)"
  run "A7 owner unknown theme"                                   "ERR:TORNEOS_SOCIAL_THEME_UNKNOWN"          $U $UC "$A('$OA','$TA','round_results','neon',true)"
  run "A8 owner unknown piece"                                   "ERR:TORNEOS_SOCIAL_PIECE_UNKNOWN"          $U $UC "$A('$OA','$TA','poster','base',true)"
  run "A9 collaborator without grant (social.read only)"         "ERR:TORNEOS_SOCIAL_EXPORT_FORBIDDEN"       $W $WC "$A('$OA','$TA','round_results','base',true)"
  run "A10 user without membership"                              "ERR:TORNEOS_SOCIAL_EXPORT_FORBIDDEN"       $V $VC "$A('$OA','$TA','round_results','base',true)"
  run "A11 owner, tournament A under org B"                      "ERR:TORNEOS_SOCIAL_EXPORT_FORBIDDEN"       $U $UC "$A('$OB','$TA','round_results','base',true)"
  run "A12 no identity claims"                                   "ERR:TORNEOS_SOCIAL_EXPORT_FORBIDDEN"       none none "$A('$OA','$TA','round_results','base',true)"
  echo "## FINDING F1 — NULL piece/theme are AUTHORIZED today (expected to turn red once 0008 lands)"
  run "F1a owner FREE piece=round_results theme=NULL"            "OK:\"includeArma2Branding\": false"        $U $UC "$A('$OA','$TA','round_results',null,true)"
  run "F1b owner FREE piece=NULL theme=base"                     "OK:\"authorized\": true"                   $U $UC "$A('$OA','$TA',null,'base',true)"
  run "F1c owner FREE piece=NULL theme=NULL branding=NULL"       "OK:\"includeArma2Branding\": false"        $U $UC "$A('$OA','$TA',null,null,null)"
  run "F1d owner FREE round_results/base branding=NULL"          "OK:\"includeArma2Branding\": true"         $U $UC "$A('$OA','$TA','round_results','base',null)"
  echo "## read RPCs (already EXECUTE for authenticated since the baseline)"
  run "R1 owner studio context"                                  "OK:\"social.manage_permissions\""          $U $UC "public.get_tournament_social_studio_context('$OA')"
  run "R2 collaborator studio context (read only)"               "OK:\"canHideArma2Logo\": false"            $W $WC "public.get_tournament_social_studio_context('$OA')"
  run "R3 user without membership studio context"                "ERR:TORNEOS_SOCIAL_FORBIDDEN"              $V $VC "public.get_tournament_social_studio_context('$OA')"
  run "R4 owner snapshot without a published fixture"            "ERR:TORNEOS_SOCIAL_SCOPE_UNAVAILABLE"      $U $UC "public.get_tournament_social_snapshot('$OA','$TA','$TA','$TA','standings',null,null)"
  run "R5 owner snapshot piece=NULL"                             "ERR:TORNEOS_SOCIAL_PIECE_INVALID"          $U $UC "public.get_tournament_social_snapshot('$OA','$TA','$TA','$TA',null,null,null)"
  run "R6 user without membership snapshot"                      "ERR:TORNEOS_SOCIAL_FORBIDDEN"              $V $VC "public.get_tournament_social_snapshot('$OA','$TA','$TA','$TA','standings',null,null)"
  run "R7 collaborator cannot grant Social export"               "ERR:TORNEOS_SOCIAL_FORBIDDEN"              $W $WC "public.set_tournament_social_permission('$OA','$W',true)"
  run "R8 owner cannot grant export to a non-member"             "ERR:TORNEOS_SOCIAL_GRANT_INVALID"          $U $UC "public.set_tournament_social_permission('$OA','$V',true)"
  echo "TOTAL PASS=$PASS FAIL=$FAIL"
} >> "$EVID/sql-cases-post0007.txt"
cat "$EVID/sql-cases-post0007.txt"
[ "$FAIL" = 0 ] || { echo "SOCIAL_V1_AUDIT_LAB_UNEXPECTED"; exit 1; }
echo "SOCIAL_V1_AUDIT_LAB_PASS"
