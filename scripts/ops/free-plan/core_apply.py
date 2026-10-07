#!/usr/bin/env python3
"""INFRA-1.2 — Core Production writes for the Free-plan promotion, one pinned step at a time.

  plan                         prints every step with its file, sha256 and exact phrase (no connection)
  apply <step> --phrase "..."  runs ONE step on Core (psql, password typed at the prompt) and checks its result
  function-plan [--from-ref R] the torneos-core-contract files of commit R (default HEAD), with their sha256
  function-deploy --phrase ".." [--from-ref R]
                               deploys those exact bytes through the Management API (PAT typed at the prompt) and
                               checks the result. Staging stays paused on Free (two active projects: Core and Torneos):
                               the artifact is certified in the local lab instead. Rollback: --from-ref ffaf131c (INFRA-1)

Steps (supabase/ops/free-plan-capacity/ and supabase/migrations/):
  reindex                       01: rebuild notification_delivery_log's indexes (no row changes, no blocking)
  compact                       02: keep 7 days of the two operational logs (needs --verified-backup)
  migration-20261009120000      retention of those logs (daily, capped)
  migration-20261007120000      Core contract v1.2 (my_teams)
  migration-20261008120000      the account's push preference
  rollback-push-preference      the SAFE rollback of 20261008 (trigger off, client EXECUTE revoked; nothing deleted)

Every write needs the exact phrase `APPLY CORE <step> <ref> <sha12 of the file>`, the file's pinned sha256 and the
expected state before; it is checked after. Lab mode (--lab-port, loopback, LAB_PGPASSWORD) runs the same path on a
disposable copy. Nothing here runs by itself.
"""
import argparse
import datetime
import getpass
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ops_free_plan as ops  # noqa: E402

CORE_REF = ops.TARGETS['core']
LEDGER_BASE = ('20260914120000', '20260915120000')

STEPS = {
    'reindex': {'file': 'supabase/ops/free-plan-capacity/01-reindex-notification-delivery-log.sql',
                'sha256': '', 'kind': 'script'},
    'compact': {'file': 'supabase/ops/free-plan-capacity/02-compact-operational-logs.sql',
                'sha256': '', 'kind': 'script', 'needs_backup': True},
    'migration-20261009120000': {'file': 'supabase/migrations/20261009120000_core_ops_log_retention.sql',
                                 'sha256': '', 'kind': 'migration', 'version': '20261009120000', 'name': 'core_ops_log_retention',
                                 'post': """select json_build_object(
  'function', to_regprocedure('public.run_ops_log_retention(integer,integer,integer)') is not null,
  'no_client_execute', not has_function_privilege('anon', 'public.run_ops_log_retention(integer,integer,integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.run_ops_log_retention(integer,integer,integer)', 'EXECUTE'),
  'scheduled', exists (select 1 from cron.job where jobname = 'ops_log_retention_scheduler' and active and schedule = '41 3 * * *'),
  'reindex_scheduled', exists (select 1 from cron.job where jobname = 'ops_delivery_log_reindex' and active and schedule = '11 4 1 * *'))::text"""},
    'migration-20261007120000': {'file': 'supabase/migrations/20261007120000_torneos_core_contract_v1_2_my_teams.sql',
                                 'sha256': '', 'kind': 'migration', 'version': '20261007120000', 'name': 'torneos_core_contract_v1_2_my_teams',
                                 'post': """select json_build_object(
  'my_teams_branch', (select position('my_teams' in prosrc) > 0 from pg_proc where oid = 'public.torneos_contract_execute(text,text,jsonb)'::regprocedure),
  'service_role_only', has_function_privilege('service_role', 'public.torneos_contract_execute(text,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.torneos_contract_execute(text,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.torneos_contract_execute(text,text,jsonb)', 'EXECUTE'))::text"""},
    'migration-20261008120000': {'file': 'supabase/migrations/20261008120000_core_push_preference_v1.sql',
                                 'sha256': '', 'kind': 'migration', 'version': '20261008120000', 'name': 'core_push_preference_v1',
                                 'post': """select json_build_object(
  'trigger', exists (select 1 from pg_trigger where tgname = 'trg_notification_delivery_push_preference' and not tgisinternal),
  'clients', has_function_privilege('authenticated', 'public.get_my_push_preference()', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.set_my_push_preference(boolean)', 'EXECUTE'),
  'no_anon', not has_function_privilege('anon', 'public.set_my_push_preference(boolean)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_my_push_preference()', 'EXECUTE'))::text"""},
    'rollback-push-preference': {'file': 'supabase/rollbacks/20261008120000_core_push_preference_v1.safe.sql',
                                 'sha256': '', 'kind': 'script',
                                 'post': """select json_build_object(
  'trigger_off', not exists (select 1 from pg_trigger where tgname = 'trg_notification_delivery_push_preference' and not tgisinternal),
  'clients_off', not has_function_privilege('authenticated', 'public.set_my_push_preference(boolean)', 'EXECUTE'))::text"""},
}
# Pins (sha256 of each file at the commit that prepared this promotion; core_apply.test.mjs keeps them honest).
PINS = {
    'reindex': 'fe0e2b6d2ae22d1fa69f9f45912276d1a33f6721e032d33eca014c381e62c07d',
    'compact': 'd5a90b81e8c58c4beb796bfd9f44ee3dfbff076736da21d1f3cf1818c6d31599',
    'migration-20261009120000': '2d89251957ee2bf28c9d186b50fd162b151527a1d197c1e98e8a4ec888b2c59c',
    'migration-20261007120000': '61474a4996c95c3c7c35c9acde7479b1ffe6d92ce0ab10647475b1029f10605b',
    'migration-20261008120000': 'f20b8c49ef15ff674eaf3c832353d536dbc4566102f89b9d52b30622d051aec1',
    'rollback-push-preference': '322a7c9052e84b86aa3d4eac8db3a64e6b19774075f7aeaf4feb681e783619ca',
}
for _k, _v in PINS.items():
    STEPS[_k]['sha256'] = _v

# After a step: is the database writable, does pg_cron keep recording runs (and none failed), does the push tick log?
HEALTH_SQL = """select json_build_object(
  'read_only', current_setting('default_transaction_read_only'),
  'jobs_active', (select count(*) from cron.job where active),
  'cron_runs_since', (select count(*) from cron.job_run_details where start_time > :mark::timestamptz),
  'cron_failed_since', (select count(*) from cron.job_run_details where start_time > :mark::timestamptz and status = 'failed'),
  'push_tick_job_active', exists (select 1 from cron.job where jobname = 'push_sender_dispatch_scheduler' and active),
  'push_ticks_since', (select count(*) from public.push_sender_scheduler_runs where triggered_at > :mark::timestamptz))::jsonb::text"""

LEDGER_SQL = """select coalesce(json_agg(version order by version), '[]'::json)::text
from supabase_migrations.schema_migrations where version >= '20260914120000'"""


def phrase(step, ref):
    return f"APPLY CORE {step} {ref} {STEPS[step]['sha256'][:12]}"


def file_bytes(step):
    path = os.path.join(ops.REPO, STEPS[step]['file'])
    data = open(path, 'rb').read()
    if hashlib.sha256(data).hexdigest() != STEPS[step]['sha256']:
        ops.die(f"FILE_HASH_MISMATCH {STEPS[step]['file']}")
    return data.decode()


def cmd_plan(args):
    for step, s in STEPS.items():
        ok = hashlib.sha256(open(os.path.join(ops.REPO, s['file']), 'rb').read()).hexdigest() == s['sha256']
        print(f"{step:28} {s['file']}\n{'':28} sha256 {s['sha256']} {'OK' if ok else 'CHANGED'}\n{'':28} phrase: {phrase(step, CORE_REF)}")


def verified_backup(path, ref):
    """compact deletes log rows: it needs a database backup of this project, restore-checked, from the last 24 h."""
    if not path:
        ops.die('compact needs --verified-backup <folder> (ops_free_plan.py backup-db + restore-check)')
    record = json.load(open(os.path.join(path, 'MANIFEST.json')))
    if record.get('project_ref') != ref:
        ops.die(f"the backup is of {record.get('project_ref')}, not {ref}")
    created = datetime.datetime.strptime(record['created_at'], '%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc)
    if datetime.datetime.now(datetime.timezone.utc) - created > datetime.timedelta(hours=24):
        ops.die('the backup is older than 24 h: take a new one')
    checks = sorted(f for f in os.listdir(path) if f.startswith('RESTORE-CHECK-'))
    # The latest check decides, and it has to meet the strict criteria (pg_restore exit 0, no error, no difference):
    # a version-1 report could say VERIFIED with pg_restore errors.
    if not checks or not ops.strictly_verified(json.load(open(os.path.join(path, checks[-1])))):
        ops.die('the backup has no strict RESTORE VERIFIED check (pg_restore exit 0, no error, no difference)')
    for t in ('cron.job_run_details', 'public.push_sender_scheduler_runs'):
        if t not in (record['manifest'].get('tables') or {}):
            ops.die(f'the backup does not hold {t}')
    return {'backup': path, 'created_at': record['created_at'], 'restore_check': checks[-1]}


class WriteSession(ops.Psql):
    """Like ops.Psql but without the read-only default: this session writes."""

    def __init__(self, conn):
        env = conn.env()
        env.pop('PGOPTIONS', None)
        self.p = subprocess.Popen([f'{ops.LIBPQ}/psql', conn.conninfo, *conn.prompt_flag(), '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, text=True, bufsize=1)

    def close(self):
        try:
            self.p.stdin.write('\\q\n')
            self.p.stdin.flush()
        except BrokenPipeError:
            pass
        self.p.wait(timeout=60)


def cmd_apply(args):
    conn = ops.Connection(argparse.Namespace(target='core', lab_port=args.lab_port))
    step = args.step
    if step not in STEPS:
        ops.die(f'unknown step; one of {", ".join(STEPS)}')
    ref = conn.ref
    expected = phrase(step, ref)
    if args.phrase != expected:
        ops.die(f'PHRASE_REQUIRED: {expected}')
    spec = STEPS[step]
    sql = file_bytes(step)
    evidence = {'step': step, 'target': conn.label, 'file': spec['file'], 'sha256': spec['sha256'], 'at': ops.now_stamp()}
    if spec.get('needs_backup'):
        evidence['backup'] = verified_backup(os.path.abspath(args.verified_backup) if args.verified_backup else None, ref)
    session = WriteSession(conn)
    logs_sql = open(os.path.join(ops.REPO, 'supabase/ops/free-plan-capacity/inspect-core-logs.sql')).read()
    if session.run("select to_regclass('supabase_migrations.schema_migrations') is not null").splitlines()[-1] != 't':
        ops.die('Core ledger missing', 1)
    ledger = json.loads(session.run(LEDGER_SQL).splitlines()[-1])
    evidence['ledger_before'] = ledger
    if not all(v in ledger for v in LEDGER_BASE):
        ops.die(f'ledger does not hold {LEDGER_BASE}: {ledger}', 1)
    unknown = [v for v in ledger if v not in LEDGER_BASE and f'migration-{v}' not in STEPS]
    if unknown:
        ops.die(f'ledger has versions this runner does not know: {unknown}', 1)
    if spec['kind'] == 'migration' and spec['version'] in ledger:
        ops.die(f"{spec['version']} is already in the ledger", 1)
    if step == 'rollback-push-preference' and '20261008120000' not in ledger:
        ops.die('20261008120000 is not applied: nothing to roll back', 1)
    evidence['before'] = json.loads(session.run(logs_sql).splitlines()[-1])
    started = datetime.datetime.now(datetime.timezone.utc)
    session.run(sql)
    if spec['kind'] == 'migration':
        tag = f'ledger_{secrets.token_hex(4)}'
        session.run(f"insert into supabase_migrations.schema_migrations (version, name, statements) "
                    f"values ('{spec['version']}', '{spec['name']}', array[${tag}${sql}${tag}$])")
    evidence['seconds'] = round((datetime.datetime.now(datetime.timezone.utc) - started).total_seconds(), 2)
    evidence['after'] = json.loads(session.run(logs_sql).splitlines()[-1])
    if spec.get('post'):
        evidence['post'] = json.loads(session.run(spec['post']).splitlines()[-1])
    evidence['ledger_after'] = json.loads(session.run(LEDGER_SQL).splitlines()[-1])
    if args.verify_wait:
        # Production keeps working after the step: wait, then see pg_cron and the push tick write again, without failures.
        mark = session.run('select now()').splitlines()[-1].strip()
        time.sleep(args.verify_wait)
        evidence['health'] = json.loads(session.run(HEALTH_SQL.replace(':mark', ops.quote_literal(mark))).splitlines()[-1])
        evidence['health']['waited_s'] = args.verify_wait
    session.close()
    failures = [k for k, v in (evidence.get('post') or {}).items() if v is not True]
    h = evidence.get('health')
    if h is not None:
        if h['read_only'] != 'off':
            failures.append('read_only')
        if h['cron_runs_since'] == 0:
            failures.append('cron_not_writing')
        if h['cron_failed_since'] > 0:
            failures.append('cron_failures_after_step')
        if h['push_tick_job_active'] and h['push_ticks_since'] == 0:
            failures.append('push_tick_not_writing')
    if spec['kind'] == 'migration' and spec['version'] not in evidence['ledger_after']:
        failures.append('ledger_row_missing')
    if step == 'reindex' and evidence['after']['notification_delivery_log']['indexes'] > evidence['before']['notification_delivery_log']['indexes']:
        failures.append('indexes_grew')
    if step == 'compact':
        for t, key in (('cron_job_run_details', 'last_7d'), ('push_sender_scheduler_runs', 'last_7d')):
            if evidence['after'][t]['rows'] < evidence['before'][t][key]:
                failures.append(f'{t}_lost_recent_rows')
    evidence['verdict'] = f"{step.upper()}_{'DONE' if not failures else 'FAILED'}"
    evidence['failures'] = failures
    mb = lambda b: round(b / 1048576, 1)
    if args.evidence:
        with open(args.evidence, 'w') as f:
            json.dump(evidence, f, indent=1, default=str)
        os.chmod(args.evidence, 0o600)
    print(json.dumps(evidence, indent=1, default=str))
    print(f"{evidence['verdict']}: database {mb(evidence['before']['database_bytes'])} -> {mb(evidence['after']['database_bytes'])} MB "
          f"in {evidence['seconds']} s{'; failures: ' + ', '.join(failures) if failures else ''}")
    sys.exit(0 if not failures else 1)


# ───────────────────────────── torneos-core-contract (Management API) ─────────────────────────────
# On the Free plan the Staging project (hhyvmhgpapyuzjgxfnqv) stays paused: only two projects may be active and they are
# Core and Torneos. So the artifact is certified in the local lab (same edge-runtime; rehearsal S2/S5) and deployed to
# Production pinned by the bytes of a git commit. Rolling back = deploying the INFRA-1 artifact (main ffaf131c).
FUNCTION = {'slug': 'torneos-core-contract', 'root': 'supabase', 'entrypoint': 'functions/torneos-core-contract/index.ts', 'verify_jwt': False}
IMPORT = re.compile(r'''(?:import|export)[^'"]*?from\s+['"](\.{1,2}/[^'"]+)['"]|import\(\s*['"](\.{1,2}/[^'"]+)['"]\s*\)''')


def git_bytes(ref, rel):
    r = subprocess.run(['git', '-C', ops.REPO, 'cat-file', 'blob', f"{ref}:{FUNCTION['root']}/{rel}"], capture_output=True)
    if r.returncode != 0:
        ops.die(f'{ref}:{rel} not in git: {r.stderr.decode().strip()[-200:]}')
    return r.stdout


def function_files(ref):
    """The entrypoint and every file it reaches through relative imports, read from the commit `ref` (never the
    working tree), as the bundler sees them."""
    commit = subprocess.run(['git', '-C', ops.REPO, 'rev-parse', '--verify', f'{ref}^{{commit}}'], capture_output=True, text=True)
    if commit.returncode != 0:
        ops.die(f'unknown git ref {ref}')
    seen, queue = {}, [FUNCTION['entrypoint']]
    while queue:
        rel = os.path.normpath(queue.pop())
        if rel in seen:
            continue
        data = git_bytes(ref, rel)
        seen[rel] = data
        for m in IMPORT.finditer(data.decode()):
            queue.append(os.path.normpath(os.path.join(os.path.dirname(rel), m.group(1) or m.group(2))))
    files = [{'path': p, 'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest(), 'data': b} for p, b in sorted(seen.items())]
    return commit.stdout.strip(), files


def artifact_digest(files):
    return hashlib.sha256('\n'.join(f"{f['path']}:{f['sha256']}" for f in files).encode()).hexdigest()


def serves_my_teams(files):
    return any(b'/v1/my-teams' in f['data'] or b"'my-teams'" in f['data'] or b'"my-teams"' in f['data'] for f in files)


def cmd_function_plan(args):
    commit, files = function_files(args.from_ref)
    for f in files:
        print(f"{f['path']:48} {f['bytes']:>6} B  {f['sha256']}")
    d = artifact_digest(files)
    print(f"commit {commit}\nartifact {d} (my-teams route: {'yes' if serves_my_teams(files) else 'no'})")
    print(f'phrase: DEPLOY CORE FUNCTION {CORE_REF} {d[:12]}')


def mgmt(pat, method, path, body=None, content_type='application/json'):
    req = urllib.request.Request(f'https://api.supabase.com/v1{path}', data=body, method=method,
                                 headers={'Authorization': f'Bearer {pat}', 'Content-Type': content_type, 'User-Agent': 'arma2-infra-1.2'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors='replace')[:300]


def cmd_function_deploy(args):
    commit, files = function_files(args.from_ref)
    digest = artifact_digest(files)
    expected = f'DEPLOY CORE FUNCTION {CORE_REF} {digest[:12]}'
    if args.phrase != expected:
        ops.die(f'PHRASE_REQUIRED: {expected}')
    ops.tty_check()
    pat = getpass.getpass('Supabase personal access token (no se guarda): ')
    out = {'ref': CORE_REF, 'commit': commit, 'artifact': digest, 'at': ops.now_stamp(),
           'files': [{k: f[k] for k in ('path', 'bytes', 'sha256')} for f in files]}
    status, before = mgmt(pat, 'GET', f"/projects/{CORE_REF}/functions/{FUNCTION['slug']}")
    out['before'] = {k: before.get(k) for k in ('version', 'ezbr_sha256', 'verify_jwt', 'updated_at')} if status == 200 else status
    boundary = 'a2boundary' + secrets.token_hex(24)
    metadata = {'name': FUNCTION['slug'], 'entrypoint_path': FUNCTION['entrypoint'], 'verify_jwt': FUNCTION['verify_jwt']}
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n{json.dumps(metadata)}\n\r\n'.encode()]
    for f in files:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{f["path"]}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode())
        parts += [f['data'], b'\r\n']
    parts.append(f'--{boundary}--\r\n'.encode())
    status, deployed = mgmt(pat, 'POST', f"/projects/{CORE_REF}/functions/deploy?slug={FUNCTION['slug']}", b''.join(parts),
                            f'multipart/form-data; boundary={boundary}')
    pat = None
    if status not in (200, 201):
        ops.die(f'deploy failed: {status} {deployed}', 1)
    out['after'] = {k: deployed.get(k) for k in ('version', 'ezbr_sha256', 'verify_jwt', 'updated_at')}
    # Unsigned request to the my-teams route: 401 when the artifact serves it (v1.2), 404 when it does not (INFRA-1).
    want = 401 if serves_my_teams(files) else 404
    req = urllib.request.Request(f"https://{CORE_REF}.supabase.co/functions/v1/{FUNCTION['slug']}/v1/my-teams", data=b'{}', method='POST',
                                 headers={'Content-Type': 'application/json'})
    try:
        urllib.request.urlopen(req, timeout=60)
        out['unsigned_my_teams'] = 200
    except urllib.error.HTTPError as e:
        out['unsigned_my_teams'] = e.code
    failures = [] if out['unsigned_my_teams'] == want else [f'unsigned_my_teams_{out["unsigned_my_teams"]}_expected_{want}']
    if out['after'].get('verify_jwt') is not False:
        failures.append('verify_jwt_not_false')
    out['verdict'] = f"FUNCTION_DEPLOY_{'DONE' if not failures else 'FAILED'}"
    out['failures'] = failures
    print(json.dumps(out, indent=1))
    print('Next: the signed harness (backend/torneos/infra/core-prod-contract/probe-prod.mjs) with the contract secret, run by the operator.')
    sys.exit(0 if not failures else 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('plan')
    p = sub.add_parser('apply')
    p.add_argument('step')
    p.add_argument('--phrase', default='')
    p.add_argument('--lab-port', type=int)
    p.add_argument('--verified-backup')
    p.add_argument('--verify-wait', type=int, default=0, help='seconds to wait after the step and check that cron and the push tick keep writing')
    p.add_argument('--evidence', help='also write the evidence JSON to this file')
    p = sub.add_parser('function-plan')
    p.add_argument('--from-ref', default='HEAD')
    p = sub.add_parser('function-deploy')
    p.add_argument('--from-ref', default='HEAD', help='git commit whose bytes are deployed (rollback: ffaf131c, INFRA-1)')
    p.add_argument('--phrase', default='')
    args = ap.parse_args()
    {'plan': cmd_plan, 'apply': cmd_apply, 'function-plan': cmd_function_plan, 'function-deploy': cmd_function_deploy}[args.cmd](args)


if __name__ == '__main__':
    main()
