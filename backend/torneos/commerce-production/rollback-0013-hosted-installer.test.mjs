// 0013 apply → rollback → re-apply AS THE HOSTED INSTALLER: `postgres`, not a superuser, with CREATEROLE, on a lab with
// Production's topology (read 2026-10-13: 0000→0017 without 0013, every public/private object owned by postgres).
// PostgreSQL 16+ gives the non-superuser creator of torneos_payment_production_service an implicit membership in it
// (ADMIN, no INHERIT, no SET, granted by the bootstrap superuser) that the installer cannot revoke; the rollback and the
// driver catalog ignore exactly that membership and nothing else. Checks: the catalog, the data and the permissions are
// identical after apply → rollback, re-apply works, and the rollback still refuses with a login, another role, a
// different grant to the installer, or a production purchase — leaving those memberships and rows in place. The login
// bootstrap (P3, production-contract renderProductionLoginSql) and drop-login run as the installer too: the login guard
// ignores the same implicit membership (and only it), and the installer GRANTs the role through it.
//   node --test backend/torneos/commerce-production/rollback-0013-hosted-installer.test.mjs
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

process.env.COMMERCE_PRODUCTION_LAB_CONTAINER = 'arma2-commerce-hosted-installer-db';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const lab = await import('./lab/pg-lab.mjs');
const D = await import('./remote/db-0013.mjs');
const CATALOG = fs.readFileSync(path.join(HERE, 'remote/sql-catalog.sql'), 'utf8');
const R13 = fs.readFileSync(D.FILES['rollback-0013'].path, 'utf8');
const ROLE = 'torneos_payment_production_service';
const LAB_LOGIN = 'lab_payment_production_service';
const phrase = (mode) => `${mode.split('-')[0].toUpperCase()} TORNEOS 0013 ${D.REF} ${D.FILES[mode].sha256.slice(0, 12)}`;
const asPostgres = (text) => { const r = lab.sqlTry(text, { user: 'postgres' }); return { code: r.ok ? 0 : 3, error: r.error }; };
// The driver reads its catalog as the installer too (Production: the read-only transport logs in as postgres).
const deps = {
  readFile: (p) => fs.readFileSync(p),
  catalog: async () => JSON.parse(lab.sql(CATALOG, { user: 'postgres' }).trim().split('\n').filter(Boolean).pop()),
  applySql: async (text) => asPostgres(text),
};
const run = (mode) => D.run(mode, phrase(mode).split(' '), deps);
const one = (q) => lab.sql(q).trim();

/** Everything 0013 and its rollback could touch, outside the 0013 objects themselves: catalog, permissions, data. */
function snapshot() {
  return JSON.parse(one(`select json_build_object(
    'functions', (select json_agg(json_build_object('sig', p.oid::regprocedure::text, 'md5', md5(p.prosrc), 'acl', p.proacl::text,
      'owner', pg_get_userbyid(p.proowner), 'definer', p.prosecdef, 'config', p.proconfig::text) order by p.oid::regprocedure::text)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private')),
    'relations', (select json_agg(json_build_object('rel', n.nspname||'.'||c.relname, 'kind', c.relkind, 'acl', c.relacl::text,
      'owner', pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity) order by n.nspname, c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','v','m','S','p')),
    'policies', (select json_agg(schemaname||'.'||tablename||'.'||policyname||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,'')||':'||roles::text
      order by schemaname, tablename, policyname) from pg_policies where schemaname in ('public','private','storage')),
    'constraints', (select json_agg(conname||':'||pg_get_constraintdef(oid) order by conname) from pg_constraint where conrelid = 'public.tournament_purchases'::regclass),
    'triggers', (select json_agg(tgname order by tgname) from pg_trigger where tgrelid = 'public.tournament_purchases'::regclass and not tgisinternal),
    'roles', (select json_agg(json_build_object('name', rolname, 'login', rolcanlogin, 'inherit', rolinherit, 'super', rolsuper,
      'createrole', rolcreaterole, 'bypassrls', rolbypassrls) order by rolname) from pg_roles),
    'memberships', (select json_agg(pg_get_userbyid(roleid)||'>'||pg_get_userbyid(member)||' by '||pg_get_userbyid(grantor)||' a='||admin_option
      ||' i='||inherit_option||' s='||set_option order by 1) from pg_auth_members),
    'schema_acl', (select json_agg(nspname||':'||coalesce(nspacl::text,'') order by nspname) from pg_namespace where nspname in ('public','private')),
    'default_acl', (select json_agg(pg_get_userbyid(defaclrole)||':'||coalesce(defaclnamespace::regnamespace::text,'-')||':'||defaclobjtype::text||':'||defaclacl::text order by 1) from pg_default_acl),
    'data', json_build_object(
      'offers', (select md5(coalesce(string_agg(to_jsonb(o)::text, ',' order by o.offer_version, o.offer_code), '')) from public.tournament_commercial_offers o),
      'pricing', (select md5(coalesce(string_agg(to_jsonb(p)::text, ',' order by p.config_key), '')) from public.tournament_pricing_config p),
      'purchases', (select count(*) from public.tournament_purchases),
      'seasons', (select count(*) from public.tournament_seasons))
  )::text`));
}

before(async () => {
  await lab.up({ fresh: true, upTo: '00000000000017' });
  // Production today: 0017 without 0013 …
  lab.sql(`DO $$ BEGIN IF pg_has_role('${LAB_LOGIN}', '${ROLE}', 'MEMBER') THEN REVOKE ${ROLE} FROM ${LAB_LOGIN}; END IF; END $$;`);
  lab.sql(R13);
  // … and every public/private object owned by the installer, as on the hosted project.
  lab.sql(`DO $$ DECLARE r record; BEGIN
    FOR r IN SELECT format('ALTER TABLE %I.%I OWNER TO postgres', n.nspname, c.relname) q FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p','v','m','f')
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e') LOOP EXECUTE r.q; END LOOP;
    FOR r IN SELECT format('ALTER SEQUENCE %I.%I OWNER TO postgres', n.nspname, c.relname) q FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public','private') AND c.relkind = 'S'
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('e','a','i')) LOOP EXECUTE r.q; END LOOP;
    FOR r IN SELECT format('ALTER ROUTINE %s OWNER TO postgres', p.oid::regprocedure) q FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public','private') AND p.prokind IN ('f','p')
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') LOOP EXECUTE r.q; END LOOP;
    FOR r IN SELECT format('ALTER TYPE %I.%I OWNER TO postgres', n.nspname, t.typname) q FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname IN ('public','private') AND t.typtype IN ('e','d') LOOP EXECUTE r.q; END LOOP;
    EXECUTE 'ALTER SCHEMA private OWNER TO postgres';
  END $$;`);
});
after(() => { lab.down(); });

test('topology: postgres is the non-superuser CREATEROLE installer and owns every public/private table; no 0013', async () => {
  assert.equal(one("select rolsuper::text || ' ' || rolcreaterole::text from pg_roles where rolname = 'postgres'"), 'false true');
  assert.equal(one("select string_agg(distinct pg_get_userbyid(c.relowner), ',') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public','private') and c.relkind = 'r'"), 'postgres');
  assert.equal(D.classify(await deps.catalog()).state, 'PRE_0013');
});

test('apply → rollback leaves catalog, permissions and data identical; the implicit grant is the only membership ignored; re-apply works', async () => {
  const before0 = snapshot();
  const applied = await run('apply-0013');
  assert.equal(applied.verdict, 'APPLY_0013_DONE', JSON.stringify(applied));
  // The cause, observed: the installer holds the role it created — ADMIN, no INHERIT, no SET, granted by the bootstrap.
  assert.equal(one(`select pg_get_userbyid(member)||' a='||admin_option||' i='||inherit_option||' s='||set_option||' by '||pg_get_userbyid(grantor)
    from pg_auth_members where roleid = '${ROLE}'::regrole`), 'postgres a=true i=false s=false by supabase_admin');
  // REVOKE by the installer is a no-op (it is not the grantor): that is why the rollback has to recognise the grant.
  asPostgres(`REVOKE ${ROLE} FROM postgres;`);
  assert.equal(one(`select count(*) from pg_auth_members where roleid = '${ROLE}'::regrole and member = 'postgres'::regrole`), '1');
  const catalog = await deps.catalog();
  assert.deepEqual(catalog.production_logins, [], 'the implicit grant is not a login holding the role');
  assert.equal(catalog.installer_implicit_grant, true);
  assert.equal(D.classify(catalog).state, 'POST_0013');
  const rolled = await run('rollback-0013');
  assert.equal(rolled.verdict, 'ROLLBACK_0013_DONE', JSON.stringify(rolled));
  assert.deepEqual(snapshot(), before0, 'catalog, permissions and data as before 0013');
  const again = await run('apply-0013');
  assert.equal(again.verdict, 'APPLY_0013_DONE', JSON.stringify(again));
});

test('P3 as the installer: login created (SCRAM only), the rollback refuses while it holds the role, drop-login, rollback works again', async () => {
  const { scramVerifier } = await import('../infra/torneos-gateway-auth/gateway-auth-contract.mjs');
  const P = await import('../infra/torneos-payments-production/production-contract.mjs');
  let value = null;
  const keychain = { dbPassword: { check: () => (value ? 'PRESENT' : 'ABSENT'),
    generate: () => { if (value) throw new Error('KEYCHAIN_ENTRY_PRESENT_REFUSE_OVERWRITE'); value = crypto.randomBytes(30).toString('base64url'); return 'KEYCHAIN_GENERATED'; },
    read: () => value } };
  const loginDeps = { ...deps, keychain, scram: (password) => P.renderProductionLoginSql(scramVerifier(password)) };
  const word = (mode) => `${mode === 'login' ? 'CREATE' : 'DROP'} TORNEOS PAYMENTS PRODUCTION LOGIN ${P.PRODUCTION_LOGIN} ${D.REF}`.split(' ');
  assert.equal(D.classify(await deps.catalog()).state, 'POST_0013');
  // Before the fix the guard counted the installer's implicit membership: PRODUCTION_LOGIN_ALREADY_PRESENT.
  const created = await D.run('login', word('login'), loginDeps);
  assert.equal(created.verdict, 'LOGIN_DONE', JSON.stringify(created));
  const catalog = await deps.catalog();
  assert.deepEqual(catalog.production_logins.map((l) => [l.name, l.login, l.inherit, l.super, l.bypassrls]), [[P.PRODUCTION_LOGIN, true, false, false, false]]);
  assert.equal(catalog.installer_implicit_grant, true, 'the installer membership is still reported apart');
  assert.equal(one(`select pg_get_userbyid(grantor)||' i='||inherit_option||' s='||set_option from pg_auth_members where roleid = '${ROLE}'::regrole and member = '${P.PRODUCTION_LOGIN}'::regrole`),
    'postgres i=false s=true', 'the installer grants the role through its implicit ADMIN membership');
  // The login holding the role refuses the rollback (file and driver), and a second login is refused.
  assert.ok(/a login still holds/.test(asPostgres(R13).error ?? ''));
  await assert.rejects(run('rollback-0013'), /ROLLBACK_REFUSED/);
  await assert.rejects(D.run('login', word('login'), loginDeps), /PRODUCTION_LOGIN_ALREADY_PRESENT/);
  const dropped = await D.run('drop-login', word('drop-login'), loginDeps);
  assert.equal(dropped.verdict, 'DROP_LOGIN_DONE', JSON.stringify(dropped));
  assert.equal(one(`select count(*) from pg_roles where rolname = '${P.PRODUCTION_LOGIN}'`), '0');
  assert.deepEqual((await deps.catalog()).production_logins, []);
  // Back to the state of the previous test: rollback and re-apply still work.
  assert.equal((await run('rollback-0013')).verdict, 'ROLLBACK_0013_DONE');
  assert.equal((await run('apply-0013')).verdict, 'APPLY_0013_DONE');
});

test('the rollback still refuses — and keeps everything — with another member, a different installer grant, a login, or a purchase', async () => {
  assert.equal(D.classify(await deps.catalog()).state, 'POST_0013');
  const refused = (r) => r.code === 3 && /a login still holds|production purchases exist/.test(r.error);
  // Another (non-login) role holding the production role: refused, membership kept.
  lab.sql(`CREATE ROLE lab_foreign_holder NOLOGIN; GRANT ${ROLE} TO lab_foreign_holder;`);
  assert.ok(refused(asPostgres(R13)), 'another role');
  assert.equal(one(`select pg_has_role('lab_foreign_holder', '${ROLE}', 'MEMBER')`), 't', 'the foreign membership is kept');
  await assert.rejects(run('rollback-0013'), /PRE_STATE_DRIFT|ROLLBACK_REFUSED/, 'the driver refuses before writing');
  lab.sql(`REVOKE ${ROLE} FROM lab_foreign_holder; DROP ROLE lab_foreign_holder;`);
  // The installer's grant with different options (here INHERIT) is not the implicit one: refused.
  lab.sql(`GRANT ${ROLE} TO postgres WITH INHERIT TRUE GRANTED BY supabase_admin;`);
  assert.ok(refused(asPostgres(R13)), 'a different grant to the installer');
  lab.sql(`GRANT ${ROLE} TO postgres WITH INHERIT FALSE GRANTED BY supabase_admin;`);
  // A login holding the role (the production login's shape): refused.
  lab.sql(`GRANT ${ROLE} TO ${LAB_LOGIN};`);
  assert.ok(refused(asPostgres(R13)), 'a login');
  assert.equal(one(`select pg_has_role('${LAB_LOGIN}', '${ROLE}', 'MEMBER')`), 't');
  await assert.rejects(run('rollback-0013'), /ROLLBACK_REFUSED|PRE_STATE_DRIFT/);
  lab.sql(`REVOKE ${ROLE} FROM ${LAB_LOGIN};`);
  // A production purchase: refused, the row stays.
  const fx = await import('./lab/fixtures.mjs');
  fx.setScope('open');
  const w = fx.world('hosted-installer');
  const purchase = fx.checkout(w.owner, w);
  assert.ok(refused(asPostgres(R13)), 'a production purchase');
  assert.equal(fx.purchaseRow(purchase.id).provider_environment, 'production', 'the purchase is kept');
  await assert.rejects(run('rollback-0013'), /ROLLBACK_REFUSED/);
  assert.equal(D.classify(await deps.catalog()).state, 'POST_0013');
});
