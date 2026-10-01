#!/bin/bash
# SEASON-SCOPE-FIX: runs each RPC case as role `authenticated` with bridge-shaped claims (as PostgREST would) and
# prints a one-line outcome: OK plan=… or ERR <sqlstate> <message> or NULL (HTTP 200 body null).
export PATH=$PATH:/Applications/Docker.app/Contents/Resources/bin
U=11111111-1111-4111-8111-111111111111; UC=a1111111-1111-4111-8111-111111111111
V=22222222-2222-4222-8222-222222222222; VC=a2222222-2222-4222-8222-222222222222
W=33333333-3333-4333-8333-333333333333; WC=a3333333-3333-4333-8333-333333333333
OA=aaaaaaaa-0000-4000-8000-00000000000a; OB=bbbbbbbb-0000-4000-8000-00000000000b; OC=cccccccc-0000-4000-8000-00000000000c
SA=5a5a5a5a-0000-4000-8000-0000000000a1; SA2=5a5a5a5a-0000-4000-8000-0000000000a2; SB=5b5b5b5b-0000-4000-8000-0000000000b1; SC=5c5c5c5c-0000-4000-8000-0000000000c1
TA=7a7a7a7a-0000-4000-8000-0000000000a1
RND=deadbeef-0000-4000-8000-000000000000
PASS=0; FAIL=0
run() { # name expect(OK|DENY|AUTH) sub core call
  local name=$1 expect=$2 sub=$3 core=$4 call=$5 claims
  if [ "$sub" = none ]; then claims='{"role":"authenticated"}'; else
  claims=$(printf '{"role":"authenticated","iss":"urn:arma2:local:identity-bridge","aud":"arma2-torneos-local","sub":"%s","core_user_id":"%s","session_id":"s","jti":"j","iat":%s,"nbf":%s,"exp":%s}' $sub $core $(date +%s) $(date +%s) $(( $(date +%s)+120 ))); fi
  local out
  out=$(docker exec -i ${LAB_DB:?} psql -U supabase_admin -d postgres -X -A -t -q -v ON_ERROR_STOP=1 2>&1 <<EOF
begin;
set local role authenticated;
select set_config('request.jwt.claims','$claims',true);
select coalesce((r->>'plan')||' src='||(r->>'assignmentSource')||' season='||(r#>>'{scope,seasonId}')||' gal='||(r#>>'{limits,galleryAssetLimit}')||' adm='||(r#>>'{limits,administrativeCollaboratorLimit}')||' usage='||(r#>>'{administration,currentAdministrativeSeatUsage}')||' social='||(r#>>'{social,baseFamilyLimit}')||' caps='||md5((r->'capabilities')::text),'NULL') from (select $call as r) x;
rollback;
EOF
)
  if echo "$out" | grep -q 'ERROR:'; then out=$(echo "$out" | grep 'ERROR:' | head -1); else out=$(echo "$out" | grep -v '^$' | tail -1); fi
  local got
  case "$out" in
    NULL) got=NULL;; FREE*|PREMIUM*) got=OK;;
    *TORNEOS_AUTH_REQUIRED*) got=AUTH;; *TORNEOS_ENTITLEMENTS_FORBIDDEN*) got=DENY;; *) got="?";;
  esac
  if [ "$got" = "$expect" ]; then PASS=$((PASS+1)); r=PASS; else FAIL=$((FAIL+1)); r=FAIL; fi
  printf '%-4s %-46s expect=%-4s got=%-4s | %s\n' $r "$name" $expect $got "$(echo $out | sed 's/^psql:<stdin>:[0-9]*: //')"
}
S="public.get_effective_tournament_season_entitlements"; T="public.get_effective_tournament_entitlements"
run "P1 owner orgA+seasonA"                    OK   $U $UC "$S('$OA','$SA')"
run "P2 owner orgA+seasonA2 (2nd season)"      OK   $U $UC "$S('$OA','$SA2')"
run "P3 owner orgB+seasonB"                    OK   $U $UC "$S('$OB','$SB')"
run "P4 collaborator orgA+assigned seasonA"    OK   $W $WC "$S('$OA','$SA')"
run "P5 tournament RPC orgA+tournamentA"       OK   $U $UC "$T('$OA','$TA')"
run "N1 owner orgA+seasonB (cross)"            DENY $U $UC "$S('$OA','$SB')"
run "N2 owner orgB+seasonA (cross)"            DENY $U $UC "$S('$OB','$SA')"
run "N3 owner orgA+season inexistente"         DENY $U $UC "$S('$OA','$RND')"
run "N4 org inexistente+seasonA"               DENY $U $UC "$S('$RND','$SA')"
run "N5 owner orgA+season NULL"                DENY $U $UC "$S('$OA',null)"
run "N6 org NULL+seasonA"                      DENY $U $UC "$S(null,'$SA')"
run "N7 owner orgA+seasonC (foreign org)"      DENY $U $UC "$S('$OA','$SC')"
run "N8 non-member orgC+seasonC by U"          DENY $U $UC "$S('$OC','$SC')"
run "N9 user without membership orgA+seasonA"  DENY $V $VC "$S('$OA','$SA')"
run "N10 collaborator orgA+unassigned seasonA2" DENY $W $WC "$S('$OA','$SA2')"
run "N11 collaborator orgA+seasonB (cross)"    DENY $W $WC "$S('$OA','$SB')"
run "N12 no identity claims"                   AUTH none none "$S('$OA','$SA')"
run "N13 tournament RPC orgB+tournamentA"      DENY $U $UC "$T('$OB','$TA')"
run "N14 tournament RPC orgA+tournament NULL"  DENY $U $UC "$T('$OA',null)"
echo "TOTAL PASS=$PASS FAIL=$FAIL"
