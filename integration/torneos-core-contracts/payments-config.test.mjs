// MP-A3 — T5: torneos-payments configuration (fail-closed, TEST only), database identity/privilege and
// secret isolation. Part A is offline (config loader, edge-main env filter, static source guards). Part B
// uses the local commerce lab: the payment-service login on the REAL Torneos DB and the lab runtime files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { UNIT_ENV } from './payments-unit-env.mjs';
import { inGateway } from './lab.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const here = fileURLToPath(new URL('.', import.meta.url));
const FN = `${repo}backend/torneos/supabase/functions/torneos-payments/`;
const EDGE_MAIN = `${here}torneos-edge-main/`;
const DELTA = JSON.parse(await readFile(`${repo}backend/torneos/mp-a/mp-a2-acl-delta.json`, 'utf8'));
DELTA.payment_service_execute = DELTA.payment_service_execute.map(f => f.startsWith('apply_verified_tournament_payment_') ? f.replace(/\)$/, ',timestamp with time zone)') : f);
const results = [];
const LAB = process.env.MP_A3_SKIP_LAB !== '1';

test('MP-A3 — T5 config / privilege / isolation', async (t) => {
  async function check(name, fn) {
    await t.test(name, async () => {
      try { await fn(); results.push({ name, status: 'PASS' }); }
      catch (error) { results.push({ name, status: 'FAIL', error: String(error.message ?? error).slice(0, 300) }); throw error; }
    });
  }
  let evidence = null;
  try {
    // ============================================================ A. configuration (offline)
    const { loadPaymentsConfig: loader } = await import(`${FN}config.ts`).catch(() => ({}));
    // Guarded so a missing loader fails every config check instead of "throwing" vacuously inside assert.throws.
    const loadPaymentsConfig = (env) => { if (typeof loader !== 'function') throw new assert.AssertionError({ message: 'config.ts loadPaymentsConfig missing' }); return loader(env); };
    const expectReject = (env, label) => {
      assert.equal(typeof loader, 'function', 'config.ts exports loadPaymentsConfig');
      assert.throws(() => loader(env), (e) => !(e instanceof assert.AssertionError) && !(e instanceof TypeError && /not a function/.test(e.message)), label);
    };
    await check('config: the TEST configuration loads (provider MERCADO_PAGO, environment test, public https URLs, ≥32-byte internal secret, dedicated DB login)', async () => {
      assert.equal(typeof loader, 'function', 'config.ts exports loadPaymentsConfig');
      const c = loadPaymentsConfig({ ...UNIT_ENV });
      assert.equal(c.mp.sellerId, UNIT_ENV.MERCADO_PAGO_TEST_SELLER_ID);
      assert.equal(c.appBaseUrl, 'https://app.unit.invalid'); assert.equal(c.internalSecret.length, 32); assert.equal(c.labMpApiOrigin, null);
    });
    await check('config: every critical variable missing or blank → fail closed', async () => {
      for (const name of Object.keys(UNIT_ENV)) {
        for (const value of [undefined, '', '   ']) {
          const env = { ...UNIT_ENV, [name]: value };
          expectReject(env, `${name}=${JSON.stringify(value)}`);
        }
      }
    });
    await check('config: live / production / any non-test environment or provider → fail closed; live-looking MP credentials present → fail closed', async () => {
      for (const v of ['live', 'production', 'prod', 'LIVE', 'Test', 'TEST', 'sandbox', 'qa']) expectReject({ ...UNIT_ENV, MERCADO_PAGO_ENVIRONMENT: v }, v);
      for (const v of ['FAKE', 'mercado_pago', 'STRIPE']) expectReject({ ...UNIT_ENV, TORNEOS_PAYMENT_PROVIDER: v }, v);
      for (const name of ['MERCADO_PAGO_ACCESS_TOKEN', 'MERCADO_PAGO_LIVE_ACCESS_TOKEN', 'MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN', 'MERCADO_PAGO_WEBHOOK_SECRET', 'MERCADO_PAGO_PROD_SELLER_ID']) {
        expectReject({ ...UNIT_ENV, [name]: 'APP_USR-live-fixture' }, name);
      }
    });
    await check('config: public URLs must be public https (no http, localhost, loopback, credentials, query); the notification URL must be the payments webhook route', async () => {
      for (const v of ['http://app.unit.invalid', 'https://localhost', 'https://127.0.0.1', 'not a url']) expectReject({ ...UNIT_ENV, APP_PUBLIC_URL: v }, v);
      for (const v of ['https://fn.unit.invalid/functions/v1/torneos-gateway/x', 'http://fn.unit.invalid/functions/v1/torneos-payments/webhooks/mercadopago/v1',
        'https://fn.unit.invalid/functions/v1/torneos-payments/webhooks/mercadopago/v1?x=1', 'https://localhost/functions/v1/torneos-payments/webhooks/mercadopago/v1']) {
        expectReject({ ...UNIT_ENV, TORNEOS_PAYMENTS_NOTIFICATION_URL: v }, v);
      }
      expectReject({ ...UNIT_ENV, APP_PUBLIC_URL: 'https://rcyuuoaqfwcembdajcss.supabase.co' }, 'Production ref');
    });
    await check('config: internal HMAC secret < 32 effective bytes, non-hex or degenerate, or reused as the webhook secret / token → fail closed', async () => {
      for (const v of ['ab'.repeat(31), 'zz'.repeat(32), 'a'.repeat(65), '00'.repeat(32), 'aa'.repeat(40)]) expectReject({ ...UNIT_ENV, TORNEOS_PAYMENTS_INTERNAL_SECRET: v }, v);
      expectReject({ ...UNIT_ENV, MERCADO_PAGO_TEST_WEBHOOK_SECRET: UNIT_ENV.TORNEOS_PAYMENTS_INTERNAL_SECRET }, 'secret reuse');
    });
    await check('config: DB login must be a dedicated payments login — service_role, postgres, supabase_admin, authenticator, anon, authenticated, the gateway logins or a Production ref → fail closed', async () => {
      for (const login of ['service_role', 'postgres', 'supabase_admin', 'authenticator', 'anon', 'authenticated', 'supabase_auth_admin', 'lab_identity_writer', 'lab_core_adapter',
        'torneos_identity_writer', 'torneos_core_adapter', 'postgres.rcyuuoaqfwcembdajcss', 'payments.rcyuuoaqfwcembdajcss']) {
        expectReject({ ...UNIT_ENV, TORNEOS_PAYMENTS_DB_URL: `postgres://${login}:pw@db.unit.invalid:5432/postgres` }, login);
      }
      for (const v of ['mysql://payments_login:pw@db/x', 'postgres://db.unit.invalid/postgres', 'postgres://payments_login:pw@db.rcyuuoaqfwcembdajcss.supabase.co:5432/postgres']) {
        expectReject({ ...UNIT_ENV, TORNEOS_PAYMENTS_DB_URL: v }, v);
      }
    });
    await check('config: the lab Mercado Pago origin is accepted only as http://mp-stub:<port> together with a .invalid public URL and the lab DB host', async () => {
      const lab = { ...UNIT_ENV, TORNEOS_PAYMENTS_DB_URL: 'postgres://lab_payment_service:pw@torneos-db:5432/postgres' };
      assert.equal(loadPaymentsConfig({ ...lab, TORNEOS_PAYMENTS_LAB_MP_API_ORIGIN: 'http://mp-stub:8080' }).labMpApiOrigin, 'http://mp-stub:8080');
      for (const v of ['https://api.mercadopago.com', 'http://evil.invalid:8080', 'http://mp-stub:8080/x', 'http://mp-stub', 'http://127.0.0.1:8080']) {
        expectReject({ ...lab, TORNEOS_PAYMENTS_LAB_MP_API_ORIGIN: v }, v);
      }
      expectReject({ ...lab, APP_PUBLIC_URL: 'https://arma2.example', TORNEOS_PAYMENTS_LAB_MP_API_ORIGIN: 'http://mp-stub:8080' }, 'lab origin with a routable app URL');
      expectReject({ ...UNIT_ENV, TORNEOS_PAYMENTS_LAB_MP_API_ORIGIN: 'http://mp-stub:8080' }, 'lab origin with a non-lab DB host');
    });
    await check('config: a rejected configuration serves 503 on both routes and 404 elsewhere (never partially)', async () => {
      const { createPaymentsService } = await import(`${FN}handler.ts`);
      let connects = 0;
      const handle = createPaymentsService({ env: { ...UNIT_ENV, MERCADO_PAGO_ENVIRONMENT: 'live' }, log: () => {}, connectDb: () => { connects += 1; return {}; } });
      for (const path of ['/internal/v1/season-checkout-preference', '/webhooks/mercadopago/v1']) {
        assert.equal((await handle(new Request(`http://x.invalid/torneos-payments${path}`, { method: 'POST', body: '{}' }))).status, 503, path);
      }
      assert.equal((await handle(new Request('http://x.invalid/torneos-payments/other', { method: 'POST' }))).status, 404);
      assert.equal(connects, 0, 'no DB connection with a rejected config');
    });

    // ============================================================ B. static guards
    const sources = Object.fromEntries(await Promise.all((await readdir(FN).catch(() => [])).filter(f => f.endsWith('.ts')).map(async f => [f, await readFile(FN + f, 'utf8')])));
    await check('static: torneos-payments never uses service_role, a Supabase client, Core auth/contract, bridge keys or the baseline apply_tournament_purchase_reversal', async () => {
      assert.ok(Object.keys(sources).length >= 5, 'sources present');
      for (const [file, text] of Object.entries(sources)) {
        // config.ts's login and (MP-B1.1 R3) variable deny-lists name the forbidden roles / variables on purpose; they are the guard, not a use.
        const code = text.replace(/const FORBIDDEN_DB_LOGINS = new Set\(\[[\s\S]*?\]\)/, '').replace(/const FORBIDDEN_PAYMENTS_ENV = new Set\(\[[\s\S]*?\]\)/, '').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        assert.ok(!/service_role|(?<!PAYMENT_)SERVICE_ROLE|SUPABASE_SECRET|sb_secret_|createClient|supabase-js/.test(code), `${file}: service role / supabase client`);
        assert.ok(!/CORE_[A-Z_]+|TORNEOS_BRIDGE_KEYS|TORNEOS_CONTRACT_SERVICE_SECRET|TORNEOS_DB_(IDENTITY_WRITER|CORE_ADAPTER)|\/auth\/v1|torneos-core-contract/.test(code), `${file}: Core / bridge`);
        assert.ok(!/(?<!verified_)tournament_purchase_reversal\b/.test(code.replace(/apply_verified_tournament_payment_reversal/g, '')), `${file}: baseline reversal`);
        assert.ok(!/activate_verified_tournament_purchase|grant_tournament_season_premium|INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM/i.test(code), `${file}: direct domain write`);
      }
    });
    await check('static + unit: the RPC allowlist is exactly the 4 MP-A2 payment_service functions; anything else (incl. apply_tournament_purchase_reversal) is refused before SQL', async () => {
      const rpc = await import(`${FN}rpc.ts`);
      assert.equal(rpc.PAYMENT_SERVICE_ROLE, 'torneos_payment_service');
      const names = Object.keys(rpc.PAYMENT_RPCS).sort();
      assert.deepEqual(names, DELTA.payment_service_execute.map(f => f.split('(')[0]).sort());
      for (const name of names) assert.match(rpc.rpcStatement(name), new RegExp(`^SELECT public\\.${name}\\(`));
      for (const bad of ['apply_tournament_purchase_reversal', 'activate_verified_tournament_purchase', 'get_tournament_purchase', 'create_tournament_season_purchase',
        'grant_tournament_season_premium', 'constructor', '__proto__', 'toString', "get_provider_tournament_purchase; DROP TABLE x"]) {
        assert.throws(() => rpc.rpcStatement(bad), /TORNEOS_PAYMENTS_RPC_FORBIDDEN/, bad);
      }
      assert.ok(/SET LOCAL ROLE \$\{PAYMENT_SERVICE_ROLE\}|SET LOCAL ROLE torneos_payment_service/.test(sources['db.ts'] ?? ''), 'db.ts switches to the payment service role');
    });
    await check('env isolation (edge-main): gateway worker gets no MERCADO_PAGO_* / payments secrets; payments worker gets no Core, bridge, gateway DB or service keys; unknown workers get nothing', async () => {
      const { workerEnv, WORKERS } = await import(`${EDGE_MAIN}env.ts`);
      assert.deepEqual([...WORKERS].sort(), ['torneos-gateway', 'torneos-payments']);
      const full = { ...UNIT_ENV, TORNEOS_PAYMENTS_LAB_MP_API_ORIGIN: 'http://mp-stub:8080', TORNEOS_GATEWAY_PUBLIC_URL: 'x', TORNEOS_ALLOWED_ORIGIN: 'x', CORE_AUTH_URL: 'x', CORE_JWT_ISSUER: 'x', CORE_ANON_KEY: 'x',
        CORE_CONTRACT_URL: 'x', TORNEOS_CONTRACT_SERVICE_SECRET: 'x', TORNEOS_REST_URL: 'x', TORNEOS_ANON_KEY: 'x', TORNEOS_DB_IDENTITY_WRITER_URL: 'x', TORNEOS_DB_CORE_ADAPTER_URL: 'x',
        TORNEOS_BRIDGE_KEYS: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x', SUPABASE_DB_URL: 'x', PATH: '/bin', HOME: '/root' };
      const gw = Object.fromEntries(workerEnv('torneos-gateway', full));
      const pay = Object.fromEntries(workerEnv('torneos-payments', full));
      assert.ok(!Object.keys(gw).some(k => /^MERCADO_PAGO_|^TORNEOS_PAYMENT|^APP_PUBLIC_URL$/.test(k)), `gateway env: ${Object.keys(gw)}`);
      assert.ok(Object.keys(gw).includes('TORNEOS_BRIDGE_KEYS') && Object.keys(gw).includes('CORE_CONTRACT_URL'), 'gateway keeps its own config');
      assert.deepEqual(Object.keys(pay).sort(), [...Object.keys(UNIT_ENV), 'TORNEOS_PAYMENTS_LAB_MP_API_ORIGIN'].sort());
      for (const env of [gw, pay]) assert.ok(!('SUPABASE_SERVICE_ROLE_KEY' in env) && !('SUPABASE_DB_URL' in env) && !('PATH' in env));
      for (const name of ['torneos-core-contract', 'other', 'constructor', '__proto__', '']) assert.throws(() => workerEnv(name, full), undefined, name);
      const main = await readFile(`${EDGE_MAIN}index.ts`, 'utf8');
      assert.ok(/envVars:\s*workerEnv\(serviceName,\s*Deno\.env\.toObject\(\)\)/.test(main), 'edge-main hands workers only workerEnv(...)');
      assert.equal((main.match(/Deno\.env\.toObject\(\)/g) ?? []).length, 1);
    });

    // ============================================================ C. lab: DB role, privileges, runtime isolation
    if (!LAB) return;
    const lab = await import('./payments-lab.mjs');
    const { cfg, admin, j } = lab;
    const labFile = (name) => readFile(`${here}.runtime/${name}`, 'utf8');
    /** Sessions of the payments DB login (pg inside the private network). */
    function paymentLogin(steps) {
      const url = `postgres://lab_payment_service:${cfg.paymentServicePassword}@torneos-db:5432/postgres`;
      const out = inGateway(`import pg from 'pg';
        const steps = ${JSON.stringify(steps)};
        const client = new pg.Client({ connectionString: ${JSON.stringify(url)} }); await client.connect(); const out = [];
        for (const s of steps) { try { const r = await client.query(s); out.push({ sql: s.slice(0, 80), ok: true, rows: r.rows }); }
          catch (e) { out.push({ sql: s.slice(0, 80), ok: false, code: e.code }); } }
        await client.end(); console.log(JSON.stringify(out));`);
      return JSON.parse(out.trim().split('\n').pop());
    }
    await check('lab: payments DB URL uses the dedicated login lab_payment_service (not service_role / postgres / supabase_admin / gateway logins)', async () => {
      assert.ok(cfg?.mpa, 'commerce lab');
      const env = await labFile('torneos-payments.env');
      const url = new URL(env.split('\n').find(l => l.startsWith('TORNEOS_PAYMENTS_DB_URL=')).slice('TORNEOS_PAYMENTS_DB_URL='.length));
      assert.equal(url.username, 'lab_payment_service'); assert.equal(url.hostname, 'torneos-db');
    });
    await check('lab: role shape — lab_payment_service LOGIN NOINHERIT member only of torneos_payment_service; torneos_payment_service NOLOGIN NOINHERIT with that single member; no superuser/bypassrls', async () => {
      const r = j(admin(`select json_build_object(
        'login', (select json_build_object('login', rolcanlogin, 'inherit', rolinherit, 'super', rolsuper, 'bypassrls', rolbypassrls, 'createrole', rolcreaterole) from pg_roles where rolname = 'lab_payment_service'),
        'role', (select json_build_object('login', rolcanlogin, 'inherit', rolinherit, 'super', rolsuper, 'bypassrls', rolbypassrls) from pg_roles where rolname = 'torneos_payment_service'),
        'member_of', (select coalesce(json_agg(r.rolname order by r.rolname), '[]') from pg_auth_members m join pg_roles r on r.oid = m.roleid join pg_roles u on u.oid = m.member where u.rolname = 'lab_payment_service'),
        'members', (select coalesce(json_agg(u.rolname order by u.rolname), '[]') from pg_auth_members m join pg_roles r on r.oid = m.roleid join pg_roles u on u.oid = m.member where r.rolname = 'torneos_payment_service'))`));
      assert.deepEqual(r, { login: { login: true, inherit: false, super: false, bypassrls: false, createrole: false },
        role: { login: false, inherit: false, super: false, bypassrls: false }, member_of: ['torneos_payment_service'], members: ['lab_payment_service'] });
    });
    await check('lab: exactly 4 EXECUTE after SET ROLE torneos_payment_service (public + private, incl. PUBLIC grants), equal to the MP-A2 delta; the bare NOINHERIT login executes none of them', async () => {
      const q = `select coalesce(json_agg(p.oid::regprocedure::text order by 1), '[]') as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public','private') and has_function_privilege(current_user, p.oid, 'EXECUTE')`;
      const out = paymentLogin([`SET ROLE torneos_payment_service`, q, `RESET ROLE`, q]);
      const asRole = out[1].rows[0].f.map(s => s.replace(/^public\./, ''));
      const bare = out[3].rows[0].f.filter(s => DELTA.payment_service_execute.some(d => s.endsWith(d)));
      assert.deepEqual(asRole.sort(), [...DELTA.payment_service_execute].sort());
      assert.deepEqual(bare, [], 'NOINHERIT login holds nothing by itself');
      evidence = { payment_service_execute: asRole.sort() };
    });
    await check('lab: 0 direct DML / SELECT on commercial tables, no access to other commercial functions, and apply_tournament_purchase_reversal (baseline, service_role-only) is NOT executable — real attempts refused 42501', async () => {
      const pid = admin(`select id from public.tournament_purchases order by created_at desc limit 1`).trim() || '00000000-0000-4000-8000-000000000000';
      const attempts = [
        `select * from public.tournament_purchases limit 1`, `insert into public.tournament_purchase_events(purchase_id) values ('${pid}')`,
        `update public.tournament_purchases set status = 'approved' where id = '${pid}'`, `delete from public.tournament_season_plan_grants`,
        `update public.tournament_season_plan_grant_events set reason = 'x'`, `select * from public.torneos_identity limit 1`,
        `select public.apply_tournament_purchase_reversal('${pid}', 'chargeback_restored', 'direct restore attempt from payments')`,
        `select public.activate_verified_tournament_purchase('${pid}', 'MERCADO_PAGO', 'test', 'approved', null, '1', null)`,
        `select public.grant_tournament_season_premium('${pid}', '${pid}', '${pid}', 'direct grant attempt')`,
        `select public.create_tournament_season_checkout_purchase('${pid}', '${pid}', '${pid}')`,
        `select public.create_tournament_season_purchase('${pid}', '${pid}', 'torneos_premium', '${pid}', 'MERCADO_PAGO', 'test')`,
        `select public.get_tournament_purchase('${pid}')`, `select public.cancel_tournament_purchase('${pid}')`,
        `select public.get_effective_tournament_season_entitlements('${pid}', '${pid}')`,
      ];
      const out = paymentLogin(['BEGIN', 'SET LOCAL ROLE torneos_payment_service', ...attempts.flatMap(a => ['SAVEPOINT s', a, 'ROLLBACK TO SAVEPOINT s']), 'ROLLBACK']);
      const verdicts = attempts.map(a => out.find(o => o.sql === a.slice(0, 80)));
      for (const [i, v] of verdicts.entries()) assert.deepEqual([attempts[i].slice(0, 60), v.ok, v.code], [attempts[i].slice(0, 60), false, '42501']);
      assert.equal(admin(`select has_function_privilege('torneos_payment_service', 'public.apply_tournament_purchase_reversal(uuid,text,text)', 'EXECUTE')`).trim(), 'f');
      assert.equal(admin(`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','v','m','p') and (has_table_privilege('torneos_payment_service', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))`).trim(), '0');
    });
    await check('lab: the login cannot become service_role, postgres, supabase_admin, authenticator, anon, authenticated or the gateway roles', async () => {
      const roles = ['service_role', 'postgres', 'supabase_admin', 'authenticator', 'anon', 'authenticated', 'torneos_identity_writer', 'torneos_core_adapter', 'lab_identity_writer'];
      const out = paymentLogin(roles.map(r => `SET ROLE ${r}`));
      assert.deepEqual(out.map(o => [o.sql, o.ok]), roles.map(r => [`SET ROLE ${r}`, false]));
    });
    await check('lab: the running function connects only as lab_payment_service (pg_stat_activity, application_name torneos-payments) — no Core auth needed: a Torneos/Core bearer alone is refused', async () => {
      const r = await lab.http('/internal/v1/season-checkout-preference', { headers: { authorization: `Bearer ${cfg.anonKey}`, 'content-type': 'application/json' }, body: '{}' });
      assert.equal(r.status, 403);
      const p = lab.newPurchase('stat');
      assert.equal((await lab.internal({ purchase_id: p.id })).status, 200);
      const users = j(admin(`select coalesce(json_agg(distinct usename), '[]') from pg_stat_activity where application_name = 'torneos-payments'`));
      assert.deepEqual(users, ['lab_payment_service']);
    });
    await check('lab: runtime secret isolation — payments/stub secrets only in their 0600 .runtime files; gateway env/config and Core containers never carry them; stub has no DB/Core secrets', async () => {
      const gatewayEnv = await labFile('torneos-gateway.env');
      const server = await labFile('server/config.json');
      const compose = await labFile('compose.env');
      for (const secret of [cfg.mpa.accessToken, cfg.mpa.webhookSecret, cfg.mpa.internalSecret, cfg.mpa.stubControlToken, cfg.paymentServicePassword]) {
        for (const [label, text] of [['torneos-gateway.env', gatewayEnv], ['server/config.json', server], ['compose.env', compose]]) assert.ok(!text.includes(secret), `${label} carries a payments secret`);
      }
      assert.ok(!/MERCADO_PAGO/.test(gatewayEnv + server + compose));
      const stubEnv = await labFile('mp-stub.env');
      for (const secret of [cfg.mpa.webhookSecret, cfg.mpa.internalSecret, cfg.paymentServicePassword, cfg.dbPassword, cfg.coreContractSecret, cfg.serviceRoleKey]) assert.ok(!stubEnv.includes(secret), 'stub env');
      const payments = await labFile('torneos-payments.env');
      for (const secret of [cfg.coreContractSecret, cfg.serviceRoleKey, cfg.writerPassword, cfg.adapterPassword, cfg.dbPassword, cfg.coreSecret]) assert.ok(!payments.includes(secret), 'payments env has no Core/gateway secret');
      for (const f of ['torneos-payments.env', 'mp-stub.env', 'config.json']) {
        const st = spawnSync('stat', ['-f', '%Lp', `${here}.runtime/${f}`], { encoding: 'utf8' });
        assert.equal(st.stdout.trim(), '600', f);
      }
      const coreEnv = lab.containerEnv('core-functions');
      assert.ok(!/MERCADO_PAGO|TORNEOS_PAYMENTS/.test(coreEnv), 'core-functions container has no MP env');
      const gw = lab.containerEnv('gateway');
      assert.ok(!/MERCADO_PAGO|TORNEOS_PAYMENTS/.test(gw), 'Node gateway container has no MP env');
      assert.ok(spawnSync('git', ['check-ignore', '-q', `${here}.runtime/torneos-payments.env`], { cwd: repo }).status === 0, '.runtime is git-ignored');
    });
  } finally {
    if (LAB) {
      const { writeEvidence } = await import('./payments-lab.mjs');
      await writeEvidence('t5-config-privilege', { suite: 'MP-A3 T5 config / privilege / isolation', results, db: evidence,
        passed: results.filter(r => r.status === 'PASS').length, total: results.length });
    }
  }
});
