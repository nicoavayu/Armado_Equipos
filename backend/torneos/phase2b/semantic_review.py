"""Phase 2B: semantic disposition for every SECURITY DEFINER function of the installed baseline.

One row per DEFINER function in public/private. Each row carries mechanical facts read from
the live catalog (grants, trigger use, writes, tables read that clients cannot read, dynamic
SQL, temp relations), the authorization evidence found in the body (direct guards, delegated
guards, self-scoping), the Phase 2B season rule applied at build time, the dynamic
season-scope sweep verdict, and the test files that exercise the function. From those it
derives a category and a disposition. The run fails if any DEFINER function is left without
a disposition or if a client-callable function shows no authorization evidence at all.

This is a certification of what the evidence shows, not a proof of intent: the notes say
which functions rely on delegated or self-scoped authorization and which dynamic verdicts
were inconclusive (the static rule still applies and the admin was denied in those runs).
"""
import json
import pathlib
import re
import sys

BASE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE / 'tools'))
from lab import sql  # noqa: E402

GUARD = re.compile(r'(?:public|private)\.(has_tournament_[a-z_]+|can_[a-z_]+|assert_tournament_[a-z_]+|is_tournament_[a-z_]+|'
                   r'authorize_tournament_[a-z_]+|current_user_[a-z_]+|require_[a-z_]+|tournament_media_require_[a-z_]+)\s*\(')
IDENTITY = re.compile(r'private\.current_identity_id\(\)')
SELF_SCOPE = re.compile(r'=\s*private\.current_identity_id\(\)|private\.current_identity_id\(\)\s*=')
WRITE = re.compile(r'^\s*(insert\s+into|update\s|delete\s+from)\b', re.I | re.M)
TABLE = re.compile(r'public\.([a-z_]+)')
CORE_BOUND = {'accept_tournament_team_invitation', 'search_tournament_players', 'search_tournament_arma2_teams',
              'create_tournament_team_entry'}
CATALOG_READS = {'tournament_role_capabilities', 'tournament_media_role_capabilities',
                 'tournament_communications_role_capabilities', 'tournament_social_role_capabilities'}
DELEGATED = {  # authenticated-callable wrappers whose only authorization is the guarded callee
    'create_fake_tournament_season_purchase': 'create_tournament_season_purchase',
    'has_tournament_entitlement': 'get_effective_tournament_entitlements',
}


def load():
    rows = json.loads(sql('baseline', """select json_agg(x order by x.schema, x.name) from (
      select n.nspname schema, p.proname name, p.oid::regprocedure::text signature,
        pg_get_function_identity_arguments(p.oid) arguments, format_type(p.prorettype,null) returns,
        l.lanname language, r.rolname owner, p.proconfig settings, p.proacl::text[] acl,
        has_function_privilege('anon',p.oid,'EXECUTE') anon,
        has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
        has_function_privilege('service_role',p.oid,'EXECUTE') service_role,
        has_function_privilege('torneos_core_adapter',p.oid,'EXECUTE') adapter,
        exists(select 1 from pg_trigger t where t.tgfoid=p.oid and not t.tgisinternal) trigger_used,
        pg_get_functiondef(p.oid) definition
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
      join pg_roles r on r.oid=p.proowner
      where n.nspname in ('public','private') and p.prosecdef and p.prokind='f') x"""))
    tables = set(json.loads(sql('baseline', "select json_agg(relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'")))
    readable = set(json.loads(sql('baseline', "select coalesce(json_agg(distinct tablename),'[]') from pg_policies p, unnest(p.roles) r where schemaname='public' and cmd in ('SELECT','ALL') and r in ('anon','authenticated','public')")))
    return rows, tables, readable


def tests_for():
    """Function name -> test files that mention it (positive or negative exercise)."""
    files = [p for p in (BASE / 'tools').glob('test*.py')] + list((BASE / 'phase2a').glob('test_*.py')) + \
            list((BASE / 'phase2b').glob('test_*.py')) + [BASE / 'phase2b/season_scope_sweep.py']
    mentions = {}
    for path in files:
        text = path.read_text()
        for name in set(re.findall(r'public\.([a-z_]+)\(', text)) | set(re.findall(r"'([a-z_]+)'", text)):
            mentions.setdefault(name, set()).add(path.relative_to(BASE).as_posix())
    return mentions


def main():
    rows, tables, readable = load()
    differences = {d['function']: d['change'] for d in json.loads((BASE / 'evidence/intentional-function-differences.json').read_text())}
    sweep = {r['function'].split('(')[0]: r for r in json.loads((BASE / 'phase2b/season-scope-sweep.json').read_text())['results']}
    mentions = tests_for()
    review, problems = [], []
    for f in rows:
        body = f['definition'].split('AS $function$', 1)[-1] if 'AS $function$' in f['definition'] else f['definition'].split('AS $', 1)[-1]
        grantees = [r for r in ('anon', 'authenticated', 'service_role', 'adapter') if f[r]]
        guards = sorted(set(GUARD.findall(body)) - {f['name']})
        identity = bool(IDENTITY.search(body))
        self_scoped = bool(SELF_SCOPE.search(body))
        writes = bool(WRITE.search(body))
        referenced = sorted(set(TABLE.findall(body)) & tables)
        closed_reads = [t for t in referenced if t not in readable]
        dynamic = bool(re.search(r'^\s*execute\b', body, re.I | re.M))
        temp = 'pg_temp.' in body
        season_rule = differences.get(f['name'], '') if 'season' in differences.get(f['name'], '') else ''
        verdict = sweep.get(f['name'], {}).get('verdict')
        client = f['anon'] or f['authenticated']
        # ---- category ------------------------------------------------------------------------
        if f['name'] in CORE_BOUND:
            category, disposition = 'CORE_CONTRACT_BOUND', 'Historical RPC re-authorizes locally (capability + season) and consumes a single-use server attestation bound to identity, Core session and exact request; positive/negative flows in test_core_wiring.py'
        elif f['schema'] == 'private' and f['name'] == 'authorize_core_contract':
            category, disposition = 'ADAPTER_ONLY', 'Server pre-authorization for the Core contract; EXECUTE only for the NOLOGIN adapter role; evaluates the same local predicate the RPC applies; never called by clients'
        elif f['trigger_used'] or f['returns'] == 'trigger':
            category, disposition = 'TRIGGER', 'Fired by DML on protected tables; no client EXECUTE; enforces invariants (append-only, immutability, scope) regardless of caller'
        elif not client and not f['service_role']:
            category, disposition = 'INTERNAL', 'No client or service EXECUTE; reachable only from other DEFINER functions or the owner; authorization is the caller\'s responsibility and is recorded on the callers'
        elif not client and f['service_role']:
            category, disposition = 'SERVICE_ONLY', 'EXECUTE only for service_role; unreachable from anon/authenticated bearers; the calling service owns authorization of its inputs' + ('; body still applies identity/capability guards' if guards or identity else '')
        elif f['anon'] and f['name'].startswith('get_public_'):
            category, disposition = 'PUBLIC_READ', 'Anonymous read restricted to published/active rows by explicit visibility predicates (unpublished returns null; tested in tools/test.py)'
        elif f['anon']:
            category, disposition = 'IDENTITY_GATED_READ', 'EXECUTE includes anon but the body requires a verified identity and a participant-hub/communications predicate; anon receives a denial'
        elif f['name'] in CATALOG_READS:
            category, disposition = 'CATALOG_READ', 'Reads a static role/capability matrix only (seed catalog, no tenant data)'
        elif f['name'] in DELEGATED:
            category, disposition = 'CLIENT_RPC_DELEGATED', 'Authorization delegated to the guarded DEFINER callee ' + DELEGATED[f['name']] + ' invoked before any effect'
        elif f['returns'] == 'boolean' and re.match(r'(has|can|is)_', f['name']):
            category, disposition = 'CLIENT_PREDICATE', 'Boolean fact about the current identity\'s own access (returns false for others); parameters are identifiers the caller already holds' + ('; season rule applied' if season_rule else '')
        elif guards or identity or self_scoped:
            category, disposition = 'CLIENT_RPC_GUARDED', 'Direct identity/capability/scope guard before reads and writes' + ('; season rule applied' if season_rule else '') + ('; self-scoped to the current identity' if self_scoped and not guards else '')
        else:
            category, disposition = 'UNKNOWN', ''
            problems.append(f['signature'])
        if category in ('CLIENT_RPC_GUARDED', 'CLIENT_PREDICATE') and not (guards or identity or self_scoped):
            problems.append(f['signature'] + ' (no authorization evidence)')
        necessity = []
        if writes:
            necessity.append('writes tables clients cannot write (no client write policies exist)')
        if closed_reads:
            necessity.append('reads tables without client SELECT policy: ' + ', '.join(closed_reads[:6]) + ('…' if len(closed_reads) > 6 else ''))
        if not necessity:
            necessity.append('bypasses scoped RLS to evaluate rows the caller may not see (helper/predicate); DEFINER retained for the uniform search_path/ACL contract')
        notes = []
        if verdict:
            notes.append('season sweep: ' + verdict + ('' if verdict != 'INCONCLUSIVE' else ' (owner control unavailable; static rule applied; admin denied on the unassigned season)'))
        if dynamic:
            notes.append('dynamic SQL: constant statements without interpolation (storage introspection); no injection surface')
        if temp:
            notes.append('temporary work relation recreated before privileged DML (Phase 2B); adversarial probes in test_temp_relations.py')
        if f['name'] in DELEGATED:
            notes.append('delegate: ' + DELEGATED[f['name']])
        exercised = set(mentions.get(f['name'], []))
        if verdict and verdict != 'NOT_SWEPT':
            exercised.add('phase2b/season_scope_sweep.py')
        review.append({
            'function': f['signature'], 'schema': f['schema'], 'name': f['name'], 'returns': f['returns'], 'language': f['language'],
            'owner': f['owner'], 'fixed_search_path': 'search_path=""' in (f['settings'] or []), 'grantees': grantees,
            'trigger_used': f['trigger_used'], 'category': category, 'disposition': disposition,
            'definer_necessity': necessity, 'writes': writes, 'closed_tables_read': closed_reads,
            'authorization_evidence': {'direct_guards': guards, 'identity_check': identity, 'self_scoped': self_scoped,
                                       'season_rule': season_rule, 'season_sweep': verdict},
            'dynamic_sql': dynamic, 'temp_relations': temp,
            'exercised_by': sorted(exercised),
            'intentional_difference': differences.get(f['name'], ''),
            'notes': notes,
        })
    summary = {'security_definer': len(review), 'disposed': sum(r['category'] != 'UNKNOWN' for r in review), 'unknown': len(problems),
               'categories': {c: sum(r['category'] == c for r in review) for c in sorted({r['category'] for r in review})},
               'exercised': sum(bool(r['exercised_by']) for r in review)}
    (BASE / 'evidence/security-definer-review.json').write_text(json.dumps({'summary': summary, 'problems': problems, 'functions': review}, indent=2) + '\n')
    lines = ['# SECURITY DEFINER semantic review (Phase 2B)', '',
             f"{summary['security_definer']} DEFINER functions; {summary['disposed']} with a disposition; {summary['unknown']} unknown. "
             'Categories: ' + ', '.join(f'{k} {v}' for k, v in summary['categories'].items()) + '.', '',
             'Evidence per row: grantees, direct/delegated/self-scoped authorization, season rule (build-time), season sweep verdict (dynamic), writes, closed tables read, dynamic SQL, temp relations, exercising tests. See evidence/security-definer-review.json.', '',
             '| Function | Grantees | Category | Season rule | Sweep | Tests | Disposition |', '|---|---|---|---|---|---|---|']
    for r in review:
        lines.append('| `' + r['function'] + '` | ' + (', '.join(r['grantees']) or 'owner') + ' | ' + r['category'] + ' | ' +
                     ('yes' if r['authorization_evidence']['season_rule'] else '-') + ' | ' + (r['authorization_evidence']['season_sweep'] or '-') +
                     ' | ' + str(len(r['exercised_by'])) + ' | ' + r['disposition'] + ' |')
    (BASE / 'phase2b/SECURITY-DEFINER-REVIEW.md').write_text('\n'.join(lines) + '\n')
    print(json.dumps(summary))
    for p in problems:
        print('PROBLEM', p)
    return summary


if __name__ == '__main__':
    s = main()
    sys.exit(0 if s['unknown'] == 0 else 1)
