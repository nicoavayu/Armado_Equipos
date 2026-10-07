#!/usr/bin/env node
// COMMERCE-PRODUCTION operator driver for the Torneos Production DB. Never run by CI or by the operator without GO.
//   node backend/torneos/commerce-production/remote/db-0013.mjs observe                                   (read only)
//   … apply-0013                 APPLY TORNEOS 0013 <ref> <sha12 of 0013>
//   … rollback-0013              ROLLBACK TORNEOS 0013 <ref> <sha12 of its rollback>     (only with 0 production purchases)
//   … login                      CREATE TORNEOS PAYMENTS PRODUCTION LOGIN torneos_payments_prod <ref>
//   … drop-login                 DROP TORNEOS PAYMENTS PRODUCTION LOGIN torneos_payments_prod <ref>
//   … scope off|allowlist|open   SET TORNEOS COMMERCE PRODUCTION SCOPE <scope> <ref>
//   … allow <org uuid>           ALLOW TORNEOS COMMERCE PRODUCTION ORG <uuid> <ref>
//   … disallow <org uuid>        DISALLOW TORNEOS COMMERCE PRODUCTION ORG <uuid> <ref>
// Transport = the certified OEC/CV1/CONNECTED one (installer postgres.<ref>, Session Pooler sa-east-1:5432, verify-full + the
// Supabase CA, the installer password read from the macOS Keychain into memory only and redacted from every output). Every
// write is gated by the exact phrase, the file sha256 where there is a file, the observed state before and after, and "nothing
// outside the production objects moved" (bodies + ACLs of every other function, by digest). The production login password is
// generated into the Keychain by keychain-payments-production.py; only its SCRAM verifier reaches the database.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
export const REF = 'onzpwnqxnvlgsevivngf';
const file = (rel, sha256, from, to) => Object.freeze({ path: path.join(REPO, rel), rel, sha256, from, to });
export const FILES = Object.freeze({
  'apply-0013': file('backend/torneos/supabase/migrations/00000000000013_mercadopago_checkout_pro_production.sql',
    '3f57141052a9cbf05c93e2d8c38d9a06310991f1c0feac94d5192c04e6df8d2d', 'PRE_0013', 'POST_0013'),
  'rollback-0013': file('backend/torneos/commerce-production/rollback/00000000000013_mercadopago_checkout_pro_production.rollback.sql',
    '2365a37cb53c87ca403ab59fdf4dd9659a2a94c9b12bd175b61563b43e3177db', 'POST_0013', 'PRE_0013'),
});
export const CHECK_0002 = "CHECK ((((provider = 'FAKE'::text) AND (provider_environment = ANY (ARRAY['local'::text, 'qa'::text]))) OR ((provider = 'MERCADO_PAGO'::text) AND (provider_environment = 'test'::text))))";
export const CHECK_0013 = "CHECK ((((provider = 'FAKE'::text) AND (provider_environment = ANY (ARRAY['local'::text, 'qa'::text]))) OR ((provider = 'MERCADO_PAGO'::text) AND (provider_environment = ANY (ARRAY['test'::text, 'production'::text])))))";
// The certified TEST chain (0002/0003 bodies), equal in every state this driver accepts.
export const TEST_CHAIN = Object.freeze({
  'public.create_tournament_season_checkout_purchase(uuid,uuid,uuid)': 'ce838d427a83994f51c1366100d953ea',
  'public.get_provider_tournament_purchase(text,text,text)': 'c14da619edde527396a8080af422f048',
  'public.record_tournament_purchase_preference(uuid,text,text,text,timestamp with time zone)': '6eb78b1189e03b55545aa1057aafae8d',
  'public.order_verified_tournament_payment(uuid,text,text,text,text,text,text,text,timestamp with time zone)': 'c1b838f976de3426c01cd3f0748bb512',
  'public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text,timestamp with time zone)': '77fb95399a6df295832ae4125b39a140',
  'public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text,timestamp with time zone)': '12d260171bf19be9737712abeaab293d',
  'public.activate_verified_tournament_purchase(uuid,text,text,text,text,text,text)': '8a97cc62c510971331eb19de2f83326b',
});
export const PRODUCTION_FUNCTIONS = 14;
export const PRODUCTION_LOGIN = 'torneos_payments_prod';
export const SCOPES = Object.freeze(['off', 'allowlist', 'open']);
export const SCOPE_REASONS = Object.freeze({
  off: 'Cerrado por el operador: sin compras productivas nuevas',
  allowlist: 'Abierto sólo para organizaciones autorizadas (primer cobro real)',
  open: 'Abierto para todas las organizaciones',
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** PRE_0013 | POST_0013 | DRIFT, with every reason. Pure. */
export function classify(catalog) {
  if (!catalog || catalog.torneos_tables !== true) return { state: 'DRIFT', failures: ['not_the_torneos_db'] };
  const failures = [];
  for (const [sig, md5] of Object.entries(TEST_CHAIN)) if (catalog.test_chain?.[sig] !== md5) failures.push(`test_chain ${sig}`);
  const none = catalog.production_functions === 0 && catalog.production_role === false && catalog.production_tables === 0
    && catalog.isolation_trigger === false && catalog.environment_check === CHECK_0002;
  const all = catalog.production_functions === PRODUCTION_FUNCTIONS && catalog.production_role === true && catalog.production_tables === 3
    && catalog.isolation_trigger === true && catalog.environment_check === CHECK_0013 && SCOPES.includes(catalog.scope);
  if (!none && !all) failures.push(`partial functions=${catalog.production_functions} role=${catalog.production_role} tables=${catalog.production_tables} trigger=${catalog.isolation_trigger}`);
  const logins = catalog.production_logins ?? [];
  if (logins.some((l) => l.name !== PRODUCTION_LOGIN || l.login !== true || l.inherit !== false || l.super !== false || l.bypassrls !== false)) {
    failures.push(`production_logins ${JSON.stringify(logins)}`);
  }
  if ((catalog.test_logins ?? []).includes(PRODUCTION_LOGIN)) failures.push('production login holds the TEST role');
  if (failures.length) return { state: 'DRIFT', failures };
  return { state: none ? 'PRE_0013' : 'POST_0013', failures: [] };
}

function phraseFor(mode, arg) {
  const f = FILES[mode];
  if (f) return `${mode.split('-')[0].toUpperCase()} TORNEOS 0013 ${REF} ${f.sha256.slice(0, 12)}`;
  if (mode === 'login') return `CREATE TORNEOS PAYMENTS PRODUCTION LOGIN ${PRODUCTION_LOGIN} ${REF}`;
  if (mode === 'drop-login') return `DROP TORNEOS PAYMENTS PRODUCTION LOGIN ${PRODUCTION_LOGIN} ${REF}`;
  if (mode === 'scope') return `SET TORNEOS COMMERCE PRODUCTION SCOPE ${arg} ${REF}`;
  if (mode === 'allow') return `ALLOW TORNEOS COMMERCE PRODUCTION ORG ${arg} ${REF}`;
  if (mode === 'disallow') return `DISALLOW TORNEOS COMMERCE PRODUCTION ORG ${arg} ${REF}`;
  throw new Error('usage: observe | apply-0013 | rollback-0013 | login | drop-login | scope <off|allowlist|open> | allow <org> | disallow <org>');
}

/** The SQL of the small operator writes (no file): literal values validated before they are interpolated. */
export function operatorSql(mode, arg) {
  if (mode === 'scope') {
    if (!SCOPES.includes(arg)) throw new Error('SCOPE_INVALID');
    return `BEGIN; UPDATE public.tournament_commerce_production_settings SET checkout_scope = '${arg}', reason = '${SCOPE_REASONS[arg]}', updated_at = now() WHERE singleton; COMMIT;`;
  }
  if (mode === 'allow' || mode === 'disallow') {
    if (!UUID.test(arg ?? '')) throw new Error('ORGANIZATION_ID_INVALID');
    return mode === 'allow'
      ? `BEGIN; DO $guard$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.tournament_organizations WHERE id = '${arg}') THEN RAISE EXCEPTION 'ORGANIZATION_NOT_FOUND'; END IF; END $guard$;
         INSERT INTO public.tournament_commerce_production_allowlist (organization_id, reason) VALUES ('${arg}', 'Autorizada por el operador para el primer cobro real'); COMMIT;`
      : `BEGIN; DELETE FROM public.tournament_commerce_production_allowlist WHERE organization_id = '${arg}'; COMMIT;`;
  }
  throw new Error('not an operator write');
}

/** The whole operator decision, with injected I/O (tested on the lab database and offline). */
export async function run(mode, args, { readFile = fs.readFileSync, catalog, applySql, keychain = null, scram = null }) {
  const out = { mode, target: REF };
  if (mode === 'observe') {
    out.catalog = await catalog();
    out.verdict = classify(out.catalog);
    return out;
  }
  const takesArg = ['scope', 'allow', 'disallow'].includes(mode);
  const arg = takesArg ? args[0] : null;
  const words = takesArg ? args.slice(1) : args;
  const phrase = phraseFor(mode, arg);
  if (words.join(' ') !== phrase) throw new Error(`PHRASE_REQUIRED: ${phrase}`);
  const f = FILES[mode];
  let sql;
  if (f) {
    const bytes = readFile(f.path);
    if (sha256(bytes) !== f.sha256) throw new Error('FILE_HASH_MISMATCH');
    sql = bytes.toString('utf8');
  }
  const before = await catalog();
  const pre = classify(before);
  const expectedFrom = f ? f.from : 'POST_0013';
  if (pre.state !== expectedFrom) throw new Error(`PRE_STATE_${pre.state} ${pre.failures.join('; ')}`);
  if (mode === 'rollback-0013' && (before.production_purchases?.total !== 0 || (before.production_logins ?? []).length)) {
    throw new Error('ROLLBACK_REFUSED production purchases or a production login exist: disable instead (DEPLOY.md)');
  }
  if (mode === 'login') {
    if ((before.production_logins ?? []).length) throw new Error('PRODUCTION_LOGIN_ALREADY_PRESENT');
    if (!keychain || !scram) throw new Error('KEYCHAIN_REQUIRED');
    if (keychain.dbPassword.check() === 'ABSENT') keychain.dbPassword.generate();
    sql = scram(keychain.dbPassword.read());
  }
  if (mode === 'drop-login') {
    if (!(before.production_logins ?? []).some((l) => l.name === PRODUCTION_LOGIN)) throw new Error('PRODUCTION_LOGIN_ABSENT');
    sql = (await import('../../infra/torneos-payments-production/production-contract.mjs')).DROP_LOGIN_SQL;
  }
  if (takesArg) sql = operatorSql(mode, arg);
  out.psql = await applySql(sql);
  const after = await catalog();
  const post = classify(after);
  out.before = pre.state; out.after = post.state;
  out.outsideUnchanged = same(before.outside, after.outside);
  const expectedTo = f ? f.to : 'POST_0013';
  const label = mode.toUpperCase().replace(/-/g, '_');
  const effect = mode === 'login' ? (after.production_logins ?? []).some((l) => l.name === PRODUCTION_LOGIN)
    : mode === 'drop-login' ? !(after.production_logins ?? []).some((l) => l.name === PRODUCTION_LOGIN)
      : mode === 'scope' ? after.scope === arg
        : mode === 'allow' ? (after.allowlist ?? []).includes(arg)
          : mode === 'disallow' ? !(after.allowlist ?? []).includes(arg) : true;
  out.verdict = out.psql.code === 0 && post.state === expectedTo && out.outsideUnchanged && effect ? `${label}_DONE` : `${label}_FAILED`;
  out.scope = after.scope ?? null;
  out.productionPurchases = after.production_purchases ?? null;
  return out;
}

async function realDeps() {
  const infra = path.join(REPO, 'backend/torneos/infra');
  const C = await import(path.join(infra, 'torneos-officialization-error-v1/oec-remote-contract.mjs'));
  const CV1 = await import(path.join(infra, 'torneos-competition-v1/competition-remote.mjs'));
  const { runPsqlProbe } = await import(path.join(infra, 'torneos-payments-test/payments-db.mjs'));
  const { applySql } = await import(path.join(infra, 'torneos-gateway-auth/psql-gateway-auth.mjs'));
  const { scramVerifier } = await import(path.join(infra, 'torneos-gateway-auth/gateway-auth-contract.mjs'));
  const P = await import(path.join(infra, 'torneos-payments-production/production-contract.mjs'));
  const { productionKeychain } = await import(path.join(infra, 'torneos-payments-production/keychain-payments-production.mjs'));
  if (C.TORNEOS_REF !== REF || P.TORNEOS_REF !== REF) throw new Error('REF_MISMATCH');
  const keychain = productionKeychain();
  let password = null;
  const secret = () => password ?? (password = keychain.installer.read());
  const known = [];
  const redact = (s) => { let t = String(s ?? ''); for (const k of [password, ...known]) if (k) t = t.split(k).join('[REDACTED]'); return t; };
  const sql = fs.readFileSync(path.join(HERE, 'sql-catalog.sql'), 'utf8').trim();
  return {
    redact,
    keychain,
    scram: (loginPassword) => { known.push(loginPassword); return P.renderProductionLoginSql(scramVerifier(loginPassword)); },
    wipe: () => { password = null; known.length = 0; },
    catalog: async () => {
      const r = await runPsqlProbe({ script: C.readOnlyScript(sql), env: CV1.readOnlyEnv({ password: secret() }), redact });
      if (r.code !== 0) throw new Error(`CATALOG_READ_FAILED ${r.code} ${r.stderr_tail}`);
      return JSON.parse(r.stdout.trim().split('\n').filter(Boolean).pop());
    },
    applySql: (text) => applySql({ sql: text, env: CV1.installerEnv({ password: secret(), app: 'arma2-torneos-commerce-production-0013' }), redact }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, ...args] = process.argv.slice(2);
  const output = { at: new Date().toISOString(), transport: 'psql aws-0-sa-east-1.pooler.supabase.com:5432 verify-full' };
  let deps = null;
  try {
    deps = await realDeps();
    Object.assign(output, await run(mode, args, deps));
  } catch (error) {
    output.error = (deps?.redact ?? String)(error?.message ?? error).slice(0, 600);
  }
  deps?.wipe();
  process.stdout.write(`${JSON.stringify(output, null, 1)}\n`);
  process.exit(output.error || /FAILED/.test(output.verdict || '') ? 1 : 0);
}
