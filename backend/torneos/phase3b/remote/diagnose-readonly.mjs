// R3 error 25006 diagnostics. Fixed SELECT only, even on read_only:false requests.
// No user-supplied SQL, config changes, or migration writes. PAT arrives on stdin.
import { pathToFileURL } from 'node:url';
import { httpsRequest as readRequest, run, PAT_PATTERN, registerSecret, redact, assertReadOnlySql, assertNoProduction } from './mgmt.mjs';
import { httpsRequest as writeRequest } from './mgmt-write.mjs';
import { CORE_REF } from './core-contract.mjs';
export const SETTINGS_SQL = `select current_user as api_role, session_user as session_role, current_database() as database, pg_is_in_recovery() as in_recovery, pg_database_size(current_database()) as database_bytes, current_setting('transaction_read_only') as transaction_read_only, current_setting('default_transaction_read_only') as default_transaction_read_only, (select jsonb_agg(jsonb_build_object('name',name,'setting',setting,'source',source,'reset_val',reset_val)) from pg_settings where name in ('transaction_read_only','default_transaction_read_only')) as settings, (select jsonb_agg(jsonb_build_object('database',coalesce(d.datname,'ALL'),'role',coalesce(r.rolname,'ALL'),'setting',v)) from pg_db_role_setting s left join pg_database d on d.oid=s.setdatabase left join pg_roles r on r.oid=s.setrole cross join lateral unnest(s.setconfig) as v where split_part(v,'=',1) in ('transaction_read_only','default_transaction_read_only') and (s.setdatabase=0 or d.datname=current_database())) as role_database_settings`;
assertReadOnlySql(SETTINGS_SQL);
export async function diagnose(pat, read = readRequest, write = writeRequest) {
  if (!PAT_PATTERN.test(pat ?? '')) throw new Error('missing_or_malformed_pat');
  assertNoProduction('token', pat); registerSecret(pat);
  const results = {};
  async function observe(name, fn) {
    try { results[name] = await fn(); } catch(e) { results[name] = { error: e.message, detail: e.detail ?? null }; }
  }
  await observe('platform_readonly', async () => {
    const r = await read({pat, method:'GET', path:`/v1/projects/${CORE_REF}/readonly`});
    return {status:r.status, enabled:r.body?.enabled ?? null, override_enabled:r.body?.override_enabled ?? null, override_active_until:r.body?.override_active_until ?? null};
  });
  for (const read_only of [true, false, false]) {
    const name = read_only ? 'settings_readonly_request' : (results.settings_writer_request ? 'settings_writer_request_repeat' : 'settings_writer_request');
    await observe(name, async () => {
      const r = await (read_only ? read({pat, method:'POST', path:`/v1/projects/${CORE_REF}/database/query`, body:{query:SETTINGS_SQL,read_only}}) : write({pat, method:'POST', reqPath:`/v1/projects/${CORE_REF}/database/query`, body:{query:SETTINGS_SQL,read_only}}));
      return {status:r.status, request_read_only:read_only, body:r.body};
    });
  }
  for (const op of ['project','core-ledger','core-contract-acl','function']) await observe(op, () => run({op,pat,ref:CORE_REF}, read));
  return {generated_at:new Date().toISOString(), core_ref:CORE_REF, diagnostic:'25006', sql_writes:0, note:'Fixed SELECT with both read_only modes; no mode override or settings changes',results};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input=''; for await (const chunk of process.stdin) input+=chunk;
  const timeout=setTimeout(()=>{console.error('diagnostic_deadline');process.exit(1)},180000);
  try { const {pat}=JSON.parse(input); process.stdout.write(redact(JSON.stringify(await diagnose(pat)))+'\n'); }
  catch(e) { process.stdout.write(redact(JSON.stringify({error:e.message}))+'\n');process.exitCode=1; }
  finally {clearTimeout(timeout);input='';}
}
