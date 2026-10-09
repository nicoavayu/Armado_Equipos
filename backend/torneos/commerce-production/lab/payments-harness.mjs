// COMMERCE-PRODUCTION: the real production payments handler (torneos-payments-production/handler.ts) wired to the lab
// database through the exact statements of its rpc.ts, the production LOGIN and SET LOCAL ROLE (like db.ts), and to
// the in-process Mercado Pago emulator of the certified TEST rehearsals (torneos-payments-test/mp-emulator.mjs) in
// production shape: a non-test seller, live_mode true. Nothing leaves the process except the lab database connection.
import { createHmac, randomUUID } from 'node:crypto';
import pg from 'pg';
import { makeMercadoPago, signedNotification } from '../../infra/torneos-payments-test/mp-emulator.mjs';
import { loadGatewayTree } from '../../infra/torneos-gateway-auth/gateway-loader.mjs';
import { LOGINS, loginUrl } from './pg-lab.mjs';

// The REAL function sources, transpiled like every other offline suite of the functions tree (works on Node 20 / CI).
export const tree = await loadGatewayTree();
export const { createProductionPaymentsService } = await tree.import('torneos-payments-production/handler.ts');
export const { productionRpcStatement, DbError, DbUnavailable } = await tree.import('torneos-payments-production/rpc.ts');

export const SELLER = '2468013579';
export const TOKEN = 'APP_USR-2468013579123456-100726-0123456789abcdef0123456789abcdef-2468013579';
export const WEBHOOK_SECRET = 'prod-webhook-secret-fixture-0001';
export const SECRET_HEX = Array.from({ length: 32 }, (_, i) => (i * 7 + 3).toString(16).padStart(2, '0')).join('');
export const BASE = 'https://payments.unit.invalid/functions/v1/torneos-payments-production';
export const PREFERENCE_PATH = '/internal/v1/season-checkout-preference';
export const RECONCILE_PATH = '/internal/v1/purchase-reconcile';
export const PRODUCTION_ME = Object.freeze({ id: Number(SELLER), nickname: 'ARMA2_PROD_EMULATED', site_id: 'MLA', tags: ['normal', 'mshops'] });

export const LAB_ENV = Object.freeze({
  TORNEOS_PAYMENT_PROVIDER: 'MERCADO_PAGO', MERCADO_PAGO_ENVIRONMENT: 'production',
  MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN: TOKEN, MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET: WEBHOOK_SECRET, MERCADO_PAGO_PRODUCTION_SELLER_ID: SELLER,
  APP_PUBLIC_URL: 'https://app.unit.invalid', TORNEOS_PAYMENTS_NOTIFICATION_URL: `${BASE}/webhooks/mercadopago/v1`,
  TORNEOS_PAYMENTS_INTERNAL_SECRET: SECRET_HEX, TORNEOS_PAYMENTS_DB_URL: 'postgres://lab_payment_production_service:fixture@db.unit.invalid:5432/postgres',
});

/** ProductionPaymentsDb over the lab: the production login, one transaction, SET LOCAL ROLE, the rpc.ts statement. */
export function labProductionDb() {
  const pool = new pg.Pool({ connectionString: loginUrl('production'), max: 4 });
  const calls = [];
  return {
    calls,
    async call(name, args) {
      calls.push(name);
      const statement = productionRpcStatement(name);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL ROLE ${LOGINS.production.role}`);
        await client.query('SET LOCAL statement_timeout = 3000');
        const { rows } = await client.query(statement, args);
        await client.query('COMMIT');
        const value = rows[0]?.result;
        if (value === undefined || value === null || typeof value !== 'object') throw new DbUnavailable();
        return value;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error instanceof DbUnavailable) throw error;
        if (typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) {
          throw new DbError(error.code, /\bTORNEOS_[A-Z_]+/.exec(String(error.message))?.[0] ?? 'DB_ERROR');
        }
        throw new DbUnavailable();
      } finally {
        client.release();
      }
    },
    end: () => pool.end(),
  };
}

export function emulator(overrides = {}) {
  return makeMercadoPago({ sellerId: SELLER, accessToken: TOKEN, me: PRODUCTION_ME, liveMode: true, ...overrides });
}

export function service({ db, mp, env = LAB_ENV, log = () => {}, now } = {}) {
  return createProductionPaymentsService({ env, connectDb: () => db, fetcher: (input, init) => mp.fetch(input, init), log, now });
}

/** A gateway-signed internal request (../torneos-payments/hmac.ts manifest) to one of the two internal routes. */
export function internalRequest(path, payload, { secretHex = SECRET_HEX, time = String(Math.floor(Date.now() / 1000)), nonce = randomUUID(), headers = {} } = {}) {
  const body = JSON.stringify(payload);
  const signature = createHmac('sha256', Buffer.from(secretHex, 'hex')).update(`${path}\n${time}\n${nonce}\n${body}`).digest('hex');
  return new Request(`${BASE}${path}`, { method: 'POST', body,
    headers: { 'content-type': 'application/json', 'x-time': time, 'x-nonce': nonce, 'x-signature': signature, ...headers } });
}

export function webhookRequest({ dataId, type = 'payment', liveMode = true, sellerId = SELLER, secret = WEBHOOK_SECRET, body = null }) {
  const n = signedNotification({ base: BASE, secret, dataId, sellerId, type, liveMode, body });
  return new Request(n.url, n.init);
}

export async function send(svc, request) {
  const response = await svc.fetch(request);
  return { status: response.status, body: await response.json().catch(() => null) };
}
