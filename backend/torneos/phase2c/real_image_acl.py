"""Phase 2C: effective ACLs of the baseline on a REAL Supabase database, before and after the fix.

The Supabase Postgres image's own `postgres` database carries the schema-scoped default ACLs
hosted Supabase ships for the installing role in `public` (functions, sequences, tables ->
anon, authenticated, service_role); `template0`/`template1` carry none. Each candidate is
installed exactly as Phase 2B/3A install it (as `supabase_admin`, one transaction) into the
`postgres` database of a FRESH, network-disabled container of that image, inventoried with
acl-inventory.sql, and the container is removed. The corrected candidate is also installed
into a `template0` clone so the two environments can be compared object by object.

Nothing remote; the Phase 2B lab container is not touched.
"""
import json
import pathlib
import subprocess
import sys
import time

BASE = pathlib.Path(__file__).resolve().parents[1]
ROOT = BASE.parents[1]
sys.path.insert(0, str(BASE / 'tools'))
from lab import docker  # noqa: E402

API = ('anon', 'authenticated', 'service_role')
IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.143'
BEFORE_COMMIT = '317c2b19'  # Phase 3A HEAD: the certified Phase 2B candidate (7ec33549…)
INVENTORY = (BASE / 'phase2c/acl-inventory.sql').read_text()
EVIDENCE = BASE / 'phase2c/evidence'


class Container:
    def __init__(self, name):
        self.name = name

    def __enter__(self):
        docker('rm', '-f', self.name) if self.name in docker('ps', '-a', '--format', '{{.Names}}').splitlines() else None
        docker('run', '-d', '--name', self.name, '--network', 'none', '--label', 'arma2.phase=local-acl-2c',
               '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', IMAGE, 'postgres', '-D', '/etc/postgresql', '-c', 'log_statement=none')
        info = json.loads(docker('inspect', self.name))[0]
        assert info['HostConfig']['NetworkMode'] == 'none' and info['Config']['Image'] == IMAGE
        for _ in range(90):
            try:
                if 'PostgreSQL init process complete' in docker('logs', self.name):
                    self.psql('postgres', 'select 1')
                    return self
            except RuntimeError:
                pass
            time.sleep(1)
        raise RuntimeError('fresh image database not ready')

    def __exit__(self, *exc):
        docker('rm', '-f', self.name)

    def psql(self, db, query):
        assert db in ('postgres', 't0')
        return docker('exec', '-i', self.name, 'psql', '-X', '-U', 'supabase_admin', '-d', db, '-At', '-v', 'ON_ERROR_STOP=1', input=query)


def install(c, db, label, source):
    assert c.psql(db, "select count(*) from pg_class x join pg_namespace n on n.oid=x.relnamespace where n.nspname='public' and x.relkind in ('r','v','m','S')").strip() == '0'
    defaults_before = json.loads(c.psql(db, "select coalesce(json_agg(json_build_object('role',r.rolname,'type',d.defaclobjtype,'acl',d.defaclacl::text) order by r.rolname,d.defaclobjtype),'[]') from pg_default_acl d join pg_roles r on r.oid=d.defaclrole join pg_namespace n on n.oid=d.defaclnamespace where n.nspname='public'"))
    c.psql(db, source)
    inventory = json.loads(c.psql(db, INVENTORY))
    # Future-migration probe: objects a later migration creates (same installer) get no API-role privilege.
    probe = c.psql(db, """BEGIN;
      CREATE FUNCTION public.phase2c_probe() RETURNS integer LANGUAGE sql AS 'SELECT 1';
      CREATE SEQUENCE public.phase2c_probe_seq;
      CREATE TABLE public.phase2c_probe_table(id integer);
      SELECT (has_function_privilege('anon','public.phase2c_probe()','EXECUTE') OR has_function_privilege('authenticated','public.phase2c_probe()','EXECUTE') OR has_function_privilege('service_role','public.phase2c_probe()','EXECUTE'))::text
        || ',' || (has_sequence_privilege('anon','public.phase2c_probe_seq','USAGE') OR has_sequence_privilege('authenticated','public.phase2c_probe_seq','USAGE') OR has_sequence_privilege('service_role','public.phase2c_probe_seq','USAGE'))::text
        || ',' || (has_table_privilege('anon','public.phase2c_probe_table','SELECT') OR has_table_privilege('authenticated','public.phase2c_probe_table','SELECT') OR has_table_privilege('service_role','public.phase2c_probe_table','SELECT'))::text;
      ROLLBACK;""").splitlines()[-2]
    functions = inventory['functions']
    public_functions = [f for f in functions if f['schema'] == 'public']
    definer = [f for f in functions if f['security_definer']]
    summary = {
        'label': label, 'database': db, 'image': IMAGE, 'installer': 'supabase_admin',
        'default_acl_public_before_install': defaults_before,
        'default_acl_after_install': inventory['default_acl'],
        'functions_total': len(functions), 'public_functions': len(public_functions), 'security_definer': len(definer),
        'execute': {role: {
            'public_functions': sum(f[role] for f in public_functions),
            'private_functions': sum(f[role] for f in functions if f['schema'] == 'private'),
            'security_definer': sum(f[role] for f in definer),
        } for role in API + ('postgres',)},
        'public_execute_functions': sum(f['public'] for f in functions),
        'sequences_total': len(inventory['sequences']),
        'sequence_privilege': {role: sum(bool(s[role]) for s in inventory['sequences']) for role in API + ('postgres',)},
        'relations_total': len(inventory['relations']),
        'relation_privilege': {role: sum(bool(r[role]) for r in inventory['relations']) for role in API + ('postgres',)},
        'anon_write_privilege_relations': sum(any(p != 'SELECT' for p in r['anon']) for r in inventory['relations']),
        'future_objects_api_privilege(function,sequence,table)': probe,
    }
    (EVIDENCE / f'real-image-acl-{label}.json').write_text(json.dumps({'summary': summary, 'inventory': inventory}, indent=2) + '\n')
    print(label, json.dumps({k: summary[k] for k in ('execute', 'sequence_privilege', 'relation_privilege', 'future_objects_api_privilege(function,sequence,table)')}), flush=True)
    return summary, inventory


def api_view(inventory):
    """Object -> API-role privileges only (owner/platform entries excluded): the comparable surface."""
    view = {}
    for f in inventory['functions']:
        view['function:' + f['function']] = {r: f[r] for r in API} | {'public': f['public'], 'adapter': f['torneos_core_adapter'], 'writer': f['torneos_identity_writer'], 'security_definer': f['security_definer'], 'settings': f['settings']}
    for s in inventory['sequences']:
        view['sequence:' + s['sequence']] = {r: sorted(s[r]) for r in API}
    for r in inventory['relations']:
        view['relation:' + r['relation']] = {x: sorted(r[x]) for x in API} | {'rls': r['rls']}
    return view


def main():
    before_sql = subprocess.run(['git', '-C', str(ROOT), 'show', f'{BEFORE_COMMIT}:backend/torneos/supabase/migrations/00000000000000_torneos_baseline_v1.sql'], text=True, capture_output=True, check=True).stdout
    after_sql = (BASE / 'supabase/migrations/00000000000000_torneos_baseline_v1.sql').read_text()
    assert before_sql != after_sql
    EVIDENCE.mkdir(exist_ok=True)
    runs = {}
    with Container('arma2-torneos-acl-phase2c-before') as c:
        runs['before-real'], before = install(c, 'postgres', 'before-real', before_sql)
    with Container('arma2-torneos-acl-phase2c-after') as c:
        runs['after-real'], real = install(c, 'postgres', 'after-real', after_sql)
        # Roles are cluster-wide: release them, then install the same candidate into a template0 clone.
        c.psql('postgres', 'DROP OWNED BY torneos_identity_writer, torneos_core_adapter; DROP ROLE torneos_identity_writer, torneos_core_adapter; CREATE DATABASE t0 TEMPLATE template0;')
        assert c.psql('t0', 'select count(*) from pg_default_acl').strip() == '0'
        runs['after-template0'], t0 = install(c, 't0', 'after-template0', after_sql)
    a, b = api_view(real), api_view(t0)
    mismatches = [{'object': k, 'real': a.get(k), 'template0': b.get(k)} for k in sorted(a.keys() | b.keys()) if a.get(k) != b.get(k)]
    changes = {}  # per object and API role: privilege before -> after on the real image
    for kind, key in (('functions', 'function'), ('sequences', 'sequence'), ('relations', 'relation')):
        b_map = {x[key]: x for x in before[kind]}
        for x in real[kind]:
            for role in API:
                was, now = b_map[x[key]][role], x[role]
                if was != now:
                    changes.setdefault(kind, []).append({key: x[key], 'role': role, 'before': was, 'after': now})
    gained = [c for v in changes.values() for c in v if (c['after'] is True and c['before'] is False) or (isinstance(c['after'], list) and set(c['after']) - set(c['before']))]
    report = {
        'image': IMAGE,
        'image_default_acl_public': runs['before-real']['default_acl_public_before_install'],
        'runs': runs,
        'real_vs_template0_objects_compared': len(a),
        'real_vs_template0_api_privilege_mismatches': mismatches,
        'before_to_after_changes': {k: len(v) for k, v in changes.items()},
        'before_to_after_changes_detail': changes,
        'privilege_gained_by_api_role_after_fix': gained,
    }
    (EVIDENCE / 'real-image-acl-diff.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'real_vs_template0_mismatches': len(mismatches), 'before_to_after_changes': report['before_to_after_changes'], 'privilege_gained_after_fix': len(gained)}))
    return 0 if not mismatches and not gained else 1


if __name__ == '__main__':
    sys.exit(main())
