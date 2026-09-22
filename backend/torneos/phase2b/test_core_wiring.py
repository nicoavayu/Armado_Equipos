"""Four historical Core-dependent RPCs executed for real against the Phase 2A local contract.

Runs after tools/test.py on the same clean install and reuses its fixtures (alpha-league,
alpha-cup in registration, beta-cup in an unassigned season). The Core authority is the
Phase 2A synthetic mock behind its signed HTTP client; the SQL boundary is the installed
baseline. Commits are real so identity allocation, snapshot storage and audit rows are
observable; the lab database is disposable and recreated by install-local.py.
"""
import json
import pathlib
import secrets
import sys
import time
import uuid

BASE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE / 'tools'))
sys.path.insert(0, str(BASE / 'phase2a'))
sys.path.insert(0, str(BASE / 'phase2b'))
from lab import sql  # noqa: E402
from contracts import CoreAuthority, CoreClient, CoreServer, Denied  # noqa: E402
from adapter import Adapter, Gateway, as_user, lit  # noqa: E402

results = []


def check(name, condition):
    results.append({'name': name, 'pass': bool(condition)})
    print(('PASS ' if condition else 'FAIL ') + name, flush=True)


def q(query):
    return sql('baseline', query).strip()


def raises(name, fn, expected):
    try:
        fn()
        results.append({'name': name, 'pass': False, 'actual': 'no error'})
        print('FAIL ' + name + ' (no error)', flush=True)
    except (RuntimeError, Denied) as error:
        text = str(error) if isinstance(error, RuntimeError) else error.code
        check(name, expected in text)


def claims_for(identity, core_user_id, session_id):
    now = int(time.time())
    return {'sub': identity, 'core_user_id': core_user_id, 'role': 'authenticated',
            'iss': 'urn:arma2:local:identity-bridge', 'aud': 'arma2-torneos-local',
            'session_id': session_id, 'jti': str(uuid.uuid4()), 'iat': now, 'nbf': now, 'exp': now + 120}


def main():
    key = secrets.token_bytes(32)
    core = CoreAuthority(key)
    server = CoreServer(core)
    original = core.handle

    def counted(*args, **kwargs):
        _calls['n'] += 1
        return original(*args, **kwargs)
    core.handle = counted
    try:
        gateway = Gateway(Adapter(CoreClient(server.url, key)))
        run(core, gateway)
    finally:
        server.close()


def run(core, gateway):
    actors = {a['role']: a for a in json.loads(q("""select json_agg(x) from (
      select m.role,m.user_id,i.core_user_id from public.tournament_organization_members m
      join public.torneos_identity i on i.id=m.user_id
      join public.tournament_organizations o on o.id=m.organization_id where o.slug='alpha-league') x"""))}
    outsider = json.loads(q("select json_agg(x) from (select id user_id,core_user_id from public.torneos_identity i where not exists (select 1 from public.tournament_organization_members m where m.user_id=i.id) limit 1) x"))[0]
    scopes = {s['slug']: s for s in json.loads(q("select json_agg(x) from (select slug,id,organization_id,season_id,status from public.tournaments) x"))}
    org, alpha, beta = scopes['alpha-cup']['organization_id'], scopes['alpha-cup'], scopes['beta-cup']
    category = q(f"select id from public.tournament_categories where tournament_id='{alpha['id']}' and slug='open'")
    entry = q(f"select id from public.tournament_team_entries where tournament_id='{alpha['id']}' and name='Local Team'")

    def session_for(core_user_id):
        sid = str(uuid.uuid4())
        core.sessions[sid] = {'user_id': core_user_id, 'expires_at': core.clock() + 600}
        return sid

    def core_user(core_user_id, name, email=None, verified=True, discoverable=True, positions=('goalkeeper',)):
        core.users[core_user_id] = {'active': True, 'discoverable': discoverable, 'email': email,
                                    'email_verified': verified, 'display_name': name, 'avatar_url': None,
                                    'positions': list(positions), 'password': 'NEVER_RETURN'}

    def actor(role):
        a = actors[role]
        core_user(a['core_user_id'], role.title() + ' Member')
        return claims_for(a['user_id'], a['core_user_id'], session_for(a['core_user_id']))
    owner, admin = actor('owner'), actor('admin')
    core_user(outsider['core_user_id'], 'Outsider')
    outsider_claims = claims_for(outsider['user_id'], outsider['core_user_id'], session_for(outsider['core_user_id']))

    # ---- Contract 1: verified email at invitation acceptance ------------------------------------
    captain_core = str(uuid.uuid4())
    core_user(captain_core, 'Captain Test', email='Captain@Example.test')
    captain_id = q(f"SET ROLE torneos_identity_writer; INSERT INTO public.torneos_identity(core_user_id) VALUES ('{captain_core}') RETURNING id; RESET ROLE;").splitlines()[1]
    captain = claims_for(captain_id, captain_core, session_for(captain_core))

    def invite(email='captain@example.test'):
        return json.loads(as_user(owner, f"select public.invite_tournament_team_manager('{org}','{entry}','{email}','Captain Test','captain')")[0])['token']
    token = invite()
    core.available = False
    raises('accept: Core outage fails closed', lambda: gateway.accept_invitation(captain, token), 'CORE_UNAVAILABLE')
    core.available = True
    check('accept: outage left invitation pending and no attestation',
          q("select (select count(*) from private.core_contract_attestations)::text||','||(select status from public.tournament_team_invitations where token_hash=encode(public.digest(" + lit(token) + ",'sha256'),'hex'))") == '0,pending')
    core.users[captain_core]['email_verified'] = False
    raises('accept: unverified Core email denied', lambda: gateway.accept_invitation(captain, token), 'TORNEOS_INVITATION_INVALID')
    core.users[captain_core]['email_verified'] = True
    core.users[captain_core]['email'] = 'other@example.test'
    raises('accept: changed Core email denied', lambda: gateway.accept_invitation(captain, token), 'TORNEOS_INVITATION_INVALID')
    core.users[captain_core]['email'] = 'Captain@Example.test'
    raises('accept: other identity with the token denied', lambda: gateway.accept_invitation(owner, token), 'TORNEOS_INVITATION_INVALID')
    # A failed RPC rolls back its consumption marker; only negative verdicts can remain live.
    check('accept: denied attempts left no positive verdict behind',
          q("select count(*) from private.core_contract_attestations where consumed_at is null and expires_at > now() and response->>'verified'='true' and response->>'matches'='true'") == '0')
    accepted = gateway.accept_invitation(captain, token)
    check('accept: verified matching email accepted', accepted.get('status') == 'accepted' and accepted.get('teamEntryId') == entry)
    check('accept: manager bound to the local identity',
          q(f"select status||','||user_id::text from public.tournament_team_managers where team_entry_id='{entry}' and email_normalized='captain@example.test'") == 'active,' + captain_id)
    check('accept: entry moved to in_progress and audit recorded',
          q(f"select (select status from public.tournament_team_entries where id='{entry}')||','||(select count(*) from public.tournament_audit_log where action='team_manager.invitation_accepted' and actor_user_id='{captain_id}')::text") == 'in_progress,1')
    check('accept: attestation single-use marker set',
          q("select count(*) from private.core_contract_attestations where contract='verified_email' and consumed_at is not null") == '1')
    raises('accept: second acceptance rejected', lambda: gateway.accept_invitation(captain, token), 'TORNEOS_INVITATION_INVALID')
    before = q("select count(*) from private.core_contract_attestations")
    raises('accept: expired invitation denied before Core',
           lambda: gateway.adapter.prepare(captain, 'verified_email', {'token': 'x' * 64}), 'TORNEOS_INVITATION_INVALID')
    check('accept: pre-authorization failure wrote no attestation', q("select count(*) from private.core_contract_attestations") == before)
    token2 = invite('second@example.test')
    gateway.adapter.prepare(captain, 'verified_email', {'token': token2})  # attestation for token2's target
    raises('accept: attestation bound to invitation target, not reusable for another invitation',
           lambda: as_user(captain, f"select public.accept_tournament_team_invitation({lit(invite('third@example.test'))})"), 'TORNEOS_CORE_ATTESTATION_REQUIRED')
    raises('accept: attestation bound to Core session',
           lambda: as_user(claims_for(captain_id, captain_core, str(uuid.uuid4())), f"select public.accept_tournament_team_invitation({lit(token2)})"), 'TORNEOS_CORE_ATTESTATION_REQUIRED')
    q("update private.core_contract_attestations set created_at=now()-interval '30 seconds', observed_at=now()-interval '30 seconds', expires_at=now()-interval '20 seconds' where consumed_at is null")
    raises('accept: expired attestation rejected',
           lambda: as_user(captain, f"select public.accept_tournament_team_invitation({lit(token2)})"), 'TORNEOS_CORE_ATTESTATION_REQUIRED')
    core.sessions[captain['session_id']]['revoked'] = True
    raises('accept: revoked Core session denied by Core', lambda: gateway.accept_invitation(captain, token2), 'CORE_DENIED')
    del core.sessions[captain['session_id']]['revoked']
    raises('accept: anon cannot execute', lambda: as_user(captain, f"select public.accept_tournament_team_invitation({lit(token2)})", role='anon'), 'permission denied')

    # ---- Contract 2: directory ------------------------------------------------------------------
    ana, beto, cami = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    core_user(ana, 'Player Ana', positions=('goalkeeper',))
    core_user(beto, 'Player Beto', positions=('defender', 'midfielder'))
    core_user(cami, 'Player Cami', discoverable=False)
    players = gateway.search_players(owner, org, alpha['id'], 'player')
    names = [p['displayName'] for p in players]
    check('players: discoverable Core players returned, hidden excluded', names == ['Player Ana', 'Player Beto'])
    check('players: historical shape preserved with local identities',
          all(set(p) == {'userId', 'displayName', 'avatarUrl', 'positions', 'linkedAccount', 'teamName'} for p in players)
          and players[0]['linkedAccount'] is True and players[0]['teamName'] is None and players[1]['positions'] == ['defender', 'midfielder'])
    ana_identity = q(f"select id from public.torneos_identity where core_user_id='{ana}'")
    check('players: result userId is the local shadow identity', players[0]['userId'] == ana_identity and ana_identity != ana)
    check('players: certified bridge upsert reuses the allocated identity',
          q(f"SET ROLE torneos_identity_writer; INSERT INTO public.torneos_identity(core_user_id) VALUES ('{ana}') ON CONFLICT(core_user_id) DO UPDATE SET core_user_id=EXCLUDED.core_user_id RETURNING id; RESET ROLE;").splitlines()[1] == ana_identity)
    roster = q(f"select id from public.tournament_rosters where team_entry_id='{entry}' order by version desc limit 1")
    added = json.loads(as_user(owner, f"select public.add_tournament_roster_player('{org}','{entry}','{roster}','{ana_identity}',null,'Player Ana',null,1::smallint,'ARQ',null,true)")[0])
    check('players: search result usable by the historical roster flow', added.get('displayName') == 'Player Ana' and added.get('status') == 'active')
    check('players: audit row records the search', q(f"select count(*) from public.tournament_audit_log where action='search.players' and actor_user_id='{owner['sub']}'") == '1')
    gateway.adapter.prepare(owner, 'directory_players', {'organization_id': org, 'tournament_id': alpha['id'], 'team_entry_id': None, 'query': 'player', 'limit': 8})
    first = as_user(owner, f"select public.search_tournament_players('{org}','{alpha['id']}','player',8,null)")
    check('players: attested request served once', len(json.loads(first[0])) == 2)
    raises('players: replay of a consumed attestation denied',
           lambda: as_user(owner, f"select public.search_tournament_players('{org}','{alpha['id']}','player',8,null)"), 'TORNEOS_CORE_ATTESTATION_REQUIRED')
    gateway.adapter.prepare(owner, 'directory_players', {'organization_id': org, 'tournament_id': alpha['id'], 'team_entry_id': None, 'query': 'player', 'limit': 8})
    raises('players: attestation bound to the exact query',
           lambda: as_user(owner, f"select public.search_tournament_players('{org}','{alpha['id']}','playe',8,null)"), 'TORNEOS_CORE_ATTESTATION_REQUIRED')
    raises('players: attestation bound to the tournament',
           lambda: as_user(owner, f"select public.search_tournament_players('{org}','{beta['id']}','player',8,null)"), 'TORNEOS_CORE_ATTESTATION_REQUIRED')
    raises('players: attestation bound to the identity',
           lambda: as_user(admin, f"select public.search_tournament_players('{org}','{alpha['id']}','player',8,null)"), 'TORNEOS_CORE_ATTESTATION_REQUIRED')
    n = core_calls()
    check('players: assigned admin searches own season', len(gateway.search_players(admin, org, alpha['id'], 'player')) == 2)
    raises('players: admin without season access denied before Core',
           lambda: gateway.search_players(admin, org, beta['id'], 'player'), 'TORNEOS_RESOURCE_FORBIDDEN')
    raises('players: outsider denied before Core', lambda: gateway.search_players(outsider_claims, org, alpha['id'], 'player'), 'TORNEOS_RESOURCE_FORBIDDEN')
    raises('players: other workspace tournament denied', lambda: gateway.search_players(owner, org, scopes['other-cup']['id'], 'player'), 'TORNEOS_RESOURCE_FORBIDDEN')
    raises('players: query below 2 characters denied', lambda: gateway.search_players(owner, org, alpha['id'], 'p'), 'TORNEOS_RESOURCE_FORBIDDEN')
    raises('players: query above 100 characters denied', lambda: gateway.search_players(owner, org, alpha['id'], 'p' * 101), 'TORNEOS_RESOURCE_FORBIDDEN')
    check('players: local denials made exactly one Core call (the assigned admin)', core_calls() == n + 1)
    # Audit log is append-only: simulate 30 recent searches inside one rolled-back transaction.
    raises('players: local rate limit applied before Core', lambda: q(
        f"BEGIN; insert into public.tournament_audit_log(organization_id,actor_user_id,actor_type,action,resource_type,resource_id,tournament_id,metadata) select '{org}','{owner['sub']}','user','search.players','tournament','{alpha['id']}','{alpha['id']}','{{}}' from generate_series(1,30);"
        " SET LOCAL ROLE torneos_core_adapter; SET LOCAL request.jwt.claims=" + lit(json.dumps(owner)) +
        f"; select private.authorize_core_contract('directory_players','{{\"organization_id\":\"{org}\",\"tournament_id\":\"{alpha['id']}\",\"team_entry_id\":null,\"query\":\"player\",\"limit\":8}}'::jsonb); ROLLBACK;"), 'TORNEOS_SEARCH_RATE_LIMITED')
    raises('players: authenticated cannot read attestations',
           lambda: as_user(owner, 'select count(*) from private.core_contract_attestations'), 'permission denied')
    raises('players: adapter role cannot read attestations back',
           lambda: q("SET ROLE torneos_core_adapter; select count(*) from private.core_contract_attestations"), 'permission denied')
    raises('players: adapter role cannot execute domain RPC',
           lambda: q(f"SET ROLE torneos_core_adapter; select public.search_tournament_players('{org}','{alpha['id']}','player',8,null)"), 'permission denied')
    team_a, team_b, team_c = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    core.teams[team_a] = {'active': True, 'discoverable': True, 'name': 'Alpha Rovers', 'crest_url': 'https://core.example/crest.png', 'players': [ana, beto, cami], 'importers': [owner['core_user_id']], 'revision': 3}
    core.teams[team_b] = {'active': True, 'discoverable': True, 'name': 'Alpha United', 'crest_url': None, 'players': [beto], 'importers': [beto], 'revision': 1}
    core.teams[team_c] = {'active': True, 'discoverable': False, 'name': 'Alpha Hidden', 'crest_url': None, 'players': [ana], 'importers': [owner['core_user_id']], 'revision': 1}
    teams = gateway.search_teams(owner, org, alpha['id'], 'alpha')
    check('teams: only importable discoverable Core teams returned',
          [t['id'] for t in teams] == [team_a] and teams[0]['name'] == 'Alpha Rovers' and teams[0]['crestUrl'] == 'https://core.example/crest.png')
    check('teams: historical shape preserved; colors/format outside the contract are null',
          set(teams[0]) == {'id', 'name', 'crestUrl', 'primaryColor', 'secondaryColor', 'format'} and teams[0]['primaryColor'] is None)
    raises('teams: tournament not in registration denied before Core', lambda: gateway.search_teams(owner, org, beta['id'], 'alpha'), 'TORNEOS_RESOURCE_FORBIDDEN')
    raises('teams: admin without season access denied', lambda: gateway.search_teams(admin, org, beta['id'], 'alpha'), 'TORNEOS_RESOURCE_FORBIDDEN')
    raises('teams: outsider denied', lambda: gateway.search_teams(outsider_claims, org, alpha['id'], 'alpha'), 'TORNEOS_RESOURCE_FORBIDDEN')
    raises('teams: anon cannot execute', lambda: as_user(owner, f"select public.search_tournament_arma2_teams('{org}','{alpha['id']}','alpha',8)", role='anon'), 'permission denied')
    core.available = False
    raises('teams: Core outage yields no results', lambda: gateway.search_teams(owner, org, alpha['id'], 'alpha'), 'CORE_UNAVAILABLE')
    core.available = True

    # ---- Contract 3: frozen team snapshot import -------------------------------------------------
    key = str(uuid.uuid4())
    raises('import: non-importer denied by Core (hidden team, admin without import authority)',
           lambda: gateway.import_team(admin, org, alpha['id'], category, team_c, str(uuid.uuid4())), 'CORE_DENIED')
    imported = gateway.import_team(owner, org, alpha['id'], category, team_a, key, primary_color='#112233')
    check('import: entry created from the attested snapshot', imported.get('entryId') and imported.get('rosterId') and imported.get('status') == 'draft')
    entry_row = q(f"select name||','||registration_source||','||arma2_team_id::text||','||coalesce(primary_color,'-') from public.tournament_team_entries where id='{imported['entryId']}'")
    check('import: name from Core, colors as submitted, source arma2_team', entry_row == f"Alpha Rovers,arma2_team,{team_a},#112233")
    snapshot = json.loads(q(f"select row_to_json(s) from private.tournament_team_entry_core_snapshots s where team_entry_id='{imported['entryId']}'"))
    check('import: frozen snapshot stored privately with visible candidates only',
          snapshot['core_team_id'] == team_a and snapshot['source_revision'] == 3 and snapshot['imported_by'] == owner['sub']
          and [p['display_name'] for p in snapshot['players']] == ['Player Ana', 'Player Beto'])
    check('import: candidates are not roster members', q(f"select count(*) from public.tournament_roster_players where team_entry_id='{imported['entryId']}'") == '0')
    core.teams[team_a]['name'] = 'Renamed Later'
    core.teams[team_a]['revision'] = 4
    replay = gateway.import_team(owner, org, alpha['id'], category, team_a, key)
    check('import: idempotent retry returns the original entry after fresh Core authorization', replay.get('entryId') == imported['entryId'])
    check('import: later Core edits do not rewrite the frozen snapshot',
          q(f"select name||','||source_revision::text from private.tournament_team_entry_core_snapshots where team_entry_id='{imported['entryId']}'") == 'Alpha Rovers,3')
    raises('import: same Core team with another key rejected as already registered',
           lambda: gateway.import_team(owner, org, alpha['id'], category, team_a, str(uuid.uuid4())), 'TORNEOS_TEAM_ALREADY_REGISTERED')
    raises('import: team without importer authority denied by Core', lambda: gateway.import_team(owner, org, alpha['id'], category, team_b, str(uuid.uuid4())), 'CORE_DENIED')
    core.teams[team_c]['deleted'] = True
    raises('import: deleted Core team denied', lambda: gateway.import_team(owner, org, alpha['id'], category, team_c, str(uuid.uuid4())), 'CORE_DENIED')
    del core.teams[team_c]['deleted']
    n = core_calls()
    raises('import: admin without season access denied before Core', lambda: gateway.import_team(admin, org, beta['id'], category, team_c, str(uuid.uuid4())), 'TORNEOS_RESOURCE_FORBIDDEN')
    raises('import: outsider denied before Core', lambda: gateway.import_team(outsider_claims, org, alpha['id'], category, team_c, str(uuid.uuid4())), 'TORNEOS_RESOURCE_FORBIDDEN')
    raises('import: unknown category denied before Core', lambda: gateway.import_team(owner, org, alpha['id'], str(uuid.uuid4()), team_c, str(uuid.uuid4())), 'TORNEOS_REGISTRATION_CLOSED')
    check('import: local denials made no Core call', core_calls() == n)
    prepared = gateway.adapter.prepare(owner, 'team_snapshot', {'organization_id': org, 'tournament_id': alpha['id'], 'category_id': category, 'core_team_id': team_c})
    check('import: hidden team is still importable by its authorized importer with the known id', prepared['core_request'] == {'core_team_id': team_c})
    raises('import: snapshot attestation bound to the Core team',
           lambda: as_user(owner, f"select public.create_tournament_team_entry('{org}','{alpha['id']}','{category}','{team_b}',null,null,null,null,'arma2_team',null,null,null,'{uuid.uuid4()}')"), 'TORNEOS_CORE_ATTESTATION_REQUIRED')
    q(f"insert into private.core_contract_attestations(identity_id,session_id,contract,request_hash,response,observed_at) select identity_id,session_id,contract,request_hash,jsonb_set(response,'{{core_team_id}}',to_jsonb('{team_b}'::text)),now() from private.core_contract_attestations where contract='team_snapshot' order by created_at desc limit 1")
    raises('import: response/team mismatch rejected even with a matching hash',
           lambda: as_user(owner, f"select public.create_tournament_team_entry('{org}','{alpha['id']}','{category}','{team_c}',null,null,null,null,'arma2_team',null,null,null,'{uuid.uuid4()}')"), 'TORNEOS_RESOURCE_FORBIDDEN')
    core.teams[team_a]['players'] = [str(uuid.uuid4()) for _ in range(81)]
    raises('import: oversized Core team rejected, never truncated', lambda: gateway.import_team(owner, org, alpha['id'], category, team_a, str(uuid.uuid4())), 'CORE_DENIED')
    check('import: manual entry path unchanged',
          json.loads(as_user(owner, f"select public.create_tournament_team_entry('{org}','{alpha['id']}','{category}',null,'Manual Two',null,null,null,'manual',null,null,null,'{uuid.uuid4()}')")[0]).get('status') == 'draft')
    check('boundary: no attestation older than its TTL is consumable',
          q("select count(*) from private.core_contract_attestations where consumed_at is null and expires_at > created_at + interval '10 seconds'") == '0')
    check('boundary: every consumed attestation belonged to the consuming identity',
          q("select count(*) from private.core_contract_attestations a where consumed_at is not null and not exists (select 1 from public.torneos_identity i where i.id=a.identity_id)") == '0')


_calls = {'n': 0}


def core_calls():
    """Actual Core mock invocations (denied or not), counted at the authority."""
    return _calls['n']


if __name__ == '__main__':
    try:
        main()
    finally:
        (BASE / 'phase2b/core-wiring-results.json').write_text(json.dumps(results, indent=2) + '\n')
        print(f"{sum(r['pass'] for r in results)}/{len(results)} passed", flush=True)
    sys.exit(0 if results and all(r['pass'] for r in results) else 1)
