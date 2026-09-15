"""Phase 2D: effective ACLs of the 33 SECURITY DEFINER RPCs (and their parent path) on a REAL
Supabase database, BEFORE (the Phase 2C candidate at commit 992dd282, baseline only) and AFTER
(the Phase 2D baseline + 00000000000001_staging_v1_rpc_exposure.sql), plus the AFTER state on a
template0 clone for object-by-object equivalence.

Same method as phase2c/real_image_acl.py (fresh network-disabled container of the image, install
as supabase_admin, inventory with phase2c/acl-inventory.sql, remove the container). Measured, not
copied: the BEFORE numbers are re-derived here from 992dd282 rather than reused from Phase 2C.
Nothing remote; the Phase 2B lab container is not touched.
"""
import json
import pathlib
import subprocess
import sys

BASE = pathlib.Path(__file__).resolve().parents[1]
ROOT = BASE.parents[1]
sys.path.insert(0, str(BASE / 'tools'))
sys.path.insert(0, str(BASE / 'phase2c'))
from real_image_acl import API, IMAGE, INVENTORY, Container, api_view  # noqa: E402

BEFORE_COMMIT = '992dd282'  # Phase 2C HEAD: baseline 97634b65…, no gate
EVIDENCE = BASE / 'phase2d/evidence'
MIGRATIONS = BASE / 'supabase/migrations'


def install(c, db, label, sources):
    assert c.psql(db, "select count(*) from pg_class x join pg_namespace n on n.oid=x.relnamespace where n.nspname='public' and x.relkind in ('r','v','m','S')").strip() == '0'
    for name, source in sources:
        c.psql(db, source)
    inventory = json.loads(c.psql(db, INVENTORY))
    functions = inventory['functions']
    public_functions = [f for f in functions if f['schema'] == 'public']
    definer = [f for f in functions if f['security_definer']]
    summary = {
        'label': label, 'database': db, 'image': IMAGE, 'installer': 'supabase_admin', 'sources': [n for n, _ in sources],
        'functions_total': len(functions), 'public_functions': len(public_functions), 'security_definer': len(definer),
        'execute': {role: {
            'public_functions': sum(f[role] for f in public_functions),
            'private_functions': sum(f[role] for f in functions if f['schema'] == 'private'),
            'security_definer': sum(f[role] for f in definer),
        } for role in API + ('postgres',)},
        'public_execute_functions': sum(f['public'] for f in functions),
        'sequence_privilege': {role: sum(bool(s[role]) for s in inventory['sequences']) for role in API + ('postgres',)},
        'relation_privilege': {role: sum(bool(r[role]) for r in inventory['relations']) for role in API + ('postgres',)},
        'anon_write_privilege_relations': sum(any(p != 'SELECT' for p in r['anon']) for r in inventory['relations']),
    }
    (EVIDENCE / f'real-image-acl-{label}.json').write_text(json.dumps({'summary': summary, 'inventory': inventory}, indent=2) + '\n')
    print(label, json.dumps(summary['execute']), flush=True)
    return summary, inventory


def main():
    before_sql = subprocess.run(['git', '-C', str(ROOT), 'show', f'{BEFORE_COMMIT}:backend/torneos/supabase/migrations/00000000000000_torneos_baseline_v1.sql'], text=True, capture_output=True, check=True).stdout
    files = sorted(p for p in MIGRATIONS.iterdir() if p.suffix == '.sql')
    assert files[0].name == '00000000000000_torneos_baseline_v1.sql' and files[1].name == '00000000000001_staging_v1_rpc_exposure.sql' and len(files) == 2
    after = [(p.name, p.read_text()) for p in files]
    gate = json.loads((BASE / 'phase2d/staging-v1-rpc-gate.json').read_text())
    ledger = json.loads((BASE / 'phase3a/inconclusive-ledger.json').read_text())
    focus = [f['function'] for f in ledger['functions']] + [g['function'] for g in gate['functions'] if g['area'] == 'parent path']
    EVIDENCE.mkdir(exist_ok=True)
    runs = {}
    with Container('arma2-torneos-acl-phase2d-before') as c:
        runs['before-real'], before = install(c, 'postgres', 'before-real', [('00000000000000_torneos_baseline_v1.sql@992dd282', before_sql)])
    with Container('arma2-torneos-acl-phase2d-after') as c:
        runs['after-real'], real = install(c, 'postgres', 'after-real', after)
        c.psql('postgres', 'DROP OWNED BY torneos_identity_writer, torneos_core_adapter; DROP ROLE torneos_identity_writer, torneos_core_adapter; CREATE DATABASE t0 TEMPLATE template0;')
        assert c.psql('t0', 'select count(*) from pg_default_acl').strip() == '0'
        runs['after-template0'], t0 = install(c, 't0', 'after-template0', after)
    a, b = api_view(real), api_view(t0)
    mismatches = [{'object': k, 'real': a.get(k), 'template0': b.get(k)} for k in sorted(a.keys() | b.keys()) if a.get(k) != b.get(k)]
    # Before -> after on the real image, every object and API role.
    changes, gained = {}, []
    for kind, key in (('functions', 'function'), ('sequences', 'sequence'), ('relations', 'relation')):
        b_map = {x[key]: x for x in before[kind]}
        for x in real[kind]:
            for role in API:
                was, now = b_map[x[key]][role], x[role]
                if was != now:
                    changes.setdefault(kind, []).append({key: x[key], 'role': role, 'before': was, 'after': now})
                    if (now is True and was is False) or (isinstance(now, list) and set(now) - set(was)):
                        gained.append({key: x[key], 'role': role})
    # The 33 + parent: before/after per role, PostgREST exposure follows EXECUTE for the API roles.
    b_fn = {f['function']: f for f in before['functions']}
    a_fn = {f['function']: f for f in real['functions']}
    table = []
    for fn in focus:
        key = fn  # regprocedure text omits the public schema (it is on the search_path)
        bf, af = b_fn[key], a_fn[key]
        row = {'function': fn, 'security_definer': af['security_definer'], 'owner': af['owner'],
               'before': {r: bf[r] for r in API} | {'torneos_core_adapter': bf['torneos_core_adapter'], 'torneos_identity_writer': bf['torneos_identity_writer'], 'postgrest_exposed_to': [r for r in API if bf[r]]},
               'after': {r: af[r] for r in API} | {'torneos_core_adapter': af['torneos_core_adapter'], 'torneos_identity_writer': af['torneos_identity_writer'], 'postgrest_exposed_to': [r for r in API if af[r]]},
               'gated': fn in {g['function'] for g in gate['functions']}}
        table.append(row)
    gated_names = {g['function'] for g in gate['functions']}
    checks = {
        'before_authenticated_execute_on_all_33': all(b_fn[f['function']]['authenticated'] for f in ledger['functions']),
        'after_authenticated_execute_only_on_review': [r['function'] for r in table if r['after']['authenticated']] == ['review_tournament_team_entry(uuid,uuid,text,text,jsonb)'],
        'after_anon_execute_none': not any(r['after']['anon'] for r in table),
        'after_service_role_execute_kept_on_all': all(r['after']['service_role'] for r in table),
        'gate_changes_are_exactly_the_manifest': sorted({c['function'] for c in changes.get('functions', []) if c['role'] == 'authenticated'}) == sorted(gated_names),
        'no_privilege_gained_by_any_api_role': not gained,
        'no_sequence_or_relation_change': not changes.get('sequences') and not changes.get('relations'),
        'real_equals_template0': not mismatches,
    }
    report = {
        'image': IMAGE, 'before_commit': BEFORE_COMMIT, 'runs': runs,
        'focus_functions': table,
        'real_vs_template0_objects_compared': len(a), 'real_vs_template0_api_privilege_mismatches': mismatches,
        'before_to_after_changes': {k: len(v) for k, v in changes.items()}, 'before_to_after_changes_detail': changes,
        'privilege_gained_by_api_role': gained, 'checks': checks,
    }
    (EVIDENCE / 'real-image-acl-diff.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'checks': checks, 'mismatches': len(mismatches), 'changes': report['before_to_after_changes']}))
    return 0 if all(checks.values()) else 1


if __name__ == '__main__':
    sys.exit(main())
