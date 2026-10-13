// P2 — the Production order on a real PostgreSQL: Production has no 0013 today. From POST_0017 without 0013:
//   0018 → 0013 → 0019, then back 0019 → 0013 → 0018 (each rollback file), then forward again.
// Each file carries its own pre/postconditions (md5 of every body it replaces); this suite checks the observable state
// between steps: the offer in force, the season rules, the production payment objects.
//   COMMERCE_PRODUCTION_LAB_CONTAINER=arma2-season-lab-db node --test backend/torneos/season-lifecycle/season-order.test.mjs
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { up, MIGRATIONS_DIR, REPO, sql, sqlTry } from '../commerce-production/lab/pg-lab.mjs';

const file = (p) => readFileSync(path.join(REPO, p), 'utf8');
const M18 = readFileSync(path.join(MIGRATIONS_DIR, '00000000000018_season_media_lifecycle.sql'), 'utf8');
const M13 = readFileSync(path.join(MIGRATIONS_DIR, '00000000000013_mercadopago_checkout_pro_production.sql'), 'utf8');
const M19 = readFileSync(path.join(MIGRATIONS_DIR, '00000000000019_season_commerce.sql'), 'utf8');
const R18 = file('backend/torneos/season-lifecycle/rollback/00000000000018_season_media_lifecycle.rollback.sql');
const R13 = file('backend/torneos/commerce-production/rollback/00000000000013_mercadopago_checkout_pro_production.rollback.sql');
const R19 = file('backend/torneos/season-lifecycle/rollback/00000000000019_season_commerce.rollback.sql');
const one = (q) => sql(q).trim();
// 0013's rollback refuses while a login holds the production payments role: the operator drops the login first
// (db-0013.mjs drop-login), and after re-applying 0013 the login is granted again (db-0013.mjs login).
const LOGIN = 'lab_payment_production_service';
const dropLogin = () => sql(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${LOGIN}')
  AND pg_has_role('${LOGIN}', 'torneos_payment_production_service', 'MEMBER') THEN
  REVOKE torneos_payment_production_service FROM ${LOGIN}; END IF; END $$;`);
const grantLogin = () => sql(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${LOGIN}') THEN
  GRANT torneos_payment_production_service TO ${LOGIN}; END IF; END $$;`);
const rollback13 = () => { dropLogin(); sql(R13); };
const has = (sig) => one(`select to_regprocedure('${sig}') is not null`) === 't';
const state = () => ({
  s0018: has('public.run_tournament_season_media_lifecycle()'),
  s0013: has('public.create_tournament_season_production_checkout_purchase(uuid,uuid,uuid)'),
  s0019: one(`select coalesce(position('TORNEOS_SEASON_NOT_PURCHASABLE' in prosrc) > 0, false) from pg_proc
    where oid = to_regprocedure('public.create_tournament_season_production_checkout_purchase(uuid,uuid,uuid)')`) === 't',
  offer: one(`select amount || '/' || list_amount from public.tournament_commercial_offers where product_code = 'torneos_premium'
    and availability = 'available' and valid_from <= now() and (valid_until is null or valid_until > now())
    order by valid_from desc, offer_version desc limit 1`),
  premium: one("select gallery_asset_limit from public.tournament_plan_catalog where plan_code = 'PREMIUM'"),
});

before(async () => {
  await up({ upTo: '00000000000017' });
  // Start where Production is: POST_0017 without 0013 (and without 0018/0019).
  if (state().s0019) sql(R19);
  if (state().s0018) sql(R18);
  if (state().s0013) rollback13();
});

test('Production order 0018 → 0013 → 0019, back 0019 → 0013 → 0018, and forward again', () => {
  assert.deepEqual(state(), { s0018: false, s0013: false, s0019: false, offer: '39900/49900', premium: '1000' }, 'Production today');
  // 0019 refuses to run before 0013 and 0018.
  assert.match(sqlTry(M19).error, /TORNEOS_0019_PRECONDITION_FAILED/);
  sql(M18);
  assert.deepEqual(state(), { s0018: true, s0013: false, s0019: false, offer: '39900/49900', premium: '100' }, '0018 alone (no payments)');
  sql(M13); grantLogin();
  assert.deepEqual(state(), { s0018: true, s0013: true, s0019: false, offer: '39900/49900', premium: '100' }, '0013 on top of 0018');
  sql(M19);
  assert.deepEqual(state(), { s0018: true, s0013: true, s0019: true, offer: '20000/20000', premium: '100' }, '0019');
  // Back, in the only safe order.
  sql(R19);
  assert.deepEqual(state(), { s0018: true, s0013: true, s0019: false, offer: '39900/49900', premium: '100' }, 'rollback 0019');
  rollback13();
  assert.deepEqual(state(), { s0018: true, s0013: false, s0019: false, offer: '39900/49900', premium: '100' }, 'rollback 0013');
  sql(R18);
  assert.deepEqual(state(), { s0018: false, s0013: false, s0019: false, offer: '39900/49900', premium: '1000' }, 'rollback 0018 = Production today');
  // Forward again, then leave the lab as the other suites expect it (0013 back, 0018 on top).
  sql(M18); sql(M13); grantLogin(); sql(M19);
  assert.deepEqual(state(), { s0018: true, s0013: true, s0019: true, offer: '20000/20000', premium: '100' }, 'forward again');
  sql(R19);
});
