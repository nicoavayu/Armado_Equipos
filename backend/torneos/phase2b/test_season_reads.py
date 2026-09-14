"""Real RPC tests against the fixed local baseline; every request rolls back."""
import json
import pathlib
import sys
import time
import uuid
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'tools'))
from lab import BASE, sql

results = []
def check(name, actual):
    results.append({'name': name, 'pass': bool(actual)})
    print(('PASS ' if actual else 'FAIL ') + name)


def request(actor, query, role='authenticated', override=None):
    now = int(time.time())
    claims = {'sub': actor['user_id'], 'core_user_id': actor['core_user_id'],
              'role': 'authenticated', 'iss': 'urn:arma2:local:identity-bridge',
              'aud': 'arma2-torneos-local', 'session_id': str(uuid.uuid4()),
              'jti': str(uuid.uuid4()), 'iat': now, 'nbf': now, 'exp': now + 120}
    claims.update(override or {})
    return sql('baseline', "BEGIN; SET LOCAL ROLE " + role +
               "; SET LOCAL request.jwt.claims='" + json.dumps(claims).replace("'", "''") +
               "'; " + query + "; ROLLBACK;").splitlines()[3:-1]


def main():
    actors = json.loads(sql('baseline', """select json_agg(x) from (
      select m.role,m.user_id,i.core_user_id,m.organization_id
      from public.tournament_organization_members m
      join public.torneos_identity i on i.id=m.user_id
      join public.tournament_organizations o on o.id=m.organization_id
      where o.slug='alpha-league' and m.role in ('admin','owner')) x"""))
    admin = next(a for a in actors if a['role'] == 'admin')
    owner = next(a for a in actors if a['role'] == 'owner')
    scopes = json.loads(sql('baseline', "select json_agg(x) from (select slug,id,organization_id,season_id from public.tournaments where slug in ('alpha-cup','beta-cup','other-cup')) x"))
    scopes = {s['slug']: s for s in scopes}
    for name in ('can_read_tournament_fixture_scope', 'can_read_tournament_projection_scope'):
        for slug, expected in [('alpha-cup','t'), ('beta-cup','f'), ('other-cup','f')]:
            scope = scopes[slug]
            query = f"select public.{name}('{scope['organization_id']}','{scope['id']}')"
            check(name + ': admin ' + slug, request(admin, query) == [expected])
        scope = scopes['beta-cup']
        query = f"select public.{name}('{scope['organization_id']}','{scope['id']}')"
        check(name + ': owner retains access', request(owner, query) == ['t'])
        check(name + ': forged local/Core mapping denied',
              request(admin, query, override={'core_user_id': owner['core_user_id']}) == ['f'])
        try:
            request(admin, query, role='anon')
            denied = False
        except RuntimeError as error:
            denied = 'permission denied for function' in str(error)
        check(name + ': anon execute denied', denied)
    for actor, slug, expected in [(admin,'alpha-cup',True), (owner,'beta-cup',True),
                                   (admin,'beta-cup',False), (admin,'other-cup',False)]:
        scope = scopes[slug]
        query = f"select public.get_tournament_teams_context('{scope['organization_id']}','{scope['id']}')"
        try:
            rows = request(actor, query)
            actual = json.loads(rows[0])['tournamentId'] == scope['id']
        except RuntimeError as error:
            if 'TORNEOS_RESOURCE_FORBIDDEN' not in str(error): raise
            actual = False
        check('teams context: ' + actor['role'] + ' ' + slug, actual == expected)
    scope = scopes['alpha-cup']
    try:
        request(admin, f"select public.get_tournament_teams_context('{scope['organization_id']}','{scope['id']}')", role='anon')
        denied = False
    except RuntimeError as error:
        denied = 'permission denied for function' in str(error)
    check('teams context: anon execute denied', denied)
    check('unassigned admin cannot see tournament through RLS',
          request(admin, f"select count(*) from public.tournaments where id='{scopes['beta-cup']['id']}'") == ['0'])

if __name__ == '__main__':
    try:
        main()
    finally:
        (BASE / 'phase2b/season-read-results.json').write_text(json.dumps(results, indent=2) + '\n')
    assert results and all(r['pass'] for r in results)
