import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

export const root = path.resolve(import.meta.dirname, '..');
export const evidence = path.join(root, process.env.PRODUCTION_REHEARSAL_RUN ? 'artifacts/production-specific-' + process.env.PRODUCTION_REHEARSAL_RUN : 'artifacts/production-upgrade-20260903');
export const snapshot = '/Users/nicoavayu/Downloads/arma2/production-db-snapshot-20260903';
export const docker = '/Applications/Docker.app/Contents/Resources/bin/docker';
if (process.env.PRODUCTION_REHEARSAL_RUN && !['r3','r4','r5'].includes(process.env.PRODUCTION_REHEARSAL_RUN)) throw new Error('Unapproved local run');
export const container = 'arma2-production-prep-20260903-' + (process.env.PRODUCTION_REHEARSAL_RUN || 'r2');
fs.mkdirSync(evidence, { recursive: true });
const qi = s => '"' + s.replaceAll('"', '""') + '"';
const qs = s => "'" + s.replaceAll("'", "''") + "'";
export const hash = s => crypto.createHash('sha256').update(s).digest('hex');
export const read = f => fs.readFileSync(path.join(snapshot, f), 'utf8');
export const save = (f, s) => fs.writeFileSync(path.join(evidence, f), s);
export function sql(input, user = 'supabase_admin', log) {
  const r = spawnSync(docker, ['exec', '-i', container, 'psql', '-X', '-h', '/tmp', '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input, encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 });
  if (log) save(log, `${r.stdout}\n${r.stderr}`);
  if (r.status !== 0) throw new Error(`Local SQL failed (${r.status}): ${r.stderr.slice(-5000)}`);
  return r.stdout.trim();
}
export function archive(file) {
  return execFileSync('/opt/homebrew/opt/libpq/bin/pg_restore', ['--file=-', path.join(snapshot, file)], { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 }).replace(/^\\(?:un)?restrict .*\n/gm, '');
}
if (process.argv[2] === 'restore') {
  const roles = read('roles.tsv').trim().split('\n').map(l => l.split('\t'));
  const attrs = ['SUPERUSER','INHERIT','CREATEROLE','CREATEDB','LOGIN','REPLICATION','BYPASSRLS'];
  let bootstrap = 'BEGIN;\n';
  for (const [name,...flags] of roles) {
    if (name.startsWith('pg_')) continue;
    bootstrap += `${name === 'supabase_admin' ? 'ALTER' : 'CREATE'} ROLE ${qi(name)} ${flags.map((v,i)=>(v === 't' ? '' : 'NO') + attrs[i]).join(' ')};\n`;
  }
  for (const [role,member,grantor,admin,inherit,set] of read('role-memberships.tsv').trim().split('\n').slice(1).map(l=>l.split('\t'))) {
    bootstrap += `GRANT ${qi(role)} TO ${qi(member)} WITH ADMIN ${admin === 't'}, INHERIT ${inherit === 't'}, SET ${set === 't'} GRANTED BY ${qi(grantor)};\n`;
  }
  bootstrap += 'ALTER DATABASE postgres OWNER TO postgres;\nGRANT ALL ON DATABASE postgres TO dashboard_user;\nALTER SCHEMA public OWNER TO pg_database_owner;\n';
  for (const [db,role,param,value] of read('db-role-settings-sanitized.tsv').trim().split('\n').slice(1).map(l=>l.split('\t'))) {
    if (value === '<OMITTED>') continue;
    bootstrap += `ALTER ROLE ${qi(role)}${db === '<ALL_DATABASES>' ? '' : ` IN DATABASE ${qi(db)}`} SET ${qi(param)} TO ${param === 'search_path' ? value : qs(value)};\n`;
  }
  bootstrap += "ALTER ROLE authenticator SET session_preload_libraries TO 'safeupdate';\nCOMMIT;\n";
  save('bootstrap.sql', bootstrap);
  sql(bootstrap, 'supabase_admin', 'bootstrap.log');
  sql('BEGIN;\n' + archive('production-schema.dump') + '\nCOMMIT;', 'supabase_admin', 'restore-schema.log');
  sql('BEGIN;\n' + archive('migration-ledger.dump') + '\nCOMMIT;', 'supabase_admin', 'restore-ledger.log');
  console.log('RESTORE COMPLETE');
}
