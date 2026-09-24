// MP-A2 — T10: Mercado Pago TEST commercial DB delta (00000000000002_mercadopago_checkout_pro_test.sql)
// on the REAL local Supabase stack (the Phase 3A/2C/2D lab). DB-only: no provider HTTP, no Mercado Pago
// API, no webhook, no gateway commerce route, no frontend. Runs after `npm run up` on a lab rebuilt from
// empty volumes. Actors reach the database the way the hybrid stack does:
//   * authenticated: PostgREST with a lab-signed bridge bearer, or SQL `SET LOCAL ROLE authenticated`
//     with the same bridge claims (server position);
//   * payment service: the local NOINHERIT login `lab_payment_service` (lab.mjs) that must SET ROLE
//     torneos_payment_service, or SQL `SET LOCAL ROLE torneos_payment_service`.
// Every check is a named subtest; results go to backend/torneos/mp-a/evidence/. Nothing remote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { SignJWT, importPKCS8 } from 'jose';
import { config, sql, sqlTry, inGateway, repo } from './lab.mjs';

const cfg = await config();
const RUN = 'mpa2' + randomBytes(2).toString('hex');
const MIGRATIONS = `${repo}backend/torneos/supabase/migrations/`;
const M0 = '00000000000000_torneos_baseline_v1.sql';
const M1 = '00000000000001_staging_v1_rpc_exposure.sql';
const M3 = '00000000000003_mercadopago_provider_ordering.sql';
const M2 = '00000000000002_mercadopago_checkout_pro_test.sql';
// Certified (Phase 2D / stack 38f33b9a / main c2dfc3ed) hashes of the two earlier migrations, and the
// pinned hash of the MP-A2 migration under certification.
const SHA = {
  [M0]: 'f857bd0939054bc1a32a3855894b7b20e14a0c7456c9d5c8c5e8432e5b8ed19f',
  [M1]: '3df4b96eecc7321eaeda84a480f089fe4bff2b28c20aa4479db92caf33457e62',
  [M2]: '06378f12b57620e8ae550a0d881ad66464ffdc0a734ad621cba8a6ba3e6d6078',
};
const DELTA = JSON.parse(await readFile(`${repo}backend/torneos/mp-a/mp-a2-acl-delta.json`, 'utf8'));
// MP-B1.2 replaces the two payment signatures; the allowed EXECUTE count stays four.
for (const f of DELTA.new_security_definer_functions) {
  if (f.function.startsWith('apply_verified_tournament_payment_')) {
    f.function = f.function.replace(/\)$/, ',timestamp with time zone)');
    f.identity_arguments += ', p_date_last_updated timestamp with time zone';
  }
}
DELTA.payment_service_execute = DELTA.payment_service_execute.map(f => f.startsWith('apply_verified_tournament_payment_') ? f.replace(/\)$/, ',timestamp with time zone)') : f);
// Synthetic provider clock for this DB-only policy regression, not a runtime authority.
let providerClock = 0;
const providerTime = () => lit(new Date(Date.UTC(2026, 0, 1) + ++providerClock * 1000).toISOString());
const EVIDENCE = `${repo}backend/torneos/mp-a/evidence/`;
const TAG = process.env.MP_A2_EVIDENCE_TAG ? `-${process.env.MP_A2_EVIDENCE_TAG}` : '';
const PAY = 'torneos_payment_service';
const results = [];
const seenSecrets = [];
const matrix = { functions: [], relations: [] };

// ---------------------------------------------------------------- SQL helpers
const lit = (v) => (v === null || v === undefined) ? 'null' : `'${String(v).replace(/'/g, "''")}'`;
const admin = (q) => sql('torneos-db', q);
const j = (s) => JSON.parse(s);
/** One transaction as `role` (null = the installer, supabase_admin) with optional bridge claims; returns the last line or throws "ERROR: <SQLSTATE>: <message>". */
function run(role, claims, query) {
  const r = sqlTry('torneos-db', `\\set VERBOSITY verbose\nBEGIN; ${role ? `SET LOCAL ROLE ${role};` : ''} SELECT set_config('request.jwt.claims', ${lit(claims ? JSON.stringify(claims) : '')}, true); ${query}; COMMIT;`);
  if (!r.ok) throw new Error(r.error || 'sql failed');
  return r.out.trim().split('\n').pop();
}
function errOf(fn) { try { fn(); return null; } catch (e) { return String(e.message ?? e); } }
function expectErr(fn, code, message) {
  const e = errOf(fn);
  assert.ok(e, `expected ${code} ${message}`);
  assert.match(e, new RegExp(`${code}: ${message}`), e);
}
/** Raw SQL in its own transaction; returns { ok, error }. */
function rawTx(query) { const r = sqlTry('torneos-db', `\\set VERBOSITY verbose\n${query}`); return { ok: r.ok, error: r.error ?? '' }; }

// ---------------------------------------------------------------- identities / bearers
function claimsOf(actor) {
  const now = Math.floor(Date.now() / 1000);
  return { role: 'authenticated', iss: 'urn:arma2:local:identity-bridge', aud: 'arma2-torneos-local', sub: actor.id, core_user_id: actor.core,
    session_id: randomUUID(), jti: randomUUID(), iat: now, nbf: now, exp: now + 120 };
}
function identity(label) {
  const a = { label, id: randomUUID(), core: randomUUID() };
  admin(`SET ROLE torneos_identity_writer; INSERT INTO public.torneos_identity(id, core_user_id) VALUES (${lit(a.id)}, ${lit(a.core)}); RESET ROLE;`);
  return a;
}
async function bearer(actor) {
  const key = cfg.keys.find(k => k.kid === cfg.activeKid);
  const c = claimsOf(actor);
  const token = await new SignJWT({ role: 'authenticated', core_user_id: actor.core, session_id: c.session_id })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: key.kid }).setIssuer(c.iss).setAudience(c.aud)
    .setSubject(actor.id).setIssuedAt(c.iat).setNotBefore(c.nbf).setExpirationTime(c.exp).setJti(c.jti)
    .sign(await importPKCS8(key.privateKey, 'RS256'));
  seenSecrets.push(token);
  return token;
}
const asUser = (actor, q) => run('authenticated', claimsOf(actor), q);
const asPay = (q) => run(PAY, null, q);

// ---------------------------------------------------------------- PostgREST (inside the private network) and the payment login
function rest(calls, parallel = false) {
  const out = inGateway(`const calls = ${JSON.stringify(calls)};
    const one = async (c) => { const r = await fetch('http://torneos-rest:3000' + c.path, { method: c.method ?? 'POST',
      headers: { 'content-type': 'application/json', ...(c.token ? { authorization: 'Bearer ' + c.token } : {}) },
      body: (c.method ?? 'POST') === 'GET' ? undefined : JSON.stringify(c.body ?? {}) });
      const text = await r.text(); let body; try { body = JSON.parse(text); } catch { body = text; } return { id: c.id, status: r.status, body }; };
    const out = ${parallel ? 'await Promise.all(calls.map(one))' : '[]'};
    ${parallel ? '' : 'for (const c of calls) out.push(await one(c));'}
    console.log(JSON.stringify(out));`);
  return JSON.parse(out.trim().split('\n').pop());
}
const deniedBeforeBody = (r) => [401, 403].includes(r.status) && r.body?.code === '42501' && /permission denied for (function|table)/.test(r.body?.message ?? '');
/** Sessions of the local payment-service login; each session runs its steps in order; sessions run in parallel. */
function paymentLogin(sessions) {
  const url = `postgres://lab_payment_service:${cfg.paymentServicePassword}@torneos-db:5432/postgres`;
  const out = inGateway(`import pg from 'pg';
    const sessions = ${JSON.stringify(sessions)};
    const runSession = async (steps) => { const client = new pg.Client({ connectionString: ${JSON.stringify(url)} }); await client.connect(); const out = [];
      for (const s of steps) { try { const r = await client.query(s.sql, s.params ?? []); out.push({ id: s.id, ok: true, rows: r.rows }); }
        catch (e) { out.push({ id: s.id, ok: false, code: e.code, message: String(e.message).slice(0, 160) }); } }
      await client.end(); return out; };
    console.log(JSON.stringify(await Promise.all(sessions.map(runSession))));`);
  return JSON.parse(out.trim().split('\n').pop());
}

// ---------------------------------------------------------------- domain helpers
let owner, org;
const newKey = () => randomUUID();
function newSeason(label, actor = owner, organization = org) {
  const r = j(asUser(actor, `select public.create_tournament_season(${lit(organization)}, ${lit(`MP ${label} ${RUN}`)}, ${lit(`mp-${label}-${RUN}`)}, null, null, ${lit(newKey())})`));
  assert.ok(r.id, `season ${label}`);
  return r.id;
}
const checkout = (actor, season, key = newKey(), organization = org) =>
  j(asUser(actor, `select public.create_tournament_season_checkout_purchase(${lit(organization)}, ${lit(season)}, ${lit(key)})`));
const prefId = (p) => `mp-pref-${p}`;
const pref = (p, expires = "now() + interval '30 minutes'") =>
  j(asPay(`select public.record_tournament_purchase_preference(${lit(p)}, 'MERCADO_PAGO', 'test', ${lit(prefId(p))}, ${expires})`));
const status = (p, st, pay, detail = null, providerStatus = st) =>
  j(asPay(`select public.apply_verified_tournament_payment_status(${lit(p)}, 'MERCADO_PAGO', 'test', ${lit(st)}, ${lit(providerStatus)}, ${lit(detail)}, ${lit(pay)}, ${providerTime()})`));
const reversal = (p, action, pay, providerStatus = 'refunded', detail = null) =>
  j(asPay(`select public.apply_verified_tournament_payment_reversal(${lit(p)}, 'MERCADO_PAGO', 'test', ${lit(action)}, ${lit(providerStatus)}, ${lit(detail)}, ${lit(pay)}, ${providerTime()})`));
const purchase = (p) => j(admin(`select to_jsonb(x) from public.tournament_purchases x where id = ${lit(p)}`));
const events = (p) => j(admin(`select coalesce(json_agg(json_build_object('type', event_type, 'from', from_status, 'to', to_status, 'actor', actor_type, 'meta', metadata) order by id), '[]') from public.tournament_purchase_events where purchase_id = ${lit(p)}`));
const eventTypes = (p) => events(p).map(e => e.type);
const grantState = (p) => j(admin(`select json_build_object('grants', (select count(*) from public.tournament_season_plan_grants where origin_purchase_id = ${lit(p)}),
  'events', (select coalesce(json_agg(e.event_type order by e.id), '[]') from public.tournament_season_plan_grant_events e join public.tournament_season_plan_grants g on g.id = e.season_grant_id where g.origin_purchase_id = ${lit(p)}))`));
const seasonGrants = (season) => Number(admin(`select count(*) from public.tournament_season_plan_grants where season_id = ${lit(season)}`).trim());
const plan = (season, actor = owner) => j(asUser(actor, `select public.get_effective_tournament_season_entitlements(${lit(org)}, ${lit(season)})`)).plan;
const openCount = (season) => Number(admin(`select count(*) from public.tournament_purchases where season_id = ${lit(season)} and status in ('created','preference_created','pending')`).trim());
const pay = (label) => `${RUN}-${label}-${randomBytes(3).toString('hex')}`;
/** Effective season grants (any source), the quantity that must never exceed 1. */
const effectiveGrants = (season) => Number(admin(`select count(*) from public.tournament_season_plan_grants g where g.season_id = ${lit(season)} and public.is_tournament_season_plan_grant_effective(g.id)`).trim());
const purchaseCount = (season) => Number(admin(`select count(*) from public.tournament_purchases where season_id = ${lit(season)}`).trim());
const observed = { maxEffectiveGrantsPerSeason: 0, multiPendingSequences: 0 };
function observeEffective(season) {
  const n = effectiveGrants(season);
  observed.maxEffectiveGrantsPerSeason = Math.max(observed.maxEffectiveGrantsPerSeason, n);
  assert.ok(n <= 1, `season ${season} has ${n} effective grants`);
  return n;
}
function permutations(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(rest => [x, ...rest]));
}
/** A fresh season with an MP TEST purchase whose preference is recorded (status preference_created). */
function openPurchase(label, expires) {
  const season = newSeason(label);
  const p = checkout(owner, season);
  pref(p.id, expires);
  return { season, id: p.id, externalReference: p.externalReference };
}

test('MP-A2 — Mercado Pago TEST commercial DB delta (T10)', async (t) => {
  async function check(name, fn) {
    await t.test(name, async () => {
      try { await fn(); results.push({ name, status: 'PASS' }); }
      catch (error) { results.push({ name, status: 'FAIL', error: String(error.message ?? error).slice(0, 400) }); throw error; }
    });
  }
  try {
    // ============================================================ A. schema / migration chain
    await check('schema: migrations are exactly 0000 → 0001 → 0002 → 0003 in order; 0000/0001 byte-identical to the certified stack; 0002 pinned; the lab applied all four from empty volumes', async () => {
      const files = (await readdir(MIGRATIONS)).filter(f => f.endsWith('.sql')).sort();
      assert.deepEqual(files, [M0, M1, M2, M3]);
      for (const f of [M0, M1, M2]) assert.equal(createHash('sha256').update(await readFile(MIGRATIONS + f)).digest('hex'), SHA[f], f);
      const install = JSON.parse(await readFile(new URL('.runtime/install.json', import.meta.url), 'utf8'));
      assert.equal(install.torneos.sha256, SHA[M0]); assert.equal(install.torneos.installed, true, 'baseline installed from an empty volume');
      assert.deepEqual(install.torneos.migrations_after_baseline.map(m => [m.file.split('/').pop(), m.sha256, m.applied]), [[M1, SHA[M1], true], [M2, SHA[M2], true], [M3, createHash('sha256').update(await readFile(MIGRATIONS + M3)).digest('hex'), true]]);
      const text = await readFile(MIGRATIONS + M2, 'utf8');
      assert.match(text.trim(), /^--[\s\S]*^BEGIN;$[\s\S]*^COMMIT;$/m, 'BEGIN … COMMIT');
      assert.equal((text.match(/^BEGIN;$/gm) ?? []).length, 1); assert.equal((text.match(/^COMMIT;$/gm) ?? []).length, 1);
      assert.ok(text.trim().endsWith('COMMIT;'));
      assert.ok(!/\bproduction\b.*MERCADO_PAGO|MERCADO_PAGO.*\bproduction\b/i.test(text.split('\n').filter(l => !l.startsWith('--')).join('\n')), 'no production support in SQL');
      assert.ok(!/https?:\/\/|eyJ[A-Za-z0-9_-]{10,}|APP_USR-|TEST-[0-9]{6,}|access_token|PASSWORD/i.test(text), 'no URLs, tokens or credentials in the migration');
      assert.ok(!/\bLOGIN\b/.test(text.replace(/\bNOLOGIN\b/g, '')), 'the migration creates no login');
    });
    await check('schema: CHECK provider = FAKE | MERCADO_PAGO; CHECK environment = FAKE+local | FAKE+qa | MERCADO_PAGO+test only (production/live/any other pair rejected, 23514)', async () => {
      // The suite's owner and organization are created first so every later check has its fixture.
      owner = identity('owner');
      org = j(asUser(owner, `select public.create_tournament_organization(${lit(`MP-A2 League ${RUN}`)}, ${lit(`mpa2-league-${RUN}`)}, ${lit(newKey())})`)).organization.id;
      const defs = j(admin(`select json_object_agg(conname, pg_get_constraintdef(oid)) from pg_constraint where conrelid = 'public.tournament_purchases'::regclass and conname in ('tournament_purchases_provider_check','tournament_purchases_environment_check')`));
      assert.match(defs.tournament_purchases_provider_check, /'FAKE'::text, 'MERCADO_PAGO'::text/);
      assert.match(defs.tournament_purchases_environment_check, /MERCADO_PAGO/);
      assert.ok(!/production|live/.test(defs.tournament_purchases_environment_check));
      const season = newSeason('checks');
      const row = (provider, env) => `insert into public.tournament_purchases (organization_id, season_id, buyer_user_id, product_code, offer_code, offer_version, list_amount_snapshot, amount_snapshot, currency, provider, provider_environment, external_reference, idempotency_key, status)
        values (${lit(org)}, ${lit(season)}, ${lit(owner.id)}, 'torneos_premium', 'launch', 1, 49900, 39900, 'ARS', ${lit(provider)}, ${lit(env)}, ${lit('arma2:season:purchase:' + randomUUID())}, ${lit(newKey())}, 'created')`;
      const outcome = {};
      for (const [provider, env] of [['FAKE', 'local'], ['FAKE', 'qa'], ['MERCADO_PAGO', 'test'], ['MERCADO_PAGO', 'production'], ['MERCADO_PAGO', 'live'], ['MERCADO_PAGO', 'local'], ['MERCADO_PAGO', 'qa'], ['FAKE', 'test'], ['FAKE', 'production'], ['STRIPE', 'test'], ['mercado_pago', 'test']]) {
        const r = rawTx(`BEGIN; ${row(provider, env)}; ROLLBACK;`);
        outcome[`${provider}+${env}`] = r.ok ? 'accepted' : (/23514/.test(r.error) ? 'rejected_23514' : r.error);
      }
      assert.deepEqual(outcome, {
        'FAKE+local': 'accepted', 'FAKE+qa': 'accepted', 'MERCADO_PAGO+test': 'accepted',
        'MERCADO_PAGO+production': 'rejected_23514', 'MERCADO_PAGO+live': 'rejected_23514', 'MERCADO_PAGO+local': 'rejected_23514', 'MERCADO_PAGO+qa': 'rejected_23514',
        'FAKE+test': 'rejected_23514', 'FAKE+production': 'rejected_23514', 'STRIPE+test': 'rejected_23514', 'mercado_pago+test': 'rejected_23514',
      });
      assert.equal(openCount(season), 0, 'probes rolled back');
    });
    await check('schema: 0002 is fail-closed (a drifted prior schema aborts it with TORNEOS_MP_A2_PRECONDITION_FAILED and nothing changes) and idempotent on the certified post-state', async () => {
      const text = await readFile(MIGRATIONS + M2, 'utf8');
      const snapshot = () => admin(`select md5(string_agg(x, '|' order by x)) from (
          select pg_get_constraintdef(oid) x from pg_constraint where conrelid = 'public.tournament_purchases'::regclass
          union all select p.oid::regprocedure::text || coalesce(p.proacl::text, '') || md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like '%purchase%' or p.proname like '%payment%' or p.proname like '%entitlement%')
          union all select rolname || rolcanlogin || rolinherit from pg_roles where rolname = '${PAY}'
          union all select tgname from pg_trigger where tgrelid = 'public.tournament_season_plan_grant_events'::regclass and not tgisinternal) s`).trim();
      const before = snapshot();
      const drifts = {
        provider_check_widened: `ALTER TABLE public.tournament_purchases DROP CONSTRAINT tournament_purchases_provider_check; ALTER TABLE public.tournament_purchases ADD CONSTRAINT tournament_purchases_provider_check CHECK (provider IN ('FAKE','MERCADO_PAGO','STRIPE'));`,
        environment_check_production: `ALTER TABLE public.tournament_purchases DROP CONSTRAINT tournament_purchases_environment_check; ALTER TABLE public.tournament_purchases ADD CONSTRAINT tournament_purchases_environment_check CHECK (provider_environment IN ('local','qa','test','production'));`,
        baseline_function_missing: `ALTER FUNCTION public.create_tournament_season_purchase(uuid,uuid,text,uuid,text,text) RENAME TO mp_a2_probe_missing;`,
        activation_function_missing: `ALTER FUNCTION public.activate_verified_tournament_purchase(uuid,text,text,text,text,text,text) RENAME TO mp_a2_probe_missing;`,
        transition_trigger_drift: `CREATE OR REPLACE FUNCTION public.enforce_tournament_purchase_transition() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $x$ begin return new; end; $x$;`,
        payment_role_can_login: `ALTER ROLE ${PAY} LOGIN;`,
        open_purchase_index_missing: `DROP INDEX public.tournament_purchases_open_season_product_unique;`,
      };
      const outcome = {};
      for (const [name, drift] of Object.entries(drifts)) {
        const probe = text.replace(/^BEGIN;$/m, `BEGIN;\n${drift}`).replace(/^COMMIT;$/m, 'ROLLBACK;');
        const r = rawTx(probe);
        outcome[name] = !r.ok && /TORNEOS_MP_A2_PRECONDITION_FAILED/.test(r.error) ? 'aborted' : (r.ok ? 'APPLIED' : r.error.slice(0, 120));
      }
      assert.deepEqual(outcome, Object.fromEntries(Object.keys(drifts).map(k => [k, 'aborted'])));
      assert.equal(snapshot(), before, 'aborted probes changed nothing');
      // Restore only the historical signatures inside a rolled-back fixture to check 0002's
      // certified post-state. Never reapply/commit an older migration over 0003.
      const historical = ['status', 'reversal'].map(kind => `
        DROP FUNCTION public.apply_verified_tournament_payment_${kind}(uuid,text,text,text,text,text,text,timestamptz);
        ALTER FUNCTION public.unordered_tournament_payment_${kind}(uuid,text,text,text,text,text,text) RENAME TO apply_verified_tournament_payment_${kind};
        GRANT EXECUTE ON FUNCTION public.apply_verified_tournament_payment_${kind}(uuid,text,text,text,text,text,text) TO torneos_payment_service;
      `).join('\n');
      const again = rawTx(text.replace(/^BEGIN;$/m, `BEGIN;\n${historical}`).replace(/^COMMIT;$/m, 'ROLLBACK;'));
      assert.equal(again.ok, true, `re-apply on the post-state: ${again.error}`);
      assert.equal(snapshot(), before, 're-apply is a no-op on the certified post-state');
    });

    // ============================================================ B. fixture + identity / authorization
    let seasonA, seasonB, admSeated, admUnseated, collaborator, outsider, otherOwner, otherOrg, otherSeason, seasonCollab;
    await check('fixture: organization (owner), seasons, a seated admin (billing.manage), an unseated admin, a seated collaborator (no billing.manage), an outsider, and another workspace with its own season', async () => {
      assert.ok(owner && org, 'owner and organization from the schema checks');
      seasonA = newSeason('a'); seasonB = newSeason('b'); seasonCollab = newSeason('collab');
      const member = (actor, role, season) => {
        const m = admin(`insert into public.tournament_organization_members(organization_id, user_id, role, joined_at) values (${lit(org)}, ${lit(actor.id)}, ${lit(role)}, now()) returning id`).trim();
        if (season) admin(`insert into public.tournament_season_member_assignments(organization_id, season_id, membership_id, assigned_by) values (${lit(org)}, ${lit(season)}, ${lit(m)}, ${lit(owner.id)})`);
      };
      admSeated = identity('admin-seated'); member(admSeated, 'admin', seasonA);
      admUnseated = identity('admin-unseated'); member(admUnseated, 'admin', null);
      collaborator = identity('collaborator'); member(collaborator, 'collaborator', seasonCollab);
      outsider = identity('outsider');
      otherOwner = identity('other-owner');
      otherOrg = j(asUser(otherOwner, `select public.create_tournament_organization(${lit(`MP-A2 Other ${RUN}`)}, ${lit(`mpa2-other-${RUN}`)}, ${lit(newKey())})`)).organization.id;
      otherSeason = newSeason('other', otherOwner, otherOrg);
      assert.equal(asUser(admSeated, `select public.has_tournament_season_capability(${lit(org)}, ${lit(seasonA)}, 'billing.manage')`), 't');
      assert.equal(asUser(admUnseated, `select public.has_tournament_season_access(${lit(org)}, ${lit(seasonA)})`), 'f');
      assert.equal(asUser(collaborator, `select public.has_tournament_season_access(${lit(org)}, ${lit(seasonCollab)})`), 't');
      assert.equal(asUser(collaborator, `select public.has_tournament_season_capability(${lit(org)}, ${lit(seasonCollab)}, 'billing.manage')`), 'f');
    });
    await check('identity: missing/invalid identity → 42501 TORNEOS_AUTH_REQUIRED; no purchase written', async () => {
      expectErr(() => run('authenticated', null, `select public.create_tournament_season_checkout_purchase(${lit(org)}, ${lit(seasonB)}, ${lit(newKey())})`), '42501', 'TORNEOS_AUTH_REQUIRED');
      const expired = { ...claimsOf(owner), iat: 1, nbf: 1, exp: 121 };
      expectErr(() => run('authenticated', expired, `select public.create_tournament_season_checkout_purchase(${lit(org)}, ${lit(seasonB)}, ${lit(newKey())})`), '42501', 'TORNEOS_AUTH_REQUIRED');
      const forged = { ...claimsOf(owner), core_user_id: randomUUID() };
      expectErr(() => run('authenticated', forged, `select public.create_tournament_season_checkout_purchase(${lit(org)}, ${lit(seasonB)}, ${lit(newKey())})`), '42501', 'TORNEOS_AUTH_REQUIRED');
      assert.equal(openCount(seasonB), 0);
    });
    await check('authorization: outsider, unseated admin, collaborator without billing.manage, other workspace owner, crossed organization/season → 42501 TORNEOS_BILLING_FORBIDDEN; nothing written', async () => {
      const denied = [
        ['outsider', () => checkout(outsider, seasonA)],
        ['admin without a season seat', () => checkout(admUnseated, seasonA)],
        ['collaborator without billing.manage', () => checkout(collaborator, seasonCollab)],
        ['other workspace owner on this org', () => checkout(otherOwner, seasonA)],
        ['owner: own org + other org season', () => checkout(owner, otherSeason)],
        ['other owner: own org + this org season', () => checkout(otherOwner, seasonA, newKey(), otherOrg)],
        ['owner: null season', () => checkout(owner, null)],
      ];
      for (const [label, fn] of denied) expectErr(fn, '42501', 'TORNEOS_BILLING_FORBIDDEN');
      for (const s of [seasonA, seasonCollab, otherSeason]) assert.equal(openCount(s), 0);
      expectErr(() => j(asUser(owner, `select public.create_tournament_season_checkout_purchase(${lit(org)}, ${lit(seasonA)}, null)`)), '22023', 'TORNEOS_PURCHASE_INVALID');
    });
    await check('authorization: the seated admin with billing.manage is a valid buyer (buyer = caller identity)', async () => {
      const p = checkout(admSeated, seasonA);
      assert.equal(purchase(p.id).buyer_user_id, admSeated.id);
      assert.equal(asUser(admSeated, `select (public.get_tournament_purchase(${lit(p.id)}))->>'id'`), p.id);
      expectErr(() => asUser(outsider, `select public.get_tournament_purchase(${lit(p.id)})`), '42501', 'TORNEOS_PURCHASE_FORBIDDEN');
      expectErr(() => asUser(admUnseated, `select public.get_tournament_purchase(${lit(p.id)})`), '42501', 'TORNEOS_PURCHASE_FORBIDDEN');
    });

    // ============================================================ C. creation
    await check('creation: provider/environment/product forced to MERCADO_PAGO/test/torneos_premium; price from the server-side offer (ARS 39,900 / list 49,900); status created; external reference and event recorded', async () => {
      const season = newSeason('forced');
      const key = newKey();
      const p = checkout(owner, season, key);
      assert.deepEqual([p.provider, p.providerEnvironment, p.productCode, p.offerCode, p.offerVersion, p.currency, p.amount, p.listAmount, p.status, p.seasonId, p.organizationId, p.tournamentId],
        ['MERCADO_PAGO', 'test', 'torneos_premium', 'launch', 1, 'ARS', 39900, 49900, 'created', season, org, null]);
      assert.equal(p.externalReference, `arma2:season:purchase:${p.id}`);
      assert.deepEqual([p.idempotentReplay, p.existingOpenPurchase], [false, false]);
      const row = purchase(p.id);
      assert.deepEqual([row.buyer_user_id, row.idempotency_key, row.provider_preference_id], [owner.id, key, null]);
      assert.ok(new Date(row.preference_expires_at) > new Date(), 'preference expiry in the future');
      assert.deepEqual(events(p.id).map(e => [e.type, e.to, e.actor]), [['purchase.created', 'created', 'user']]);
      // The client cannot choose provider, environment, product or price: no such parameters exist.
      const token = await bearer(owner);
      const tries = rest([
        { id: 'provider', path: '/rpc/create_tournament_season_checkout_purchase', token, body: { p_organization_id: org, p_season_id: season, p_idempotency_key: newKey(), p_provider: 'FAKE' } },
        { id: 'env', path: '/rpc/create_tournament_season_checkout_purchase', token, body: { p_organization_id: org, p_season_id: season, p_idempotency_key: newKey(), p_provider_environment: 'production' } },
        { id: 'price', path: '/rpc/create_tournament_season_checkout_purchase', token, body: { p_organization_id: org, p_season_id: season, p_idempotency_key: newKey(), p_amount: 1 } },
        { id: 'product', path: '/rpc/create_tournament_season_checkout_purchase', token, body: { p_organization_id: org, p_season_id: season, p_idempotency_key: newKey(), p_product_code: 'x' } },
      ]);
      for (const r of tries) assert.equal(r.status, 404, `${r.id}: ${JSON.stringify(r.body)}`);
      const ok = rest([{ id: 'ok', path: '/rpc/create_tournament_season_checkout_purchase', token, body: { p_organization_id: org, p_season_id: season, p_idempotency_key: key } }])[0];
      assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.id, p.id); assert.equal(ok.body.idempotentReplay, true);
    });
    await check('creation: idempotency — the same (buyer, key) returns the same purchase; the same key for another season → 22023 TORNEOS_IDEMPOTENCY_CONFLICT; another buyer may reuse the key value', async () => {
      const season = newSeason('idem'); const other = newSeason('idem2');
      const key = newKey();
      const first = checkout(owner, season, key);
      const again = checkout(owner, season, key);
      assert.equal(again.id, first.id); assert.equal(again.idempotentReplay, true);
      expectErr(() => checkout(owner, other, key), '22023', 'TORNEOS_IDEMPOTENCY_CONFLICT');
      assert.equal(openCount(other), 0);
      const seated = newSeason('idem3');
      admin(`insert into public.tournament_season_member_assignments(organization_id, season_id, membership_id, assigned_by) select ${lit(org)}, ${lit(seated)}, id, ${lit(owner.id)} from public.tournament_organization_members where organization_id = ${lit(org)} and user_id = ${lit(admSeated.id)}`);
      const byAdmin = checkout(admSeated, seated, key);
      assert.notEqual(byAdmin.id, first.id, '(buyer, key) is the idempotency scope');
      assert.equal(Number(admin(`select count(*) from public.tournament_purchases where idempotency_key = ${lit(key)}`).trim()), 2);
    });
    await check('creation: one open purchase per season — another key returns the existing created/preference_created purchase (existingOpenPurchase)', async () => {
      const season = newSeason('open');
      const first = checkout(owner, season);
      const second = checkout(owner, season);
      assert.deepEqual([second.id, second.existingOpenPurchase, second.status], [first.id, true, 'created']);
      pref(first.id);
      const third = checkout(owner, season);
      assert.deepEqual([third.id, third.existingOpenPurchase, third.status], [first.id, true, 'preference_created']);
      assert.equal(openCount(season), 1);
    });
    await check('creation: an open FAKE purchase in the season is not taken over (55000 TORNEOS_OPEN_PURCHASE_PROVIDER_CONFLICT)', async () => {
      const season = newSeason('fakeopen');
      const fake = j(run(null, claimsOf(owner), `select public.create_fake_tournament_season_purchase(${lit(org)}, ${lit(season)}, 'torneos_premium', ${lit(newKey())}, 'local')`));
      assert.equal(fake.provider, 'FAKE');
      expectErr(() => checkout(owner, season), '55000', 'TORNEOS_OPEN_PURCHASE_PROVIDER_CONFLICT');
    });
    await check('creation: concurrency — 8 parallel checkouts with distinct keys (PostgREST) create exactly one purchase; 6 parallel with the same key return one purchase', async () => {
      const season = newSeason('conc');
      const tokens = await Promise.all(Array.from({ length: 8 }, () => bearer(owner)));
      const out = rest(tokens.map((token, i) => ({ id: String(i), path: '/rpc/create_tournament_season_checkout_purchase', token, body: { p_organization_id: org, p_season_id: season, p_idempotency_key: newKey() } })), true);
      assert.ok(out.every(r => r.status === 200), JSON.stringify(out.map(r => [r.status, r.body?.message])));
      assert.equal(new Set(out.map(r => r.body.id)).size, 1);
      assert.equal(out.filter(r => !r.body.existingOpenPurchase && !r.body.idempotentReplay).length, 1);
      assert.equal(Number(admin(`select count(*) from public.tournament_purchases where season_id = ${lit(season)}`).trim()), 1);
      const season2 = newSeason('conc2'); const key = newKey();
      const tokens2 = await Promise.all(Array.from({ length: 6 }, () => bearer(owner)));
      const out2 = rest(tokens2.map((token, i) => ({ id: String(i), path: '/rpc/create_tournament_season_checkout_purchase', token, body: { p_organization_id: org, p_season_id: season2, p_idempotency_key: key } })), true);
      assert.ok(out2.every(r => r.status === 200)); assert.equal(new Set(out2.map(r => r.body.id)).size, 1);
      assert.equal(Number(admin(`select count(*) from public.tournament_purchases where season_id = ${lit(season2)}`).trim()), 1);
      assert.equal(Number(admin(`select count(*) from public.tournament_purchase_events e join public.tournament_purchases p on p.id = e.purchase_id where p.season_id in (${lit(season)}, ${lit(season2)}) and e.event_type = 'purchase.created'`).trim()), 2);
    });
    await check('creation: stale open purchases — preference_created past preference_expires_at + 15 min → expired, created past it → cancelled (event, service actor); then a new purchase is created; within the grace nothing expires', async () => {
      const stale = openPurchase('stalepref', "now() - interval '16 minutes'");
      const fresh = checkout(owner, stale.season);
      assert.notEqual(fresh.id, stale.id); assert.equal(fresh.existingOpenPurchase, false); assert.equal(fresh.expiredStalePurchases, 1);
      assert.equal(purchase(stale.id).status, 'expired'); assert.ok(purchase(stale.id).cancelled_at);
      assert.deepEqual(events(stale.id).slice(-1).map(e => [e.type, e.from, e.to, e.actor, e.meta.reason, e.meta.graceMinutes]), [['purchase.expired', 'preference_created', 'expired', 'service', 'stale_open_purchase', 15]]);
      assert.equal(purchase(fresh.id).status, 'created');
      // created (preference never recorded) past the grace → cancelled
      const season = newSeason('stalecreated');
      const created = checkout(owner, season);
      admin(`update public.tournament_purchases set preference_expires_at = now() - interval '16 minutes' where id = ${lit(created.id)}`);
      const next = checkout(owner, season);
      assert.notEqual(next.id, created.id);
      assert.equal(purchase(created.id).status, 'cancelled');
      assert.deepEqual(events(created.id).slice(-1).map(e => [e.type, e.from, e.to, e.actor]), [['purchase.cancelled', 'created', 'cancelled', 'service']]);
      // inside the 15-minute grace: still open and reused
      const grace = openPurchase('grace', "now() - interval '14 minutes'");
      const reuse = checkout(owner, grace.season);
      assert.deepEqual([reuse.id, reuse.existingOpenPurchase, reuse.expiredStalePurchases], [grace.id, true, 0]);
      assert.equal(purchase(grace.id).status, 'preference_created');
    });
    await check('creation: pending never expires automatically — a pending purchase long past its preference expiry stays open and is returned', async () => {
      const o = openPurchase('pendingstale', "now() - interval '3 days'");
      status(o.id, 'pending', pay('pend'));
      const again = checkout(owner, o.season);
      assert.deepEqual([again.id, again.existingOpenPurchase, again.status, again.expiredStalePurchases], [o.id, true, 'pending', 0]);
      assert.equal(openCount(o.season), 1);
    });
    await check('creation: concurrency — 6 parallel checkouts on a season with a stale purchase expire it exactly once and create exactly one new purchase', async () => {
      const stale = openPurchase('concstale', "now() - interval '20 minutes'");
      const tokens = await Promise.all(Array.from({ length: 6 }, () => bearer(owner)));
      const out = rest(tokens.map((token, i) => ({ id: String(i), path: '/rpc/create_tournament_season_checkout_purchase', token, body: { p_organization_id: org, p_season_id: stale.season, p_idempotency_key: newKey() } })), true);
      assert.ok(out.every(r => r.status === 200), JSON.stringify(out.map(r => r.body?.message)));
      assert.equal(new Set(out.map(r => r.body.id)).size, 1);
      assert.equal(out.reduce((n, r) => n + r.body.expiredStalePurchases, 0), 1);
      assert.equal(eventTypes(stale.id).filter(e => e === 'purchase.expired').length, 1);
      assert.equal(openCount(stale.season), 1);
    });
    await check('creation: already Premium → 55000 TORNEOS_SEASON_ALREADY_PREMIUM (no new purchase)', async () => {
      const o = openPurchase('premium');
      status(o.id, 'approved', pay('ok'));
      expectErr(() => checkout(owner, o.season), '55000', 'TORNEOS_SEASON_ALREADY_PREMIUM');
      assert.equal(Number(admin(`select count(*) from public.tournament_purchases where season_id = ${lit(o.season)}`).trim()), 1);
    });

    // ============================================================ D. provider lookup
    await check('service lookup: get_provider_tournament_purchase finds MP TEST purchases by external reference only; FAKE/production → 22023; unknown/FAKE purchase → P0002', async () => {
      const o = openPurchase('lookup');
      const found = j(asPay(`select public.get_provider_tournament_purchase(${lit(o.externalReference)}, 'MERCADO_PAGO', 'test')`));
      assert.deepEqual([found.id, found.providerPreferenceId, found.amount, found.currency, found.status], [o.id, prefId(o.id), 39900, 'ARS', 'preference_created']);
      expectErr(() => asPay(`select public.get_provider_tournament_purchase(${lit(o.externalReference)}, 'FAKE', 'local')`), '22023', 'TORNEOS_PROVIDER_INVALID');
      expectErr(() => asPay(`select public.get_provider_tournament_purchase(${lit(o.externalReference)}, 'MERCADO_PAGO', 'production')`), '22023', 'TORNEOS_PROVIDER_INVALID');
      expectErr(() => asPay(`select public.get_provider_tournament_purchase(${lit('arma2:season:purchase:' + randomUUID())}, 'MERCADO_PAGO', 'test')`), 'P0002', 'TORNEOS_PURCHASE_NOT_FOUND');
      const season = newSeason('lookupfake');
      const fake = j(run(null, claimsOf(owner), `select public.create_fake_tournament_season_purchase(${lit(org)}, ${lit(season)}, 'torneos_premium', ${lit(newKey())}, 'local')`));
      expectErr(() => asPay(`select public.get_provider_tournament_purchase(${lit(fake.externalReference)}, 'MERCADO_PAGO', 'test')`), 'P0002', 'TORNEOS_PURCHASE_NOT_FOUND');
    });

    // ============================================================ E. payment state
    await check('payment: input validation — FAKE/production provider, unknown status, missing payment id, FAKE purchase, purchase without preference; all non-transient except the not-ready purchase; zero writes', async () => {
      const o = openPurchase('validate');
      const before = events(o.id).length;
      const call = (provider, env, st, payId, id = o.id) => asPay(`select public.apply_verified_tournament_payment_status(${lit(id)}, ${lit(provider)}, ${lit(env)}, ${lit(st)}, ${lit(st)}, null, ${lit(payId)}, ${providerTime()})`);
      expectErr(() => call('FAKE', 'local', 'approved', pay('v')), '22023', 'TORNEOS_PROVIDER_INVALID');
      expectErr(() => call('MERCADO_PAGO', 'production', 'approved', pay('v')), '22023', 'TORNEOS_PROVIDER_INVALID');
      for (const st of ['authorized', 'in_process', 'refunded', 'charged_back', 'in_mediation', 'APPROVED', '', 'created']) expectErr(() => call('MERCADO_PAGO', 'test', st, pay('v')), '22023', 'TORNEOS_PROVIDER_STATUS_INVALID');
      expectErr(() => call('MERCADO_PAGO', 'test', 'approved', null), '22023', 'TORNEOS_PAYMENT_INVALID');
      expectErr(() => call('MERCADO_PAGO', 'test', 'approved', '  '), '22023', 'TORNEOS_PAYMENT_INVALID');
      expectErr(() => call('MERCADO_PAGO', 'test', 'approved', pay('v'), randomUUID()), '22023', 'TORNEOS_PURCHASE_INVALID');
      const season = newSeason('valfake');
      const fake = j(run(null, claimsOf(owner), `select public.create_fake_tournament_season_purchase(${lit(org)}, ${lit(season)}, 'torneos_premium', ${lit(newKey())}, 'local')`));
      expectErr(() => call('MERCADO_PAGO', 'test', 'approved', pay('v'), fake.id), '22023', 'TORNEOS_PURCHASE_INVALID');
      const s2 = newSeason('valcreated');
      const created = checkout(owner, s2);
      expectErr(() => call('MERCADO_PAGO', 'test', 'approved', pay('v'), created.id), '55000', 'TORNEOS_PURCHASE_NOT_READY');
      assert.equal(events(o.id).length, before); assert.equal(purchase(o.id).status, 'preference_created');
      assert.equal(purchase(created.id).status, 'created'); assert.equal(seasonGrants(s2), 0);
    });
    await check('payment: pending → status pending, no Premium; later approved → approved, Premium granted exactly once', async () => {
      const o = openPurchase('pending');
      const pid = pay('p');
      const r = status(o.id, 'pending', pid, 'pending_waiting_payment', 'in_process');
      assert.deepEqual([r.outcome, r.status, r.stateChanged, r.requiresManualRefund], ['pending', 'pending', true, false]);
      assert.equal(plan(o.season), 'FREE'); assert.deepEqual(grantState(o.id), { grants: 0, events: [] });
      const replay = status(o.id, 'pending', pid, 'pending_waiting_payment', 'in_process');
      assert.deepEqual([replay.outcome, replay.idempotentReplay, replay.stateChanged], ['pending', true, false]);
      const a = status(o.id, 'approved', pid, 'accredited');
      assert.deepEqual([a.outcome, a.status, a.stateChanged, a.requiresManualRefund], ['approved', 'approved', true, false]);
      assert.equal(purchase(o.id).approved_provider_payment_id, pid);
      assert.deepEqual(grantState(o.id), { grants: 1, events: ['granted'] });
      assert.equal(plan(o.season), 'PREMIUM');
      assert.deepEqual(eventTypes(o.id), ['purchase.created', 'preference.created', 'payment.pending', 'payment.approved']);
    });
    await check('payment: rejected is an attempt, not a closure — preference_created stays open (payment.attempt_rejected), a replay adds nothing, and a later approved on the same preference activates Premium', async () => {
      const o = openPurchase('rejected');
      const bad = pay('bad');
      const r = status(o.id, 'rejected', bad, 'cc_rejected_insufficient_amount');
      assert.deepEqual([r.outcome, r.status, r.stateChanged, r.requiresManualRefund], ['attempt_rejected', 'preference_created', false, false]);
      assert.equal(status(o.id, 'rejected', bad, 'cc_rejected_insufficient_amount').idempotentReplay, true);
      assert.equal(eventTypes(o.id).filter(e => e === 'payment.attempt_rejected').length, 1);
      assert.equal(plan(o.season), 'FREE'); assert.equal(openCount(o.season), 1);
      assert.equal(checkout(owner, o.season).id, o.id, 'still the open purchase of the season');
      const a = status(o.id, 'approved', pay('good'), 'accredited');
      assert.deepEqual([a.outcome, a.status], ['approved', 'approved']);
      assert.equal(plan(o.season), 'PREMIUM'); assert.deepEqual(grantState(o.id), { grants: 1, events: ['granted'] });
    });
    await check('payment: pending(X) then cancelled(X) → back to preference_created (payment.attempt_cancelled); a rejected of another payment leaves a pending purchase pending; later approved(Y) activates', async () => {
      const o = openPurchase('cancelled');
      const x = pay('x');
      status(o.id, 'pending', x, 'pending_waiting_transfer');
      const other = status(o.id, 'rejected', pay('z'), 'cc_rejected_other_reason');
      assert.deepEqual([other.outcome, other.status, other.stateChanged], ['attempt_rejected', 'pending', false]);
      const c = status(o.id, 'cancelled', x, 'expired');
      assert.deepEqual([c.outcome, c.status, c.stateChanged], ['attempt_cancelled', 'preference_created', true]);
      const ex = status(o.id, 'expired', pay('w'), 'expired');
      assert.deepEqual([ex.outcome, ex.status], ['attempt_expired', 'preference_created']);
      const stalePending = status(o.id, 'pending', x, 'pending_waiting_transfer');
      assert.deepEqual([stalePending.outcome, stalePending.status], ['stale_ignored', 'preference_created'], 'an ended attempt never reopens as pending');
      const a = status(o.id, 'approved', pay('y'), 'accredited');
      assert.deepEqual([a.outcome, a.status], ['approved', 'approved']);
      assert.equal(plan(o.season), 'PREMIUM');
      assert.deepEqual(eventTypes(o.id).filter(e => e.startsWith('payment.')), ['payment.pending', 'payment.attempt_rejected', 'payment.attempt_cancelled', 'payment.attempt_expired', 'payment.stale_status_ignored', 'payment.approved']);
    });
    await check('payment: multi-pending (A) — pending(A), pending(B), rejected(B) keeps the purchase pending while A is open; long past its preference expiry the stale sweep does not expire it and checkout returns it', async () => {
      const o = openPurchase('multipend', "now() - interval '3 days'");
      const a = pay('a'), b = pay('b');
      assert.deepEqual([status(o.id, 'pending', a, 'pending_waiting_payment', 'in_process').status, status(o.id, 'pending', b, 'pending_waiting_transfer', 'in_process').status], ['pending', 'pending']);
      const rb = status(o.id, 'rejected', b, 'cc_rejected_other_reason');
      assert.deepEqual([rb.outcome, rb.status, rb.stateChanged, rb.requiresManualRefund], ['attempt_rejected', 'pending', false, false]);
      assert.equal(purchase(o.id).status, 'pending', 'A still pending: the purchase stays pending');
      const again = checkout(owner, o.season);
      assert.deepEqual([again.id, again.existingOpenPurchase, again.status, again.expiredStalePurchases], [o.id, true, 'pending', 0]);
      assert.equal(openCount(o.season), 1); assert.equal(purchaseCount(o.season), 1, 'no second purchase while a payment is pending');
      const lateB = status(o.id, 'pending', b, 'pending_waiting_transfer', 'in_process');
      assert.deepEqual([lateB.outcome, lateB.status], ['stale_ignored', 'pending'], 'an ended payment never reopens');

      // (B) rejected(A): now nothing is open → pending → preference_created
      const ra = status(o.id, 'rejected', a, 'cc_rejected_other_reason');
      assert.deepEqual([ra.outcome, ra.status, ra.stateChanged, ra.requiresManualRefund], ['attempt_rejected', 'preference_created', true, false]);
      assert.deepEqual(events(o.id).filter(e => e.type === 'payment.attempt_rejected').map(e => [e.meta.providerPaymentId, e.from, e.to]), [[b, 'pending', 'pending'], [a, 'pending', 'preference_created']]);

      // (C) replayed pending(A) after its terminal: stale, recorded once, never reopens
      const replayA = status(o.id, 'pending', a, 'pending_waiting_payment', 'in_process');
      assert.deepEqual([replayA.outcome, replayA.status, replayA.stateChanged, replayA.idempotentReplay], ['stale_ignored', 'preference_created', false, false]);
      const replayA2 = status(o.id, 'pending', a, 'pending_waiting_payment', 'in_process');
      assert.deepEqual([replayA2.outcome, replayA2.status, replayA2.idempotentReplay], ['stale_ignored', 'preference_created', true]);
      assert.equal(purchase(o.id).status, 'preference_created');
      assert.deepEqual(grantState(o.id), { grants: 0, events: [] }); assert.equal(plan(o.season), 'FREE');
      // Only now, with no open payment, may the stale sweep expire it.
      const next = checkout(owner, o.season);
      assert.notEqual(next.id, o.id); assert.equal(next.expiredStalePurchases, 1); assert.equal(purchase(o.id).status, 'expired');
    });
    await check('payment: multi-pending (B/C/E) — every order of pending(A), pending(B), cancelled(A), rejected(B) matches the open-payment model at every step (pending ⇔ some pending payment without its terminal; a terminal before its pending makes that pending stale) and converges to preference_created; while pending the stale sweep never expires it', async () => {
      const orders = permutations(['pA', 'pB', 'tA', 'tB']);
      assert.equal(orders.length, 24);
      for (const order of orders) {
        const o = openPurchase('mp' + order.join('').toLowerCase(), "now() - interval '3 days'");
        const ids = { A: pay('a'), B: pay('b') };
        const open = new Set(), ended = new Set();
        for (const step of order) {
          const who = step[1]; const id = ids[who];
          let r, outcome;
          if (step[0] === 'p') {
            r = status(o.id, 'pending', id, 'pending_waiting_payment', 'in_process');
            if (ended.has(who)) outcome = 'stale_ignored'; else { open.add(who); outcome = 'pending'; }
          } else {
            const st = who === 'A' ? 'cancelled' : 'rejected';
            r = status(o.id, st, id, 'by_payer');
            ended.add(who); open.delete(who); outcome = 'attempt_' + st;
          }
          const expected = open.size > 0 ? 'pending' : 'preference_created';
          assert.deepEqual([r.outcome, r.status, r.requiresManualRefund], [outcome, expected, false], `${order.join(',')} at ${step}`);
          assert.equal(purchase(o.id).status, expected, `${order.join(',')} at ${step}`);
          if (expected === 'pending') {
            const c = checkout(owner, o.season);
            assert.deepEqual([c.id, c.status, c.expiredStalePurchases], [o.id, 'pending', 0], `${order.join(',')} at ${step}: never expired nor replaced while money is pending`);
          }
        }
        assert.equal(purchase(o.id).status, 'preference_created', order.join(','));
        assert.equal(purchaseCount(o.season), 1); assert.equal(seasonGrants(o.season), 0);
        observed.multiPendingSequences += 1;
      }
    });
    await check('payment: multi-pending (D/E) — pending(A), pending(B), rejected(B), approved(A) in every order ends approved on A with exactly one grant and requiresManualRefund = false at every step', async () => {
      const orders = permutations(['pA', 'pB', 'rB', 'okA']);
      for (const order of orders) {
        const o = openPurchase('mq' + order.join('').toLowerCase(), "now() - interval '3 days'");
        const a = pay('a'), b = pay('b');
        const open = new Set(), ended = new Set(); let approved = false;
        for (const step of order) {
          let r, outcome, expected;
          if (step === 'okA') {
            r = status(o.id, 'approved', a, 'accredited');
            approved = true; ended.add('A'); open.delete('A'); outcome = 'approved';
          } else if (step[0] === 'p') {
            const who = step[1];
            r = status(o.id, 'pending', who === 'A' ? a : b, 'pending_waiting_payment', 'in_process');
            if (approved || ended.has(who)) outcome = 'stale_ignored'; else { open.add(who); outcome = 'pending'; }
          } else {
            r = status(o.id, 'rejected', b, 'cc_rejected_other_reason');
            ended.add('B'); open.delete('B'); outcome = approved ? 'stale_ignored' : 'attempt_rejected';
          }
          expected = approved ? 'approved' : (open.size > 0 ? 'pending' : 'preference_created');
          assert.deepEqual([r.outcome, r.status, r.requiresManualRefund], [outcome, expected, false], `${order.join(',')} at ${step}`);
          observeEffective(o.season);
        }
        const row = purchase(o.id);
        assert.deepEqual([row.status, row.approved_provider_payment_id], ['approved', a], order.join(','));
        assert.deepEqual(grantState(o.id), { grants: 1, events: ['granted'] }, order.join(','));
        assert.equal(seasonGrants(o.season), 1); assert.equal(effectiveGrants(o.season), 1); assert.equal(purchaseCount(o.season), 1);
        assert.deepEqual(eventTypes(o.id).filter(e => /approved_(after_close|duplicate_payment)/.test(e)), [], 'no manual-refund anomaly');
        observed.multiPendingSequences += 1;
      }
    });
    await check('payment: defense in depth — even a preference_created purchase that still has an open pending payment (forced with triggers off) is never expired by the stale sweep', async () => {
      const o = openPurchase('forcedopen', "now() - interval '3 days'");
      status(o.id, 'pending', pay('open'), 'pending_waiting_transfer', 'in_process');
      admin(`BEGIN; SET LOCAL session_replication_role = replica; update public.tournament_purchases set status = 'preference_created' where id = ${lit(o.id)}; COMMIT;`);
      const c = checkout(owner, o.season);
      assert.deepEqual([c.id, c.existingOpenPurchase, c.expiredStalePurchases], [o.id, true, 0]);
      assert.equal(purchase(o.id).status, 'preference_created'); assert.equal(purchaseCount(o.season), 1);
    });
    await check('payment: duplicate approved of the same payment — no error, no second grant, one payment.approved_duplicate event (deduplicated), logical success', async () => {
      const o = openPurchase('dupsame');
      const pid = pay('a');
      status(o.id, 'approved', pid);
      const d1 = status(o.id, 'approved', pid); const d2 = status(o.id, 'approved', pid);
      // Same convention as the other anomalies: the first duplicate records its event, the retry writes nothing.
      for (const [d, replay] of [[d1, false], [d2, true]]) assert.deepEqual([d.outcome, d.status, d.stateChanged, d.requiresManualRefund, d.idempotentReplay], ['duplicate_approved', 'approved', false, false, replay]);
      assert.deepEqual(grantState(o.id), { grants: 1, events: ['granted'] });
      assert.equal(eventTypes(o.id).filter(e => e === 'payment.approved').length, 1);
      assert.equal(eventTypes(o.id).filter(e => e === 'payment.approved_duplicate').length, 1);
    });
    await check('payment: approved with a DIFFERENT payment on an approved purchase — no error, no second grant, approved payment unchanged, requiresManualRefund = true (payment.approved_duplicate_payment, deduplicated)', async () => {
      const o = openPurchase('dupother');
      const first = pay('first'); const second = pay('second');
      status(o.id, 'approved', first);
      const d = status(o.id, 'approved', second);
      assert.deepEqual([d.outcome, d.status, d.stateChanged, d.requiresManualRefund], ['duplicate_payment', 'approved', false, true]);
      const again = status(o.id, 'approved', second);
      assert.deepEqual([again.outcome, again.requiresManualRefund, again.idempotentReplay], ['duplicate_payment', true, true]);
      assert.equal(purchase(o.id).approved_provider_payment_id, first);
      assert.deepEqual(grantState(o.id), { grants: 1, events: ['granted'] });
      const ev = events(o.id).filter(e => e.type === 'payment.approved_duplicate_payment');
      assert.equal(ev.length, 1); assert.equal(ev[0].meta.providerPaymentId, second); assert.equal(ev[0].meta.requiresManualRefund, true);
    });
    await check('payment: approved after the purchase was closed (expired by the stale sweep; cancelled while created) — no Premium, payment.approved_after_close, requiresManualRefund = true, replay deduplicated, no retry loop', async () => {
      const stale = openPurchase('afterclose', "now() - interval '30 minutes'");
      const replacement = checkout(owner, stale.season);
      assert.equal(purchase(stale.id).status, 'expired');
      const pid = pay('late');
      const r = status(stale.id, 'approved', pid, 'accredited');
      assert.deepEqual([r.outcome, r.status, r.stateChanged, r.requiresManualRefund], ['approved_after_close', 'expired', false, true]);
      const replay = status(stale.id, 'approved', pid, 'accredited');
      assert.deepEqual([replay.outcome, replay.requiresManualRefund, replay.idempotentReplay], ['approved_after_close', true, true]);
      assert.equal(eventTypes(stale.id).filter(e => e === 'payment.approved_after_close').length, 1);
      assert.deepEqual(grantState(stale.id), { grants: 0, events: [] });
      assert.equal(plan(stale.season), 'FREE'); assert.equal(purchase(replacement.id).status, 'created');
      assert.equal(purchase(stale.id).approved_provider_payment_id, null);
    });
    await check('payment: stale / out-of-order — pending, rejected, cancelled or expired after approved never degrade it (payment.stale_status_ignored); Premium stays', async () => {
      const o = openPurchase('stale');
      const pid = pay('a');
      status(o.id, 'approved', pid);
      for (const st of ['pending', 'rejected', 'cancelled', 'expired']) {
        const r = status(o.id, st, pid);
        assert.deepEqual([r.outcome, r.status, r.stateChanged], ['stale_ignored', 'approved', false], st);
      }
      assert.equal(status(o.id, 'pending', pid).idempotentReplay, true);
      assert.equal(purchase(o.id).status, 'approved'); assert.equal(plan(o.season), 'PREMIUM');
      assert.deepEqual(grantState(o.id), { grants: 1, events: ['granted'] });
      assert.equal(eventTypes(o.id).filter(e => e === 'payment.stale_status_ignored').length, 4);
    });
    await check('payment: concurrency — 6 parallel approved notifications of the same payment through the payment login produce exactly one grant and one payment.approved', async () => {
      const o = openPurchase('concapprove');
      const pid = pay('c');
      const q = { id: 'a', sql: `select public.apply_verified_tournament_payment_status($1, 'MERCADO_PAGO', 'test', 'approved', 'approved', 'accredited', $2, '2026-01-02T00:00:00Z'::timestamptz) r`, params: [o.id, pid] };
      const out = paymentLogin(Array.from({ length: 6 }, () => [{ id: 'role', sql: `set role ${PAY}` }, q]));
      assert.ok(out.every(s => s.every(x => x.ok)), JSON.stringify(out));
      const outcomes = out.map(s => s[1].rows[0].r.outcome).sort();
      assert.deepEqual(outcomes, ['approved', 'provider_snapshot_duplicate', 'provider_snapshot_duplicate', 'provider_snapshot_duplicate', 'provider_snapshot_duplicate', 'provider_snapshot_duplicate']);
      assert.deepEqual(grantState(o.id), { grants: 1, events: ['granted'] });
      assert.equal(eventTypes(o.id).filter(e => e === 'payment.approved').length, 1);
    });
    await check('payment: concurrency — approved (payment login) racing a checkout that expires the stale purchase always ends consistent: (Premium, checkout refused) or (expired + approved_after_close + new open purchase, no Premium)', async () => {
      const verdicts = [];
      for (let i = 0; i < 4; i++) {
        const stale = openPurchase(`race${i}`, "now() - interval '20 minutes'");
        const token = await bearer(owner); const pid = pay(`race${i}`);
        // Both sides fire from one process inside the private network, after their connections are ready.
        const raced = JSON.parse(inGateway(`import pg from 'pg';
          const client = new pg.Client({ connectionString: ${JSON.stringify(`postgres://lab_payment_service:${cfg.paymentServicePassword}@torneos-db:5432/postgres`)} });
          await client.connect(); await client.query('set role ${PAY}');
          // Stagger the start (either side first) so both interleavings are exercised; the invariant is the same.
          const wait = (ms) => new Promise(r => setTimeout(r, ms));
          const [approve, buy] = await Promise.all([
            wait(${i % 2 ? 250 : 0}).then(() => client.query("select public.apply_verified_tournament_payment_status($1, 'MERCADO_PAGO', 'test', 'approved', 'approved', 'accredited', $2, '2026-01-02T00:00:00Z'::timestamptz) r", [${JSON.stringify(stale.id)}, ${JSON.stringify(pid)}])
              .then(r => ({ ok: true, rows: r.rows }), e => ({ ok: false, code: e.code, message: String(e.message) }))),
            wait(${i % 2 ? 0 : 250}).then(() => fetch('http://torneos-rest:3000/rpc/create_tournament_season_checkout_purchase', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ${JSON.stringify(token)} },
              body: JSON.stringify({ p_organization_id: ${JSON.stringify(org)}, p_season_id: ${JSON.stringify(stale.season)}, p_idempotency_key: ${JSON.stringify(newKey())} }) })
              .then(async r => ({ status: r.status, body: JSON.parse(await r.text()) }))),
          ]);
          await client.end(); console.log(JSON.stringify({ approve, buy }));`).trim().split('\n').pop());
        const { approve, buy } = raced;
        assert.ok(approve.ok, JSON.stringify(approve));
        const final = purchase(stale.id).status;
        if (final === 'approved') {
          assert.equal(approve.rows[0].r.outcome, 'approved'); assert.equal(buy.body?.message, 'TORNEOS_SEASON_ALREADY_PREMIUM');
          assert.equal(plan(stale.season), 'PREMIUM'); assert.equal(openCount(stale.season), 0); verdicts.push('premium');
        } else {
          assert.equal(final, 'expired'); assert.equal(approve.rows[0].r.outcome, 'approved_after_close'); assert.equal(approve.rows[0].r.requiresManualRefund, true);
          assert.equal(buy.status, 200); assert.equal(plan(stale.season), 'FREE'); assert.equal(seasonGrants(stale.season), 0); assert.equal(openCount(stale.season), 1); verdicts.push('refund');
        }
      }
      t.diagnostic(`race verdicts: ${verdicts.join(',')}`);
      assert.deepEqual([...new Set(verdicts)].sort(), ['premium', 'refund'], 'both interleavings exercised');
    });

    // ============================================================ F. reversals
    await check('reversal: refund after approved → refunded, grant revoked, entitlement FREE; a duplicate refund is an idempotent replay (no new grant event)', async () => {
      const o = openPurchase('refund');
      const pid = pay('r');
      status(o.id, 'approved', pid);
      const r = reversal(o.id, 'refund', pid, 'refunded', 'refunded');
      assert.deepEqual([r.outcome, r.status, r.idempotentReplay, r.stateChanged], ['reversal_applied', 'refunded', false, true]);
      assert.deepEqual(grantState(o.id), { grants: 1, events: ['granted', 'revoked'] });
      assert.equal(plan(o.season), 'FREE');
      const again = reversal(o.id, 'refund', pid, 'refunded', 'refunded');
      assert.deepEqual([again.outcome, again.idempotentReplay], ['reversal_applied', true]);
      assert.deepEqual(grantState(o.id), { grants: 1, events: ['granted', 'revoked'] });
      assert.ok(purchase(o.id).refunded_at);
    });
    await check('reversal: chargeback disputed → charged_back + suspended (FREE); restored → approved + restored (PREMIUM); duplicate dispute replay adds nothing', async () => {
      const o = openPurchase('chargeback');
      const pid = pay('cb');
      status(o.id, 'approved', pid);
      const d = reversal(o.id, 'chargeback_disputed', pid, 'charged_back', 'in_process');
      assert.deepEqual([d.outcome, d.status], ['reversal_applied', 'charged_back']);
      assert.equal(reversal(o.id, 'chargeback_disputed', pid, 'charged_back', 'in_process').idempotentReplay, true);
      assert.equal(plan(o.season), 'FREE');
      const s = reversal(o.id, 'chargeback_restored', pid, 'charged_back', 'reimbursed');
      assert.deepEqual([s.outcome, s.status], ['reversal_applied', 'approved']);
      assert.equal(plan(o.season), 'PREMIUM');
      assert.deepEqual(grantState(o.id), { grants: 1, events: ['granted', 'suspended', 'restored'] });
    });
    await check('reversal: chargeback buyer_won → revoked (FREE); a later restored is ignored after revocation (no un-revoke)', async () => {
      const o = openPurchase('buyerwon');
      const pid = pay('bw');
      status(o.id, 'approved', pid);
      reversal(o.id, 'chargeback_disputed', pid, 'charged_back', 'in_process');
      const w = reversal(o.id, 'chargeback_buyer_won', pid, 'charged_back', 'settled');
      assert.deepEqual([w.outcome, w.status], ['reversal_applied', 'charged_back']);
      assert.equal(plan(o.season), 'FREE');
      const late = reversal(o.id, 'chargeback_restored', pid, 'charged_back', 'reimbursed');
      assert.deepEqual([late.outcome, late.status, late.stateChanged], ['reversal_ignored_after_revocation', 'charged_back', false]);
      assert.equal(plan(o.season), 'FREE');
      assert.deepEqual(grantState(o.id), { grants: 1, events: ['granted', 'suspended', 'revoked'] });
    });
    await check('reversal: refund while a chargeback is disputed → reversal_conflict (requiresManualReview), grant stays suspended, no partial write', async () => {
      const o = openPurchase('conflict');
      const pid = pay('cf');
      status(o.id, 'approved', pid);
      reversal(o.id, 'chargeback_disputed', pid, 'charged_back', 'in_process');
      const c = reversal(o.id, 'refund', pid, 'refunded', 'refunded');
      assert.deepEqual([c.outcome, c.status, c.requiresManualReview, c.stateChanged], ['reversal_conflict', 'charged_back', true, false]);
      assert.deepEqual(grantState(o.id), { grants: 1, events: ['granted', 'suspended'] });
      assert.equal(eventTypes(o.id).filter(e => e === 'payment.reversal_conflict').length, 1);
    });
    await check('reversal: without any activation (open purchase; approved-after-close payment refunded) → payment.reversal_without_activation, no error, no grant/revoke, replay deduplicated', async () => {
      const o = openPurchase('noactivation');
      const r = reversal(o.id, 'refund', pay('n'), 'refunded');
      assert.deepEqual([r.outcome, r.status, r.stateChanged, r.requiresManualRefund], ['reversal_without_activation', 'preference_created', false, false]);
      assert.deepEqual(grantState(o.id), { grants: 0, events: [] });
      const stale = openPurchase('manualrefund', "now() - interval '30 minutes'");
      checkout(owner, stale.season);
      const late = pay('late');
      status(stale.id, 'approved', late);
      const refund = reversal(stale.id, 'refund', late, 'refunded');
      assert.equal(refund.outcome, 'reversal_without_activation');
      assert.equal(reversal(stale.id, 'refund', late, 'refunded').idempotentReplay, true);
      assert.equal(eventTypes(stale.id).filter(e => e === 'payment.reversal_without_activation').length, 1);
      const cb = reversal(o.id, 'chargeback_disputed', pay('n2'), 'charged_back', 'in_process');
      assert.equal(cb.outcome, 'reversal_without_activation');
      assert.deepEqual(grantState(stale.id), { grants: 0, events: [] }); assert.equal(plan(stale.season), 'FREE');
    });
    await check('reversal: a reversal of another payment on an activated purchase (e.g. the manually refunded duplicate) never touches the grant', async () => {
      const o = openPurchase('otherpay');
      const pid = pay('main');
      status(o.id, 'approved', pid);
      const dup = pay('dup'); status(o.id, 'approved', dup);
      const r = reversal(o.id, 'refund', dup, 'refunded');
      assert.deepEqual([r.outcome, r.status, r.stateChanged], ['reversal_other_payment', 'approved', false]);
      assert.equal(plan(o.season), 'PREMIUM'); assert.deepEqual(grantState(o.id), { grants: 1, events: ['granted'] });
    });
    await check('reversal: input validation — unknown action, FAKE/production provider, missing payment id → 22023; zero writes', async () => {
      const o = openPurchase('revval');
      const before = events(o.id).length;
      const call = (provider, env, action, payId) => asPay(`select public.apply_verified_tournament_payment_reversal(${lit(o.id)}, ${lit(provider)}, ${lit(env)}, ${lit(action)}, 'refunded', null, ${lit(payId)}, ${providerTime()})`);
      expectErr(() => call('MERCADO_PAGO', 'test', 'partial_refund', pay('x')), '22023', 'TORNEOS_REVERSAL_INVALID');
      expectErr(() => call('FAKE', 'local', 'refund', pay('x')), '22023', 'TORNEOS_PROVIDER_INVALID');
      expectErr(() => call('MERCADO_PAGO', 'live', 'refund', pay('x')), '22023', 'TORNEOS_PROVIDER_INVALID');
      expectErr(() => call('MERCADO_PAGO', 'test', 'refund', null), '22023', 'TORNEOS_PAYMENT_INVALID');
      assert.equal(events(o.id).length, before);
    });

    // ============================================================ F2. a reversible grant blocks a second purchase
    await check('second purchase: Premium active → 55000 TORNEOS_SEASON_ALREADY_PREMIUM; suspended (chargeback in dispute) → 55000 TORNEOS_SEASON_PREMIUM_SUSPENDED (also while a refund conflicts); restored → still exactly one grant; no purchase is written', async () => {
      const o = openPurchase('suspended');
      const pid = pay('s');
      status(o.id, 'approved', pid);
      expectErr(() => checkout(owner, o.season), '55000', 'TORNEOS_SEASON_ALREADY_PREMIUM');
      reversal(o.id, 'chargeback_disputed', pid, 'charged_back', 'in_process');
      assert.equal(plan(o.season), 'FREE'); assert.equal(observeEffective(o.season), 0);
      expectErr(() => checkout(owner, o.season), '55000', 'TORNEOS_SEASON_PREMIUM_SUSPENDED');
      admin(`insert into public.tournament_season_member_assignments(organization_id, season_id, membership_id, assigned_by) select ${lit(org)}, ${lit(o.season)}, id, ${lit(owner.id)} from public.tournament_organization_members where organization_id = ${lit(org)} and user_id = ${lit(admSeated.id)}`);
      expectErr(() => checkout(admSeated, o.season), '55000', 'TORNEOS_SEASON_PREMIUM_SUSPENDED');
      // The same refusal through the Data API (the path MP-A3 will use behind the gateway).
      const viaRest = rest([{ id: 'r', path: '/rpc/create_tournament_season_checkout_purchase', token: await bearer(owner), body: { p_organization_id: org, p_season_id: o.season, p_idempotency_key: newKey() } }])[0];
      assert.deepEqual([viaRest.status >= 400, viaRest.body?.code, viaRest.body?.message], [true, '55000', 'TORNEOS_SEASON_PREMIUM_SUSPENDED']);
      assert.equal(reversal(o.id, 'refund', pid, 'refunded', 'refunded').outcome, 'reversal_conflict');
      expectErr(() => checkout(owner, o.season), '55000', 'TORNEOS_SEASON_PREMIUM_SUSPENDED');
      assert.equal(purchaseCount(o.season), 1, 'no second purchase while the grant is suspended');
      const restored = reversal(o.id, 'chargeback_restored', pid, 'charged_back', 'reimbursed');
      assert.deepEqual([restored.outcome, restored.status], ['reversal_applied', 'approved']);
      assert.equal(plan(o.season), 'PREMIUM');
      assert.equal(seasonGrants(o.season), 1); assert.equal(observeEffective(o.season), 1);
      assert.deepEqual(grantState(o.id), { grants: 1, events: ['granted', 'suspended', 'restored'] });
      expectErr(() => checkout(owner, o.season), '55000', 'TORNEOS_SEASON_ALREADY_PREMIUM');
      assert.equal(purchaseCount(o.season), 1);
    });
    await check('second purchase: only a definitive revocation (chargeback lost / refund) re-enables buying; the new purchase activates exactly one effective grant; late reversals of the first payment never un-revoke it', async () => {
      // chargeback lost
      const o = openPurchase('buyerwon2');
      const pid = pay('bw');
      status(o.id, 'approved', pid);
      reversal(o.id, 'chargeback_disputed', pid, 'charged_back', 'in_process');
      expectErr(() => checkout(owner, o.season), '55000', 'TORNEOS_SEASON_PREMIUM_SUSPENDED');
      reversal(o.id, 'chargeback_buyer_won', pid, 'charged_back', 'settled');
      assert.equal(observeEffective(o.season), 0);
      const second = checkout(owner, o.season);
      assert.notEqual(second.id, o.id); assert.deepEqual([second.status, second.existingOpenPurchase], ['created', false]);
      pref(second.id);
      const pid2 = pay('bw2');
      assert.equal(status(second.id, 'approved', pid2, 'accredited').outcome, 'approved');
      assert.deepEqual([seasonGrants(o.season), observeEffective(o.season), plan(o.season)], [2, 1, 'PREMIUM']);
      for (const action of ['chargeback_restored', 'chargeback_disputed', 'chargeback_buyer_won', 'refund']) {
        const late = reversal(o.id, action, pid, 'charged_back', 'late');
        assert.ok(['reversal_ignored_after_revocation', 'reversal_applied'].includes(late.outcome), `${action}: ${late.outcome}`);
        if (late.outcome === 'reversal_applied') assert.equal(late.idempotentReplay, true, `${action} is a replay of the revocation`);
        assert.equal(observeEffective(o.season), 1, `${action} on the revoked first purchase`);
      }
      assert.deepEqual(grantState(o.id), { grants: 1, events: ['granted', 'suspended', 'revoked'] });
      expectErr(() => checkout(owner, o.season), '55000', 'TORNEOS_SEASON_ALREADY_PREMIUM');
      // refund
      const r = openPurchase('refund2');
      const rp = pay('rf');
      status(r.id, 'approved', rp);
      reversal(r.id, 'refund', rp, 'refunded', 'refunded');
      assert.equal(observeEffective(r.season), 0);
      const again = checkout(owner, r.season);
      assert.notEqual(again.id, r.id);
      pref(again.id);
      assert.equal(status(again.id, 'approved', pay('rf2')).outcome, 'approved');
      assert.deepEqual([seasonGrants(r.season), observeEffective(r.season)], [2, 1]);
      assert.equal(reversal(r.id, 'refund', rp, 'refunded', 'refunded').idempotentReplay, true);
      assert.equal(observeEffective(r.season), 1);
      // the second purchase's own lifecycle: suspended blocks again, lost re-enables
      const pid3 = purchase(again.id).approved_provider_payment_id;
      reversal(again.id, 'chargeback_disputed', pid3, 'charged_back', 'in_process');
      expectErr(() => checkout(owner, r.season), '55000', 'TORNEOS_SEASON_PREMIUM_SUSPENDED');
      assert.equal(observeEffective(r.season), 0);
      reversal(again.id, 'chargeback_restored', pid3, 'charged_back', 'reimbursed');
      assert.equal(observeEffective(r.season), 1);
    });

    // ============================================================ G. Premium invariants
    await check('premium: never before approved; exactly one grant per purchase and per season; visible to every seated billing admin; activation goes through activate_verified_tournament_purchase (audit billing.season_purchase_activated)', async () => {
      const o = openPurchase('premiumviz');
      admin(`insert into public.tournament_season_member_assignments(organization_id, season_id, membership_id, assigned_by) select ${lit(org)}, ${lit(o.season)}, id, ${lit(owner.id)} from public.tournament_organization_members where organization_id = ${lit(org)} and user_id = ${lit(admSeated.id)}`);
      assert.deepEqual([plan(o.season), plan(o.season, admSeated)], ['FREE', 'FREE']);
      status(o.id, 'pending', pay('p'));
      assert.equal(plan(o.season), 'FREE'); assert.equal(seasonGrants(o.season), 0);
      const pid = pay('ok');
      status(o.id, 'approved', pid);
      assert.deepEqual([plan(o.season), plan(o.season, admSeated)], ['PREMIUM', 'PREMIUM']);
      assert.equal(seasonGrants(o.season), 1);
      const ent = j(asUser(owner, `select public.get_effective_tournament_season_entitlements(${lit(org)}, ${lit(o.season)})`));
      assert.deepEqual([ent.assignmentSource, ent.limits.galleryAssetLimit, ent.branding.canRemoveArma2], ['purchase', 1000, true]);
      assert.equal(Number(admin(`select count(*) from public.tournament_audit_log where resource_id = ${lit(o.id)} and action = 'billing.season_purchase_activated'`).trim()), 1);
      expectErr(() => asUser(outsider, `select public.get_effective_tournament_season_entitlements(${lit(org)}, ${lit(o.season)})`), '42501', 'TORNEOS_ENTITLEMENTS_FORBIDDEN');
    });
    await check('premium: across every season this suite touched, no season holds two effective grants, two approved purchases with live grants, or two open purchases', async () => {
      const worst = j(admin(`select json_build_object(
          'effective', (select coalesce(max(n), 0) from (select count(*) n from public.tournament_season_plan_grants g where g.organization_id = ${lit(org)} and public.is_tournament_season_plan_grant_effective(g.id) group by g.season_id) s),
          'live', (select coalesce(max(n), 0) from (select count(*) n from public.tournament_season_plan_grants g where g.organization_id = ${lit(org)}
            and coalesce((select e.event_type from public.tournament_season_plan_grant_events e where e.season_grant_id = g.id order by e.id desc limit 1), 'granted') <> 'revoked' group by g.season_id) s),
          'open', (select coalesce(max(n), 0) from (select count(*) n from public.tournament_purchases p where p.organization_id = ${lit(org)} and p.status in ('created','preference_created','pending') group by p.season_id) s))`));
      observed.maxEffectiveGrantsPerSeason = Math.max(observed.maxEffectiveGrantsPerSeason, worst.effective);
      observed.maxLiveGrantsPerSeason = worst.live;
      assert.deepEqual(worst, { effective: 1, live: 1, open: 1 });
    });

    // ============================================================ H. ACL matrix
    await check('acl: live matrix == authorized MP-A2 delta — anon none; authenticated only wrapper + get_tournament_purchase + entitlements (create/fake/cancel revoked); payment_service only its 4; service_role preserved (no new grants); runtime logins nothing; owner supabase_admin', async () => {
      const fns = [
        ...DELTA.new_security_definer_functions.map(f => f.function),
        ...DELTA.authenticated_execute_granted, ...DELTA.authenticated_execute_revoked, ...DELTA.authenticated_execute_kept, ...DELTA.authenticated_execute_kept_revoked,
        'record_tournament_purchase_preference(uuid,text,text,text,timestamp with time zone)', 'activate_verified_tournament_purchase(uuid,text,text,text,text,text,text)',
        'apply_tournament_purchase_reversal(uuid,text,text)', 'grant_tournament_season_premium(uuid,uuid,uuid,text)', 'apply_fake_tournament_payment_status(uuid,text,text,text,text)',
        'activate_verified_fake_tournament_purchase(uuid,text,text)', 'tournament_purchase_projection(tournament_purchases)',
      ];
      const roles = ['anon', 'authenticated', 'service_role', PAY, 'torneos_core_adapter', 'torneos_identity_writer', 'authenticator', 'lab_payment_service', 'lab_identity_writer', 'lab_core_adapter'];
      const live = j(admin(`select json_agg(json_build_object('function', f, 'owner', (select pg_get_userbyid(proowner) from pg_proc where oid = f::regprocedure), 'secdef', (select prosecdef from pg_proc where oid = f::regprocedure),
        'settings', (select proconfig from pg_proc where oid = f::regprocedure), 'public', (select exists (select 1 from aclexplode(coalesce(proacl, acldefault('f', proowner))) a where a.grantee = 0) from pg_proc where oid = f::regprocedure),
        ${roles.map(r => `'${r}', has_function_privilege('${r}', ('public.' || f)::regprocedure, 'EXECUTE')`).join(', ')}) order by f) from unnest(${lit(`{${fns.map(f => `"${f}"`).join(',')}}`)}::text[]) f`));
      const svcBaseline = new Set(['get_tournament_purchase(uuid)', 'get_effective_tournament_season_entitlements(uuid,uuid)', 'create_tournament_season_purchase(uuid,uuid,text,uuid,text,text)', 'create_fake_tournament_season_purchase(uuid,uuid,text,uuid,text)', 'cancel_tournament_purchase(uuid)',
        'record_tournament_purchase_preference(uuid,text,text,text,timestamp with time zone)', 'activate_verified_tournament_purchase(uuid,text,text,text,text,text,text)', 'apply_tournament_purchase_reversal(uuid,text,text)', 'grant_tournament_season_premium(uuid,uuid,uuid,text)',
        'apply_fake_tournament_payment_status(uuid,text,text,text,text)', 'activate_verified_fake_tournament_purchase(uuid,text,text)', 'tournament_purchase_projection(tournament_purchases)']);
      const authGranted = new Set(['create_tournament_season_checkout_purchase(uuid,uuid,uuid)', 'get_tournament_purchase(uuid)', 'get_effective_tournament_season_entitlements(uuid,uuid)']);
      const payGranted = new Set(DELTA.payment_service_execute);
      for (const row of live) {
        const expected = { anon: false, authenticated: authGranted.has(row.function), service_role: svcBaseline.has(row.function), [PAY]: payGranted.has(row.function),
          torneos_core_adapter: false, torneos_identity_writer: false, authenticator: false, lab_payment_service: false, lab_identity_writer: false, lab_core_adapter: false };
        assert.deepEqual(Object.fromEntries(roles.map(r => [r, row[r]])), expected, row.function);
        assert.equal(row.public, false, `${row.function}: PUBLIC`); assert.equal(row.owner, 'supabase_admin', row.function);
        matrix.functions.push({ ...row, expected });
      }
      for (const f of DELTA.new_security_definer_functions) {
        const row = live.find(x => x.function === f.function);
        assert.equal(row.secdef, true); assert.deepEqual(row.settings, ['search_path=""']);
      }
      // payment_service executes exactly its four functions in public + private, and nothing through PUBLIC.
      const payAll = j(admin(`select json_agg(p.oid::regprocedure::text order by 1) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and has_function_privilege('${PAY}', p.oid, 'EXECUTE')`));
      assert.deepEqual(payAll.sort(), [...payGranted].sort());
      const attrs = j(admin(`select json_build_object('login', rolcanlogin, 'inherit', rolinherit, 'super', rolsuper, 'createrole', rolcreaterole, 'createdb', rolcreatedb, 'bypassrls', rolbypassrls, 'replication', rolreplication,
        'member_of', (select coalesce(json_agg(g.rolname), '[]') from pg_auth_members m join pg_roles g on g.oid = m.roleid where m.member = r.oid),
        'members', (select coalesce(json_agg(g.rolname order by g.rolname), '[]') from pg_auth_members m join pg_roles g on g.oid = m.member where m.roleid = r.oid)) from pg_roles r where rolname = '${PAY}'`));
      assert.deepEqual(attrs, { login: false, inherit: false, super: false, createrole: false, createdb: false, bypassrls: false, replication: false, member_of: [], members: ['lab_payment_service'] });
      const login = j(admin(`select json_build_object('login', rolcanlogin, 'inherit', rolinherit, 'super', rolsuper) from pg_roles where rolname = 'lab_payment_service'`));
      assert.deepEqual(login, { login: true, inherit: false, super: false }, 'lab login is a NOINHERIT member');
    });
    await check('acl: direct DML — no API role, payment_service or its login holds INSERT/UPDATE/DELETE/TRUNCATE on commercial tables; payment_service has no SELECT; service_role keeps exactly its baseline SELECT; real attempts are refused', async () => {
      // Commercial tables only (tournament_audit_log keeps its baseline-certified, RLS + append-only protected grants; 0002 does not touch it).
      const tables = ['tournament_purchases', 'tournament_purchase_events', 'tournament_season_plan_grants', 'tournament_season_plan_grant_events', 'tournament_commercial_offers', 'tournament_commercial_products', 'tournament_plan_grants', 'tournament_plan_grant_events'];
      const roles = ['anon', 'authenticated', 'service_role', PAY, 'lab_payment_service'];
      const rows = j(admin(`select json_agg(json_build_object('table', t, ${roles.map(r => `'${r}', array(select x from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) x where has_table_privilege('${r}', ('public.' || t)::regclass, x))`).join(', ')}) order by t) from unnest(${lit(`{${tables.join(',')}}`)}::text[]) t`));
      for (const r of rows) {
        for (const role of ['anon', 'authenticated', PAY, 'lab_payment_service']) assert.deepEqual(r[role].filter(p => p !== 'SELECT' || [PAY, 'lab_payment_service'].includes(role)), [], `${role} on ${r.table}`);
        assert.deepEqual(r[PAY], [], `${PAY} on ${r.table}`);
        assert.deepEqual(r.service_role.filter(p => p !== 'SELECT'), [], `service_role on ${r.table}`);
        matrix.relations.push(r);
      }
      assert.equal(admin(`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','v','m') and (has_table_privilege('${PAY}', c.oid, 'SELECT') or has_table_privilege('${PAY}', c.oid, 'INSERT') or has_table_privilege('${PAY}', c.oid, 'UPDATE') or has_table_privilege('${PAY}', c.oid, 'DELETE'))`).trim(), '0', 'payment_service holds no table privilege anywhere');
      assert.equal(admin(`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public','private') and c.relkind = 'S' and (has_sequence_privilege('${PAY}', c.oid, 'USAGE') or has_sequence_privilege('${PAY}', c.oid, 'SELECT') or has_sequence_privilege('${PAY}', c.oid, 'UPDATE'))`).trim(), '0', 'payment_service holds no sequence privilege');
      const o = openPurchase('dml');
      expectErr(() => asPay(`update public.tournament_purchases set status = 'approved' where id = ${lit(o.id)}`), '42501', 'permission denied for table tournament_purchases');
      expectErr(() => asPay(`insert into public.tournament_purchase_events(purchase_id, organization_id, event_type, actor_type) values (${lit(o.id)}, ${lit(org)}, 'payment.approved', 'provider')`), '42501', 'permission denied for table tournament_purchase_events');
      expectErr(() => asUser(owner, `update public.tournament_purchases set amount_snapshot = 1 where id = ${lit(o.id)}`), '42501', 'permission denied for table tournament_purchases');
      expectErr(() => asUser(owner, `insert into public.tournament_season_plan_grants(organization_id, season_id, plan_code, source, reason) values (${lit(org)}, ${lit(o.season)}, 'PREMIUM', 'manual_legacy', 'forged premium grant')`), '42501', 'permission denied for table tournament_season_plan_grants');
      const token = await bearer(owner);
      const out = rest([
        { id: 'insert-purchase', path: '/tournament_purchases', token, body: { organization_id: org, season_id: o.season } },
        { id: 'insert-grant', path: '/tournament_season_plan_grants', token, body: { organization_id: org, season_id: o.season, plan_code: 'PREMIUM', source: 'manual_legacy', reason: 'forged premium grant' } },
      ]);
      for (const r of out) assert.ok([401, 403].includes(r.status) && r.body?.code === '42501', `${r.id}: ${r.status} ${JSON.stringify(r.body)}`);
      assert.equal(purchase(o.id).status, 'preference_created'); assert.equal(seasonGrants(o.season), 0);
    });
    await check('acl: Data API — anon is denied every commercial RPC before the body; authenticated is denied the revoked creators and all service RPCs; the wrapper and reads execute', async () => {
      const token = await bearer(owner);
      const o = openPurchase('dataapi');
      const denied = ['create_tournament_season_purchase', 'create_fake_tournament_season_purchase', 'cancel_tournament_purchase', 'get_provider_tournament_purchase', 'apply_verified_tournament_payment_status', 'apply_verified_tournament_payment_reversal', 'record_tournament_purchase_preference', 'activate_verified_tournament_purchase', 'apply_tournament_purchase_reversal'];
      const args = j(admin(`select json_object_agg(p.proname, (select json_object_agg(a, null) from unnest(p.proargnames) a)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (${[...denied, 'create_tournament_season_checkout_purchase', 'get_tournament_purchase', 'get_effective_tournament_season_entitlements'].map(lit).join(',')})`));
      const anon = rest([...denied, 'create_tournament_season_checkout_purchase', 'get_tournament_purchase', 'get_effective_tournament_season_entitlements'].map(n => ({ id: n, path: `/rpc/${n}`, body: args[n] })));
      for (const r of anon) assert.ok(deniedBeforeBody(r), `anon ${r.id}: ${r.status} ${JSON.stringify(r.body)}`);
      const auth = rest(denied.map(n => ({ id: n, path: `/rpc/${n}`, body: args[n], token })));
      for (const r of auth) assert.ok(deniedBeforeBody(r), `authenticated ${r.id}: ${r.status} ${JSON.stringify(r.body)}`);
      const ok = rest([
        { id: 'get', path: '/rpc/get_tournament_purchase', token, body: { p_purchase_id: o.id } },
        { id: 'ent', path: '/rpc/get_effective_tournament_season_entitlements', token, body: { p_organization_id: org, p_season_id: o.season } },
      ]);
      assert.deepEqual(ok.map(r => [r.id, r.status]), [['get', 200], ['ent', 200]]);
      assert.equal(ok[0].body.id, o.id); assert.equal(ok[1].body.plan, 'FREE');
    });
    await check('acl: the payment-service login is NOINHERIT — without SET ROLE it executes nothing; with SET ROLE it executes its four functions and nothing else (no table read, no activation, no checkout, no reversal chain)', async () => {
      const o = openPurchase('login');
      const steps = [
        { id: 'no-role-lookup', sql: `select public.get_provider_tournament_purchase($1, 'MERCADO_PAGO', 'test') r`, params: [o.externalReference] },
        { id: 'no-role-read', sql: 'select count(*) from public.tournament_purchases' },
        { id: 'set-role', sql: `set role ${PAY}` },
        { id: 'lookup', sql: `select public.get_provider_tournament_purchase($1, 'MERCADO_PAGO', 'test') r`, params: [o.externalReference] },
        { id: 'status', sql: `select public.apply_verified_tournament_payment_status($1, 'MERCADO_PAGO', 'test', 'pending', 'in_process', null, $2, '2026-01-02T00:00:00Z'::timestamptz) r`, params: [o.id, pay('login')] },
        { id: 'read', sql: 'select count(*) from public.tournament_purchases' },
        { id: 'events', sql: 'select count(*) from public.tournament_purchase_events' },
        { id: 'activate', sql: `select public.activate_verified_tournament_purchase($1, 'MERCADO_PAGO', 'test', 'approved', null, 'x', null)`, params: [o.id] },
        { id: 'reversal-chain', sql: `select public.apply_tournament_purchase_reversal($1, 'refund', 'reembolso forzado por el test')`, params: [o.id] },
        { id: 'grant', sql: `select public.grant_tournament_season_premium($1, $2, $3, 'grant forzado por el test')`, params: [org, o.season, o.id] },
        { id: 'checkout', sql: `select public.create_tournament_season_checkout_purchase($1, $2, $3)`, params: [org, o.season, newKey()] },
        { id: 'become-service-role', sql: 'set role service_role' },
        { id: 'become-authenticated', sql: 'set role authenticated' },
      ];
      const [out] = paymentLogin([steps]);
      const by = Object.fromEntries(out.map(x => [x.id, x]));
      for (const id of ['no-role-lookup', 'no-role-read', 'read', 'events', 'activate', 'reversal-chain', 'grant', 'checkout', 'become-service-role', 'become-authenticated']) {
        assert.equal(by[id].ok, false, id); assert.equal(by[id].code, '42501', `${id}: ${by[id].message}`);
      }
      assert.equal(by.lookup.ok, true); assert.equal(by.lookup.rows[0].r.id, o.id);
      assert.equal(by.status.ok, true); assert.equal(by.status.rows[0].r.status, 'pending');
      assert.equal(seasonGrants(o.season), 0);
    });

    // ============================================================ I. persistence
    await check('persistence: purchase events and season grant events are append-only even for the owner; purchase snapshots are immutable; the state machine refuses approved → pending', async () => {
      const o = openPurchase('persist');
      const pid = pay('ps');
      status(o.id, 'approved', pid);
      const eid = admin(`select id from public.tournament_purchase_events where purchase_id = ${lit(o.id)} order by id limit 1`).trim();
      const gid = admin(`select e.id from public.tournament_season_plan_grant_events e join public.tournament_season_plan_grants g on g.id = e.season_grant_id where g.origin_purchase_id = ${lit(o.id)} limit 1`).trim();
      for (const [label, q] of [
        ['update purchase event', `update public.tournament_purchase_events set event_type = 'payment.forged' where id = ${eid}`],
        ['delete purchase event', `delete from public.tournament_purchase_events where id = ${eid}`],
        ['update grant event', `update public.tournament_season_plan_grant_events set event_type = 'revoked' where id = ${gid}`],
        ['delete grant event', `delete from public.tournament_season_plan_grant_events where id = ${gid}`],
      ]) { const r = rawTx(`BEGIN; ${q}; ROLLBACK;`); assert.ok(!r.ok && /55000: TORNEOS_APPEND_ONLY_RESOURCE/.test(r.error), `${label}: ${r.error}`); }
      for (const [label, q] of [
        ['amount', `update public.tournament_purchases set amount_snapshot = 1 where id = ${lit(o.id)}`],
        ['provider', `update public.tournament_purchases set provider = 'FAKE', provider_environment = 'local' where id = ${lit(o.id)}`],
        ['buyer', `update public.tournament_purchases set buyer_user_id = ${lit(outsider.id)} where id = ${lit(o.id)}`],
        ['external reference', `update public.tournament_purchases set external_reference = ${lit('arma2:season:purchase:' + randomUUID())} where id = ${lit(o.id)}`],
      ]) { const r = rawTx(`BEGIN; ${q}; ROLLBACK;`); assert.ok(!r.ok && /55000: TORNEOS_PURCHASE_SNAPSHOT_IMMUTABLE/.test(r.error), `${label}: ${r.error}`); }
      const back = rawTx(`BEGIN; update public.tournament_purchases set status = 'pending' where id = ${lit(o.id)}; ROLLBACK;`);
      assert.match(back.error, /55000: TORNEOS_PURCHASE_TRANSITION_INVALID/);
      const trig = j(admin(`select json_agg(tgname order by tgname) from pg_trigger where tgrelid = 'public.tournament_season_plan_grant_events'::regclass and not tgisinternal`));
      assert.deepEqual(trig, ['tournament_season_plan_grant_events_append_only']);
      assert.deepEqual(grantState(o.id), { grants: 1, events: ['granted'] });
    });
    await check('persistence: the only new transition is pending → preference_created (an ended payment attempt); every other baseline transition rule is unchanged', async () => {
      const probe = checkout(owner, newSeason('transitions'));
      const allowed = (from, to) => {
        // Arrange `from` with triggers off for this rolled-back probe only, then exercise the edge with the trigger on.
        const arranged = rawTx(`BEGIN; SET LOCAL session_replication_role = replica; update public.tournament_purchases set status = ${lit(from)} where id = ${lit(probe.id)}; SET LOCAL session_replication_role = origin; update public.tournament_purchases set status = ${lit(to)} where id = ${lit(probe.id)}; ROLLBACK;`);
        return arranged.ok ? 'allowed' : (/TORNEOS_PURCHASE_TRANSITION_INVALID/.test(arranged.error) ? 'refused' : arranged.error);
      };
      const edges = {
        'pending→preference_created': 'allowed', 'preference_created→pending': 'allowed', 'pending→approved': 'allowed', 'created→preference_created': 'allowed', 'created→cancelled': 'allowed', 'preference_created→expired': 'allowed',
        'approved→pending': 'refused', 'approved→preference_created': 'refused', 'expired→preference_created': 'refused', 'cancelled→preference_created': 'refused', 'rejected→preference_created': 'refused', 'refunded→approved': 'refused', 'created→approved': 'refused', 'charged_back→approved': 'allowed', 'approved→refunded': 'allowed',
      };
      const got = Object.fromEntries(Object.keys(edges).map(k => [k, allowed(...k.split('→'))]));
      assert.deepEqual(got, edges);
    });

    // ============================================================ J. no secrets
    await check('no secrets: lab secrets, the payment login password and bearers are absent from the migration, the delta manifest and this suite\'s evidence', async () => {
      const secrets = [cfg.dbPassword, cfg.readerPassword, cfg.writerPassword, cfg.adapterPassword, cfg.paymentServicePassword, cfg.coreSecret, cfg.serviceRoleKey, cfg.anonKey, cfg.coreContractSecret, ...cfg.keys.map(k => k.privateKey), ...seenSecrets].filter(Boolean);
      const texts = [await readFile(MIGRATIONS + M2, 'utf8'), JSON.stringify(DELTA), JSON.stringify(matrix), JSON.stringify(results)];
      for (const text of texts) { for (const s of secrets) assert.ok(!text.includes(s), 'artifact carries a lab secret'); assert.ok(!/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\./.test(text), 'artifact carries a JWT'); }
    });
  } finally {
    await mkdir(EVIDENCE, { recursive: true });
    await writeFile(`${EVIDENCE}commerce-db-acl-matrix${TAG}.json`, JSON.stringify({ source: 'live lab stack (0000 + 0001 + 0002)', delta_manifest: 'backend/torneos/mp-a/mp-a2-acl-delta.json', ...matrix }, null, 2) + '\n');
    await writeFile(`${EVIDENCE}commerce-db-results${TAG}.json`, JSON.stringify({ generated_at: new Date().toISOString(), run: RUN, migration_sha256: SHA, observed,
      pass: results.filter(r => r.status === 'PASS').length, fail: results.filter(r => r.status === 'FAIL').length, results }, null, 2) + '\n');
  }
});
