#!/usr/bin/env python3
"""Free-plan operations for Arma2 Core and Torneos (Supabase Free: no scheduled backups, no PITR, 500 MB per database).

  inspect        read-only size report of a project (supabase/ops/free-plan-capacity/inspect*.sql)
  backup-db      encrypted pg_dump of a project + a manifest taken in the SAME snapshot (rows, row hashes, functions,
                 grants, policies, triggers) + the project's own roles (no passwords)
  restore-check  decrypts a backup inside a disposable Supabase Postgres container (no network), restores it into an
                 empty database and compares every table and catalog digest with the manifest
  backup-storage every Storage object of a project with its checksums, in one encrypted tar
  storage-check  decrypts a Storage backup in memory and checks every file against its manifest
  storage-restore uploads a Storage backup back (only missing objects, never overwrites) and verifies each file by
                 downloading it; Production needs the exact phrase

Production is only READ here. The database password is asked by psql/pg_dump themselves on /dev/tty; the backup
passphrase and the service key are read by this tool from /dev/tty and handed to gpg through an anonymous pipe or kept in
memory. None of them reaches argv, the environment, a file or a log, and decrypted data never touches the disk (the
restore check decrypts inside a disposable container; Storage files go from memory straight into the encrypted tar).
Lab mode (--lab-port / --lab-storage-url, loopback only) takes them from LAB_PGPASSWORD / LAB_BACKUP_PASSPHRASE /
LAB_SERVICE_KEY so the whole path can be rehearsed without a person; it refuses any non-loopback host.
"""
import argparse
import datetime
import getpass
import hashlib
import io
import json
import os
import re
import secrets
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
LIBPQ = '/opt/homebrew/opt/libpq/bin'
GPG = '/opt/homebrew/bin/gpg'
DOCKER = '/Applications/Docker.app/Contents/Resources/bin/docker'
CA = '/Users/nicoavayu/Downloads/prod-ca-2021.crt'
CA_SHA256_PREFIX = '700723581420dd1a'
POOLER = 'aws-0-sa-east-1.pooler.supabase.com'
TARGETS = {'core': 'rcyuuoaqfwcembdajcss', 'torneos': 'onzpwnqxnvlgsevivngf'}
RESTORE_IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.143'
CHUNK = 1 << 16

# Roles every Supabase project already has; a backup records only the project's own roles (without passwords).
PLATFORM_ROLES = re.compile(r'^(pg_|supabase|postgres$|authenticator$|anon$|authenticated$|service_role$|pgbouncer$|'
                            r'dashboard_user$|pgsodium|cli_login_)')

ROLES_QUERY = """select coalesce(json_agg(json_build_object('name', r.rolname, 'login', r.rolcanlogin, 'inherit', r.rolinherit,
  'bypassrls', r.rolbypassrls, 'config', r.rolconfig,
  'member_of', (select coalesce(json_agg(g.rolname order by g.rolname), '[]'::json)
                from pg_auth_members m join pg_roles g on g.oid = m.roleid where m.member = r.oid))
  order by r.rolname), '[]'::json)::text from pg_roles r"""


def die(message, code=2):
    print(f'STOP: {message}', file=sys.stderr)
    sys.exit(code)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(CHUNK), b''):
            h.update(block)
    return h.hexdigest()


def now_stamp():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')


def tty_check():
    try:
        with open('/dev/tty'):
            pass
    except OSError:
        die('this step needs a real terminal (run it in Terminal.app)')


def read_secret(prompt, env_name, lab, confirm=False):
    if lab:
        value = os.environ.get(env_name)
        if not value:
            die(f'lab mode needs {env_name}')
        return value
    tty_check()
    value = getpass.getpass(prompt)
    if len(value) < 12:
        die('at least 12 characters')
    if confirm and getpass.getpass('Repetir: ') != value:
        die('the two entries differ')
    return value


class Connection:
    """Production: session pooler + verify-full + pinned CA; psql/pg_dump prompt for the password. Lab: loopback only."""

    def __init__(self, args):
        self.lab = args.lab_port is not None
        if self.lab:
            self.label, self.ref = f'lab:{args.lab_port}', 'lab'
            dbname = os.environ.get('LAB_PGDATABASE', 'postgres')
            if not re.fullmatch(r'[a-z_][a-z0-9_]*', dbname):
                die('LAB_PGDATABASE must be a plain database name')
            self.conninfo = f'host=127.0.0.1 port={int(args.lab_port)} user=postgres dbname={dbname} connect_timeout=10'
            self.lab_password = os.environ.get('LAB_PGPASSWORD') or die('lab mode needs LAB_PGPASSWORD')
        else:
            if args.target not in TARGETS:
                die('--target core|torneos')
            if not os.path.exists(CA) or not sha256_file(CA).startswith(CA_SHA256_PREFIX):
                die(f'pinned CA missing or changed: {CA}')
            for name in ('PGPASSWORD', 'PGPASSFILE', 'PGSERVICEFILE'):
                if os.environ.get(name):
                    die(f'{name} is set: unset it, the password is typed at the prompt')
            self.ref = TARGETS[args.target]
            self.label = f'{args.target}:{self.ref}'
            self.conninfo = (f'host={POOLER} port=5432 user=postgres.{self.ref} dbname=postgres sslmode=verify-full '
                             f'sslrootcert={CA} connect_timeout=15')
            self.lab_password = None

    def env(self):
        env = {'PATH': '/usr/bin:/bin', 'HOME': os.environ.get('HOME', '/tmp'), 'LANG': 'C', 'PGTZ': 'UTC',
               'PGAPPNAME': 'arma2-ops-free-plan', 'PGOPTIONS': '-c default_transaction_read_only=on'}
        if self.lab:
            env['PGPASSWORD'] = self.lab_password
        return env

    def prompt_flag(self):
        if self.lab:
            return []
        tty_check()
        return ['--password']


class Psql:
    """One psql session kept open, so the manifest and pg_dump read the same exported snapshot."""

    def __init__(self, conn):
        self.p = subprocess.Popen([f'{LIBPQ}/psql', conn.conninfo, *conn.prompt_flag(), '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  env=conn.env(), text=True, bufsize=1)

    def run(self, sql):
        marker = f'__ops_{secrets.token_hex(6)}__'
        self.p.stdin.write(sql.rstrip().rstrip(';') + ';\n\\echo ' + marker + '\n')
        self.p.stdin.flush()
        lines = []
        while True:
            line = self.p.stdout.readline()
            if line == '':
                die(f'psql ended: {self.p.stderr.read().strip()[-400:]}', 1)
            if line.strip() == marker:
                return '\n'.join(lines).strip()
            lines.append(line.rstrip('\n'))

    def last_json(self, sql):
        return json.loads(self.run(sql).splitlines()[-1])

    def close(self):
        try:
            self.p.stdin.write('commit;\n\\q\n')
            self.p.stdin.flush()
        except BrokenPipeError:
            pass
        self.p.wait(timeout=60)


def gpg(mode, path, passphrase, **popen):
    """gpg symmetric AES256; the passphrase goes through an anonymous pipe (--passphrase-fd), no agent cache."""
    rfd, wfd = os.pipe()
    os.write(wfd, passphrase.encode() + b'\n')
    os.close(wfd)
    argv = [GPG, '--batch', '--quiet', '--no-symkey-cache', '--pinentry-mode', 'loopback', '--passphrase-fd', str(rfd)]
    argv += (['--yes', '--symmetric', '--cipher-algo', 'AES256', '--compress-algo', 'none', '--output', path]
             if mode == 'encrypt' else ['--decrypt', path])
    proc = subprocess.Popen(argv, pass_fds=(rfd,), **popen)
    os.close(rfd)
    return proc


class HashingWriter(io.RawIOBase):
    """Writes through to `sink` while hashing what passes (the plaintext)."""

    def __init__(self, sink):
        self.sink, self.h, self.size = sink, hashlib.sha256(), 0

    def writable(self):
        return True

    def write(self, b):
        self.h.update(b)
        self.size += len(b)
        self.sink.write(b)
        return len(b)


def encrypt_stream(source, dest_path, passphrase):
    proc = gpg('encrypt', dest_path, passphrase, stdin=subprocess.PIPE)
    w = HashingWriter(proc.stdin)
    for block in iter(lambda: source.read(CHUNK), b''):
        w.write(block)
    proc.stdin.close()
    if proc.wait() != 0:
        die('gpg encryption failed', 1)
    return w.h.hexdigest(), w.size


def decrypt_stream(path, passphrase, sink):
    proc = gpg('decrypt', path, passphrase, stdout=subprocess.PIPE)
    w = HashingWriter(sink)
    for block in iter(lambda: proc.stdout.read(CHUNK), b''):
        w.write(block)
    if proc.wait() != 0:
        die('gpg decryption failed (wrong passphrase or damaged file)', 1)
    return w.h.hexdigest(), w.size


def quote_ident(s):
    return '"' + s.replace('"', '""') + '"'


def quote_literal(s):
    return "'" + s.replace("'", "''") + "'"


def roles_sql(roles):
    out = []
    for r in roles:
        attrs = ['LOGIN' if r['login'] else 'NOLOGIN', 'INHERIT' if r['inherit'] else 'NOINHERIT',
                 'BYPASSRLS' if r['bypassrls'] else 'NOBYPASSRLS']
        out.append(f"do $r$ begin if not exists (select 1 from pg_roles where rolname = {quote_literal(r['name'])}) then "
                   f"create role {quote_ident(r['name'])} {' '.join(attrs)}; end if; end $r$;")
        for cfg in r.get('config') or []:
            key, _, value = cfg.partition('=')
            out.append(f'alter role {quote_ident(r["name"])} set {key} = {quote_literal(value)};')
    for r in roles:
        for parent in r.get('member_of') or []:
            out.append(f'grant {quote_ident(parent)} to {quote_ident(r["name"])};')
    return '\n'.join(out) + '\n'


def new_folder(path):
    out = os.path.abspath(path)
    if out.startswith(REPO + os.sep):
        die('backups never go inside the repository')
    if os.path.exists(out):
        die(f'{out} exists: every backup goes to a new folder')
    os.makedirs(out, mode=0o700)
    return out


def seal(out):
    for name in os.listdir(out):
        os.chmod(os.path.join(out, name), 0o600)


def cmd_inspect(args):
    conn = Connection(args)
    files = ['supabase/ops/free-plan-capacity/inspect.sql']
    if args.target == 'core' or args.core_logs:
        files.append('supabase/ops/free-plan-capacity/inspect-core-logs.sql')
    argv = [f'{LIBPQ}/psql', conn.conninfo, *conn.prompt_flag(), '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1']
    for rel in files:
        argv += ['-f', os.path.join(REPO, rel)]
    r = subprocess.run(argv, env=conn.env(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if r.returncode != 0:
        die(f'inspect: {r.stderr.strip()[-400:]}', 1)
    lines = [l for l in r.stdout.strip().splitlines() if l.startswith('{')]
    report = {'target': conn.label, 'at': now_stamp()}
    for rel, line in zip(files, lines):
        report[os.path.basename(rel)] = json.loads(line)
    print(json.dumps(report, indent=1))


def cmd_backup_db(args):
    conn = Connection(args)
    passphrase = read_secret('Passphrase del backup (no se guarda; sin ella no se restaura): ', 'LAB_BACKUP_PASSPHRASE', conn.lab, confirm=True)
    out = new_folder(args.out)
    started = time.time()
    psql = Psql(conn)
    psql.run("set timezone = 'UTC'; set extra_float_digits = 1")
    psql.run('begin isolation level repeatable read read only')
    snapshot = psql.run('select pg_export_snapshot()').splitlines()[-1].strip()
    if not re.fullmatch(r'[0-9A-F]+-[0-9A-F]+-[0-9]+', snapshot):
        die(f'unexpected snapshot id {snapshot!r}', 1)
    source = psql.last_json("select json_build_object('database', current_database(), 'server_version', current_setting('server_version'), "
                            "'database_bytes', pg_database_size(current_database()), 'at', now())::text")
    manifest = psql.last_json(open(os.path.join(HERE, 'sql', 'manifest.sql')).read())
    roles = [r for r in psql.last_json(ROLES_QUERY) if not PLATFORM_ROLES.match(r['name'])]
    dump = subprocess.Popen([f'{LIBPQ}/pg_dump', conn.conninfo, *conn.prompt_flag(), '--format=custom', '--compress=6',
                             f'--snapshot={snapshot}', '--no-sync'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=conn.env())
    plain_sha, plain_bytes = encrypt_stream(dump.stdout, os.path.join(out, 'database.dump.gpg'), passphrase)
    err = dump.stderr.read().decode(errors='replace')
    if dump.wait() != 0:
        die(f'pg_dump failed (folder left for inspection: {out}): {err.strip()[-600:]}', 1)
    psql.close()
    with open(os.path.join(out, 'roles.sql'), 'w') as f:
        f.write(roles_sql(roles))
    record = {
        'kind': 'arma2-free-plan-database-backup', 'version': 1, 'target': conn.label, 'project_ref': conn.ref,
        'created_at': now_stamp(), 'seconds': round(time.time() - started, 1), 'snapshot': snapshot, 'source': source,
        'pg_dump': subprocess.run([f'{LIBPQ}/pg_dump', '--version'], capture_output=True, text=True).stdout.strip(),
        'artifact': {'file': 'database.dump.gpg', 'format': 'pg_dump custom (compress 6), gpg AES256 symmetric',
                     'plaintext_sha256': plain_sha, 'plaintext_bytes': plain_bytes,
                     'ciphertext_sha256': sha256_file(os.path.join(out, 'database.dump.gpg'))},
        'roles': [r['name'] for r in roles], 'roles_sql_sha256': sha256_file(os.path.join(out, 'roles.sql')),
        'manifest': manifest,
    }
    with open(os.path.join(out, 'MANIFEST.json'), 'w') as f:
        json.dump(record, f, indent=1)
    seal(out)
    tables = manifest['tables'] or {}
    print(f"BACKUP COMPLETE {conn.label}: {len(tables)} tables, {sum(t['rows'] for t in tables.values())} rows, "
          f"{round(plain_bytes / 1048576, 1)} MB dump, snapshot {snapshot} -> {out}")
    print(f'Next: python3 {os.path.relpath(os.path.abspath(__file__), REPO)} restore-check --backup {out}')


def docker(*argv, **kw):
    return subprocess.run([DOCKER, *argv], **kw)


# Role names a dump's DDL refers to: owners, ACL grantees and grantors (pg_dump runs a grant whose grantor is not the
# owner under SET SESSION AUTHORIZATION), default privileges and policies. PUBLIC is not a role.
_ROLE = r'(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)'
_ROLE_LIST = rf'({_ROLE}(?:\s*,\s*{_ROLE})*)'
ROLE_REFERENCES = [
    re.compile(rf'\bOWNER TO {_ROLE_LIST}\s*;'),
    re.compile(rf'^SET SESSION AUTHORIZATION {_ROLE_LIST}\s*;', re.M),
    re.compile(rf'\bFOR ROLE {_ROLE_LIST}\s+(?:IN SCHEMA|GRANT|REVOKE)\b'),
    re.compile(rf'^(?:ALTER DEFAULT PRIVILEGES .*?)?GRANT .+? TO {_ROLE_LIST}(?: WITH (?:GRANT|ADMIN) OPTION)?(?: GRANTED BY {_ROLE})?\s*;$', re.M),
    re.compile(rf'^(?:ALTER DEFAULT PRIVILEGES .*?)?REVOKE .+? FROM {_ROLE_LIST}(?: GRANTED BY {_ROLE})?(?: CASCADE| RESTRICT)?\s*;$', re.M),
    re.compile(rf'^CREATE POLICY .+? TO {_ROLE_LIST}(?=\s+USING\b|\s+WITH CHECK\b|\s*;)', re.M | re.S),
]


def referenced_roles(ddl):
    found = set()
    for pattern in ROLE_REFERENCES:
        for m in pattern.finditer(ddl):
            for token in re.findall(_ROLE, m.group(1)):
                if token.startswith('"'):
                    found.add(token[1:-1].replace('""', '"'))
                elif token.upper() != 'PUBLIC':
                    found.add(token)
    return found


def restore_errors_with_context(stderr):
    """Each pg_restore error with its TOC entry and the failed command (pg_restore writes them on separate lines)."""
    blocks = []
    for line in stderr.splitlines():
        if line.startswith('pg_restore: ') or not blocks:
            blocks.append([line])
        else:
            blocks[-1].append(line)
    errors, toc = [], None
    for block in blocks:
        text = '\n'.join(l for l in block if l.strip())
        if block[0].startswith('pg_restore: from TOC entry'):
            toc = text
        elif block[0].startswith('pg_restore: error'):
            errors.append(((toc + '\n') if toc else '') + text)
            toc = None
    return [e[:800] for e in errors]


def restore_verdict(pg_restore_exit, errors, differences):
    """VERIFIED needs all three: pg_restore exited 0, it reported no error, and nothing differs from the manifest."""
    if pg_restore_exit != 0 or errors:
        return 'RESTORE FAILED'
    if differences:
        return 'RESTORE MISMATCH'
    return 'RESTORE VERIFIED'


def strictly_verified(check):
    """A restore-check report that proves the backup restores: version-2 report with the strict criteria all met."""
    return (check.get('version') == 2 and check.get('verdict') == 'RESTORE VERIFIED' and check.get('pg_restore_exit') == 0
            and check.get('restore_error_count') == 0 and not check.get('restore_errors') and check.get('differences') == []
            and all(step.get('exit') == 0 for step in check.get('steps') or [{'exit': 1}]))


def cmd_restore_check(args):
    """Restores a backup in a disposable container and compares it with its manifest.

    RESTORE VERIFIED only when every preparation command succeeded, pg_restore exited 0 with no error, and every table
    and catalog digest equals the manifest. A step that fails stops the check (no verdict file is written then).
    """
    backup = os.path.abspath(args.backup)
    record = json.load(open(os.path.join(backup, 'MANIFEST.json')))
    if sha256_file(os.path.join(backup, record['artifact']['file'])) != record['artifact']['ciphertext_sha256']:
        die('ciphertext hash differs from MANIFEST.json', 1)
    if sha256_file(os.path.join(backup, 'roles.sql')) != record['roles_sql_sha256']:
        die('roles.sql hash differs from MANIFEST.json', 1)
    passphrase = read_secret('Passphrase del backup: ', 'LAB_BACKUP_PASSPHRASE', record['target'].startswith('lab:'))
    name, pw, started = f'arma2-restore-check-{secrets.token_hex(4)}', secrets.token_hex(16), time.time()
    steps = []

    def must(label, result, detail=''):
        steps.append({'step': label, 'exit': result.returncode})
        if result.returncode != 0:
            err = (getattr(result, 'stderr', '') or '')
            err = err.decode(errors='replace') if isinstance(err, bytes) else err
            die(f'{label} failed (exit {result.returncode}){": " + detail if detail else ""} {err.strip()[-400:]}', 1)
        return result

    # Empty database in a disposable container without network; pg_cron may only be created in cron.database_name, and
    # the restored jobs must not run there (they would add rows while the copy is being compared).
    must('docker run', docker('run', '-d', '--name', name, '--network', 'none', '-e', f'POSTGRES_PASSWORD={pw}', args.image,
                              'postgres', '-D', '/etc/postgresql', '-c', 'cron.database_name=restore_check',
                              '-c', 'cron.launch_active_jobs=off', capture_output=True, text=True))
    try:
        ready = False
        for _ in range(90):
            if docker('exec', name, 'pg_isready', '-U', 'postgres', '-h', 'localhost', capture_output=True).returncode == 0:
                ready = True
                break
            time.sleep(2)
        steps.append({'step': 'pg_isready', 'exit': 0 if ready else 1})
        if not ready:
            die('the restore container never became ready', 1)
        time.sleep(4)

        def psql(db, user, *argv, stdin=None):
            return docker('exec', '-i', '-e', f'PGPASSWORD={pw}', name, 'psql', '-h', 'localhost', '-U', user, '-d', db,
                          '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', *argv, input=stdin, capture_output=True, text=True)

        must('create database', psql('postgres', 'supabase_admin', '-c', 'create database restore_check'))
        sink = subprocess.Popen([DOCKER, 'exec', '-i', name, 'sh', '-c', 'umask 077; cat > /tmp/database.dump'],
                                stdin=subprocess.PIPE, stderr=subprocess.PIPE)
        plain_sha, _ = decrypt_stream(os.path.join(backup, record['artifact']['file']), passphrase, sink.stdin)
        sink.stdin.close()
        steps.append({'step': 'copy dump into the container', 'exit': sink.wait()})
        if steps[-1]['exit'] != 0:
            die(f'copying the dump into the container failed: {sink.stderr.read().decode(errors="replace")[-300:]}', 1)
        if plain_sha != record['artifact']['plaintext_sha256']:
            die('the decrypted dump differs from the hash taken while it was written', 1)

        # Roles. The project's own roles come from the backup (roles.sql). Platform roles are not in a backup: each
        # Supabase project has them, but some are created by platform services (Realtime: supabase_realtime_admin,
        # Functions: supabase_functions_admin), not by the Postgres image, so the restore image may lack them. Every
        # role the dump's DDL names must exist before pg_restore, or the objects it owns are left to the restoring
        # superuser and their owner and ACL grantor change. The missing platform ones are created here, inside the
        # disposable container only, as plain NOLOGIN NOINHERIT roles without password or membership: pg_dump never
        # writes role attributes or memberships, and everything the dump does with them (ALTER ... OWNER TO, GRANT under
        # SET SESSION AUTHORIZATION) is run by the restoring superuser. Any other missing role stops the check.
        must('roles.sql', psql('restore_check', 'supabase_admin', stdin=open(os.path.join(backup, 'roles.sql')).read()))
        ddl = must('list the dump DDL', docker('exec', name, 'pg_restore', '--schema-only', '--file=-', '/tmp/database.dump',
                                                capture_output=True, text=True)).stdout
        referenced = referenced_roles(ddl)
        existing = set(must('read roles', psql('restore_check', 'supabase_admin', '-c',
                                               'select rolname from pg_roles')).stdout.split())
        missing = sorted(referenced - existing)
        unexpected = [r for r in missing if not PLATFORM_ROLES.match(r)]
        if unexpected:
            die(f'the dump names roles that are neither in the backup nor platform roles: {unexpected}', 1)
        provisioned = []
        for role in missing:
            must(f'create platform role {role}', psql('restore_check', 'supabase_admin', '-c',
                                                      f'create role {quote_ident(role)} nologin noinherit'))
            provisioned.append({'role': role, 'attributes': 'NOLOGIN NOINHERIT, no password, no membership',
                                'scope': 'disposable restore container only'})
        existing = set(must('read roles', psql('restore_check', 'supabase_admin', '-c',
                                               'select rolname from pg_roles')).stdout.split())
        if referenced - existing:
            die(f'roles still missing before pg_restore: {sorted(referenced - existing)}', 1)

        restore = docker('exec', '-e', f'PGPASSWORD={pw}', name, 'pg_restore', '-h', 'localhost', '-U', 'supabase_admin',
                         '-d', 'restore_check', '/tmp/database.dump', capture_output=True, text=True)
        steps.append({'step': 'pg_restore', 'exit': restore.returncode})
        errors = restore_errors_with_context(restore.stderr)
        r = must('manifest on the restored copy', psql('restore_check', 'postgres', '-c', "set timezone = 'UTC'",
                                                       '-c', 'set extra_float_digits = 1',
                                                       '-c', open(os.path.join(HERE, 'sql', 'manifest.sql')).read()))
        restored = json.loads(r.stdout.strip().splitlines()[-1])
        expected = record['manifest']
        diffs = [{'table': k, 'backup': v, 'restored': (restored['tables'] or {}).get(k)}
                 for k, v in (expected['tables'] or {}).items() if (restored['tables'] or {}).get(k) != v]
        extra = sorted(set(restored['tables'] or {}) - set(expected['tables'] or {}))
        diffs += [{'table': k, 'backup': None, 'restored': restored['tables'][k]} for k in extra]
        diffs += [{'catalog': k, 'backup': expected[k], 'restored': restored[k]}
                  for k in ('functions', 'policies', 'triggers', 'table_acl') if expected[k] != restored[k]]
        # A catalog digest only says "different": keep the restored per-object state so a difference can be explained.
        detail = None
        if any('catalog' in d for d in diffs):
            r = must('catalog detail on the restored copy', psql('restore_check', 'postgres', '-c',
                                                                open(os.path.join(HERE, 'sql', 'catalog-detail.sql')).read()))
            detail = json.loads(r.stdout.strip().splitlines()[-1])
    finally:
        docker('rm', '-f', name, capture_output=True)
    verdict = restore_verdict(restore.returncode, errors, diffs)
    result = {
        'kind': 'arma2-free-plan-restore-check', 'version': 2, 'backup': backup, 'checked_at': now_stamp(), 'image': args.image,
        'seconds': round(time.time() - started, 1), 'steps': steps,
        'referenced_roles': sorted(referenced), 'provisioned_roles': provisioned,
        'pg_restore_exit': restore.returncode, 'restore_errors': errors[:80], 'restore_error_count': len(errors),
        'tables_checked': len(expected['tables'] or {}), 'rows_checked': sum(t['rows'] for t in (expected['tables'] or {}).values()),
        'differences': diffs, 'restored_catalog_detail': detail,
        'criteria': 'pg_restore exit 0, no pg_restore error, every table and catalog digest equal to the manifest',
        'verdict': verdict,
    }
    path = os.path.join(backup, f'RESTORE-CHECK-{now_stamp()}.json')
    with open(path, 'w') as f:
        json.dump(result, f, indent=1)
    os.chmod(path, 0o600)
    print(f"{verdict}: {result['tables_checked']} tables / {result['rows_checked']} rows, {len(diffs)} differences, "
          f"pg_restore exit {restore.returncode} with {len(errors)} errors ({result['seconds']} s) -> {path}")
    if provisioned:
        print('  platform roles created in the disposable container:', ', '.join(p['role'] for p in provisioned))
    for e in errors[:10]:
        print('  pg_restore:', e.replace('\n', ' | ')[:300])
    for d in diffs[:10]:
        print('  diff:', json.dumps(d)[:300])
    sys.exit(0 if verdict == 'RESTORE VERIFIED' else 1)


def storage_call(base, key, method, path, body=None):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
    return urllib.request.urlopen(req, timeout=60)


def list_objects(base, key, bucket, prefix=''):
    """The Storage API lists one folder level per call; folders come back without an id."""
    found, offset = [], 0
    while True:
        with storage_call(base, key, 'POST', f'/object/list/{urllib.parse.quote(bucket)}',
                          {'prefix': prefix, 'limit': 1000, 'offset': offset, 'sortBy': {'column': 'name', 'order': 'asc'}}) as r:
            page = json.load(r)
        for item in page:
            path = prefix + item['name']
            if item.get('id') is None:
                found.extend(list_objects(base, key, bucket, path + '/'))
            else:
                meta = item.get('metadata') or {}
                found.append({'name': path, 'size': meta.get('size'), 'etag': (meta.get('eTag') or '').strip('"'),
                              'mimetype': meta.get('mimetype')})
        if len(page) < 1000:
            return found
        offset += 1000


def storage_target(args):
    if getattr(args, 'lab_storage_url', None):
        base = args.lab_storage_url.rstrip('/')
        if urllib.parse.urlparse(base).hostname not in ('127.0.0.1', 'localhost'):
            die('lab storage must be loopback')
        return base, f'lab:{base}', 'lab', True
    if args.target not in TARGETS:
        die('--target core|torneos')
    ref = TARGETS[args.target]
    return f'https://{ref}.supabase.co/storage/v1', f'{args.target}:{ref}', ref, False


def iter_backup_files(backup, record, passphrase):
    """Yields (bucket, name, bytes) from the encrypted tar, in memory; checks the archive hash at the end."""
    proc = gpg('decrypt', os.path.join(backup, 'storage.tar.gpg'), passphrase, stdout=subprocess.PIPE)
    whole = hashlib.sha256()

    class Tee(io.RawIOBase):
        def readable(self):
            return True

        def readinto(self, b):
            data = proc.stdout.read(len(b))
            whole.update(data)
            b[:len(data)] = data
            return len(data)

    try:
        with tarfile.open(fileobj=io.BufferedReader(Tee(), CHUNK), mode='r|') as tar:
            for member in tar:
                if member.isfile():
                    bucket, _, name = member.name.partition('/')
                    yield bucket, name, tar.extractfile(member).read()
    except tarfile.TarError:
        proc.stdout.read()
        die('gpg decryption failed (wrong passphrase or damaged file)' if proc.wait() != 0 else 'the archive is not a valid tar', 1)
    whole.update(proc.stdout.read())
    if proc.wait() != 0 or whole.hexdigest() != record['artifact']['plaintext_sha256']:
        die('archive does not match its manifest', 1)


def cmd_storage_restore(args):
    backup = os.path.abspath(args.backup)
    record = json.load(open(os.path.join(backup, 'STORAGE-MANIFEST.json')))
    cipher = sha256_file(os.path.join(backup, 'storage.tar.gpg'))
    if cipher != record['artifact']['ciphertext_sha256']:
        die('ciphertext hash differs from STORAGE-MANIFEST.json', 1)
    base, label, ref, lab = storage_target(args)
    if not lab:
        phrase = f'RESTORE STORAGE {ref} {cipher[:12]}'
        if args.phrase != phrase:
            die(f'PHRASE_REQUIRED: {phrase}')
    mapping = dict(m.split('=', 1) for m in (args.bucket_map or []))
    passphrase = read_secret('Passphrase del backup de archivos: ', 'LAB_BACKUP_PASSPHRASE', lab)
    key = read_secret(f'service_role key de {label} (no se guarda): ', 'LAB_SERVICE_KEY', lab)
    by_path = {f"{f['bucket']}/{f['name']}": f for f in record['files']}
    with storage_call(base, key, 'GET', '/bucket') as r:
        existing = {b['id'] for b in json.load(r)}
    for b in record['buckets']:
        target = mapping.get(b['id'], b['id'])
        if target not in existing:
            body = {'id': target, 'name': target, 'public': bool(b.get('public'))}
            for k in ('file_size_limit', 'allowed_mime_types'):
                if b.get(k) is not None:
                    body[k] = b[k]
            storage_call(base, key, 'POST', '/bucket', body).close()
    uploaded, kept, bad = 0, 0, []
    for bucket, name, body in iter_backup_files(backup, record, passphrase):
        entry = by_path.get(f'{bucket}/{name}')
        if entry is None or hashlib.sha256(body).hexdigest() != entry['sha256']:
            bad.append(f'{bucket}/{name} (not in manifest or changed)')
            continue
        target = mapping.get(bucket, bucket)
        path = f"/object/{urllib.parse.quote(target)}/{urllib.parse.quote(name, safe='/')}"
        req = urllib.request.Request(base + path, data=body, method='POST', headers={
            'apikey': key, 'Authorization': f'Bearer {key}', 'x-upsert': 'false',
            'Content-Type': entry.get('mimetype') or 'application/octet-stream'})
        try:
            urllib.request.urlopen(req, timeout=60).close()
            uploaded += 1
        except urllib.error.HTTPError as e:
            if e.code in (400, 409) and 'exist' in e.read().decode(errors='replace').lower():
                kept += 1
            else:
                bad.append(f'{bucket}/{name} (HTTP {e.code})')
                continue
        with storage_call(base, key, 'GET', f"/object/authenticated/{urllib.parse.quote(target)}/{urllib.parse.quote(name, safe='/')}") as r:
            if hashlib.sha256(r.read()).hexdigest() != entry['sha256']:
                bad.append(f'{target}/{name} (stored copy differs)')
    if lab and args.lab_cleanup:
        for target in mapping.values():
            storage_call(base, key, 'POST', f'/bucket/{urllib.parse.quote(target)}/empty').close()
            storage_call(base, key, 'DELETE', f'/bucket/{urllib.parse.quote(target)}').close()
    key = None
    print(f"{'STORAGE RESTORED' if not bad else 'STORAGE RESTORE INCOMPLETE'} {label}: {uploaded} uploaded, {kept} already there "
          f"(not overwritten), {len(bad)} problems; every file re-read and compared")
    for b in bad[:10]:
        print('  ', b)
    sys.exit(0 if not bad else 1)


def cmd_backup_storage(args):
    base, label, ref, lab = storage_target(args)
    passphrase = read_secret('Passphrase del backup de archivos: ', 'LAB_BACKUP_PASSPHRASE', lab, confirm=True)
    key = read_secret(f'service_role key de {label} (no se guarda): ', 'LAB_SERVICE_KEY', lab)
    out = new_folder(args.out)
    with storage_call(base, key, 'GET', '/bucket') as r:
        buckets = json.load(r)
    files = []
    proc = gpg('encrypt', os.path.join(out, 'storage.tar.gpg'), passphrase, stdin=subprocess.PIPE)
    plain = HashingWriter(proc.stdin)
    with tarfile.open(fileobj=plain, mode='w|', format=tarfile.PAX_FORMAT) as tar:
        for b in buckets:
            for obj in list_objects(base, key, b['id']):
                with storage_call(base, key, 'GET', f"/object/authenticated/{urllib.parse.quote(b['id'])}/{urllib.parse.quote(obj['name'], safe='/')}") as r:
                    body = r.read()
                info = tarfile.TarInfo(f"{b['id']}/{obj['name']}")
                info.size, info.mtime, info.mode = len(body), int(time.time()), 0o600
                tar.addfile(info, io.BytesIO(body))
                md5 = hashlib.md5(body).hexdigest()
                files.append({'bucket': b['id'], 'name': obj['name'], 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest(),
                              'md5': md5, 'mimetype': obj.get('mimetype'), 'listed_size': obj['size'], 'listed_etag': obj['etag']})
    key = None
    proc.stdin.close()
    if proc.wait() != 0:
        die('gpg encryption failed', 1)
    record = {'kind': 'arma2-free-plan-storage-backup', 'version': 1, 'target': label, 'project_ref': ref, 'created_at': now_stamp(),
              'buckets': [{k: b.get(k) for k in ('id', 'public', 'file_size_limit', 'allowed_mime_types')} for b in buckets],
              'files': files, 'bytes': sum(f['bytes'] for f in files),
              'artifact': {'file': 'storage.tar.gpg', 'plaintext_sha256': plain.h.hexdigest(), 'plaintext_bytes': plain.size,
                           'ciphertext_sha256': sha256_file(os.path.join(out, 'storage.tar.gpg'))}}
    with open(os.path.join(out, 'STORAGE-MANIFEST.json'), 'w') as f:
        json.dump(record, f, indent=1)
    seal(out)
    # Storage's eTag is the md5 for single-part uploads; a multipart eTag has a '-N' suffix and is not comparable.
    bad = [f for f in files if (f['listed_size'] is not None and f['listed_size'] != f['bytes'])
           or (f['listed_etag'] and '-' not in f['listed_etag'] and f['listed_etag'] != f['md5'])]
    print(f"STORAGE BACKUP {'COMPLETE' if not bad else 'WITH MISMATCHES'} {label}: {len(buckets)} buckets, {len(files)} files, "
          f"{round(record['bytes'] / 1048576, 1)} MB -> {out}")
    sys.exit(0 if not bad else 1)


def cmd_storage_check(args):
    backup = os.path.abspath(args.backup)
    record = json.load(open(os.path.join(backup, 'STORAGE-MANIFEST.json')))
    if sha256_file(os.path.join(backup, 'storage.tar.gpg')) != record['artifact']['ciphertext_sha256']:
        die('ciphertext hash differs from STORAGE-MANIFEST.json', 1)
    passphrase = read_secret('Passphrase del backup de archivos: ', 'LAB_BACKUP_PASSPHRASE', record['target'].startswith('lab:'))
    seen = {f'{bucket}/{name}': hashlib.sha256(body).hexdigest() for bucket, name, body in iter_backup_files(backup, record, passphrase)}
    bad = [f"{f['bucket']}/{f['name']}" for f in record['files'] if seen.get(f"{f['bucket']}/{f['name']}") != f['sha256']]
    print(f"{'STORAGE ARCHIVE VERIFIED' if not bad else 'STORAGE ARCHIVE MISMATCH'}: "
          f"{len(record['files']) - len(bad)}/{len(record['files'])} files, nothing written to disk")
    sys.exit(0 if not bad else 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    for name in ('inspect', 'backup-db'):
        p = sub.add_parser(name)
        p.add_argument('--target', choices=sorted(TARGETS))
        p.add_argument('--lab-port', type=int, help='loopback lab Postgres port (LAB_PGPASSWORD)')
        if name == 'inspect':
            p.add_argument('--core-logs', action='store_true', help='also the Core operational-log report (lab)')
        else:
            p.add_argument('--out', required=True, help='new folder, outside the repository')
    p = sub.add_parser('restore-check')
    p.add_argument('--backup', required=True)
    p.add_argument('--image', default=RESTORE_IMAGE)
    p = sub.add_parser('backup-storage')
    p.add_argument('--target', choices=sorted(TARGETS))
    p.add_argument('--lab-storage-url', help='loopback storage-api base URL (LAB_SERVICE_KEY)')
    p.add_argument('--out', required=True)
    p = sub.add_parser('storage-check')
    p.add_argument('--backup', required=True)
    p = sub.add_parser('storage-restore')
    p.add_argument('--backup', required=True)
    p.add_argument('--target', choices=sorted(TARGETS))
    p.add_argument('--lab-storage-url')
    p.add_argument('--bucket-map', action='append', help='OLD=NEW: restore a bucket under another name')
    p.add_argument('--lab-cleanup', action='store_true', help='lab only: empty and delete the mapped buckets after checking')
    p.add_argument('--phrase', default='')
    args = ap.parse_args()
    {'inspect': cmd_inspect, 'backup-db': cmd_backup_db, 'restore-check': cmd_restore_check,
     'backup-storage': cmd_backup_storage, 'storage-check': cmd_storage_check, 'storage-restore': cmd_storage_restore}[args.cmd](args)


if __name__ == '__main__':
    main()
