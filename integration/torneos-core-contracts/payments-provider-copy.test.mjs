// MP-A3 — T2: the Torneos copy of the Mercado Pago payment provider is the legacy provider, byte for byte.
// Offline (no lab). The payments logic is reused, never forked: if the copy needed an edit to compile, this
// suite fails and MP-A3 stops. Also pins the legacy files themselves (they must stay untouched) and the
// import graph of the copy and of torneos-payments (no Core, no Supabase client, no gateway code).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const EVIDENCE = `${repo}backend/torneos/mp-a/evidence/mp-a3/`;
const TAG = process.env.MP_A3_EVIDENCE_TAG ? `-${process.env.MP_A3_EVIDENCE_TAG}` : '';
const LEGACY = 'supabase/functions/_shared/';
const COPY = 'backend/torneos/supabase/functions/_shared/';
const PAYMENTS = 'backend/torneos/supabase/functions/torneos-payments/';
// Legacy provider as merged in PR #150/#151 (0c434ea1) and certified unchanged on main c2dfc3ed.
const LEGACY_SHA = {
  'paymentProvider.ts': 'da5e43266c5107cd1f6183c83046ba49e71343e9102370adb08be8abb4640a40',
  'mercadoPagoPaymentProvider.ts': '1136217d93c55c5f981d45dfa9abfd62f14b26a218df120f5f801d547e547961',
};
const sha = (b) => createHash('sha256').update(b).digest('hex');
const importsOf = (text) => [...text.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm)].map(m => m[1] ?? m[2]);
const results = [];

test('MP-A3 — T2 provider copy', async (t) => {
  async function check(name, fn) {
    await t.test(name, async () => {
      try { await fn(); results.push({ name, status: 'PASS' }); }
      catch (error) { results.push({ name, status: 'FAIL', error: String(error.message ?? error).slice(0, 300) }); throw error; }
    });
  }
  const parity = {};
  try {
    await check('legacy provider files are byte-identical to the certified legacy (untouched by MP-A3)', async () => {
      for (const [file, expected] of Object.entries(LEGACY_SHA)) assert.equal(sha(await readFile(repo + LEGACY + file)), expected, file);
    });
    await check('Torneos _shared holds exactly paymentProvider.ts and mercadoPagoPaymentProvider.ts, each sha256 == legacy', async () => {
      const files = (await readdir(repo + COPY)).sort();
      assert.deepEqual(files, ['mercadoPagoPaymentProvider.ts', 'paymentProvider.ts']);
      for (const file of files) {
        const legacy = sha(await readFile(repo + LEGACY + file));
        const copy = sha(await readFile(repo + COPY + file));
        parity[file] = { legacy, copy, identical: legacy === copy };
        assert.equal(copy, legacy, `${file} differs from legacy`);
        assert.equal(copy, LEGACY_SHA[file], `${file} is not the pinned legacy`);
      }
    });
    await check('copy import graph: paymentProvider.ts imports nothing; mercadoPagoPaymentProvider.ts imports only ./paymentProvider.ts', async () => {
      assert.deepEqual(importsOf(await readFile(repo + COPY + 'paymentProvider.ts', 'utf8')), []);
      assert.deepEqual(importsOf(await readFile(repo + COPY + 'mercadoPagoPaymentProvider.ts', 'utf8')), ['./paymentProvider.ts']);
    });
    await check('no Core dependency: neither copy nor torneos-payments references Core contract, Core auth, supabase-js, service keys or the gateway', async () => {
      const files = [COPY + 'paymentProvider.ts', COPY + 'mercadoPagoPaymentProvider.ts',
        ...(await readdir(repo + PAYMENTS)).filter(f => f.endsWith('.ts')).map(f => PAYMENTS + f)];
      assert.ok(files.length >= 4, 'torneos-payments sources present');
      for (const file of files) {
        // config.ts's login and (MP-B1.1 R3) variable deny-lists name the forbidden roles / Core-bridge-admin variables on
        // purpose; they are the guard, not a use. Comments may name what is forbidden; only code counts.
        const text = (await readFile(repo + file, 'utf8')).replace(/const FORBIDDEN_DB_LOGINS = new Set\(\[[\s\S]*?\]\)/, '')
          .replace(/const FORBIDDEN_PAYMENTS_ENV = new Set\(\[[\s\S]*?\]\)/, '')
          .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        assert.ok(!/torneosCoreContract|torneos-core-contract|core-client|CORE_[A-Z_]+|\/auth\/v1|supabase-js|createClient|supabaseApiKeys|commercialHttp|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET|service_role|torneos-gateway\//.test(text), `${file} has a Core / service-role / gateway dependency`);
        for (const spec of importsOf(text)) {
          const allowed = ['./paymentProvider.ts', '../_shared/paymentProvider.ts', '../_shared/mercadoPagoPaymentProvider.ts', 'npm:postgres@3.4.7'];
          assert.ok(allowed.includes(spec) || /^\.\/[a-z-]+\.ts$/.test(spec), `${file} imports ${spec}`);
        }
      }
    });
    await check('torneos-payments imports the provider from the shared copy (not a fork): the only Mercado Pago API origin literal lives in the copy', async () => {
      const files = (await readdir(repo + PAYMENTS)).filter(f => f.endsWith('.ts'));
      const texts = await Promise.all(files.map(f => readFile(repo + PAYMENTS + f, 'utf8')));
      assert.ok(texts.some(t => importsOf(t).includes('../_shared/mercadoPagoPaymentProvider.ts')), 'imports the shared provider');
      for (const [i, text] of texts.entries()) {
        assert.ok(!/function (verifyMercadoPagoWebhookSignature|verifyMercadoPagoPaymentBinding|normalizeMercadoPagoPaymentStatus|buildMercadoPagoPreferenceBody|isMercadoPagoCheckoutUrl)\b/.test(text), `${files[i]} re-implements provider logic`);
      }
    });
    await check('the copy is loadable as-is (Node type stripping): provider exports present, no network at import', async () => {
      const mod = await import(`${repo}${COPY}mercadoPagoPaymentProvider.ts`);
      for (const name of ['createMercadoPagoPaymentProvider', 'getMercadoPagoTestConfig', 'requirePublicHttpsUrl', 'buildMercadoPagoPreferenceBody',
        'fetchMercadoPagoPayment', 'fetchMercadoPagoMerchantOrder', 'fetchMercadoPagoChargeback', 'paymentIdFromMercadoPagoChargeback',
        'verifyMercadoPagoPaymentBinding', 'normalizeMercadoPagoPaymentStatus', 'verifyMercadoPagoWebhookSignature']) {
        assert.equal(typeof mod[name], 'function', name);
      }
      assert.throws(() => mod.requirePublicHttpsUrl('http://localhost:3000'), /app_public_url_must_be_public_https/, 'provider still refuses localhost');
    });
  } finally {
    await mkdir(EVIDENCE, { recursive: true });
    await writeFile(`${EVIDENCE}t2-provider-copy${TAG}.json`, JSON.stringify({ suite: 'MP-A3 T2 provider copy', parity, results,
      passed: results.filter(r => r.status === 'PASS').length, total: results.length }, null, 2) + '\n');
  }
});
