// COMMERCE-PRODUCTION — 00000000000013 and its rollback on a disposable database of their own (container
// arma2-commerce-production-lab-rb, port 58651): POST_0011 → 0013 → rollback → the catalog of POST_0011 again, byte for
// byte; a re-application after the rollback works; the rollback refuses once a production purchase or login exists.
//   node --test backend/torneos/commerce-production/rollback-0013.test.mjs
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.COMMERCE_PRODUCTION_LAB_CONTAINER = 'arma2-commerce-production-lab-rb';
process.env.COMMERCE_PRODUCTION_LAB_PORT = '58651';
const lab = await import('./lab/pg-lab.mjs');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(path.join(lab.MIGRATIONS_DIR, '00000000000013_mercadopago_checkout_pro_production.sql'), 'utf8');
const ROLLBACK = readFileSync(path.join(HERE, 'rollback/00000000000013_mercadopago_checkout_pro_production.rollback.sql'), 'utf8');

// Everything 0013 could touch, as one comparable document (bodies by md5, ACLs, constraints, triggers, relations, roles).
const CATALOG = `select json_build_object(
  'functions', (select json_agg(x order by x) from (select p.oid::regprocedure::text || ' ' || md5(p.prosrc) || ' ' || coalesce(p.proacl::text, '') || ' ' || p.prosecdef x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private')) f),
  'purchase_constraints', (select json_agg(conname || ' ' || pg_get_constraintdef(oid) order by conname) from pg_constraint where conrelid = 'public.tournament_purchases'::regclass),
  'purchase_triggers', (select json_agg(tgname order by tgname) from pg_trigger where tgrelid = 'public.tournament_purchases'::regclass and not tgisinternal),
  'relations', (select json_agg(c.oid::regclass::text || ' ' || coalesce(c.relacl::text, '') order by c.oid::regclass::text) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public','private') and c.relkind in ('r','v','m','p','S')),
  'roles', (select json_agg(rolname order by rolname) from pg_roles where rolname like 'torneos_%'),
  'schema_acl', (select json_agg(nspname || ' ' || coalesce(nspacl::text, '') order by nspname) from pg_namespace where nspname in ('public','private'))
)`;
const catalog = () => JSON.parse(lab.sql(CATALOG).trim());

before(async () => { await lab.up({ fresh: true, upTo: '00000000000011' }); });
after(() => lab.down());

test('POST_0011 → 0013 → rollback leaves the catalog exactly as before; 0013 applies again afterwards', () => {
  const before0013 = catalog();
  lab.sql(MIGRATION);
  const with0013 = catalog();
  assert.notDeepEqual(with0013, before0013);
  lab.sql(ROLLBACK);
  assert.deepEqual(catalog(), before0013);
  lab.sql(MIGRATION);
  assert.deepEqual(catalog(), with0013);
});

test('the rollback refuses while a login holds the production role, and once a production purchase exists', async () => {
  lab.ensureLogins(JSON.parse(readFileSync(path.join((await import('node:os')).tmpdir(), 'arma2-commerce-production-lab', 'arma2-commerce-production-lab-rb.json'), 'utf8')).passwords);
  assert.match(lab.sqlTry(ROLLBACK).error, /a login still holds torneos_payment_production_service/);
  lab.sql('DROP ROLE lab_payment_production_service');
  const fx = await import('./lab/fixtures.mjs');
  fx.setScope('open');
  const w = fx.world('rollback');
  fx.checkout(w.owner, w);
  assert.match(lab.sqlTry(ROLLBACK).error, /production purchases exist/);
  assert.equal(lab.sql("select count(*) from pg_roles where rolname='torneos_payment_production_service'").trim(), '1');
});
