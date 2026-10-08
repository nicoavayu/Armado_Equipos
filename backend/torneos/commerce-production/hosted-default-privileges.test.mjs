// COMMERCE-PRODUCTION — 0013 under the hosted installer's default privileges. On Supabase the migrations run as postgres,
// whose default privileges in public grant EXECUTE on every new function and ALL on every new table and sequence to anon,
// authenticated and service_role; the lab installs as supabase_admin, which has no such grants, so a migration that only
// revokes FROM PUBLIC passes the lab and leaks in Production (the 0010 finding of the pilot dress rehearsal). Here
// supabase_admin is given postgres's hosted default ACL first, so every object 0013 creates is born exactly as it would be
// in Production, on a disposable database of its own (arma2-commerce-production-lab-defacl-<checkout tag>).
//   node --test backend/torneos/commerce-production/hosted-default-privileges.test.mjs
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.COMMERCE_PRODUCTION_LAB_CONTAINER = 'arma2-commerce-production-lab-defacl';
const lab = await import('./lab/pg-lab.mjs');
const CLIENT_ROLES = ['anon', 'authenticated', 'service_role'];
const TABLES = ['tournament_commerce_production_settings', 'tournament_commerce_production_allowlist', 'tournament_purchase_provider_checks'];
const json = (query) => JSON.parse(lab.sql(query).trim());

after(() => lab.down());

test('0013 born under the hosted default ACL: anon and service_role get nothing, authenticated only its two client functions', async () => {
  await lab.up({ fresh: true, upTo: lab.BEFORE_0013 });
  lab.sql(['FUNCTIONS', 'TABLES', 'SEQUENCES'].map((kind) =>
    `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON ${kind} TO ${CLIENT_ROLES.join(', ')};`).join('\n'));

  // The emulation bites: a throwaway function and table are executable / readable by anon, as on the hosted project.
  const probe = json(`CREATE FUNCTION public.defacl_probe() RETURNS int LANGUAGE sql AS 'select 1'; CREATE TABLE public.defacl_probe_t (x int);
    SELECT json_build_object('execute', has_function_privilege('anon', 'public.defacl_probe()', 'EXECUTE'),
      'select', has_table_privilege('anon', 'public.defacl_probe_t', 'SELECT'));`);
  lab.sql('DROP FUNCTION public.defacl_probe(); DROP TABLE public.defacl_probe_t;');
  assert.deepEqual(probe, { execute: true, select: true });

  lab.sql(fs.readFileSync(path.join(lab.MIGRATIONS_DIR, '00000000000013_mercadopago_checkout_pro_production.sql'), 'utf8'));

  const fns = `select p.oid, p.oid::regprocedure::text as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private') and (p.proname ~ 'production' or p.proname in ('get_tournament_season_purchases', 'enforce_tournament_purchase_payment_environment'))`;
  assert.equal(json(`select count(*) from (${fns}) f`), 14);
  const functionGrants = json(`select coalesce(json_agg(r.role || ' ' || f.name order by f.name, r.role), '[]') from (${fns}) f
    cross join unnest(array['${CLIENT_ROLES.join("','")}']) r(role) where has_function_privilege(r.role, f.oid, 'EXECUTE')`);
  assert.deepEqual(functionGrants, [
    'authenticated create_tournament_season_production_checkout_purchase(uuid,uuid,uuid)',
    'authenticated get_tournament_season_purchases(uuid,uuid)',
  ]);
  const tableGrants = json(`select coalesce(json_agg(r.role || ' ' || p.priv || ' ' || c.relname), '[]') from pg_class c
    join pg_namespace n on n.oid = c.relnamespace cross join unnest(array['${CLIENT_ROLES.join("','")}']) r(role)
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
    where n.nspname = 'public' and c.relname = any(array['${TABLES.join("','")}']) and has_table_privilege(r.role, c.oid, p.priv)`);
  assert.deepEqual(tableGrants, []);
  // 0013 creates no sequence, view or type that the default ACL could reach.
  assert.equal(json(`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
    and c.relkind in ('S','v','m') and c.relname ~ '(production|provider_checks)'`), 0);
});
