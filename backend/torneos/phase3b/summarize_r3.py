"""Phase 3B — STRICT evaluation of the R3 evidence (decision B.2, 2026-09-15). No side effects.

The single source of truth for pins, ledger rows, probe answers and ACL expectations is
phase3b/remote/core-contract.mjs; this module asks it (offline, node) for its manifest instead of
copying values. Every predicate returns False on missing evidence: nothing is inferred.
"""
import hashlib
import json
import pathlib
import re
import subprocess

HERE = pathlib.Path(__file__).resolve().parent
BASE = HERE.parent
ROOT = BASE.parents[1]
R3_MODULE = HERE / 'remote/core-contract.mjs'
CORE_REF = 'hhyvmhgpapyuzjgxfnqv'


def sha(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def node_module_json(script):
    r = subprocess.run(['node', '--input-type=module', '-e', script], capture_output=True, text=True, cwd=str(ROOT), timeout=60)
    if r.returncode != 0:
        raise RuntimeError('core-contract.mjs manifest failed: ' + r.stderr[-400:])
    return json.loads(r.stdout)


r3_manifest = node_module_json(
    "import * as c from '%s'; const r = c.renderAll(process.cwd());"
    "process.stdout.write(JSON.stringify({ core_ref: c.CORE_REF, function_slug: c.FUNCTION_SLUG, secret_name: c.SECRET_NAME, cli_parser_sha256: c.CLI_PARSER_SHA256,"
    " migrations: r.map(m => ({ version: m.version, name: m.name, file: m.file, sha256: m.migration_sha256, apply_sql_sha256: m.apply_sql_sha256, statements_count: m.row.statements_count, ledger_digest: m.row.statements_digest, ledger_bytes: m.row.statements_bytes })),"
    " probe_expect: c.PROBE_EXPECT, rollback_sql_sha256: c.loadRollbackSql().sha256, contract_objects: c.CONTRACT_OBJECTS }))" % R3_MODULE)
r3_apply_sql_pins = {m['version']: m['apply_sql_sha256'] for m in r3_manifest['migrations']}
r3_deploy_files = {  # the deploy manifest must be the bytes in the tree
    'functions/_shared/supabaseApiKeys.ts': sha(ROOT / 'supabase/functions/_shared/supabaseApiKeys.ts'),
    'functions/_shared/torneosCoreContract.ts': sha(ROOT / 'supabase/functions/_shared/torneosCoreContract.ts'),
    'functions/torneos-core-contract/index.ts': sha(ROOT / 'supabase/functions/torneos-core-contract/index.ts'),
}


def r3_acl_failures(acl):
    return node_module_json("import { aclFailures } from '%s'; process.stdout.write(JSON.stringify(aclFailures(%s)))" % (R3_MODULE, json.dumps(acl)))


def r3_migrations_recorded(core):
    if not core or core.get('mode') != 'apply' or core.get('core_ref') != CORE_REF:
        return False
    entries = {m.get('version'): m for m in core.get('migrations', [])}
    rows = {r.get('version'): r for r in core.get('ledger_rows_after', [])}
    for m in r3_manifest['migrations']:
        e = entries.get(m['version']); r = rows.get(m['version'])
        if not e or not r:
            return False
        if e.get('sha256') != m['sha256'] or e.get('apply_sql_sha256') != m['apply_sql_sha256']:
            return False
        if e.get('installed_after') is not True or e.get('ledger_after') != 'ours' or e.get('decision') not in ('apply', 'skip', 'reconcile-ledger'):
            return False
        if r.get('statements_digest') != m['ledger_digest'] or int(r.get('statements_count', -1)) != m['statements_count'] or int(r.get('statements_bytes', -1)) != m['ledger_bytes'] or r.get('name') != m['name']:
            return False
        if not (r.get('created_by_is_null') is True and r.get('idempotency_key_is_null') is True and r.get('rollback_is_null') is True):
            return False
    return core.get('pins', {}).get('rollback_sql_sha256') == r3_manifest['rollback_sql_sha256'] and core.get('pins', {}).get('cli_parser_sha256') == r3_manifest['cli_parser_sha256']


def r3_function_signed_harness(core):
    if not core or core.get('mode') != 'apply' or core.get('core_ref') != CORE_REF:
        return False
    fn = core.get('function') or {}
    if fn.get('status') != 'ACTIVE' or fn.get('verify_jwt') is not False or not re.fullmatch(r'[0-9a-f]{64}', str(fn.get('ezbr_sha256'))):
        return False
    files = {f.get('path'): f.get('sha256') for f in (core.get('deploy') or {}).get('files', [])}
    if files != r3_deploy_files:
        return False
    probe = core.get('probe') or {}
    checks = probe.get('checks') or []
    if probe.get('verdict') != 'SIGNED_HARNESS_PASS' or probe.get('pass') is not True or len(checks) != len(r3_manifest['probe_expect']):
        return False
    for c, e in zip(checks, r3_manifest['probe_expect']):
        o = c.get('observed') or {}
        if c.get('ok') is not True or c.get('name') != e['name'] or o.get('status') != e['status'] or o.get('body') != e['body']:
            return False
    sec = core.get('secret') or {}
    return sec.get('name') == r3_manifest['secret_name'] and sec.get('remote') == 'PRESENT' and sec.get('keychain') == 'PRESENT'


def r3_acl_certified(core):
    if not core or core.get('mode') != 'apply':
        return False
    acl = (core.get('acl') or {})
    return acl.get('failures') == [] and acl.get('acl') is not None and r3_acl_failures(acl['acl']) == []


def r3_rollback_rehearsed(reh):
    if not reh or reh.get('pass') is not True or reh.get('rollback_sql_sha256') != r3_manifest['rollback_sql_sha256']:
        return False
    if {m['version']: m['apply_sql_sha256'] for m in reh.get('migrations', [])} != r3_apply_sql_pins:
        return False
    ph = reh.get('phases') or {}
    return reh.get('remote_requests') == 0 and reh.get('clone_dropped') is True and all(ph.get(k, {}).get('ok') is True for k in ('pins_and_lab', 'clone', 'ledger_shape', 'writer_privileges', 'cli_rows_round_trip', 'cli_rows_discrepancy_blocks', 'rollback_initial', 'apply', 'ledger', 'acl', 'rerun_idempotent', 'rollback', 'residue', 'catalog_unchanged', 'rollback_rerun_noop'))


def r3_d1_positive(d1p):
    if not d1p or d1p.get('pass') is not True or d1p.get('verdict') != 'D1_POSITIVE_PASS' or d1p.get('core_ref') != CORE_REF:
        return False
    steps = d1p.get('steps') or []
    if [s.get('status') for s in steps] != [200, 200, 204, 403] or not all(s.get('ok') is True for s in steps):
        return False
    return (d1p.get('qa_user') or {}).get('dedicated') is True and (d1p.get('session') or {}).get('present_after') is False


