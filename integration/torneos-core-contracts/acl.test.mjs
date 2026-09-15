// Phase 2C — ACL certification of the corrected Torneos baseline on the REAL local
// Supabase stack (supabase/postgres image database + PostgREST + gateway), the same lab
// Phase 3A used. Runs after `npm run up`. Every check is a named subtest; results go to
// evidence/acl-results.json, inventories to evidence/acl-*.json. Nothing touches a
// remote target; the attacker position is a direct PostgREST client INSIDE the network
// (a published Data API), which the certified gateway never exposes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { SignJWT, importPKCS8 } from 'jose';
import { config, sql, sqlTry, inGateway, BASE, repo } from './lab.mjs';

const cfg = await config();
const results = [];
const API = ['anon', 'authenticated', 'service_role'];
const torneosSql = (q) => sql('torneos-db', q);
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const inventorySql = await readFile(`${repo}backend/torneos/phase2c/acl-inventory.sql`, 'utf8');
const review = JSON.parse(await readFile(`${repo}backend/torneos/evidence/security-definer-review.json`, 'utf8'));
const template0 = JSON.parse(await readFile(`${repo}backend/torneos/phase2c/evidence/real-image-acl-after-template0.json`, 'utf8')).inventory;
const baselineSql = await readFile(`${repo}backend/torneos/supabase/migrations/00000000000000_torneos_baseline_v1.sql`, 'utf8');

/** Direct PostgREST calls from inside the private network, batched in one container exec. */
function restBatch(calls) {
  const out = inGateway(`const calls = ${JSON.stringify(calls)}; const out = [];
    for (const c of calls) {
      const r = await fetch('http://torneos-rest:3000' + c.path, { method: c.method ?? 'POST',
        headers: { 'content-type': 'application/json', ...(c.accept ? { accept: c.accept } : {}), ...(c.token ? { authorization: 'Bearer ' + c.token } : {}) },
        body: c.method === 'GET' ? undefined : JSON.stringify(c.body ?? {}) });
      const text = await r.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
      out.push({ id: c.id, status: r.status, body });
    }
    console.log(JSON.stringify(out));`);
  return JSON.parse(out.trim().split('\n').pop());
}
async function bearer(identity, sessionId = randomUUID()) {
  const key = cfg.keys.find(k => k.kid === cfg.activeKid);
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: 'authenticated', core_user_id: identity.core_user_id, session_id: sessionId })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: key.kid }).setIssuer('urn:arma2:local:identity-bridge').setAudience('arma2-torneos-local')
    .setSubject(identity.id).setIssuedAt(now).setNotBefore(now).setExpirationTime(now + 120).setJti(randomUUID())
    .sign(await importPKCS8(key.privateKey, 'RS256'));
}
function identity() {
  const id = { id: randomUUID(), core_user_id: randomUUID() };
  torneosSql(`SET ROLE torneos_identity_writer; INSERT INTO public.torneos_identity(id, core_user_id) VALUES (${lit(id.id)}, ${lit(id.core_user_id)}); RESET ROLE;`);
  return id;
}
/** PostgREST needs named arguments to resolve an RPC; null for every declared parameter. */
function nullArgs(argString) {
  const args = {};
  for (const part of argString.split(',').map(s => s.trim()).filter(Boolean)) {
    const name = part.replace(/^(IN|OUT|INOUT|VARIADIC)\s+/i, '').split(/\s+/)[0];
    if (name.startsWith('p_') || /^[a-z_]+$/.test(name)) args[name] = null;
  }
  return args;
}
const deniedBeforeBody = (r) => [401, 403].includes(r.status) && r.body?.code === '42501' && /permission denied for function/.test(r.body?.message ?? '');

test('Phase 2C — real Supabase stack ACL certification', async (t) => {
  async function check(name, fn) {
    await t.test(name, async () => {
      try { await fn(); results.push({ name, status: 'PASS' }); }
      catch (error) { results.push({ name, status: 'FAIL', error: String(error.message ?? error).slice(0, 400) }); throw error; }
    });
  }
  let inventory, fnByName, publicFns, categories, argsOf;
  try {
    await check('install: corrected baseline installed from an empty real Supabase database (image default ACLs present, installer supabase_admin)', async () => {
      const install = JSON.parse(await readFile('.runtime/install.json', 'utf8'));
      const sha = createHash('sha256').update(baselineSql).digest('hex');
      assert.equal(install.torneos.sha256, sha, 'lab installed the candidate in this tree');
      assert.equal(install.torneos.certified_sha256, sha, 'candidate hash equals the Phase 2B lab install record');
      assert.equal(install.torneos.installed, true, 'installed by this lab from an empty volume');
      assert.match(sha, /^97634b65/, 'Phase 2C candidate');
      // Real image database: the platform role's own schema-scoped defaults are untouched (still grant anon),
      // the installer's were revoked by the baseline prologue; every function is owned by the installer.
      const defaults = JSON.parse(torneosSql("select json_agg(json_build_object('role',r.rolname,'type',d.defaclobjtype,'acl',d.defaclacl::text) order by r.rolname,d.defaclobjtype) from pg_default_acl d join pg_roles r on r.oid=d.defaclrole join pg_namespace n on n.oid=d.defaclnamespace where n.nspname='public'"));
      assert.ok(defaults.some(x => x.role === 'postgres' && x.type === 'f' && /anon=X/.test(x.acl)), 'image default ACLs present (real Supabase database)');
      for (const type of ['f', 'S', 'r']) {
        const row = defaults.find(x => x.role === 'supabase_admin' && x.type === type);
        assert.ok(!row || !/anon=|authenticated=|service_role=/.test(row.acl), `installer default ACL for ${type} no longer grants API roles: ${row?.acl}`);
      }
      assert.equal(torneosSql("select count(distinct pg_get_userbyid(p.proowner)) || ':' || min(pg_get_userbyid(p.proowner)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')").trim(), '1:supabase_admin');
      const openapi = restBatch([{ id: 'root', path: '/', method: 'GET' }])[0];
      assert.equal(openapi.status, 200); assert.ok(openapi.body?.openapi || openapi.body?.swagger, 'real PostgREST answers on the Data API');
    });
    await check('grants: effective privilege inventory per function, sequence and relation (written to evidence)', async () => {
      inventory = JSON.parse(torneosSql(inventorySql));
      fnByName = new Map(inventory.functions.map(f => [f.function, f]));
      publicFns = inventory.functions.filter(f => f.schema === 'public');
      argsOf = new Map(JSON.parse(torneosSql("select json_agg(json_build_object('f', p.oid::regprocedure::text, 'a', pg_get_function_identity_arguments(p.oid))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'")).map(x => [x.f, x.a]));
      const count = (role, rows) => rows.filter(f => f[role]).length;
      const summary = {
        image: 'public.ecr.aws/supabase/postgres:17.6.1.143', database: 'postgres', installer: 'supabase_admin',
        functions_total: inventory.functions.length, public_functions: publicFns.length, security_definer: inventory.functions.filter(f => f.security_definer).length,
        execute: Object.fromEntries([...API, 'postgres'].map(r => [r, { public_functions: count(r, publicFns), private_functions: count(r, inventory.functions.filter(f => f.schema === 'private')), security_definer: count(r, inventory.functions.filter(f => f.security_definer)) }])),
        public_execute_functions: inventory.functions.filter(f => f.public).length,
        sequences_total: inventory.sequences.length,
        sequence_privilege: Object.fromEntries([...API, 'postgres'].map(r => [r, inventory.sequences.filter(s => s[r].length).length])),
        relations_total: inventory.relations.length,
        relation_privilege: Object.fromEntries([...API, 'postgres'].map(r => [r, inventory.relations.filter(x => x[r].length).length])),
        anon_write_privilege_relations: inventory.relations.filter(x => x.anon.some(p => p !== 'SELECT')).length,
      };
      await writeFile('evidence/acl-inventory-real-stack.json', JSON.stringify({ summary, inventory }, null, 2) + '\n');
      assert.deepEqual(summary.execute.anon, { public_functions: 12, private_functions: 2, security_definer: 12 });
      assert.deepEqual(summary.execute.authenticated, { public_functions: 180, private_functions: 2, security_definer: 179 });
      assert.deepEqual(summary.execute.service_role, { public_functions: 328, private_functions: 2, security_definer: 284 });
      assert.equal(summary.public_execute_functions, 0, 'no function is executable by PUBLIC');
      assert.deepEqual(summary.sequence_privilege, { anon: 0, authenticated: 4, service_role: 4, postgres: 7 });
      assert.equal(summary.anon_write_privilege_relations, 0);
      // Object-by-object equivalence with the certified template0 install for every API role.
      const view = (inv) => {
        const v = {};
        for (const f of inv.functions) v['function:' + f.function] = { anon: f.anon, authenticated: f.authenticated, service_role: f.service_role, public: f.public, adapter: f.torneos_core_adapter, writer: f.torneos_identity_writer, security_definer: f.security_definer, settings: f.settings };
        for (const s of inv.sequences) v['sequence:' + s.sequence] = { anon: [...s.anon].sort(), authenticated: [...s.authenticated].sort(), service_role: [...s.service_role].sort() };
        for (const r of inv.relations) v['relation:' + r.relation] = { anon: [...r.anon].sort(), authenticated: [...r.authenticated].sort(), service_role: [...r.service_role].sort(), rls: r.rls };
        return v;
      };
      const a = view(inventory), b = view(template0);
      const mismatches = Object.keys({ ...a, ...b }).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      assert.deepEqual(mismatches, [], 'real stack == template0 for API-role privileges');
      assert.ok(Object.keys(a).length >= 470, `objects compared: ${Object.keys(a).length}`);
    });
    // ---------------------------------------------------------------- disposition classes (Phase 2B ledger)
    categories = new Map(review.functions.map(f => [f.function, f]));
    const byCategory = (c) => review.functions.filter(f => f.category === c);
    const serviceOnly = byCategory('SERVICE_ONLY'), internal = byCategory('INTERNAL');
    assert.equal(serviceOnly.length, 106); assert.equal(internal.length, 9); assert.equal(review.functions.length, 305);
    const sweep = { anon: [], authenticated: [] };
    const actor = identity();
    const actorToken = await bearer(actor);
    async function sweepDenied(role, rows, label) {
      const calls = rows.map(f => ({ id: f.function, path: `/rpc/${f.name}`, body: nullArgs(argsOf.get(f.function) ?? ''), token: role === 'authenticated' ? actorToken : undefined }));
      const out = restBatch(calls);
      for (const r of out) {
        const cat = categories.get(r.id)?.category;
        const verdict = deniedBeforeBody(r) ? 'DENIED_BEFORE_BODY' : (r.status === 200 ? 'EXECUTED' : /TORNEOS_/.test(JSON.stringify(r.body)) ? 'BODY_GUARD' : 'OTHER:' + r.status);
        sweep[role].push({ function: r.id, category: cat, status: r.status, code: r.body?.code, message: String(r.body?.message ?? '').slice(0, 80), verdict });
      }
      const bad = sweep[role].filter(x => rows.some(f => f.function === x.function) && x.verdict !== 'DENIED_BEFORE_BODY');
      assert.deepEqual(bad, [], `${label}: every call denied by the ACL before the body runs`);
      for (const f of rows) assert.equal(fnByName.get(f.function)[role], false, `${role} has no EXECUTE on ${f.function}`);
    }
    await check('anon: all 106 SERVICE_ONLY functions DENY (catalog EXECUTE false; Data API 42501 before the body)', () => sweepDenied('anon', serviceOnly, 'anon/SERVICE_ONLY'));
    await check('anon: all 9 INTERNAL functions DENY (catalog EXECUTE false; Data API 42501 before the body)', () => sweepDenied('anon', internal, 'anon/INTERNAL'));
    await check('authenticated: all 106 SERVICE_ONLY functions DENY with a valid bearer', () => sweepDenied('authenticated', serviceOnly, 'authenticated/SERVICE_ONLY'));
    await check('authenticated: all 9 INTERNAL functions DENY with a valid bearer (no certified exception exists)', () => sweepDenied('authenticated', internal, 'authenticated/INTERNAL'));
    await check('bearers: TRIGGER and ADAPTER_ONLY DEFINER functions are unreachable by anon/authenticated bearers and keep their certified grantees', async () => {
      for (const f of [...byCategory('TRIGGER'), ...byCategory('ADAPTER_ONLY')]) {
        const row = fnByName.get(f.function);
        assert.ok(row, f.function);
        // anon/authenticated can never call them; a service_role grant (server-only, like SERVICE_ONLY) is allowed and is recorded in the ledger.
        assert.deepEqual([row.anon, row.authenticated], [false, false], f.function);
        const grantees = ['anon', 'authenticated', 'service_role'].filter(r => row[r]).concat(row.torneos_core_adapter ? ['adapter'] : []);
        assert.deepEqual(grantees, f.grantees, `${f.function}: grantees match the Phase 2B ledger`);
      }
    });
    await check('public RPCs: exactly the 12 explicitly granted anon functions execute for anon (3 PUBLIC_READ + 9 IDENTITY_GATED_READ)', async () => {
      const anonFns = publicFns.filter(f => f.anon).map(f => f.function).sort();
      const expected = [...byCategory('PUBLIC_READ'), ...byCategory('IDENTITY_GATED_READ')].map(f => f.function).sort();
      assert.deepEqual(anonFns, expected);
      const out = restBatch(anonFns.map(f => ({ id: f, path: `/rpc/${fnByName.get(f).name}`, body: nullArgs(argsOf.get(f)) })));
      for (const r of out) {
        const cat = categories.get(r.id).category;
        if (cat === 'PUBLIC_READ') assert.equal(r.status, 200, `${r.id}: ${JSON.stringify(r.body)}`);
        else assert.match(JSON.stringify(r.body), /TORNEOS_/, `${r.id}: body executes and denies the anonymous caller`);
        assert.ok(!deniedBeforeBody(r), `${r.id}: EXECUTE is granted`);
        sweep.anon.push({ function: r.id, category: cat, status: r.status, code: r.body?.code, message: String(r.body?.message ?? '').slice(0, 80), verdict: r.status === 200 ? 'EXECUTED' : 'BODY_GUARD' });
      }
      const page = restBatch([{ id: 'page', path: '/rpc/get_public_tournament_page', body: { p_public_slug: 'phase2c-no-such-page' } }])[0];
      assert.equal(page.status, 200); assert.equal(page.body, null, 'unpublished page is null for anon');
    });
    let org;
    await check('authenticated RPCs: the 180 explicitly granted functions execute with a valid bearer (guarded DEFINER write + predicate)', async () => {
      const authFns = publicFns.filter(f => f.authenticated).map(f => f.function).sort();
      const t0Fns = template0.functions.filter(f => f.schema === 'public' && f.authenticated).map(f => f.function).sort();
      assert.deepEqual(authFns, t0Fns); assert.equal(authFns.length, 180);
      const slug = `phase2c-${randomUUID().slice(0, 8)}`;
      const r = restBatch([{ id: 'org', path: '/rpc/create_tournament_organization', token: actorToken, body: { p_name: 'Phase 2C League', p_slug: slug, p_idempotency_key: randomUUID() } }])[0];
      assert.equal(r.status, 200, JSON.stringify(r.body));
      org = r.body.organization.id;
      const cap = restBatch([{ id: 'cap', path: '/rpc/has_tournament_organization_capability', token: actorToken, body: { p_organization_id: org, p_capability: 'organization.archive' } }])[0];
      assert.deepEqual([cap.status, cap.body], [200, true]);
      const read = restBatch([{ id: 'read', path: `/tournament_organizations?select=slug&id=eq.${org}`, method: 'GET', token: actorToken }])[0];
      assert.deepEqual(read.body, [{ slug }]);
    });
    await check('305/305 SECURITY DEFINER functions keep their Phase 2B grantees, owner and fixed search_path on the real stack', async () => {
      const rows = [];
      for (const f of review.functions) {
        const row = fnByName.get(f.function);
        assert.ok(row, `missing ${f.function}`);
        const grantees = ['anon', 'authenticated', 'service_role'].filter(r => row[r]).concat(row.torneos_core_adapter ? ['adapter'] : []);
        const ok = JSON.stringify(grantees) === JSON.stringify(f.grantees) && row.security_definer && row.owner === 'supabase_admin' && (row.settings ?? []).includes('search_path=""')
          && (['PUBLIC_READ', 'IDENTITY_GATED_READ'].includes(f.category) ? row.anon : !row.anon)
          && (['SERVICE_ONLY', 'INTERNAL', 'TRIGGER', 'ADAPTER_ONLY'].includes(f.category) ? (!row.anon && !row.authenticated) : true);
        rows.push({ function: f.function, category: f.category, phase2b_grantees: f.grantees, real_stack_grantees: grantees, owner: row.owner, settings: row.settings, disposition_maintained: ok });
      }
      await writeFile('evidence/acl-security-definer-recert.json', JSON.stringify({ total: rows.length, maintained: rows.filter(r => r.disposition_maintained).length, categories: Object.fromEntries([...new Set(rows.map(r => r.category))].sort().map(c => [c, rows.filter(r => r.category === c).length])), functions: rows }, null, 2) + '\n');
      assert.equal(rows.filter(r => !r.disposition_maintained).length, 0);
      assert.equal(rows.length, 305);
      assert.equal(torneosSql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prosecdef").trim(), '305');
    });
    await check('no privilege escalation: role graph, PostgREST role switch, sequences, private schema', async () => {
      const roles = Object.fromEntries(inventory.roles.map(r => [r.role, r]));
      assert.deepEqual(roles.authenticator.member_of, ['anon', 'authenticated', 'service_role'], 'the Data API can only become the three API roles');
      for (const r of ['anon', 'authenticated']) { assert.deepEqual(roles[r].member_of, []); assert.deepEqual([roles[r].superuser, roles[r].createrole, roles[r].bypassrls], [false, false, false]); }
      assert.deepEqual([roles.torneos_core_adapter.login, roles.torneos_identity_writer.login], [false, false]);
      // A bearer claiming a non-API role is refused by PostgREST (authenticator is not a member).
      const key = cfg.keys.find(k => k.kid === cfg.activeKid);
      const now = Math.floor(Date.now() / 1000);
      for (const role of ['postgres', 'supabase_admin', 'torneos_core_adapter', 'torneos_identity_writer']) {
        const token = await new SignJWT({ role, core_user_id: actor.core_user_id, session_id: randomUUID() }).setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: key.kid })
          .setIssuer('urn:arma2:local:identity-bridge').setAudience('arma2-torneos-local').setSubject(actor.id).setIssuedAt(now).setNotBefore(now).setExpirationTime(now + 120).setJti(randomUUID())
          .sign(await importPKCS8(key.privateKey, 'RS256'));
        const r = restBatch([{ id: role, path: `/tournament_organizations?select=id&limit=1`, method: 'GET', token }])[0];
        assert.ok([401, 403].includes(r.status), `${role}: ${r.status} ${JSON.stringify(r.body)}`);
      }
      // Sequences: the seven identity sequences are not usable by anon (setval/nextval/last_value).
      for (const s of inventory.sequences) {
        assert.deepEqual(s.anon, [], s.sequence);
        const r = sqlTry('torneos-db', `BEGIN; SET LOCAL ROLE anon; SELECT nextval(${lit(s.sequence)}); ROLLBACK;`);
        assert.match(r.error ?? '', /permission denied/, s.sequence);
        const l = sqlTry('torneos-db', `BEGIN; SET LOCAL ROLE anon; SELECT last_value FROM ${s.sequence}; ROLLBACK;`);
        assert.match(l.error ?? '', /permission denied/, s.sequence + ' last_value');
      }
      // Private schema: no API-role privilege on Core boundary tables; adapter cannot read domain tables.
      for (const r of inventory.relations.filter(x => x.relation.startsWith('private.'))) for (const role of API) assert.deepEqual(r[role], [], `${role} on ${r.relation}`);
      assert.equal(torneosSql("select bool_or(has_table_privilege('torneos_core_adapter',c.oid,'SELECT')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'").trim(), 'f');
      assert.equal(torneosSql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname in ('public','private') and r.rolname in ('anon','authenticated','service_role','authenticator')").trim(), '0');
    });
    await check('no cross-workspace: another identity cannot read or mutate the organization through the Data API', async () => {
      const other = identity(); const otherToken = await bearer(other);
      const read = restBatch([{ id: 'r', path: `/tournament_organizations?select=id&id=eq.${org}`, method: 'GET', token: otherToken }])[0];
      assert.deepEqual([read.status, read.body], [200, []]);
      const mut = restBatch([{ id: 'm', path: '/rpc/create_tournament_season', token: otherToken, body: { p_organization_id: org, p_name: 'X', p_slug: 'x', p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() } }])[0];
      assert.equal(mut.status, 403); assert.equal(mut.body.message, 'TORNEOS_RESOURCE_FORBIDDEN');
    });
    await check('no cross-season: an organization admin without a season assignment has no access to that season', async () => {
      const admin = identity(); const adminToken = await bearer(admin);
      const season = restBatch([{ id: 's', path: '/rpc/create_tournament_season', token: actorToken, body: { p_organization_id: org, p_name: 'Season One', p_slug: `s1-${randomUUID().slice(0, 8)}`, p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() } }])[0];
      assert.equal(season.status, 200, JSON.stringify(season.body));
      torneosSql(`insert into public.tournament_organization_members(organization_id,user_id,role,joined_at) values (${lit(org)},${lit(admin.id)},'admin',now())`);
      const access = restBatch([{ id: 'a', path: '/rpc/has_tournament_season_access', token: adminToken, body: { p_organization_id: org, p_season_id: season.body.id } }])[0];
      assert.deepEqual([access.status, access.body], [200, false]);
      const own = restBatch([{ id: 'o', path: '/rpc/has_tournament_season_access', token: actorToken, body: { p_organization_id: org, p_season_id: season.body.id } }])[0];
      assert.deepEqual([own.status, own.body], [200, true]);
    });
    await check('no physical Core dependency: no FK outside public/private, no auth schema, no FDW/dblink', async () => {
      // The Supabase image ships auth/storage/realtime schemas with their own FKs; the baseline's own tables must not depend on anything outside public/private.
      assert.equal(torneosSql("select count(*) from pg_constraint x join pg_class src on src.oid=x.conrelid join pg_namespace sn on sn.oid=src.relnamespace join pg_class tgt on tgt.oid=x.confrelid join pg_namespace tn on tn.oid=tgt.relnamespace where x.contype='f' and sn.nspname in ('public','private') and tn.nspname not in ('public','private')").trim(), '0');
      assert.equal(torneosSql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('usuarios','jugadores','teams','team_members')").trim(), '0');
      assert.equal(torneosSql("select count(*) from pg_foreign_server").trim(), '0');
      assert.equal(torneosSql("select count(*) from pg_extension where extname in ('dblink','postgres_fdw')").trim(), '0');
      assert.ok(!/auth\.(users|uid)|public\.(usuarios|jugadores|teams|team_members)\b/.test(baselineSql));
    });
    await check('Data API: anon OpenAPI exposes only the anon-executable RPCs; SERVICE_ONLY/INTERNAL absent for anon and for a bearer', async () => {
      const docs = restBatch([{ id: 'anon', path: '/', method: 'GET' }, { id: 'auth', path: '/', method: 'GET', token: actorToken }]);
      const paths = (d) => Object.keys(d.body.paths ?? {}).filter(p => p.startsWith('/rpc/')).map(p => p.slice(5)).sort();
      const anonPaths = paths(docs[0]), authPaths = paths(docs[1]);
      const anonNames = [...new Set(publicFns.filter(f => f.anon).map(f => f.name))].sort();
      const authNames = [...new Set(publicFns.filter(f => f.authenticated || f.anon).map(f => f.name))].sort();
      await writeFile('evidence/acl-data-api-openapi.json', JSON.stringify({ anon_rpc_paths: anonPaths, authenticated_rpc_paths: authPaths, anon_executable: anonNames, authenticated_executable: authNames }, null, 2) + '\n');
      assert.deepEqual(anonPaths, anonNames, 'OpenAPI follows privileges for anon');
      assert.deepEqual(authPaths, authNames, 'OpenAPI follows privileges for authenticated');
      const hidden = [...serviceOnly, ...internal].map(f => f.name);
      assert.deepEqual(hidden.filter(n => anonPaths.includes(n) || authPaths.includes(n)), []);
    });
    await check('no secrets: lab secrets and JWTs absent from the baseline and from this suite\'s evidence', async () => {
      const secrets = [cfg.dbPassword, cfg.readerPassword, cfg.writerPassword, cfg.adapterPassword, cfg.coreSecret, cfg.serviceRoleKey, cfg.anonKey, cfg.coreContractSecret, actorToken, ...cfg.keys.map(k => k.privateKey)];
      const files = ['evidence/acl-inventory-real-stack.json', 'evidence/acl-security-definer-recert.json', 'evidence/acl-data-api-openapi.json'];
      for (const f of files) {
        const text = await readFile(f, 'utf8');
        for (const s of secrets) assert.ok(!text.includes(s), `${f} carries a lab secret`);
        assert.ok(!/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\./.test(text), `${f} carries a JWT`);
      }
      assert.ok(!/https?:\/\/[a-zA-Z0-9][a-zA-Z0-9.-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(baselineSql));
    });
    await writeFile('evidence/acl-data-api-sweep.json', JSON.stringify({
      summary: Object.fromEntries(Object.entries(sweep).map(([role, rows]) => [role, Object.fromEntries([...new Set(rows.map(r => r.category + ':' + r.verdict))].sort().map(k => [k, rows.filter(r => r.category + ':' + r.verdict === k).length]))])),
      rows: sweep,
    }, null, 2) + '\n');
  } finally {
    await mkdir('evidence', { recursive: true });
    await writeFile('evidence/acl-results.json', JSON.stringify({
      generated_at: new Date().toISOString(), base: BASE,
      pass: results.filter(r => r.status === 'PASS').length, fail: results.filter(r => r.status === 'FAIL').length, results,
    }, null, 2) + '\n');
  }
});
