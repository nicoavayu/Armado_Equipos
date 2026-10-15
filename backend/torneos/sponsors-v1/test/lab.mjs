// PREMIUM SPONSORS 0020 lab: the commerce-production disposable PostgreSQL (its own container per checkout, named by
// COMMERCE_PRODUCTION_LAB_CONTAINER; never the shared lab), migrated 0000 → 0019 as the lab installer and then given
// Production's topology — every public/private object owned by `postgres`, the hosted installer, which is NOT a superuser
// (same emulation as commerce-production/rollback-0013-hosted-installer.test.mjs). 0020 and its rollback are applied by
// db-0020.mjs's own run() as `postgres`, exactly as the operator would, with the same read-only catalog.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.COMMERCE_PRODUCTION_LAB_CONTAINER ||= 'arma2-sponsors-lab-db';
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const lab = await import('../../commerce-production/lab/pg-lab.mjs');
export const F = await import('../../commerce-production/lab/fixtures.mjs');
export const D = await import('../remote/db-0020.mjs');
export const CATALOG = fs.readFileSync(path.join(HERE, '../remote/sql-catalog-0020.sql'), 'utf8').trim();

export const one = (q) => lab.sql(q).trim();
export const asPostgres = (text) => { const r = lab.sqlTry(text, { user: 'postgres' }); return { code: r.ok ? 0 : 3, stderr_tail: r.error ?? '' }; };
/** The driver's dependencies on the lab: the catalog read inside a READ ONLY transaction, writes as the installer. */
export const deps = {
  readFile: (p) => fs.readFileSync(p),
  catalog: async () => JSON.parse(lab.sql(`BEGIN TRANSACTION READ ONLY;\nselect (\n${CATALOG}\n)::text;\nROLLBACK;\n`, { user: 'postgres' })
    .trim().split('\n').filter(Boolean).pop()),
  applySql: async (text) => asPostgres(text),
};
export const drive = (mode, { force = false } = {}) => D.run(mode, D.phraseFor(mode, { force }).split(' '), deps);
export const applied = () => one("select to_regclass('public.tournament_organization_sponsors') is not null") === 't';

/** 0000 → 0019, then Production's ownership; 0020 present or not as found (callers decide). */
export async function prepare() {
  await lab.up({ upTo: '00000000000019' });
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
}

/** Makes sure the lab is at PRE_0020 (a previous run may have left 0020 and rows: discarded, as the lab is disposable). */
export async function toPre() {
  if (!applied()) return;
  const out = await drive('rollback-0020', { force: true });
  if (out.verdict !== 'ROLLBACK_0020_DONE') throw new Error(`lab reset failed: ${JSON.stringify(out)}`);
}
export async function toPost() {
  if (applied()) return;
  const out = await drive('apply-0020');
  if (out.verdict !== 'APPLY_0020_DONE') throw new Error(`lab apply failed: ${JSON.stringify(out)}`);
}

/** Everything 0020 and its rollback could touch outside its own objects: catalog, permissions, data of the neighbours. */
export function snapshot() {
  return JSON.parse(one(`select json_build_object(
    'functions', (select json_agg(json_build_object('sig', p.oid::regprocedure::text, 'md5', md5(p.prosrc), 'acl', p.proacl::text,
      'owner', pg_get_userbyid(p.proowner), 'definer', p.prosecdef, 'config', p.proconfig::text, 'volatile', p.provolatile)
      order by p.oid::regprocedure::text)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private')),
    'relations', (select json_agg(json_build_object('rel', n.nspname||'.'||c.relname, 'kind', c.relkind, 'acl', c.relacl::text,
      'owner', pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity) order by n.nspname, c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public','private','storage') and c.relkind in ('r','v','m','S','p','i')),
    'constraints', (select json_agg(conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid) order by conrelid::regclass::text, conname)
      from pg_constraint where connamespace in ('public'::regnamespace, 'private'::regnamespace)),
    'policies', (select json_agg(schemaname||'.'||tablename||'.'||policyname||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,'')||':'||roles::text
      order by schemaname, tablename, policyname) from pg_policies where schemaname in ('public','private','storage')),
    'schema_acl', (select json_agg(nspname||':'||coalesce(nspacl::text,'') order by nspname) from pg_namespace where nspname in ('public','private')),
    'default_acl', (select json_agg(pg_get_userbyid(defaclrole)||':'||coalesce(defaclnamespace::regnamespace::text,'-')||':'||defaclobjtype::text||':'||defaclacl::text order by 1) from pg_default_acl),
    'buckets', (select json_agg(to_jsonb(b) - 'created_at' - 'updated_at' order by b.id) from storage.buckets b),
    'data', json_build_object(
      'organizations', (select md5(coalesce(string_agg(to_jsonb(o)::text, ',' order by o.id), '')) from public.tournament_organizations o),
      'seasons', (select count(*) from public.tournament_seasons),
      'grants', (select count(*) from public.tournament_season_plan_grants),
      'capabilities', (select md5(coalesce(string_agg(to_jsonb(c)::text, ',' order by c.capability), '')) from public.tournament_entitlement_capabilities c))
  )::text`));
}
