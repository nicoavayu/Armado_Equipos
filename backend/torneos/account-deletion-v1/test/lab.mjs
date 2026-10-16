// ACCOUNT ERASURE 0021 lab: the commerce-production disposable PostgreSQL (its own container per checkout, named by
// COMMERCE_PRODUCTION_LAB_CONTAINER; never a shared lab), migrated 0000 → 0019 as the lab installer and then given
// Production's topology — every public/private object owned by `postgres`, the hosted installer, which is NOT a superuser
// (same emulation as sponsors-v1/test/lab.mjs). With ACCOUNT_DELETION_WITH_0020=<path of 00000000000020_premium_sponsors.sql>
// the sponsors migration (another branch, #212) is applied as `postgres` before 0021: 0021 must apply on main AND on
// main + 0020. 0021 and its rollback are applied by db-0021.mjs's own run() as `postgres`, exactly as the operator would.
// With ACCOUNT_DELETION_WITH_0022=<path of 00000000000022_content_moderation.sql> (moderation, #216) that migration is
// applied the same way (after 0020 when both are given): 0021 must apply and erase on main + 0022 and main + 0020 + 0022.
// Only fictional data ever enters this database. Nothing here reaches a remote host.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { ERASURE_LOGIN, REGRANT_SQL, newCredential, renderProvisionSql, renderRotationSql } from '../remote/erasure-login.mjs';

export const WITH_0020 = process.env.ACCOUNT_DELETION_WITH_0020 || null;
export const WITH_0022 = process.env.ACCOUNT_DELETION_WITH_0022 || null;
/** The suffix of evidence files and lab containers for this variant: '', '-with-0020', '-with-0022', '-with-0020-0022'. */
export const VARIANT = `${WITH_0020 || WITH_0022 ? '-with' : ''}${WITH_0020 ? '-0020' : ''}${WITH_0022 ? '-0022' : ''}`;
process.env.COMMERCE_PRODUCTION_LAB_CONTAINER ||= `arma2-account-deletion${VARIANT.replace('-with', '')}-lab-db`;
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const lab = await import('../../commerce-production/lab/pg-lab.mjs');
export const D = await import('../remote/db-0021.mjs');
export const CATALOG = fs.readFileSync(path.join(HERE, '../remote/sql-catalog-0021.sql'), 'utf8').trim();

export const one = (q) => lab.sql(q).trim();
export const asPostgres = (text) => { const r = lab.sqlTry(text, { user: 'postgres' }); return { code: r.ok ? 0 : 3, stderr_tail: r.error ?? '' }; };
/** The driver's dependencies on the lab: the catalog read inside a READ ONLY transaction, writes as the installer. */
export const deps = {
  readFile: (p) => fs.readFileSync(p),
  catalog: async () => JSON.parse(lab.sql(`BEGIN TRANSACTION READ ONLY;\nselect (\n${CATALOG}\n)::text;\nROLLBACK;\n`, { user: 'postgres' })
    .trim().split('\n').filter(Boolean).pop()),
  applySql: async (text) => asPostgres(text),
};
export const drive = (mode, { force = false } = {}) => (mode === 'observe' ? D.run('observe', [], deps)
  : D.run(mode, D.phraseFor(mode, { force }).split(' '), deps));
export const applied = () => one("select to_regprocedure('private.erase_tournament_account(uuid,uuid)') is not null") === 't';

/** 0000 → 0019, Production's ownership, then 0020 when asked; 0021 present or not as found (callers decide). */
export async function prepare() {
  await lab.up({ upTo: '00000000000019', fresh: process.env.ACCOUNT_DELETION_LAB_FRESH === '1' });
  // A variant lab must hold exactly its variant: order-0020.test.mjs leaves 0020 on the main lab (0021 → 0020), and an
  // earlier revision of 0021 cannot be rolled back by this tree's rollback file. Either → start this lab over.
  const has0020 = one("select to_regclass('public.tournament_organization_sponsors') is not null") === 't';
  const has0022 = one("select to_regclass('public.tournament_content_reports') is not null") === 't';
  const stale0021 = applied() && one("select md5(prosrc) from pg_proc where oid = to_regprocedure('private.erase_tournament_account(uuid,uuid)')")
    !== D.BODIES.POST_0021.erase;
  if ((has0020 && !WITH_0020) || (has0022 && !WITH_0022) || stale0021) await lab.up({ upTo: '00000000000019', fresh: true });
  lab.sql(`DO $$ DECLARE r record; BEGIN
    FOR r IN SELECT format('ALTER TABLE %I.%I OWNER TO postgres', n.nspname, c.relname) q FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p','v','m','f') AND pg_get_userbyid(c.relowner) <> 'postgres'
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e') LOOP EXECUTE r.q; END LOOP;
    FOR r IN SELECT format('ALTER SEQUENCE %I.%I OWNER TO postgres', n.nspname, c.relname) q FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public','private') AND c.relkind = 'S' AND pg_get_userbyid(c.relowner) <> 'postgres'
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('e','a','i')) LOOP EXECUTE r.q; END LOOP;
    FOR r IN SELECT format('ALTER ROUTINE %s OWNER TO postgres', p.oid::regprocedure) q FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public','private') AND p.prokind IN ('f','p') AND pg_get_userbyid(p.proowner) <> 'postgres'
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') LOOP EXECUTE r.q; END LOOP;
    FOR r IN SELECT format('ALTER TYPE %I.%I OWNER TO postgres', n.nspname, t.typname) q FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname IN ('public','private') AND t.typtype IN ('e','d') AND pg_get_userbyid(t.typowner) <> 'postgres' LOOP EXECUTE r.q; END LOOP;
    IF (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'private') <> 'postgres' THEN
      EXECUTE 'ALTER SCHEMA private OWNER TO postgres';
    END IF;
  END $$;`);
  // The hosted installer's default privileges (Supabase: every new function / table / sequence of `postgres` in public is
  // born granted to anon, authenticated and service_role), and the same in private as a worse-than-hosted case: whatever
  // 0021 creates must come out closed anyway (its own postconditions and the driver's catalog check it).
  lab.sql(['public', 'private'].flatMap((schema) => ['FUNCTIONS', 'TABLES', 'SEQUENCES'].map((kind) =>
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ${schema} GRANT ALL ON ${kind} TO anon, authenticated, service_role;`)).join('\n'));
  if (WITH_0020 && one("select to_regclass('public.tournament_organization_sponsors') is null") === 't') {
    const r = asPostgres(fs.readFileSync(WITH_0020, 'utf8'));
    if (r.code !== 0) throw new Error(`0020 did not apply on the lab: ${r.stderr_tail}`);
  }
  if (WITH_0022 && one("select to_regclass('public.tournament_content_reports') is null") === 't') {
    const r = asPostgres(fs.readFileSync(WITH_0022, 'utf8'));
    if (r.code !== 0) throw new Error(`0022 did not apply on the lab: ${r.stderr_tail}`);
  }
}

/** Makes sure the lab is at PRE_0021 (a previous run may have left 0021 and a ledger: discarded, the lab is disposable). */
export async function toPre() {
  if (!applied()) return;
  const out = await drive('rollback-0021', { force: true });
  if (out.verdict !== 'ROLLBACK_0021_DONE') throw new Error(`lab reset failed: ${JSON.stringify(out)}`);
}
export async function toPost() {
  if (applied()) return;
  const out = await drive('apply-0021');
  if (out.verdict !== 'APPLY_0021_DONE') throw new Error(`lab apply failed: ${JSON.stringify(out)}`);
}

// The gateway's database logins, as on the hosted project: NOINHERIT members of the NOLOGIN roles. The erasure login is
// the Production one (torneos_edge_erasure_writer), provisioned / rotated / re-granted with the exact SQL the operator
// sends (remote/erasure-login.mjs: SCRAM verifier, the plaintext never reaches the server).
export const GATEWAY_LOGINS = Object.freeze({
  coreAdapter: Object.freeze({ login: 'lab_erasure_core_adapter', role: 'torneos_core_adapter' }),
  identityWriter: Object.freeze({ login: 'lab_erasure_identity_writer', role: 'torneos_identity_writer' }),
  erasureWriter: Object.freeze({ login: ERASURE_LOGIN, role: 'torneos_erasure_writer' }),
});
const passwords = {};
/** The erasure login as the operator provisions it: first time → provision SQL; again → rotation SQL (+ re-grant). */
export function provisionErasureLogin() {
  const { password, verifier } = newCredential(randomBytes);
  const exists = one(`select count(*) from pg_roles where rolname = '${ERASURE_LOGIN}'`) === '1';
  const r = asPostgres(exists ? `${renderRotationSql(verifier)}${REGRANT_SQL}` : renderProvisionSql(verifier));
  if (r.code !== 0) throw new Error(`erasure login provisioning failed: ${r.stderr_tail}`);
  passwords[ERASURE_LOGIN] = password;
  return { url: `postgres://${ERASURE_LOGIN}:${password}@127.0.0.1:${lab.state().port}/postgres`, rotated: exists };
}
export function gatewayLoginUrl(kind) {
  const { login, role } = GATEWAY_LOGINS[kind];
  if (kind === 'erasureWriter') {
    if (!passwords[login]) provisionErasureLogin();
    // A forced rollback + re-apply of 0021 drops and recreates the role (the membership goes): the runbook's re-grant.
    else if (one(`select count(*) from pg_auth_members m join pg_roles r on r.oid = m.roleid join pg_roles l on l.oid = m.member
      where r.rolname = '${role}' and l.rolname = '${login}'`) !== '1') {
      const r = asPostgres(REGRANT_SQL);
      if (r.code !== 0) throw new Error(`erasure login re-grant failed: ${r.stderr_tail}`);
    }
    return `postgres://${login}:${passwords[login]}@127.0.0.1:${lab.state().port}/postgres`;
  }
  if (!passwords[login]) {
    passwords[login] = randomBytes(18).toString('hex');
    lab.sql(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${login}') THEN CREATE ROLE ${login} LOGIN NOINHERIT; END IF;
      EXECUTE format('ALTER ROLE ${login} PASSWORD %L', '${passwords[login]}');
      GRANT ${role} TO ${login};
    END $$;`);
  }
  return `postgres://${login}:${passwords[login]}@127.0.0.1:${lab.state().port}/postgres`;
}

/** The installer (postgres, not a superuser) over TCP: fixtures run as it, through the product's own RPCs where possible. */
export function installerPool() {
  const s = lab.state();
  return new pg.Pool({ host: '127.0.0.1', port: s.port, user: 'postgres', password: s.dbPassword, database: 'postgres', max: 4 });
}

/**
 * The gateway's database driver for the in-process gateway (npm:postgres stand-in over pg): `begin(fn)` is one
 * transaction on a lab login chosen by the login named in the gateway's URL (the hosted login names map to the lab ones).
 */
export function postgresStandIn() {
  return `import pg from ${JSON.stringify(fileURLToPath(import.meta.resolve('pg')))};
const urls = globalThis.__erasureLabUrls;
export default function postgres(url) {
  const login = decodeURIComponent(new URL(url).username).split('.')[0];
  const target = login.includes('erasure_writer') ? urls.erasureWriter : login.includes('core_adapter') ? urls.coreAdapter : urls.identityWriter;
  if (!target) throw Object.assign(new Error('connect ECONNREFUSED (no lab login for ' + login + ')'), { code: 'ECONNREFUSED' });
  const pool = new pg.Pool({ connectionString: target, max: 2 });
  return {
    begin: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ unsafe: async (q, params) => (await client.query(q, params)).rows });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
    },
    end: () => pool.end(),
  };
}`;
}
