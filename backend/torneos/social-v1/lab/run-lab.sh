#!/bin/bash
# SOCIAL-V1 — disposable local lab for migration 0008. Never touches Staging, Production or another lab: own Postgres
# (supabase/postgres 17.6.1.143) on an internal docker network, no published port, random password, removed on exit.
#
#   0000…0007 (= Production POST_0007) + fixtures
#   → RED: authorize closed for authenticated; with a lab-only GRANT the F1 NULL cases are AUTHORIZED (the bug)
#   → 0008 → GREEN: the full matrix (FREE / PREMIUM / NULL / unknown / cross org / cross season / roles / no identity)
#   → re-apply 0008 = no-op (same catalog) → a tampered ACL makes 0008 abort (fail closed, nothing applied)
#   → rollback → catalog byte-identical to POST_0007 (and to the audit evidence) → rollback re-run = no-op
#   → 0008 again → GREEN smoke.
# Evidence goes to ../evidence/. Exit 0 only if every observation equals its expectation; prints SOCIAL_V1_LAB_PASS.
set -euo pipefail
export PATH=$PATH:/Applications/Docker.app/Contents/Resources/bin
HERE=$(cd "$(dirname "$0")" && pwd); SOCIAL=$(cd "$HERE/.." && pwd); TORNEOS=$(cd "$HERE/../.." && pwd)
EVID="$SOCIAL/evidence"; MIG="$TORNEOS/supabase/migrations"
M8="$MIG/00000000000008_social_v1_export_authorization.sql"
RB8="$SOCIAL/rollback/00000000000008_social_v1_export_authorization.rollback.sql"
TAG="social-v1-lab-$$"; LAB_DB="arma2-$TAG-db"; NET="arma2-$TAG-net"
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
psql_apply "$TORNEOS/season-scope-fix/lab/fixture.sql"; psql_apply "$HERE/fixture.sql"; echo "applied fixtures"
mkdir -p "$EVID"

CATALOG_SQL="select p.oid::regprocedure, md5(p.prosrc), p.prosecdef, p.provolatile, p.proconfig, pg_get_userbyid(p.proowner),
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role,
  exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like '%social%' order by 1;"
COUNTS_SQL="select 'authenticated='||count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ||' anon='||count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE'))
from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f';"
# Whole public-function ACL fingerprint: proves nothing outside the Social catalog moves.
ACL_SQL="select md5(string_agg(p.oid::regprocedure::text||'|'||coalesce(p.proacl::text,'')||'|'||md5(p.prosrc), ',' order by p.oid::regprocedure::text))
from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private');"
catalog() { echo "$CATALOG_SQL" | sql; }
counts() { echo "$COUNTS_SQL" | sql; }
fingerprint() { echo "$ACL_SQL" | sql; }

U=11111111-1111-4111-8111-111111111111; UC=a1111111-1111-4111-8111-111111111111   # owner A, B
V=22222222-2222-4222-8222-222222222222; VC=a2222222-2222-4222-8222-222222222222   # owner C, not a member of A
W=33333333-3333-4333-8333-333333333333; WC=a3333333-3333-4333-8333-333333333333   # collaborator of A (season A1)
X=44444444-4444-4444-8444-444444444444; XC=a4444444-4444-4444-8444-444444444444   # admin of A (season A2 only)
OA=aaaaaaaa-0000-4000-8000-00000000000a; OB=bbbbbbbb-0000-4000-8000-00000000000b; OC=cccccccc-0000-4000-8000-00000000000c
TA=7a7a7a7a-0000-4000-8000-0000000000a1    # Copa A,  season A1, FREE
TA2=7a7a7a7a-0000-4000-8000-0000000000a2   # Copa A2, season A2, PREMIUM
TB=7b7b7b7b-0000-4000-8000-0000000000b1    # Copa B,  org B, FREE
TC=7c7c7c7c-0000-4000-8000-0000000000c1    # Copa C,  org C
NOPE=99999999-9999-4999-8999-999999999999  # no such tournament / season
PASS=0; FAIL=0
run() { # name expect sub core call ; expect = OK:<substring>[&&<substring>…] | ERR:<substring>
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
  local kind=${expect%%:*} needles=${expect#*:} ok=1 needle
  [ "${got%%:*}" = "$kind" ] || ok=0
  IFS='&' read -ra parts <<< "${needles//&&/&}"
  for needle in "${parts[@]}"; do [[ "$got" == *"$needle"* ]] || ok=0; done
  if [ $ok = 1 ]; then PASS=$((PASS + 1)); r=PASS; else FAIL=$((FAIL + 1)); r=FAIL; fi
  printf '%-4s %-62s expect=%-58s | %s\n' "$r" "$name" "$expect" "$got"
}
check() { # name expected actual
  if [ "$2" = "$3" ]; then PASS=$((PASS + 1)); printf 'PASS %-62s %s\n' "$1" "$3"
  else FAIL=$((FAIL + 1)); printf 'FAIL %-62s expected=%s got=%s\n' "$1" "$2" "$3"; fi
}
A="public.authorize_tournament_social_export"
BR='"includeArma2Branding": true'; WL='"includeArma2Branding": false'
green_matrix() {
  echo "## access (the access check runs before any input validation)"
  run "G1 bearer absent: no identity claims"                        "ERR:TORNEOS_SOCIAL_EXPORT_FORBIDDEN"   none none "$A('$OA','$TA','round_results','base',true)"
  run "G2 unknown identity (no torneos_identity row)"               "ERR:TORNEOS_SOCIAL_EXPORT_FORBIDDEN"   $NOPE $NOPE "$A('$OA','$TA','round_results','base',true)"
  run "G3 identity without membership"                              "ERR:TORNEOS_SOCIAL_EXPORT_FORBIDDEN"   $V $VC "$A('$OA','$TA','round_results','base',true)"
  run "G4 identity without access + NULL theme (no oracle)"         "ERR:TORNEOS_SOCIAL_EXPORT_FORBIDDEN"   $V $VC "$A('$OA','$TA','round_results',null,true)"
  run "G5 collaborator without export grant"                        "ERR:TORNEOS_SOCIAL_EXPORT_FORBIDDEN"   $W $WC "$A('$OA','$TA','round_results','base',true)"
  run "G6 cross org: tournament A sent under org B"                 "ERR:TORNEOS_SOCIAL_EXPORT_FORBIDDEN"   $U $UC "$A('$OB','$TA','round_results','base',true)"
  run "G7 cross org: owner A on org C tournament"                   "ERR:TORNEOS_SOCIAL_EXPORT_FORBIDDEN"   $U $UC "$A('$OC','$TC','round_results','base',true)"
  run "G8 cross season: admin of season A2 on Copa A (A1)"          "ERR:TORNEOS_SOCIAL_EXPORT_FORBIDDEN"   $X $XC "$A('$OA','$TA','round_results','base',true)"
  run "G9 nonexistent tournament (no season)"                       "ERR:TORNEOS_SOCIAL_EXPORT_FORBIDDEN"   $U $UC "$A('$OA','$NOPE','round_results','base',true)"
  run "G10 NULL organization"                                       "ERR:TORNEOS_SOCIAL_EXPORT_FORBIDDEN"   $U $UC "$A(null,'$TA','round_results','base',true)"
  run "G11 NULL tournament"                                         "ERR:TORNEOS_SOCIAL_EXPORT_FORBIDDEN"   $U $UC "$A('$OA',null,'round_results','base',true)"
  echo "## NULL / unknown inputs (F1 fixed: never authorized, never coerced)"
  run "N1 FREE theme NULL"                                          "ERR:TORNEOS_SOCIAL_THEME_UNKNOWN"      $U $UC "$A('$OA','$TA','round_results',null,true)"
  run "N2 FREE piece NULL"                                          "ERR:TORNEOS_SOCIAL_PIECE_UNKNOWN"      $U $UC "$A('$OA','$TA',null,'base',true)"
  run "N3 FREE piece NULL theme NULL branding NULL"                 "ERR:TORNEOS_SOCIAL_THEME_UNKNOWN"      $U $UC "$A('$OA','$TA',null,null,null)"
  run "N4 FREE branding NULL"                                       "ERR:TORNEOS_SOCIAL_BRANDING_INVALID"   $U $UC "$A('$OA','$TA','round_results','base',null)"
  run "N5 PREMIUM theme NULL"                                       "ERR:TORNEOS_SOCIAL_THEME_UNKNOWN"      $U $UC "$A('$OA','$TA2','mvp',null,false)"
  run "N6 PREMIUM piece NULL"                                       "ERR:TORNEOS_SOCIAL_PIECE_UNKNOWN"      $U $UC "$A('$OA','$TA2',null,'heritage',false)"
  run "N7 PREMIUM branding NULL"                                    "ERR:TORNEOS_SOCIAL_BRANDING_INVALID"   $U $UC "$A('$OA','$TA2','mvp','base',null)"
  run "N8 unknown theme"                                            "ERR:TORNEOS_SOCIAL_THEME_UNKNOWN"      $U $UC "$A('$OA','$TA','round_results','neon',true)"
  run "N9 theme with a different case (no coercion)"                "ERR:TORNEOS_SOCIAL_THEME_UNKNOWN"      $U $UC "$A('$OA','$TA','round_results','BASE',true)"
  run "N10 theme with padding (no coercion)"                        "ERR:TORNEOS_SOCIAL_THEME_UNKNOWN"      $U $UC "$A('$OA','$TA','round_results',' base',true)"
  run "N11 unknown piece"                                           "ERR:TORNEOS_SOCIAL_PIECE_UNKNOWN"      $U $UC "$A('$OA','$TA','poster','base',true)"
  run "N12 empty piece"                                             "ERR:TORNEOS_SOCIAL_PIECE_UNKNOWN"      $U $UC "$A('$OA','$TA','','base',true)"
  echo "## FREE (season A1): Base + 3 pieces + Arma2 signature, nothing else"
  run "F1 FREE round_results/base/signed"                          "OK:\"plan\": \"FREE\"&&$BR&&\"authorized\": true" $U $UC "$A('$OA','$TA','round_results','base',true)"
  run "F2 FREE standings/base/signed"                              "OK:\"plan\": \"FREE\"&&$BR"            $U $UC "$A('$OA','$TA','standings','base',true)"
  run "F3 FREE next_fixture/base/signed"                           "OK:\"plan\": \"FREE\"&&$BR"            $U $UC "$A('$OA','$TA','next_fixture','base',true)"
  for piece in mvp final champion scorers discipline best_eleven round_summary semifinals; do
    run "F5 FREE $piece/base (premium piece)"                      "ERR:TORNEOS_SOCIAL_PREMIUM_REQUIRED"   $U $UC "$A('$OA','$TA','$piece','base',true)"
  done
  for theme in heritage street scoreboard editorial; do
    run "F6 FREE round_results/$theme (premium theme)"             "ERR:TORNEOS_SOCIAL_PREMIUM_REQUIRED"   $U $UC "$A('$OA','$TA','round_results','$theme',true)"
  done
  run "F7 FREE Base removing the Arma2 signature"                  "ERR:TORNEOS_BRANDING_PREMIUM_REQUIRED" $U $UC "$A('$OA','$TA','round_results','base',false)"
  run "F8 FREE org B (other FREE org of the same owner)"            "OK:\"plan\": \"FREE\"&&$BR"            $U $UC "$A('$OB','$TB','next_fixture','base',true)"
  echo "## PREMIUM (season A2): 11 pieces × 5 styles, Base signature optional, Premium styles always white-label"
  for piece in round_results next_fixture standings mvp final champion scorers discipline best_eleven round_summary semifinals; do
    run "P1 PREMIUM $piece/base signed"                            "OK:\"plan\": \"PREMIUM\"&&$BR"         $U $UC "$A('$OA','$TA2','$piece','base',true)"
  done
  run "P2 PREMIUM Base branding OFF"                               "OK:\"plan\": \"PREMIUM\"&&$WL"         $U $UC "$A('$OA','$TA2','standings','base',false)"
  for theme in heritage street scoreboard editorial; do
    run "P3 PREMIUM $theme asked WITH Arma2 → white-label"         "OK:\"theme\": \"$theme\"&&$WL"         $U $UC "$A('$OA','$TA2','mvp','$theme',true)"
    run "P4 PREMIUM $theme without Arma2 → white-label"            "OK:\"theme\": \"$theme\"&&$WL"         $U $UC "$A('$OA','$TA2','champion','$theme',false)"
  done
  run "P5 PREMIUM unknown theme"                                   "ERR:TORNEOS_SOCIAL_THEME_UNKNOWN"      $U $UC "$A('$OA','$TA2','mvp','neon',false)"
  run "P7 PREMIUM admin of the season, Scoreboard"                "OK:\"plan\": \"PREMIUM\"&&$WL"         $X $XC "$A('$OA','$TA2','discipline','scoreboard',true)"
  run "P6 PREMIUM season does not leak to FREE season A1"          "ERR:TORNEOS_SOCIAL_PREMIUM_REQUIRED"   $U $UC "$A('$OA','$TA','mvp','heritage',false)"
  echo "## read RPCs (unchanged by 0008)"
  run "R1 owner studio context"                                    "OK:\"social.export\"&&\"freeBaseFamilies\"" $U $UC "public.get_tournament_social_studio_context('$OA')"
  run "R2 season-scoped admin sees its season A2 tournament"        "OK:Copa A2\""                          $X $XC "public.get_tournament_social_studio_context('$OA')"
  run "R3 identity without membership studio context"              "ERR:TORNEOS_SOCIAL_FORBIDDEN"          $V $VC "public.get_tournament_social_studio_context('$OA')"
  run "R4 no identity studio context"                              "ERR:TORNEOS_SOCIAL_FORBIDDEN"          none none "public.get_tournament_social_studio_context('$OA')"
  run "R5 snapshot without a published fixture"                    "ERR:TORNEOS_SOCIAL_SCOPE_UNAVAILABLE"  $U $UC "public.get_tournament_social_snapshot('$OA','$TA','$TA','$TA','standings',null,null)"
  run "R6 snapshot cross org"                                      "ERR:TORNEOS_SOCIAL_FORBIDDEN"          $U $UC "public.get_tournament_social_snapshot('$OB','$TA','$TA','$TA','standings',null,null)"
  run "R7 snapshot cross season (admin A2 on Copa A)"              "ERR:TORNEOS_SOCIAL_FORBIDDEN"          $X $XC "public.get_tournament_social_snapshot('$OA','$TA','$TA','$TA','standings',null,null)"
  run "R8 snapshot identity without membership"                    "ERR:TORNEOS_SOCIAL_FORBIDDEN"          $V $VC "public.get_tournament_social_snapshot('$OA','$TA','$TA','$TA','standings',null,null)"
}
# R2 must not list Copa A (season A1): checked separately (substring absence).
season_scope_check() {
  local now claims out
  now=$(date +%s)
  claims=$(printf '{"role":"authenticated","iss":"urn:arma2:local:identity-bridge","aud":"arma2-torneos-local","sub":"%s","core_user_id":"%s","session_id":"s","jti":"j","iat":%s,"nbf":%s,"exp":%s}' "$X" "$XC" "$now" "$now" $((now + 120)))
  out=$(sql <<EOF
begin; set local role authenticated; select set_config('request.jwt.claims','$claims',true);
select public.get_tournament_social_studio_context('$OA')::text; rollback;
EOF
)
  if [[ "$out" == *'"name": "Copa A"'* ]]; then check "R2b season-scoped admin does not see Copa A (A1)" absent present; else check "R2b season-scoped admin does not see Copa A (A1)" absent absent; fi
}

grant_w() {
# Grant the collaborator W export in org A (owner U, through the very RPC the UI does NOT expose), committed.
local now; now=$(date +%s)
sql > /dev/null <<EOF
begin; set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","iss":"urn:arma2:local:identity-bridge","aud":"arma2-torneos-local","sub":"$U","core_user_id":"$UC","session_id":"s","jti":"j","iat":$now,"nbf":$now,"exp":$((now + 120))}',true);
select public.set_tournament_social_permission('$OA','$W',true);
commit;
EOF
}

PRE_CATALOG=$(catalog); PRE_COUNTS=$(counts); PRE_FP=$(fingerprint)
{
  echo "## POST_0007 baseline"
  check "catalog = audit evidence catalog-post0007.txt" "$(cat "$EVID/catalog-post0007.txt")" "$PRE_CATALOG"
  check "ACL counts POST_0007" "authenticated=171 anon=12" "$PRE_COUNTS"
  echo "## RED — authorize closed for authenticated (as in Production)"
  run "RED0 owner FREE round_results/base, ACL closed"             "ERR:permission denied for function"    $U $UC "$A('$OA','$TA','round_results','base',true)"
} > "$EVID/sql-cases-0008.txt"
# Lab-only GRANT on a throwaway copy of the transaction to reproduce F1 without leaving state behind.
red_f1() {
  local now claims out
  now=$(date +%s)
  claims=$(printf '{"role":"authenticated","iss":"urn:arma2:local:identity-bridge","aud":"arma2-torneos-local","sub":"%s","core_user_id":"%s","session_id":"s","jti":"j","iat":%s,"nbf":%s,"exp":%s}' "$U" "$UC" "$now" "$now" $((now + 120)))
  out=$(sql <<EOF
begin;
grant execute on function $A(uuid,uuid,text,text,boolean) to authenticated;
set local role authenticated; select set_config('request.jwt.claims','$claims',true);
select coalesce($A('$OA','$TA','round_results',null,true)::text,'NULL');
rollback;
EOF
)
  if [[ "$out" == *'"authorized": true'* && "$out" == *"$WL"* ]]; then check "RED-F1 FREE theme NULL is authorized white-label before 0008" bug-reproduced bug-reproduced
  else check "RED-F1 FREE theme NULL is authorized white-label before 0008" bug-reproduced "$out"; fi
}
red_f1 >> "$EVID/sql-cases-0008.txt"
check "RED leaves no state behind" "$PRE_FP" "$(fingerprint)" >> "$EVID/sql-cases-0008.txt"

psql_apply "$M8"; echo "applied 0008"
POST_CATALOG=$(catalog); POST_COUNTS=$(counts); POST_FP=$(fingerprint)
echo "$POST_CATALOG" > "$EVID/catalog-post0008.txt"
diff <(echo "$PRE_CATALOG") <(echo "$POST_CATALOG") > "$EVID/catalog-diff-0007-0008.txt" || true
{
  echo "## after 0008"
  check "ACL counts POST_0008" "authenticated=172 anon=12" "$POST_COUNTS"
  check "catalog diff = only the authorize row (md5 + authenticated)" \
    "1c1
< authorize_tournament_social_export(uuid,uuid,text,text,boolean)|f211d9a26d99448d4069c499c7508c55|t|s|{\"search_path=\\\"\\\"\"}|supabase_admin|f|f|t|f
---
> authorize_tournament_social_export(uuid,uuid,text,text,boolean)|85bb485891d9a2c046798f9eaa0cb649|t|s|{\"search_path=\\\"\\\"\"}|supabase_admin|f|t|t|f" \
    "$(cat "$EVID/catalog-diff-0007-0008.txt")"
  green_matrix
  season_scope_check
  grant_w
  echo "## collaborator W with an explicit export grant (season A1 only)"
  run "C1 granted collaborator FREE round_results/base/signed"     "OK:\"plan\": \"FREE\"&&$BR"            $W $WC "$A('$OA','$TA','round_results','base',true)"
  run "C2 granted collaborator cross season (Copa A2)"             "ERR:TORNEOS_SOCIAL_EXPORT_FORBIDDEN"   $W $WC "$A('$OA','$TA2','round_results','base',true)"
  run "C3 granted collaborator FREE premium theme"                 "ERR:TORNEOS_SOCIAL_PREMIUM_REQUIRED"   $W $WC "$A('$OA','$TA','round_results','street',true)"
} >> "$EVID/sql-cases-0008.txt"
AFTER_GRANT_FP=$(fingerprint)

{
  echo "## re-apply 0008 = no-op"
  psql_apply "$M8"
  check "catalog after re-apply" "$POST_CATALOG" "$(catalog)"
  check "public/private fingerprint after re-apply" "$AFTER_GRANT_FP" "$(fingerprint)"
  echo "## tampered state: 0008 aborts and changes nothing"
  echo "grant execute on function $A(uuid,uuid,text,text,boolean) to anon;" | sql
  TAMPERED_FP=$(fingerprint)
  out=$(docker exec -i "$LAB_DB" psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 < "$M8" 2>&1 || true)
  if [[ "$out" == *TORNEOS_SOCIAL_V1_PRECONDITION_FAILED* ]]; then check "0008 refuses anon EXECUTE on authorize" refused refused; else check "0008 refuses anon EXECUTE on authorize" refused "$out"; fi
  check "nothing applied by the refused run" "$TAMPERED_FP" "$(fingerprint)"
  echo "revoke execute on function $A(uuid,uuid,text,text,boolean) from anon;" | sql
  check "tamper reverted" "$AFTER_GRANT_FP" "$(fingerprint)"
} >> "$EVID/sql-cases-0008.txt"

{
  echo "## rollback"
  psql_apply "$RB8"
  check "catalog after rollback = POST_0007" "$PRE_CATALOG" "$(catalog)"
  check "ACL counts after rollback" "authenticated=171 anon=12" "$(counts)"
  run "RB1 authorize closed again"                                  "ERR:permission denied for function"    $U $UC "$A('$OA','$TA','round_results','base',true)"
  psql_apply "$RB8"
  check "rollback re-run = no-op" "$PRE_CATALOG" "$(catalog)"
  echo "## 0008 again after the rollback"
  psql_apply "$M8"
  check "catalog after re-forward = POST_0008" "$POST_CATALOG" "$(catalog)"
  run "RF1 FREE theme NULL refused"                                 "ERR:TORNEOS_SOCIAL_THEME_UNKNOWN"      $U $UC "$A('$OA','$TA','round_results',null,true)"
  run "RF2 PREMIUM editorial white-label"                           "OK:$WL"                                $U $UC "$A('$OA','$TA2','standings','editorial',true)"
  echo "TOTAL PASS=$PASS FAIL=$FAIL"
} >> "$EVID/sql-cases-0008.txt"
cat "$EVID/sql-cases-0008.txt"
grep -q '^FAIL' "$EVID/sql-cases-0008.txt" && { echo "SOCIAL_V1_LAB_FAILED"; exit 1; }
echo "SOCIAL_V1_LAB_PASS"
