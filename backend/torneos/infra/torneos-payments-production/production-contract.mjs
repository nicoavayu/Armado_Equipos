// COMMERCE-PRODUCTION — every pin of the production payments operation in one place: the Deno Deploy app, its public
// URLs, its exact environment (names only; values never live in the repository), the database login and role, the
// Keychain custody and the Mercado Pago shapes. Nothing here is a secret.
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from '../torneos-gateway-auth/gateway-auth-contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '../../../..');
export const FUNCTIONS_DIR = path.join(REPO_ROOT, 'backend/torneos/supabase/functions');
export const EVIDENCE_DIR = path.join(REPO_ROOT, 'backend/torneos/commerce-production/evidence');
export const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const { TORNEOS_REF } = G;

// ─────────────────────────── Deno Deploy (the app next to the certified torneos-payments-test, never inside it)
export const DENO_API_HOST = 'api.deno.com';
export const DENO_TOKEN_PATTERN = /^dd[op]_[A-Za-z0-9_-]{20,200}$/;
export const DENO_ORG = /^torneos-gateway\.([a-z0-9-]+)\.deno\.net$/.exec(G.GATEWAY_HOST)[1];
export const APP_SLUG = 'torneos-payments';
export const TEST_APP_SLUG = 'torneos-payments-test';
export const PAYMENTS_HOST = `${APP_SLUG}.${DENO_ORG}.deno.net`;
export const FUNCTION_NAME = 'torneos-payments-production';
export const PAYMENTS_BASE = `https://${PAYMENTS_HOST}/functions/v1/${FUNCTION_NAME}`;
export const WEBHOOK_URL = `${PAYMENTS_BASE}/webhooks/mercadopago/v1`;
export const INTERNAL_PREFERENCE_URL = `${PAYMENTS_BASE}/internal/v1/season-checkout-preference`;
export const INTERNAL_RECONCILE_URL = `${PAYMENTS_BASE}/internal/v1/purchase-reconcile`;
export const APP_PUBLIC_URL = 'https://app.arma2.com.ar';
export const ENTRYPOINT = `${FUNCTION_NAME}/index.ts`;
// `crons: true`: the reconciliation Deno.cron of index.ts (the TEST app has none and says false).
export const APP_CONFIG = Object.freeze({ install: null, build: null, predeploy: null, runtime: Object.freeze({ type: 'dynamic', entrypoint: ENTRYPOINT }), crons: true });
export const APP_LABELS = Object.freeze({ 'custom.component': 'arma2-torneos-payments', 'custom.environment': 'mercadopago-production' });

export const SECRET_NAMES = Object.freeze(['MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN', 'MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET', 'TORNEOS_PAYMENTS_DB_URL',
  'TORNEOS_PAYMENTS_INTERNAL_SECRET']);
export const CONFIG_NAMES = Object.freeze(['TORNEOS_PAYMENT_PROVIDER', 'MERCADO_PAGO_ENVIRONMENT', 'MERCADO_PAGO_PRODUCTION_SELLER_ID', 'APP_PUBLIC_URL',
  'TORNEOS_PAYMENTS_NOTIFICATION_URL', 'TORNEOS_PAYMENTS_DEPLOYMENT', 'TORNEOS_PAYMENTS_DB_SSL_CA']);
export const ENV_NAMES = Object.freeze([...SECRET_NAMES, ...CONFIG_NAMES].sort());
// The production app never holds anything of TEST, Core, Supabase, the gateway or a platform database binding.
export const FORBIDDEN_ENV = Object.freeze([/^MERCADO_PAGO_TEST_/, /^TORNEOS_PAYMENTS_TEST_/, /^CORE_/, /^SUPABASE_/, /^DATABASE_/, /^PG[A-Z_]*$/,
  /^TORNEOS_COMMERCE_/, /^TORNEOS_GATEWAY_/, /^TORNEOS_BRIDGE_/, /^TORNEOS_CONTRACT_/, /^TORNEOS_DB_/, /^TORNEOS_REST_/, /^TORNEOS_PAYMENTS_LAB_/]);
export const forbiddenEnvNames = (names) => names.filter((n) => FORBIDDEN_ENV.some((re) => re.test(n)));

// ─────────────────────────── Mercado Pago (production seller)
export const MP_API_HOST = 'api.mercadopago.com';
export const MP_TOKEN_PATTERN = /^APP_USR-\d{6,20}-\d{6}-[0-9a-f]{32}-\d{6,20}$/;
export const MP_SECRET_PATTERN = /^[A-Za-z0-9]{32,128}$/;
export const MP_SELLER_PATTERN = /^[1-9]\d{3,19}$/;
/** The token's own seller id (its last group): must equal the declared seller before anything is sent. */
export const sellerOfToken = (token) => /-(\d{6,20})$/.exec(token ?? '')?.[1] ?? null;
/** /users/me of a production seller: exactly the declared id, MLA, never a test user. */
export function productionAttestation(me, sellerId) {
  if (!me || typeof me !== 'object') return { ok: false, reason: 'no_answer' };
  const tags = Array.isArray(me.tags) ? me.tags.map(String) : [];
  if (String(me.id ?? '') !== sellerId) return { ok: false, reason: 'seller_mismatch' };
  if (me.site_id !== 'MLA') return { ok: false, reason: 'site' };
  if (tags.includes('test_user')) return { ok: false, reason: 'test_user' };
  return { ok: true, reason: null };
}

// ─────────────────────────── Database (Arma2 Torneos data plane)
export const PRODUCTION_LOGIN = 'torneos_payments_prod';
export const PRODUCTION_ROLE = 'torneos_payment_production_service';
export const POOLER_HOST = 'aws-0-sa-east-1.pooler.supabase.com';
export const POOLER_PORT = 6543;
export const dbUrlFor = (password) => `postgres://${PRODUCTION_LOGIN}.${TORNEOS_REF}:${encodeURIComponent(password)}@${POOLER_HOST}:${POOLER_PORT}/postgres`;

/** The ONLY SQL of the login bootstrap: one transaction; guards first (login absent, no other production login, role shape), SCRAM only. */
export function renderProductionLoginSql(verifier) {
  if (!G.SCRAM_PATTERN.test(verifier ?? '')) throw new Error('verifier_shape');
  return [
    'BEGIN;',
    "SET LOCAL statement_timeout = '30s';",
    `DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PRODUCTION_LOGIN}') THEN RAISE EXCEPTION 'PAYMENTS_PRODUCTION_LOGIN_ALREADY_PRESENT'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PRODUCTION_ROLE}' AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls) THEN RAISE EXCEPTION 'PRODUCTION_ROLE_SHAPE_UNEXPECTED'; END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid WHERE r.rolname = '${PRODUCTION_ROLE}') THEN RAISE EXCEPTION 'PRODUCTION_LOGIN_ALREADY_PRESENT'; END IF;
END $guard$;`.replace(/\n/g, ' '),
    `CREATE ROLE ${PRODUCTION_LOGIN} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${verifier}';`,
    `GRANT ${PRODUCTION_ROLE} TO ${PRODUCTION_LOGIN} WITH INHERIT FALSE, SET TRUE;`,
    'COMMIT;',
    '',
  ].join('\n');
}
export const DROP_LOGIN_SQL = [
  'BEGIN;',
  `DO $guard$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PRODUCTION_LOGIN}') THEN RAISE EXCEPTION 'PAYMENTS_PRODUCTION_LOGIN_ABSENT'; END IF; END $guard$;`,
  `REVOKE ${PRODUCTION_ROLE} FROM ${PRODUCTION_LOGIN};`,
  `DROP ROLE ${PRODUCTION_LOGIN};`,
  'COMMIT;',
  '',
].join('\n');

// ─────────────────────────── Keychain custody (values never reach argv, logs or the repository)
export const KEYCHAIN_SERVICE = 'arma2-torneos-payments-production';
export const KEYCHAIN_ACCOUNTS = Object.freeze({ dbPassword: PRODUCTION_LOGIN, internalSecret: 'internal-hmac-key' });
export const DB_PASSWORD_PATTERN = G.DB_PASSWORD_PATTERN;
export const INTERNAL_SECRET_PATTERN = /^[0-9a-f]{64}$/;

// ─────────────────────────── the gateway side (Cloud Run torneos-gateway; values set by the operator)
export const GATEWAY_ENV = Object.freeze({
  TORNEOS_COMMERCE_MODE: 'production',
  TORNEOS_COMMERCE_PRODUCTION_PAYMENTS_HOST: PAYMENTS_HOST,
  TORNEOS_PAYMENTS_INTERNAL_URL: `https://${PAYMENTS_HOST}/functions/v1/${FUNCTION_NAME}`,
  TORNEOS_PAYMENTS_INTERNAL_SECRET: '<Secret Manager: the same 64-hex value as Keychain arma2-torneos-payments-production / internal-hmac-key>',
});
// ─────────────────────────── the frontend side (Vercel Production)
export const FRONTEND_ENV = Object.freeze({ REACT_APP_TORNEOS_BILLING_MODE: 'production' });
