// MP-B1.1 R2 — remote TEST commerce enablement (offline; no lab, no network).
//
//   A. config matrix      TORNEOS_COMMERCE_MODE × TORNEOS_COMMERCE_DEPLOYMENT: OFF default, local-lab unchanged,
//                         remote-test explicit (mode + deployment + two declared hosts + exact https URLs).
//   B. host validation    exact canonical hostnames: no wildcard, suffix/prefix spoof, userinfo, http, ports,
//                         IP literals, single labels, non-routable TLDs; the declared hosts themselves are validated.
//   C. Production         remote-test can never name the Production Supabase ref, Core Production, the Production
//                         web hostnames, or a live / prod / production label — gateway and payments alike.
//   D. secret isolation   what each side may read (static contract) + boot refusal of foreign material.
//   E. Node / Edge parity one loader, the same verdicts for URL objects (Edge) and strings (Node), same wiring.
//   F. webhook freshness  ts parsing mirrors the certified verifier; absurd FUTURE ts rejected before any provider
//                         call; OLD ts accepted (no documented Mercado Pago max age) and still re-fetched.
//
// Results: backend/torneos/mp-b/evidence/mp-b1.1-r2/offline[-tag].json. Fixture values only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createHash, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const here = fileURLToPath(new URL('.', import.meta.url));
const GW_DIR = `${repo}backend/torneos/supabase/functions/torneos-gateway/`;
const PAY_DIR = `${repo}backend/torneos/supabase/functions/torneos-payments/`;
const EVIDENCE = `${repo}backend/torneos/mp-b/evidence/mp-b1.1-r2/`;
const TAG = process.env.MP_B11R2_EVIDENCE_TAG ? `-${process.env.MP_B11R2_EVIDENCE_TAG}` : '';
const PROD_REF = 'rcyuuoaqfwcembdajcss';
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const results = [];
const evidence = { configMatrix: [], hostValidation: [], productionRejection: [], parity: [], webhook: [] };

const load = async (path) => import(path).catch((error) => ({ __missing: String(error?.message ?? error) }));
const commerce = await load(`${GW_DIR}commerce.ts`);
const freshness = await load(`${PAY_DIR}webhook-freshness.ts`);
const payConfig = await load(`${PAY_DIR}config.ts`);
const { UNIT_ENV: PAY_ENV } = await import('./payments-unit-env.mjs');

// ------------------------------------------------------------------ fixtures (derived, never a lab or real secret)
const stagingDoc = JSON.parse(await readFile(`${GW_DIR}staging-v1-rpc-allowlist.json`, 'utf8'));
const BASE43 = new Set(Object.values(stagingDoc.features).flat());
const SECRET = sha256('mp-b11r2-unit-internal-secret-fixture');
const GW_HOST = 'gw.torneos-test.example.com';
const PAY_HOST = 'pay.torneos-test.example.com';
const GW_URL = `https://${GW_HOST}/functions/v1/torneos-gateway`;
const PAY_URL = `https://${PAY_HOST}/functions/v1/torneos-payments`;
const DEPS = ['https://core.torneos-test.example.com/auth/v1', 'https://core.torneos-test.example.com/functions/v1/torneos-core-contract',
  'https://data.torneos-test.example.com/rest/v1', 'https://web.torneos-test.example.com'];
const LAB_ENV = Object.freeze({ TORNEOS_COMMERCE_MODE: 'test', TORNEOS_PAYMENTS_INTERNAL_URL: 'http://torneos-functions:9000/torneos-payments', TORNEOS_PAYMENTS_INTERNAL_SECRET: SECRET });
const REMOTE_ENV = Object.freeze({ TORNEOS_COMMERCE_MODE: 'test', TORNEOS_COMMERCE_DEPLOYMENT: 'remote-test',
  TORNEOS_COMMERCE_REMOTE_GATEWAY_HOST: GW_HOST, TORNEOS_COMMERCE_REMOTE_PAYMENTS_HOST: PAY_HOST,
  TORNEOS_PAYMENTS_INTERNAL_URL: PAY_URL, TORNEOS_PAYMENTS_INTERNAL_SECRET: SECRET });
const labCtx = (over = {}) => ({ baseAllowlist: BASE43, gatewayPublicUrl: 'http://127.0.0.1:58421/torneos-gateway', distinctFrom: ['anon-key-fixture'], ...over });
const remoteCtx = (over = {}) => ({ baseAllowlist: BASE43, gatewayPublicUrl: new URL(GW_URL), distinctFrom: ['anon-key-fixture'], dependencyUrls: DEPS, ...over });

function mod() {
  if (commerce.__missing) throw new assert.AssertionError({ message: `commerce.ts: ${commerce.__missing}` });
  return commerce;
}
function verdict(env, ctx) {
  try {
    const c = mod().loadCommerceConfig(env, ctx);
    return { ok: true, mode: c.mode, deployment: c.deployment ?? null, paymentsUrl: c.paymentsUrl ?? null };
  } catch (error) {
    return { ok: false, error: error?.constructor?.name, message: String(error?.message ?? error) };
  }
}
function expectReject(env, ctx, label, bucket = evidence.configMatrix) {
  const v = verdict(env, ctx);
  bucket.push({ case: label, verdict: v.ok ? 'ACCEPTED' : 'REJECTED', reason: v.message ?? null });
  assert.equal(v.ok, false, `${label}: must fail closed (got ${JSON.stringify(v)})`);
  assert.equal(v.error, 'CommerceConfigError', `${label}: CommerceConfigError, got ${v.error}: ${v.message}`);
  for (const value of Object.values(env)) if (typeof value === 'string' && value.length >= 8) assert.ok(!v.message.includes(value), `${label}: the error names no value`);
  return v;
}
function expectAccept(env, ctx, label, bucket = evidence.configMatrix) {
  const v = verdict(env, ctx);
  bucket.push({ case: label, verdict: v.ok ? 'ACCEPTED' : 'REJECTED', mode: v.mode ?? null, deployment: v.deployment ?? null, reason: v.message ?? null });
  assert.equal(v.ok, true, `${label}: expected a configuration, got ${v.message}`);
  return v;
}

test('MP-B1.1 R2 — remote TEST enablement (offline)', async (t) => {
  async function check(name, fn) {
    await t.test(name, async () => {
      try { await fn(); results.push({ name, status: 'PASS' }); }
      catch (error) { results.push({ name, status: 'FAIL', error: String(error.message ?? error).slice(0, 400) }); throw error; }
    });
  }
  try {
    // ================================================================ A. config matrix
    await check('A default OFF: no mode → OFF whatever else is set (a deployment, remote hosts or URLs alone never enable commerce)', async () => {
      for (const [label, env] of [['empty', {}], ['blank mode', { TORNEOS_COMMERCE_MODE: '  ' }],
        ['remote vars without mode', { ...REMOTE_ENV, TORNEOS_COMMERCE_MODE: undefined }],
        ['deployment only', { TORNEOS_COMMERCE_DEPLOYMENT: 'remote-test' }],
        ['hosts only', { TORNEOS_COMMERCE_REMOTE_GATEWAY_HOST: GW_HOST, TORNEOS_COMMERCE_REMOTE_PAYMENTS_HOST: PAY_HOST }]]) {
        const v = verdict(env, remoteCtx());
        evidence.configMatrix.push({ case: `OFF: ${label}`, verdict: v.ok ? v.mode : 'REJECTED' });
        assert.deepEqual(mod().loadCommerceConfig(env, remoteCtx()), { mode: 'off' }, label);
      }
    });
    await check('A local-lab: the certified lab configuration (no deployment variable) is unchanged — loopback gateway, lab payments mount; explicit local-lab is identical', async () => {
      const implicit = expectAccept({ ...LAB_ENV }, labCtx(), 'local-lab implicit');
      const explicit = expectAccept({ ...LAB_ENV, TORNEOS_COMMERCE_DEPLOYMENT: 'local-lab' }, labCtx(), 'local-lab explicit');
      assert.deepEqual(implicit, explicit);
      assert.deepEqual([implicit.mode, implicit.deployment, implicit.paymentsUrl], ['test', 'local-lab', 'http://torneos-functions:9000/torneos-payments']);
      const c = mod().loadCommerceConfig({ ...LAB_ENV }, labCtx());
      assert.equal(Buffer.from(c.secret).toString('hex'), SECRET);
      assert.equal(c.readRpcs.size, 2);
    });
    await check('A local-lab stays lab-only: an https / hosted gateway, an https payments URL or declared remote hosts in local-lab → fail closed', async () => {
      expectReject({ ...LAB_ENV }, labCtx({ gatewayPublicUrl: GW_URL }), 'local-lab with a hosted gateway');
      expectReject({ ...LAB_ENV, TORNEOS_PAYMENTS_INTERNAL_URL: PAY_URL }, labCtx(), 'local-lab with a remote payments URL');
      expectReject({ ...LAB_ENV, TORNEOS_COMMERCE_REMOTE_GATEWAY_HOST: GW_HOST }, labCtx(), 'local-lab with a declared remote gateway host');
      expectReject({ ...LAB_ENV, TORNEOS_COMMERCE_REMOTE_PAYMENTS_HOST: PAY_HOST }, labCtx(), 'local-lab with a declared remote payments host');
    });
    await check('A remote-test: exact HTTPS configuration → commerce TEST, deployment remote-test, payments URL canonical', async () => {
      const v = expectAccept({ ...REMOTE_ENV }, remoteCtx(), 'remote-test exact');
      assert.deepEqual([v.mode, v.deployment, v.paymentsUrl], ['test', 'remote-test', PAY_URL]);
      assert.equal(expectAccept({ ...REMOTE_ENV, TORNEOS_PAYMENTS_INTERNAL_URL: `${PAY_URL}/` }, remoteCtx(), 'remote-test trailing slash').paymentsUrl, PAY_URL);
      assert.equal(expectAccept({ ...REMOTE_ENV }, remoteCtx({ gatewayPublicUrl: `${GW_URL}/` }), 'remote-test gateway trailing slash').deployment, 'remote-test');
      const same = expectAccept({ ...REMOTE_ENV, TORNEOS_COMMERCE_REMOTE_PAYMENTS_HOST: GW_HOST, TORNEOS_PAYMENTS_INTERNAL_URL: `https://${GW_HOST}/functions/v1/torneos-payments` },
        remoteCtx(), 'remote-test gateway and payments on one declared host');
      assert.equal(same.paymentsUrl, `https://${GW_HOST}/functions/v1/torneos-payments`);
      const c = mod().loadCommerceConfig({ ...REMOTE_ENV }, remoteCtx());
      assert.equal(c.readRpcs.size, 2, 'remote-test adds the same 2 reads');
      assert.equal(mod().effectiveRpcAllowlist(BASE43, c).size, 45);
    });
    await check('A deployment accepts exactly local-lab | remote-test (live / prod / production / variants → fail closed)', async () => {
      for (const d of ['remote', 'Remote-Test', 'REMOTE-TEST', 'remote_test', 'remote-test ', 'remote-live', 'live', 'prod', 'production', 'staging', 'hosted', 'lab', 'local', 'test', 'off', 'remote-test,local-lab']) {
        const env = { ...REMOTE_ENV, TORNEOS_COMMERCE_DEPLOYMENT: d };
        if (d === 'remote-test ') { expectAccept(env, remoteCtx(), 'deployment with surrounding blanks is trimmed like every commerce variable'); continue; }
        expectReject(env, remoteCtx(), `deployment ${JSON.stringify(d)}`);
      }
      for (const m of ['live', 'prod', 'production', 'LIVE', 'Test', 'remote-test']) expectReject({ ...REMOTE_ENV, TORNEOS_COMMERCE_MODE: m }, remoteCtx(), `mode ${m}`);
    });
    await check('A one variable never suffices: dropping any single remote requirement (deployment, either declared host, URL, secret, dependency URLs) → fail closed or lab-only', async () => {
      for (const name of ['TORNEOS_COMMERCE_REMOTE_GATEWAY_HOST', 'TORNEOS_COMMERCE_REMOTE_PAYMENTS_HOST', 'TORNEOS_PAYMENTS_INTERNAL_URL', 'TORNEOS_PAYMENTS_INTERNAL_SECRET']) {
        for (const value of [undefined, '', '   ']) expectReject({ ...REMOTE_ENV, [name]: value }, remoteCtx(), `remote-test missing ${name}=${JSON.stringify(value)}`);
      }
      // Without the deployment the same variables are local-lab, which refuses anything remote.
      expectReject({ ...REMOTE_ENV, TORNEOS_COMMERCE_DEPLOYMENT: undefined }, remoteCtx(), 'remote variables without TORNEOS_COMMERCE_DEPLOYMENT');
      for (const deps of [undefined, [], [null], ['']]) expectReject({ ...REMOTE_ENV }, remoteCtx({ dependencyUrls: deps }), `remote-test dependency URLs ${JSON.stringify(deps)}`);
      expectReject({ ...REMOTE_ENV }, remoteCtx({ gatewayPublicUrl: 'http://127.0.0.1:58421/torneos-gateway' }), 'remote-test on a loopback (lab) gateway');
    });

    // ================================================================ B. host validation
    const H = evidence.hostValidation;
    await check('B declared hosts: bare lowercase DNS names only — scheme, path, port, userinfo, wildcard, uppercase, trailing dot, IP literal, single label, non-routable TLD → fail closed', async () => {
      for (const bad of ['https://gw.torneos-test.example.com', 'gw.torneos-test.example.com/', 'gw.torneos-test.example.com/functions', 'gw.torneos-test.example.com:443',
        'gw.torneos-test.example.com:8443', 'user@gw.torneos-test.example.com', '*.torneos-test.example.com', '.torneos-test.example.com', 'GW.torneos-test.example.com',
        'gw.torneos-test.example.com.', 'gw..example.com', '-gw.example.com', 'gw-.example.com', 'gw_x.example.com', '10.0.0.1', '192.168.1.10', '[::1]', '::1', 'localhost',
        'gw.localhost', 'torneos-functions', 'gw.test.invalid', 'gw.local', 'gw.internal', 'gw.example.123', 'g w.example.com', 'gw.example.com,evil.com', 'gw.example.com\\@evil.com',
        `${'a'.repeat(64)}.example.com`]) {
        for (const name of ['TORNEOS_COMMERCE_REMOTE_GATEWAY_HOST', 'TORNEOS_COMMERCE_REMOTE_PAYMENTS_HOST']) {
          expectReject({ ...REMOTE_ENV, [name]: bad }, remoteCtx(), `${name.endsWith('GATEWAY_HOST') ? 'gateway' : 'payments'} host ${JSON.stringify(bad)}`, H);
        }
      }
    });
    await check('B payments URL (remote-test): exactly https://<declared payments host>/functions/v1/torneos-payments — wrong host, suffix/prefix spoof, userinfo, http, ports, path, query, fragment, encoding tricks → fail closed', async () => {
      for (const bad of [
        `https://other.torneos-test.example.com/functions/v1/torneos-payments`,          // unexpected host
        `https://${PAY_HOST}.evil.com/functions/v1/torneos-payments`,                     // suffix spoof
        `https://evil.${PAY_HOST}/functions/v1/torneos-payments`,                         // unauthorised subdomain
        `https://x${PAY_HOST}/functions/v1/torneos-payments`,                             // prefix glue
        `https://${PAY_HOST}@evil.com/functions/v1/torneos-payments`,                     // userinfo = expected host
        `https://evil.com@${PAY_HOST}/functions/v1/torneos-payments`,                     // userinfo before expected host
        `https://user:pw@${PAY_HOST}/functions/v1/torneos-payments`,                      // credentials
        `http://${PAY_HOST}/functions/v1/torneos-payments`,                               // HTTP remote
        `https://${PAY_HOST}:8443/functions/v1/torneos-payments`,                         // unexpected port
        `https://${PAY_HOST}:443/functions/v1/torneos-payments`,                          // explicit port (non-canonical)
        `https://${PAY_HOST.toUpperCase()}/functions/v1/torneos-payments`,                // non-canonical case
        `https://${PAY_HOST}./functions/v1/torneos-payments`,                             // trailing dot
        `https://${PAY_HOST}/torneos-payments`,                                           // lab mount
        `https://${PAY_HOST}/functions/v1/torneos-gateway`,                               // wrong function
        `https://${PAY_HOST}/functions/v1/torneos-payments/internal/v1/season-checkout-preference`,
        `https://${PAY_HOST}/functions/v1/torneos-payments?x=1`, `https://${PAY_HOST}/functions/v1/torneos-payments#x`,
        `https://${PAY_HOST}/functions/v1/../v1/torneos-payments`, `https://${PAY_HOST}/functions/v1/torneos%2Dpayments`,
        `https://${PAY_HOST}\\@evil.com/functions/v1/torneos-payments`, ` https://${PAY_HOST}/functions/v1/torneos-payments/x`,
        `https:${PAY_HOST}/functions/v1/torneos-payments`, `//${PAY_HOST}/functions/v1/torneos-payments`, 'http://torneos-functions:9000/torneos-payments', 'not a url',
      ]) expectReject({ ...REMOTE_ENV, TORNEOS_PAYMENTS_INTERNAL_URL: bad }, remoteCtx(), `payments URL ${bad}`, H);
    });
    await check('B gateway public URL (remote-test): https on exactly the declared gateway host at /functions/v1/torneos-gateway — spoof, userinfo, http, ports, other path → fail closed (string and URL alike)', async () => {
      for (const bad of [`https://${GW_HOST}.evil.com/functions/v1/torneos-gateway`, `https://evil.${GW_HOST}/functions/v1/torneos-gateway`,
        `https://other.torneos-test.example.com/functions/v1/torneos-gateway`, `https://${GW_HOST}@evil.com/functions/v1/torneos-gateway`,
        `https://evil.com@${GW_HOST}/functions/v1/torneos-gateway`, `http://${GW_HOST}/functions/v1/torneos-gateway`, `https://${GW_HOST}:8443/functions/v1/torneos-gateway`,
        `https://${GW_HOST}./functions/v1/torneos-gateway`, `https://${GW_HOST}/torneos-gateway`, `https://${GW_HOST}/functions/v1/torneos-payments`,
        `https://${GW_HOST}/functions/v1/torneos-gateway?x=1`, `https://${GW_HOST}/`, 'http://127.0.0.1:58421/torneos-gateway']) {
        expectReject({ ...REMOTE_ENV }, remoteCtx({ gatewayPublicUrl: bad }), `gateway URL ${bad}`, H);
        let url = null; try { url = new URL(bad); } catch { /* string only */ }
        if (url) expectReject({ ...REMOTE_ENV }, remoteCtx({ gatewayPublicUrl: url }), `gateway URL object ${bad}`, H);
      }
    });
    await check('B dependency URLs (remote-test): every Core / Torneos / browser endpoint must be https, credential-free and default-port; lab hosts and http → fail closed', async () => {
      for (const bad of ['http://core.torneos-test.example.com/auth/v1', 'http://core-auth:9999', 'http://torneos-rest:3000', 'https://user:pw@core.torneos-test.example.com/auth/v1',
        'https://core.torneos-test.example.com:8443/auth/v1', 'https://localhost/auth/v1', 'https://127.0.0.1/rest/v1', 'not a url']) {
        expectReject({ ...REMOTE_ENV }, remoteCtx({ dependencyUrls: [...DEPS, bad] }), `dependency ${bad}`, H);
      }
    });

    // ================================================================ C. Production fail closed
    const P = evidence.productionRejection;
    const PROD_HOSTS = [`${PROD_REF}.supabase.co`, `${PROD_REF}.functions.supabase.co`, `x${PROD_REF}.example.com`, `gw.${PROD_REF}.example.com`,
      'app.arma2.com.ar', 'arma2.com.ar', 'www.arma2.com.ar', 'arma2.vercel.app', 'arma2-nicoavayus-projects.vercel.app', 'arma2-git-main-nicoavayus-projects.vercel.app',
      'prod.torneos.example.com', 'gw-prod.example.com', 'live.torneos.example.com', 'payments-live.example.com', 'production.example.com', 'torneos.production.example.com', 'api-production-1.example.com'];
    await check('C remote-test declared hosts / URLs naming Production (Supabase Production ref, Core Production, Production web hostnames, live / prod / production labels) → fail closed', async () => {
      for (const host of PROD_HOSTS) {
        expectReject({ ...REMOTE_ENV, TORNEOS_COMMERCE_REMOTE_GATEWAY_HOST: host }, remoteCtx({ gatewayPublicUrl: `https://${host}/functions/v1/torneos-gateway` }), `gateway host ${host}`, P);
        expectReject({ ...REMOTE_ENV, TORNEOS_COMMERCE_REMOTE_PAYMENTS_HOST: host, TORNEOS_PAYMENTS_INTERNAL_URL: `https://${host}/functions/v1/torneos-payments` }, remoteCtx(), `payments host ${host}`, P);
        expectReject({ ...REMOTE_ENV }, remoteCtx({ dependencyUrls: [...DEPS, `https://${host}/auth/v1`] }), `dependency on ${host}`, P);
      }
      // Core Production / Production web as the Core endpoints or the allowed browser origin.
      for (const dep of [`https://${PROD_REF}.supabase.co/auth/v1`, `https://${PROD_REF}.supabase.co/functions/v1/torneos-core-contract`, 'https://app.arma2.com.ar', 'https://arma2.vercel.app']) {
        expectReject({ ...REMOTE_ENV }, remoteCtx({ dependencyUrls: [dep] }), `Core/web Production ${dep}`, P);
      }
      // Non-Production words that merely contain the letters are not refused.
      for (const host of ['product.torneos-test.example.com', 'delivery.torneos-test.example.com', 'olive.torneos-test.example.com', 'reproduce.example.com']) {
        expectAccept({ ...REMOTE_ENV, TORNEOS_COMMERCE_REMOTE_PAYMENTS_HOST: host, TORNEOS_PAYMENTS_INTERNAL_URL: `https://${host}/functions/v1/torneos-payments` }, remoteCtx(), `not Production: ${host}`, P);
      }
    });
    await check('C payments service: public URLs on Production (ref anywhere in the host, Production web hostnames, live / prod labels) → fail closed; TEST-only Mercado Pago contract intact', async () => {
      assert.ok(!payConfig.__missing, payConfig.__missing);
      const { loadPaymentsConfig, ConfigError } = payConfig;
      assert.ok(loadPaymentsConfig({ ...PAY_ENV }), 'the unit TEST configuration still loads');
      for (const host of PROD_HOSTS) {
        for (const [name, value] of [['APP_PUBLIC_URL', `https://${host}`], ['TORNEOS_PAYMENTS_NOTIFICATION_URL', `https://${host}/functions/v1/torneos-payments/webhooks/mercadopago/v1`]]) {
          let caught = null; try { loadPaymentsConfig({ ...PAY_ENV, [name]: value }); } catch (error) { caught = error; }
          P.push({ case: `payments ${name} on ${host}`, verdict: caught ? 'REJECTED' : 'ACCEPTED', reason: caught?.message ?? null });
          assert.ok(caught instanceof ConfigError, `${name} ${host}`);
          assert.ok(!caught.message.includes(host), 'the error names no value');
        }
      }
      for (const [name, value] of [['MERCADO_PAGO_ENVIRONMENT', 'live'], ['MERCADO_PAGO_ENVIRONMENT', 'production'], ['MERCADO_PAGO_ACCESS_TOKEN', 'x'], ['MERCADO_PAGO_LIVE_ACCESS_TOKEN', 'x'], ['MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET', 'x']]) {
        assert.throws(() => loadPaymentsConfig({ ...PAY_ENV, [name]: value }), ConfigError, `${name}=${value}`);
        P.push({ case: `payments ${name}=${value}`, verdict: 'REJECTED' });
      }
    });

    // ================================================================ D. secret isolation
    // Every read shape used by these sources: env.X, env["X"], <helper>(env|environment, "X"), environment.get("X").
    const envReads = (text) => new Set([...text.matchAll(/(?:env\.|env\[\s*["']|\w+\(\s*(?:env|environment)\s*,\s*["']|\.get\(\s*["'])([A-Z][A-Z0-9_]+)/g)].map(m => m[1]));
    const codeOf = (text) => text.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const GATEWAY_MAY_READ = new Set(['TORNEOS_GATEWAY_PUBLIC_URL', 'TORNEOS_ALLOWED_ORIGIN', 'CORE_AUTH_URL', 'CORE_JWT_ISSUER', 'CORE_ANON_KEY', 'CORE_CONTRACT_URL',
      'TORNEOS_CONTRACT_SERVICE_SECRET', 'TORNEOS_REST_URL', 'TORNEOS_ANON_KEY', 'TORNEOS_DB_IDENTITY_WRITER_URL', 'TORNEOS_DB_CORE_ADAPTER_URL', 'TORNEOS_DB_SSL_CA',
      'TORNEOS_BRIDGE_KEYS', 'TORNEOS_COMMERCE_MODE', 'TORNEOS_COMMERCE_DEPLOYMENT', 'TORNEOS_COMMERCE_REMOTE_GATEWAY_HOST', 'TORNEOS_COMMERCE_REMOTE_PAYMENTS_HOST',
      'TORNEOS_PAYMENTS_INTERNAL_URL', 'TORNEOS_PAYMENTS_INTERNAL_SECRET',
      // PLAN READ (2026-10-01): non-secret opt-in for the two plan reads (torneos-gateway/plan-read.ts), default off.
      'TORNEOS_PLAN_READ_MODE',
      // SOCIAL-V1 (2026-10-03): non-secret opt-in for the three Estudio Social RPCs (torneos-gateway/social.ts), default off.
      'TORNEOS_SOCIAL_MODE',
      // CONNECTED-V1 (2026-10-05): non-secret opt-in for Explorar/solicitudes (torneos-gateway/connected.ts), default off.
      'TORNEOS_CONNECTED_MODE',
      // BRANDING-V1 (2026-10-06): non-secret logos opt-in and the local lab's storage targets (torneos-gateway/branding.ts;
      // hosted derives storage from TORNEOS_REST_URL and refuses any other value), default off.
      'TORNEOS_BRANDING_MODE', 'TORNEOS_STORAGE_URL', 'TORNEOS_STORAGE_PUBLIC_URL',
      // MEDIA-V1 (2026-10-07): non-secret photo galleries opt-in (torneos-gateway/media.ts), default off.
      'TORNEOS_MEDIA_MODE']);
    const PAYMENTS_MAY_READ = new Set(['TORNEOS_PAYMENT_PROVIDER', 'MERCADO_PAGO_ENVIRONMENT', 'MERCADO_PAGO_TEST_ACCESS_TOKEN', 'MERCADO_PAGO_TEST_WEBHOOK_SECRET',
      'MERCADO_PAGO_TEST_SELLER_ID', 'APP_PUBLIC_URL', 'TORNEOS_PAYMENTS_NOTIFICATION_URL', 'TORNEOS_PAYMENTS_INTERNAL_SECRET', 'TORNEOS_PAYMENTS_DB_URL',
      'TORNEOS_PAYMENTS_DB_SSL_CA', 'TORNEOS_PAYMENTS_LAB_MP_API_ORIGIN',
      // PAYMENTS TEST: the hosted TEST deployment marker (infra/torneos-payments-test/pins/payments-test-isolation-delta.json).
      'TORNEOS_PAYMENTS_DEPLOYMENT']);
    const GATEWAY_MUST_NOT = /^(MERCADO_PAGO_|TORNEOS_PAYMENTS_DB_|TORNEOS_PAYMENT_PROVIDER$|TORNEOS_PAYMENTS_NOTIFICATION_URL$|TORNEOS_PAYMENTS_LAB_)/;
    const PAYMENTS_MUST_NOT = /^(CORE_|TORNEOS_BRIDGE_KEYS$|TORNEOS_CONTRACT_SERVICE_SECRET$|TORNEOS_DB_|TORNEOS_COMMERCE_|SUPABASE_)/;
    await check('D static contract: gateway sources read only gateway/Core/bridge/REST/commerce-link variables — never a Mercado Pago token, webhook secret or the payment DB login', async () => {
      const files = (await readdir(GW_DIR)).filter(f => f.endsWith('.ts'));
      const reads = new Set();
      for (const f of files) {
        const code = codeOf(await readFile(GW_DIR + f, 'utf8')).replace(/const FORBIDDEN_GATEWAY_ENV[\s\S]*?\]\)?\n/, '\n');
        for (const name of envReads(code)) reads.add(name);
        assert.ok(!/MERCADO_PAGO_|TORNEOS_PAYMENTS_DB_|lab_payment_service|torneos_payment_service/.test(code), `${f} names payments-only material outside the refusal list`);
      }
      evidence.secretIsolation = { gatewayReads: [...reads].sort() };
      for (const name of reads) { assert.ok(GATEWAY_MAY_READ.has(name), `gateway reads ${name}`); assert.ok(!GATEWAY_MUST_NOT.test(name), `gateway reads ${name}`); }
      for (const name of ['TORNEOS_COMMERCE_DEPLOYMENT', 'TORNEOS_COMMERCE_REMOTE_GATEWAY_HOST', 'TORNEOS_COMMERCE_REMOTE_PAYMENTS_HOST', 'TORNEOS_PAYMENTS_INTERNAL_SECRET']) assert.ok(reads.has(name), `gateway reads ${name}`);
    });
    await check('D static contract: payments sources (+ the shared provider copy) read only Mercado Pago TEST, seller, public URLs, payment DB login and the internal HMAC key — never Core, bridge, gateway DB or commerce-mode values', async () => {
      const files = [...(await readdir(PAY_DIR)).filter(f => f.endsWith('.ts')).map(f => PAY_DIR + f), `${repo}backend/torneos/supabase/functions/_shared/mercadoPagoPaymentProvider.ts`];
      const reads = new Set();
      for (const f of files) {
        // MP-B1.1 R3: config.ts's variable deny-list names Core / bridge / gateway-DB variables on purpose (the guard, not a read).
        const code = codeOf(await readFile(f, 'utf8')).replace(/const FORBIDDEN_PAYMENTS_ENV = new Set\(\[[\s\S]*?\]\)/, '');
        for (const name of envReads(code)) reads.add(name);
        assert.ok(!/TORNEOS_BRIDGE_KEYS|TORNEOS_CONTRACT_SERVICE_SECRET|TORNEOS_DB_(IDENTITY_WRITER|CORE_ADAPTER)|PRIVATE KEY|signing/i.test(code.replace(/-----BEGIN/g, '')), `${f} references Core / bridge signing material`);
      }
      evidence.secretIsolation = { ...evidence.secretIsolation, paymentsReads: [...reads].sort() };
      for (const name of reads) { assert.ok(PAYMENTS_MAY_READ.has(name), `payments reads ${name}`); assert.ok(!PAYMENTS_MUST_NOT.test(name), `payments reads ${name}`); }
    });
    await check('D runtime: in remote-test the gateway refuses to boot with any Mercado Pago value, the payments DB login or payments-only configuration in its environment (shared secret scope → gateway down)', async () => {
      for (const name of ['MERCADO_PAGO_TEST_ACCESS_TOKEN', 'MERCADO_PAGO_TEST_WEBHOOK_SECRET', 'MERCADO_PAGO_TEST_SELLER_ID', 'MERCADO_PAGO_ACCESS_TOKEN', 'MERCADO_PAGO_ENVIRONMENT',
        'MERCADO_PAGO_WEBHOOK_SECRET', 'TORNEOS_PAYMENTS_DB_URL', 'TORNEOS_PAYMENTS_DB_SSL_CA', 'TORNEOS_PAYMENT_PROVIDER', 'TORNEOS_PAYMENTS_NOTIFICATION_URL', 'TORNEOS_PAYMENTS_LAB_MP_API_ORIGIN']) {
        expectReject({ ...REMOTE_ENV, [name]: 'fixture-value-not-a-secret' }, remoteCtx(), `remote-test gateway env carries ${name}`, evidence.configMatrix);
      }
      assert.deepEqual([...mod().GATEWAY_COMMERCE_ENV].sort(), ['TORNEOS_COMMERCE_DEPLOYMENT', 'TORNEOS_COMMERCE_MODE', 'TORNEOS_COMMERCE_REMOTE_GATEWAY_HOST',
        'TORNEOS_COMMERCE_REMOTE_PAYMENTS_HOST', 'TORNEOS_PAYMENTS_INTERNAL_SECRET', 'TORNEOS_PAYMENTS_INTERNAL_URL']);
    });
    await check('D runtime: the internal HMAC key must be distinct from the Core contract secret, bridge key material and public keys in remote-test too', async () => {
      const contract = sha256('mp-b11r2-contract-fixture');
      expectReject({ ...REMOTE_ENV, TORNEOS_PAYMENTS_INTERNAL_SECRET: contract }, remoteCtx({ distinctFrom: [contract] }), 'remote-test HMAC = Core contract secret');
      expectReject({ ...REMOTE_ENV }, remoteCtx({ distinctFrom: [`{"keys":[{"privateKey":"${SECRET}"}]}`] }), 'remote-test HMAC inside bridge key document');
    });
    await check('D lab router: the gateway worker never receives the remote-test variables (the lab can never become remote-test); payments worker unchanged', async () => {
      const { workerEnv } = await import(`${here}torneos-edge-main/env.ts`);
      const env = { ...PAY_ENV, ...REMOTE_ENV, TORNEOS_GATEWAY_PUBLIC_URL: 'x', TORNEOS_BRIDGE_KEYS: 'x', CORE_AUTH_URL: 'x' };
      const gw = workerEnv('torneos-gateway', env).map(([k]) => k);
      const pay = workerEnv('torneos-payments', env).map(([k]) => k);
      for (const name of ['TORNEOS_COMMERCE_DEPLOYMENT', 'TORNEOS_COMMERCE_REMOTE_GATEWAY_HOST', 'TORNEOS_COMMERCE_REMOTE_PAYMENTS_HOST']) {
        assert.ok(!gw.includes(name) && !pay.includes(name), name);
      }
      assert.ok(!pay.some(k => PAYMENTS_MUST_NOT.test(k)), `payments worker env: ${pay}`);
      assert.ok(!gw.some(k => GATEWAY_MUST_NOT.test(k)), `gateway worker env: ${gw}`);
    });
    await check('D frontend: 0 secrets — src/ never names a Mercado Pago token / webhook secret, the internal HMAC key, bridge / contract secrets or DB logins, and exposes no REACT_APP_* secret', async () => {
      const files = [];
      async function walk(dir) { for (const e of await readdir(dir, { withFileTypes: true })) { const p = `${dir}/${e.name}`; if (e.isDirectory()) await walk(p); else if (/\.(jsx?|tsx?|mjs|json)$/.test(e.name)) files.push(p); } }
      await walk(`${repo}src`);
      assert.ok(files.length > 50);
      for (const f of files) {
        const text = await readFile(f, 'utf8');
        assert.ok(!/MERCADO_PAGO_(TEST_)?(ACCESS_TOKEN|WEBHOOK_SECRET)|TORNEOS_PAYMENTS_INTERNAL_SECRET|TORNEOS_PAYMENTS_DB_URL|TORNEOS_BRIDGE_KEYS|TORNEOS_CONTRACT_SERVICE_SECRET|TORNEOS_DB_(IDENTITY_WRITER|CORE_ADAPTER)_URL|REACT_APP_[A-Z_]*(SECRET|ACCESS_TOKEN|PRIVATE)/.test(text), f.slice(repo.length));
        assert.ok(!/APP_USR-[0-9A-Za-z-]{20,}|TEST-[a-f0-9]{24,}/.test(text), `${f.slice(repo.length)}: Mercado Pago credential pattern`);
      }
      evidence.secretIsolation = { ...evidence.secretIsolation, frontendFilesScanned: files.length, frontendSecrets: 0 };
    });

    // ================================================================ E. Node / Edge parity
    await check('E wiring: Edge index.ts and Node gateway.mjs run the SAME loader; Edge hands it its validated dependency URLs (Core Auth, issuer, contract, REST, allowed origin); both disable the whole gateway on CommerceConfigError', async () => {
      const edge = await readFile(`${GW_DIR}index.ts`, 'utf8');
      const node = await readFile(`${here}gateway.mjs`, 'utf8');
      assert.match(edge, /from "\.\/commerce\.ts"/);
      assert.match(node, /import\(['"]\.\/functions\/torneos-gateway\/commerce\.ts['"]\)/);
      const call = /loadCommerceConfig\(env, \{[\s\S]*?\}\)/.exec(edge)?.[0] ?? '';
      assert.match(call, /dependencyUrls:\s*\[cfg\.coreAuthUrl, cfg\.coreJwtIssuer, cfg\.coreContractUrl, cfg\.torneosRestUrl, cfg\.allowedOrigin\]/, 'Edge passes its dependency URLs');
      assert.match(edge, /error instanceof ConfigError \|\| error instanceof CommerceConfigError/, 'Edge: config fault → gateway disabled');
      assert.match(node, /CommerceConfigError/); assert.match(node, /if \(disabled\) return json\(res, 503/, 'Node: config fault → 503 everywhere');
      for (const text of [edge, node]) assert.ok(!/remote-test|REMOTE_GATEWAY_HOST|REMOTE_PAYMENTS_HOST|TORNEOS_COMMERCE_DEPLOYMENT/.test(codeOf(text)), 'no gateway-local deployment logic');
      // MEDIA-V1 lab: a second lab gateway may present another loopback port, but only 127.0.0.1:584xx — still loopback-only.
      assert.match(node, /req\.headers\.host !== new URL\(publicOrigin\)\.host/, 'Node gateway checks its own public origin');
      assert.match(node, /const publicOrigin = process\.env\.PHASE3A_GATEWAY_PUBLIC_ORIGIN \|\| origin;/, 'default: its own loopback port');
      assert.ok(node.includes("if (!/^http:\\/\\/127\\.0\\.0\\.1:584[0-9]{2}$/.test(publicOrigin)) throw"), 'Node gateway stays loopback-only');
    });
    await check('E Node runtime: every relative import of commerce.ts is mounted read-only into the Node lab gateway (compose.mpa.yaml), so the Node gateway loads the very same module graph as Edge', async () => {
      const src = await readFile(`${GW_DIR}commerce.ts`, 'utf8');
      const compose = await readFile(`${here}compose.mpa.yaml`, 'utf8');
      const imports = [...src.matchAll(/^import[^\n]*from "(\.{1,2}\/[^"]+)"/gm)].map(m => m[1]);
      assert.ok(imports.includes('../torneos-payments/remote-hosts.ts') && imports.includes('../torneos-payments/hmac.ts'));
      for (const spec of imports) {
        const target = new URL(spec, 'file:///lab/functions/torneos-gateway/').pathname;
        const source = `../../backend/torneos/supabase/functions/${target.slice('/lab/functions/'.length)}`;
        assert.ok(compose.includes(`- ${source}:${target}:ro`), `compose.mpa.yaml mounts ${spec}`);
      }
    });
    await check('E verdict parity: every config-matrix case gives the same verdict whether the gateway URL arrives as a URL object (Edge) or a string (Node)', async () => {
      const cases = [
        ['off', {}, GW_URL], ['local-lab', { ...LAB_ENV }, 'http://127.0.0.1:58421/torneos-gateway'], ['local-lab node origin', { ...LAB_ENV }, 'http://127.0.0.1:58420'],
        ['remote-test', { ...REMOTE_ENV }, GW_URL], ['remote-test trailing', { ...REMOTE_ENV }, `${GW_URL}/`],
        ['remote-test on lab gateway', { ...REMOTE_ENV }, 'http://127.0.0.1:58421/torneos-gateway'], ['remote-test spoof', { ...REMOTE_ENV }, `https://${GW_HOST}.evil.com/functions/v1/torneos-gateway`],
        ['remote-test userinfo', { ...REMOTE_ENV }, `https://evil.com@${GW_HOST}/functions/v1/torneos-gateway`], ['remote-test http', { ...REMOTE_ENV }, `http://${GW_HOST}/functions/v1/torneos-gateway`],
        ['remote-test port', { ...REMOTE_ENV }, `https://${GW_HOST}:8443/functions/v1/torneos-gateway`], ['remote-test Production', { ...REMOTE_ENV }, `https://${PROD_REF}.supabase.co/functions/v1/torneos-gateway`],
        ['mode live', { ...REMOTE_ENV, TORNEOS_COMMERCE_MODE: 'live' }, GW_URL], ['deployment prod', { ...REMOTE_ENV, TORNEOS_COMMERCE_DEPLOYMENT: 'prod' }, GW_URL],
      ];
      for (const [label, env, gw] of cases) {
        const asString = verdict(env, remoteCtx({ gatewayPublicUrl: gw }));
        const asUrl = verdict(env, remoteCtx({ gatewayPublicUrl: new URL(gw) }));
        evidence.parity.push({ case: label, node: asString.ok ? `${asString.mode}/${asString.deployment}` : 'REJECTED', edge: asUrl.ok ? `${asUrl.mode}/${asUrl.deployment}` : 'REJECTED', reason: asString.message ?? null });
        assert.deepEqual(asString, asUrl, label);
      }
    });

    // ================================================================ F. webhook freshness
    const W = evidence.webhook;
    // MP-B1.1 R3 supersedes the R2 parsing contract (10 digits only, value trimmed, last duplicate wins): one Torneos-local
    // parser (webhook-signature.ts) feeds both the HMAC and this check — raw ts, 10-digit seconds or 13-digit milliseconds,
    // no whitespace, duplicates refused. The full R3 matrix lives in deno-runtime-hardening.test.mjs.
    await check('F module: the ts the HMAC covers is the ts the freshness check judges (one parser, raw 10- or 13-digit ts, duplicates refused); future skew is small and documented', async () => {
      assert.ok(!freshness.__missing, freshness.__missing);
      const { parseMercadoPagoSignature: parse } = await import(`${PAY_DIR}webhook-signature.ts`);
      const { webhookTimestampMs: ms, WEBHOOK_FUTURE_SKEW_S } = freshness;
      const ts = (header) => { const p = parse(header); return p === null ? null : ms(p.ts); };
      const V1 = 'a'.repeat(64);
      assert.equal(WEBHOOK_FUTURE_SKEW_S, 300);
      assert.equal(ts(`ts=1790000000,v1=${V1}`), 1790000000000);
      assert.equal(ts(`ts=1790000000123,v1=${V1}`), 1790000000123);
      assert.equal(ts(`v1=${V1},ts=1790000000`), 1790000000000);
      assert.equal(ts(`ts=1790000000, v1=${V1}`), 1790000000000, 'keys are trimmed');
      for (const bad of [null, '', `v1=${V1}`, `ts=,v1=${V1}`, `ts=179000000,v1=${V1}`, `ts=17900000x0,v1=${V1}`, `ts=-179000000,v1=${V1}`, `ts=1790000000.5,v1=${V1}`,
        `ts=1790000000,ts=abc,v1=${V1}`, `ts=9999999999,ts=1790000000,v1=${V1}`, ` ts = 1790000000 , v1=${V1}`, `ts=0790000000,v1=${V1}`, `ts=17900000000,v1=${V1}`]) {
        assert.equal(ts(bad), null, JSON.stringify(bad));
      }
    });
    await check('F module: verdicts — within +300 s → ok; beyond → future; any past value (1 s … 10 years) → ok (Mercado Pago documents no maximum age; retries continue after the third attempt)', async () => {
      const { webhookTimeVerdict: v } = freshness;
      const now = 1_790_000_000_000;
      for (const [delta, expected] of [[0, 'ok'], [60, 'ok'], [300, 'ok'], [301, 'future'], [3600, 'future'], [86400 * 365, 'future'], [-1, 'ok'], [-900, 'ok'], [-86400 * 30, 'ok'], [-86400 * 3650, 'ok']]) {
        assert.equal(v(String(1_790_000_000 + delta), now), expected, `delta ${delta}`);
      }
      assert.equal(v('1790000000123', now), 'ok', 'R3: 13-digit milliseconds are a valid ts');
      assert.equal(v('1790000301000', now), 'future');
      assert.equal(v('179000000', now), 'malformed');
    });

    // Handler level with an offline fake provider + DB (same shape as the MP-B1.2 handler tests).
    const handler = await load(`${PAY_DIR}handler.ts`);
    const PID = '5f0e0000-0000-4000-8000-00000000b112';
    const EXT = `arma2:season:purchase:${PID}`;
    const projection = { id: PID, organizationId: '10000000-0000-4000-8000-000000000001', seasonId: '20000000-0000-4000-8000-000000000001', tournamentId: null,
      productCode: 'torneos_premium', provider: 'MERCADO_PAGO', providerEnvironment: 'test', providerPreferenceId: 'pref-r2', externalReference: EXT, status: 'approved',
      amount: 39900, currency: 'ARS', createdAt: '2026-09-20T00:00:00.000Z', preferenceExpiresAt: null };
    async function deliver({ tsOffsetS = 0, nowMs = Date.parse('2026-09-24T12:00:00Z'), signatureHeader, secret = PAY_ENV.MERCADO_PAGO_TEST_WEBHOOK_SECRET,
      providerStatus = 'approved', bodyStatus = 'approved', requestId = 'r2-freshness', paymentId = '1790000000123' } = {}) {
      const calls = { fetch: 0, db: [] };
      const service = handler.createPaymentsService({ env: PAY_ENV, now: () => nowMs, log: () => {},
        connectDb: () => ({ async call(name, args) { calls.db.push(name); return name === 'get_provider_tournament_purchase' ? projection : { outcome: 'replayed' }; } }),
        fetcher: async (url) => { calls.fetch += 1; return new Response(JSON.stringify(String(url).includes('/v1/payments/') ? {
          id: paymentId, status: providerStatus, status_detail: 'accredited', date_last_updated: '2026-09-24T11:00:00.000Z', external_reference: EXT, currency_id: 'ARS',
          transaction_amount: 39900, collector_id: PAY_ENV.MERCADO_PAGO_TEST_SELLER_ID, metadata: { purchase_id: PID }, live_mode: false, order: { id: '999', type: 'mercadopago' },
        } : { id: '999', preference_id: 'pref-r2', external_reference: EXT, collector: { id: PAY_ENV.MERCADO_PAGO_TEST_SELLER_ID }, payments: [{ id: paymentId }] })); } });
      const ts = String(Math.floor(nowMs / 1000) + tsOffsetS);
      const v1 = createHmac('sha256', secret).update(`id:${paymentId};request-id:${requestId};ts:${ts};`).digest('hex');
      const response = await service(new Request(`http://unit.invalid/torneos-payments/webhooks/mercadopago/v1?data.id=${paymentId}&type=payment`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': requestId, 'x-signature': signatureHeader ?? `ts=${ts},v1=${v1}` },
        body: JSON.stringify({ type: 'payment', data: { id: paymentId }, live_mode: false, user_id: PAY_ENV.MERCADO_PAGO_TEST_SELLER_ID, status: bodyStatus, date_last_updated: '2099-01-01T00:00:00Z' }) }));
      return { status: response.status, body: await response.json(), fetches: calls.fetch, db: calls.db };
    }
    await check('F handler: absurd future ts (+301 s, +1 h, +1 year) with a VALID signature → 401 invalid_signature before any provider call or DB call', async () => {
      assert.ok(!handler.__missing, handler.__missing);
      for (const offset of [301, 3600, 86400 * 365]) {
        const r = await deliver({ tsOffsetS: offset });
        W.push({ case: `future ts +${offset}s (signed)`, http: r.status, error: r.body.error ?? null, providerFetches: r.fetches, dbCalls: r.db.length });
        assert.deepEqual([r.status, r.body.error, r.fetches, r.db.length], [401, 'invalid_signature', 0, 0], `+${offset}`);
      }
    });
    await check('F handler: small future skew (+60 s, +300 s) and OLD signed notifications (−1 h, −30 d, −2 y) are accepted and ALWAYS re-fetched from the provider (body status/date ignored)', async () => {
      for (const offset of [60, 300, -3600, -86400 * 30, -86400 * 730]) {
        const r = await deliver({ tsOffsetS: offset, bodyStatus: 'refunded' });
        W.push({ case: `ts ${offset >= 0 ? '+' : ''}${offset}s (signed)`, http: r.status, outcome: r.body.outcome ?? r.body.error, providerFetches: r.fetches, dbCalls: r.db });
        assert.equal(r.status, 200, `${offset}: ${JSON.stringify(r.body)}`);
        assert.equal(r.fetches, 2, 'payment + merchant order re-fetched');
        assert.deepEqual(r.db, ['get_provider_tournament_purchase', 'apply_verified_tournament_payment_status'], 'status comes from the provider, not the body');
      }
    });
    await check('F handler: bad signature, wrong secret, malformed ts (9 / 13 digits, non-numeric, missing) → 401 with 0 provider calls; a future ts with a BAD signature is also 401', async () => {
      const cases = [
        ['bad v1', { signatureHeader: `ts=${Math.floor(Date.parse('2026-09-24T12:00:00Z') / 1000)},v1=${'0'.repeat(64)}` }],
        ['wrong secret', { secret: 'x'.repeat(40) }],
        ['ts 9 digits', { signatureHeader: `ts=179000000,v1=${'a'.repeat(64)}` }],
        ['ts 13 digits (ms)', { signatureHeader: `ts=1790000000000,v1=${'a'.repeat(64)}` }],
        ['ts non-numeric', { signatureHeader: `ts=abcdefghij,v1=${'a'.repeat(64)}` }],
        ['ts missing', { signatureHeader: `v1=${'a'.repeat(64)}` }],
        ['future + bad signature', { signatureHeader: `ts=${Math.floor(Date.parse('2026-09-24T12:00:00Z') / 1000) + 86400},v1=${'0'.repeat(64)}` }],
      ];
      for (const [label, opts] of cases) {
        const r = await deliver(opts);
        W.push({ case: label, http: r.status, error: r.body.error ?? null, providerFetches: r.fetches, dbCalls: r.db.length });
        assert.deepEqual([r.status, r.body.error, r.fetches, r.db.length], [401, 'invalid_signature', 0, 0], label);
      }
    });
    await check('F handler: duplicate-ts differential parsing is impossible — R3: a repeated ts is ambiguous and refused before any provider call, whichever occurrence is signed', async () => {
      const nowS = Math.floor(Date.parse('2026-09-24T12:00:00Z') / 1000);
      const sign = (ts) => createHmac('sha256', PAY_ENV.MERCADO_PAGO_TEST_WEBHOOK_SECRET).update(`id:1790000000123;request-id:r2-freshness;ts:${ts};`).digest('hex');
      const a = await deliver({ signatureHeader: `ts=${nowS + 86400},ts=${nowS},v1=${sign(nowS)}` });
      const b = await deliver({ signatureHeader: `ts=${nowS},ts=${nowS + 86400},v1=${sign(nowS + 86400)}` });
      W.push({ case: 'duplicate ts: future then now (signed now)', http: a.status }, { case: 'duplicate ts: now then future (signed future)', http: b.status });
      assert.deepEqual([a.status, a.fetches], [401, 0]); assert.deepEqual([b.status, b.fetches], [401, 0]);
    });
    await check('F source: webhook ts and payment.date_last_updated stay separate — the freshness module never reads date_last_updated; the handler passes only the re-fetched provider date to the ordering RPCs', async () => {
      const src = await readFile(`${PAY_DIR}webhook-freshness.ts`, 'utf8') + await readFile(`${PAY_DIR}webhook-signature.ts`, 'utf8');
      assert.ok(!/date_last_updated|providerUpdatedAt/.test(codeOf(src)));
      const h = await readFile(`${PAY_DIR}handler.ts`, 'utf8');
      assert.match(h, /const providerUpdatedAt = payment\.date_last_updated/);
      assert.ok(!/webhookTime[\s\S]{0,200}providerUpdatedAt|providerUpdatedAt[^\n]*webhookTime/.test(h), 'no mixing of the two clocks');
      const futureCheck = h.indexOf('webhookTimeVerdict('), fetchCall = h.indexOf('fetchMercadoPagoPayment(paymentId');
      assert.ok(futureCheck > 0 && futureCheck < fetchCall, 'future check precedes the provider re-fetch');
      assert.ok(h.indexOf('verifyMercadoPagoSignature(') > 0 && h.indexOf('verifyMercadoPagoSignature(') < futureCheck, 'the signature is verified first (only an authenticated ts is judged)');
    });
    await check('F provider copy untouched: _shared provider files remain byte-identical to the certified legacy (no fork of the signature verifier)', async () => {
      for (const [file, expected] of Object.entries({ 'paymentProvider.ts': 'da5e43266c5107cd1f6183c83046ba49e71343e9102370adb08be8abb4640a40',
        'mercadoPagoPaymentProvider.ts': '1136217d93c55c5f981d45dfa9abfd62f14b26a218df120f5f801d547e547961' })) {
        assert.equal(sha256(await readFile(`${repo}backend/torneos/supabase/functions/_shared/${file}`)), expected, file);
      }
    });
  } finally {
    await mkdir(EVIDENCE, { recursive: true });
    const doc = { suite: 'MP-B1.1 R2 offline', results, passed: results.filter(r => r.status === 'PASS').length, total: results.length, ...evidence };
    await writeFile(`${EVIDENCE}offline${TAG}.json`, JSON.stringify(doc, null, 2) + '\n');
  }
});
