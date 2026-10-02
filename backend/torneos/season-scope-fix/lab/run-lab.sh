#!/bin/bash
# SEASON-SCOPE-FIX — disposable local lab. Never touches Staging, Production or another lab:
#   own Postgres (supabase/postgres 17.6.1.143) + own PostgREST v14.15 on a private docker network, the REST port
#   published on 127.0.0.1 only; random secrets in a mktemp dir; everything is removed on exit.
# Sequence: 0000…0006 → fixture → RED (SQL + HTTP) → 0007 → GREEN → 0007 again (no-op) → rollback → RED again →
#           0007 → GREEN. Evidence goes to ../evidence/. Exit 0 only if every expectation holds.
set -euo pipefail
export PATH=$PATH:/Applications/Docker.app/Contents/Resources/bin
HERE=$(cd "$(dirname "$0")" && pwd); TORNEOS=$(cd "$HERE/../.." && pwd); EVID="$HERE/../evidence"
MIG="$TORNEOS/supabase/migrations"; FIX="$MIG/00000000000007_season_entitlements_scope.sql"
ROLLBACK="$TORNEOS/season-scope-fix/rollback/00000000000007_season_entitlements_scope.rollback.sql"
TAG="season-scope-$$"; export LAB_DB="arma2-$TAG-db"; REST="arma2-$TAG-rest"; NET="arma2-$TAG-net"
SECRETS=$(mktemp -d); chmod 700 "$SECRETS"
cleanup() { docker rm -f "$REST" "$LAB_DB" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; rm -rf "$SECRETS"; }
trap cleanup EXIT
openssl rand -hex 32 > "$SECRETS/jwt.secret"; openssl rand -hex 16 > "$SECRETS/auth.pw"
psql_apply() { docker exec -i "$LAB_DB" psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 < "$1" > /dev/null; }
body_md5() { docker exec "$LAB_DB" psql -U supabase_admin -d postgres -X -A -t -c \
  "select md5(prosrc) from pg_proc where oid='public.get_effective_tournament_season_entitlements(uuid,uuid)'::regprocedure"; }
catalog() { docker exec "$LAB_DB" psql -U supabase_admin -d postgres -X -A -t -c \
  "select p.oid::regprocedure, md5(p.prosrc), p.prosecdef, p.provolatile, p.proconfig, pg_get_userbyid(p.proowner), p.proacl
   from pg_proc p where p.proname in ('get_effective_tournament_season_entitlements','get_effective_tournament_entitlements',
   'has_tournament_season_access','resolve_effective_tournament_season_entitlements_at') order by 1"; }

docker network create "$NET" > /dev/null
docker run -d --name "$LAB_DB" --network "$NET" -e POSTGRES_PASSWORD="$(openssl rand -hex 16)" \
  public.ecr.aws/supabase/postgres:17.6.1.143 postgres -D /etc/postgresql > /dev/null
for _ in $(seq 1 90); do docker exec "$LAB_DB" pg_isready -U postgres -q 2>/dev/null && break; sleep 2; done
sleep 5  # the image restarts once after its init scripts
for _ in $(seq 1 30); do docker exec "$LAB_DB" psql -U supabase_admin -d postgres -X -q -c 'select 1' >/dev/null 2>&1 && break; sleep 2; done
for f in "$MIG"/0000000000000[0-6]_*.sql; do psql_apply "$f"; echo "applied $(basename "$f")"; done
psql_apply "$HERE/fixture.sql"
docker exec "$LAB_DB" psql -U supabase_admin -d postgres -X -q -c "alter role authenticator password '$(cat "$SECRETS/auth.pw")'"
docker run -d --name "$REST" --network "$NET" -p 127.0.0.1::3000 \
  -e PGRST_DB_URI="postgres://authenticator:$(cat "$SECRETS/auth.pw")@$LAB_DB:5432/postgres" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$(cat "$SECRETS/jwt.secret")" -e PGRST_JWT_AUD=arma2-torneos-local \
  -e PGRST_DB_PRE_REQUEST=private.check_token -e PGRST_LOG_LEVEL=error public.ecr.aws/supabase/postgrest:v14.15 > /dev/null
BASE="http://$(docker port "$REST" 3000 | head -1)"
for _ in $(seq 1 30); do curl -s -o /dev/null "$BASE/" && break; sleep 1; done

expect_total() { grep -q "^TOTAL PASS=$2 FAIL=$3\$" "$1" || { echo "UNEXPECTED $(basename "$1"): $(tail -1 "$1")"; exit 1; }; }
mkdir -p "$EVID"
catalog > "$EVID/catalog-post0006.txt"
[ "$(body_md5)" = a533331a821dbbac90c6eedbc7b053b3 ] || { echo "POST_0006 body is not the certified one"; exit 1; }
"$HERE/sql-cases.sh" > "$EVID/sql-red-post0006.txt"; expect_total "$EVID/sql-red-post0006.txt" 14 5
python3 "$HERE/rest-cases.py" "$SECRETS" "$BASE" > "$EVID/http-red-post0006.txt"; expect_total "$EVID/http-red-post0006.txt" 7 3
psql_apply "$FIX"; echo "applied $(basename "$FIX")"
"$HERE/sql-cases.sh" > "$EVID/sql-green-post0007.txt"; expect_total "$EVID/sql-green-post0007.txt" 19 0
python3 "$HERE/rest-cases.py" "$SECRETS" "$BASE" > "$EVID/http-green-post0007.txt"; expect_total "$EVID/http-green-post0007.txt" 10 0
catalog > "$EVID/catalog-post0007.txt"
psql_apply "$FIX"; [ "$(body_md5)" = bf263acafb185ee0993117d5805bc701 ] || { echo "re-apply 0007 FAILED"; exit 1; }; echo "re-apply 0007: no-op OK"
psql_apply "$ROLLBACK"; [ "$(body_md5)" = a533331a821dbbac90c6eedbc7b053b3 ] || { echo "rollback FAILED"; exit 1; }; echo "rollback: certified body restored"
"$HERE/sql-cases.sh" > "$EVID/sql-red-after-rollback.txt"; expect_total "$EVID/sql-red-after-rollback.txt" 14 5
diff <(catalog) "$EVID/catalog-post0006.txt" > /dev/null || { echo "rollback catalog differs"; exit 1; }; echo "rollback: catalog identical to POST_0006"
psql_apply "$FIX"; "$HERE/sql-cases.sh" > "$EVID/sql-green-reforward.txt"; expect_total "$EVID/sql-green-reforward.txt" 19 0
# Only the season RPC changes between POST_0006 and POST_0007 (same attributes, owner and ACL).
diff "$EVID/catalog-post0006.txt" "$EVID/catalog-post0007.txt" > "$EVID/catalog-diff.txt" || true
[ "$(grep -c '^[<>]' "$EVID/catalog-diff.txt")" = 2 ] && grep -q '^> get_effective_tournament_season_entitlements(uuid,uuid)|bf263aca' "$EVID/catalog-diff.txt" \
  || { echo "catalog changed beyond the season RPC body"; exit 1; }
echo "catalog: only the season RPC body changed"
echo "SEASON_SCOPE_FIX_LAB_PASS"
