// COMMERCE-PRODUCTION phase B — the additive overlay that makes the Premium purchase clickable in the integrated preview
// (shared rehearsal lab). Lab only: nothing here reaches Mercado Pago, a hosted project or a real buyer.
//
//   prepare [--app-origin http://localhost:3121]
//            ephemeral lab secrets and the files the lab owner applies, in ./.runtime (0700 / 0600, git-ignored):
//              gateway-commerce.env             the Node gateway's 4 commerce values (production mode, local-lab)
//              edge-gateway-commerce.env        the Edge gateway's 2 (mode + mount; the router supplies the rest)
//              torneos-functions-production.env the production worker's values, PRODUCTION_PAYMENTS__-prefixed (the lab
//                                               router hands them only to torneos-payments-production, unprefixed)
//              mp-stub.env                      the lab Mercado Pago (this overlay's container)
//              lab-login.sql                    the worker's lab LOGIN (SCRAM verifier only) — run as the DB superuser
//              scope-open.sql / scope-off.sql   the checkout switch of 0013
//            Idempotent: existing secrets are kept, so a running lab keeps working.
//   stub-up [--network arma2-promo-rehearsal_isolated]
//            the lab Mercado Pago container (alias mp-stub on the lab network; console on 127.0.0.1:58461)
//   stub-down | status
//   selftest [--keep]
//            the same pieces on a private replica (own DB with 0000 → 0013, own edge-runtime as torneos-functions with
//            the repo's lab router, own stub): checkout → Preference → console actions → signed notifications → plan.
//
// Nothing secret is printed. The console URL carries the lab control token (loopback-only lab console): it is written
// to .runtime/console-url.txt and printed once by `status`, never logged by the stub.
import { spawnSync } from 'node:child_process';
import { createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scramVerifier } from '../../../infra/torneos-gateway-auth/gateway-auth-contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../../..');
const RUNTIME = path.join(HERE, '.runtime');
const DOCKER = process.platform === 'darwin' ? '/Applications/Docker.app/Contents/Resources/bin/docker' : 'docker';

export const LAB_LOGIN = 'lab_payment_production_service';
export const PRODUCTION_ROLE = 'torneos_payment_production_service';
export const STUB = Object.freeze({ container: 'arma2-phaseb-mp-stub', ingress: 'arma2-phaseb-ingress', port: 58461, image: 'node:22.22.0-bookworm-slim' });
export const DEFAULT_NETWORK = 'arma2-promo-rehearsal_isolated';
export const PAYMENTS_MOUNT = 'http://torneos-functions:9000/torneos-payments-production';
const PRODUCTION_PREFIX = 'PRODUCTION_PAYMENTS__';
const EDGE_IMAGE = 'public.ecr.aws/supabase/edge-runtime:v1.74.2';
// Mercado Pago's own hosts resolve to a black hole inside the lab containers (as in the TEST commerce overlay).
const MP_BLACKHOLE = ['api.mercadopago.com', 'www.mercadopago.com', 'www.mercadopago.com.ar', 'mercadopago.com.ar', 'sandbox.mercadopago.com.ar'];

function docker(args, { input } = {}) {
  const r = spawnSync(DOCKER, args, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PATH: `/Applications/Docker.app/Contents/Resources/bin:${process.env.PATH}` } });
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? '' };
}
const must = (r, what) => { if (!r.ok) throw new Error(`${what}: ${r.err.split('\n').find(Boolean) ?? 'failed'}`); return r.out; };
const envFile = (values) => `${Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n')}\n`;
const parseEnv = (text) => Object.fromEntries(text.split('\n').filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
function writeSecret(dir, name, text) { writeFileSync(path.join(dir, name), text, { mode: 0o600 }); chmodSync(path.join(dir, name), 0o600); }

// ─────────────────────────── secrets and files

export function freshSecrets() {
  const seller = String(randomInt(1_000_000_000, 9_999_999_999));
  const digits = (n) => Array.from({ length: n }, () => randomInt(0, 10)).join('');
  return {
    seller,
    accessToken: `APP_USR-${digits(16)}-${digits(6)}-${randomBytes(16).toString('hex')}-${seller}`,
    webhookSecret: randomBytes(24).toString('hex'),
    internalSecret: randomBytes(32).toString('hex'),
    controlToken: randomBytes(16).toString('hex'),
    dbPassword: randomBytes(30).toString('base64url'), // 40 chars: the SCRAM helper's password shape
  };
}

/** The four files of the overlay plus the SQL, from one set of secrets. Pure: also used by the self-test. */
export function renderOverlay(secrets, { appOrigin = 'http://localhost:3121', dbHost = 'torneos-db' } = {}) {
  const worker = {
    TORNEOS_PAYMENT_PROVIDER: 'MERCADO_PAGO',
    MERCADO_PAGO_ENVIRONMENT: 'production',
    MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN: secrets.accessToken,
    MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET: secrets.webhookSecret,
    MERCADO_PAGO_PRODUCTION_SELLER_ID: secrets.seller,
    // Lab configuration of the production service: public URLs are .invalid, the database is the lab's.
    APP_PUBLIC_URL: 'https://app.phase-b.invalid',
    TORNEOS_PAYMENTS_NOTIFICATION_URL: 'https://payments.phase-b.invalid/functions/v1/torneos-payments-production/webhooks/mercadopago/v1',
    TORNEOS_PAYMENTS_INTERNAL_SECRET: secrets.internalSecret,
    TORNEOS_PAYMENTS_DB_URL: `postgres://${LAB_LOGIN}:${secrets.dbPassword}@${dbHost}:5432/postgres`,
    TORNEOS_PAYMENTS_LAB_MP_API_ORIGIN: 'http://mp-stub:8080',
  };
  return {
    // Node lab gateway (its own .runtime/server/commerce.env): the 4 values.
    'gateway-commerce.env': envFile({ TORNEOS_COMMERCE_MODE: 'production', TORNEOS_COMMERCE_DEPLOYMENT: 'local-lab',
      TORNEOS_PAYMENTS_INTERNAL_URL: PAYMENTS_MOUNT, TORNEOS_PAYMENTS_INTERNAL_SECRET: secrets.internalSecret }),
    // Edge gateway (torneos-functions container, next to torneos-functions-production.env): the mode and the mount only.
    // The lab router pins local-lab and takes the HMAC key from the production worker's prefixed value.
    'edge-gateway-commerce.env': envFile({ TORNEOS_COMMERCE_MODE: 'production', TORNEOS_PAYMENTS_INTERNAL_URL: PAYMENTS_MOUNT }),
    'torneos-functions-production.env': envFile(Object.fromEntries(Object.entries(worker).map(([k, v]) => [`${PRODUCTION_PREFIX}${k}`, v]))),
    'mp-stub.env': envFile({ MP_STUB_ACCESS_TOKEN: secrets.accessToken, MP_STUB_SELLER_ID: secrets.seller, MP_STUB_CONTROL_TOKEN: secrets.controlToken,
      MP_STUB_WEBHOOK_SECRET: secrets.webhookSecret, MP_STUB_PAYMENTS_URL: PAYMENTS_MOUNT, MP_STUB_APP_ORIGIN: appOrigin }),
    'lab-login.sql': [
      '-- COMMERCE-PRODUCTION phase B: the lab LOGIN of torneos-payments-production (run once, as the DB superuser).',
      'BEGIN;',
      `DO $guard$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PRODUCTION_ROLE}' AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'PRODUCTION_ROLE_SHAPE_UNEXPECTED (is 0013 applied?)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${LAB_LOGIN}') THEN RAISE EXCEPTION 'LAB_LOGIN_ALREADY_PRESENT'; END IF;
END $guard$;`,
      `CREATE ROLE ${LAB_LOGIN} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${scramVerifier(secrets.dbPassword)}';`,
      `GRANT ${PRODUCTION_ROLE} TO ${LAB_LOGIN} WITH INHERIT FALSE, SET TRUE;`,
      'COMMIT;',
      '',
    ].join('\n'),
    'lab-login-drop.sql': `BEGIN;\nREVOKE ${PRODUCTION_ROLE} FROM ${LAB_LOGIN};\nDROP ROLE ${LAB_LOGIN};\nCOMMIT;\n`,
    'scope-open.sql': "BEGIN;\nUPDATE public.tournament_commerce_production_settings SET checkout_scope = 'open', reason = 'Laboratorio fase B (preview integrada)', updated_at = now() WHERE singleton;\nCOMMIT;\n",
    'scope-off.sql': "BEGIN;\nUPDATE public.tournament_commerce_production_settings SET checkout_scope = 'off', reason = 'Laboratorio fase B cerrado', updated_at = now() WHERE singleton;\nCOMMIT;\n",
  };
}

function loadOrCreateSecrets(dir) {
  const file = path.join(dir, 'secrets.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const s = freshSecrets();
  writeSecret(dir, 'secrets.json', JSON.stringify(s));
  return s;
}

export function prepare({ dir = RUNTIME, appOrigin = 'http://localhost:3121', dbHost = 'torneos-db' } = {}) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const secrets = loadOrCreateSecrets(dir);
  const files = renderOverlay(secrets, { appOrigin, dbHost });
  for (const [name, text] of Object.entries(files)) writeSecret(dir, name, text);
  writeSecret(dir, 'console-url.txt', `http://127.0.0.1:${STUB.port}/__lab/${secrets.controlToken}/\n`);
  return { dir, files: Object.keys(files), secrets };
}

// ─────────────────────────── the lab Mercado Pago container

function ensureIngress(name) {
  if (docker(['network', 'inspect', name]).ok) return;
  // Port publishing needs a non-internal bridge; masquerade off, so nothing on it reaches the outside.
  must(docker(['network', 'create', '--label', 'arma2.lab=commerce-production-phase-b', '-o', 'com.docker.network.bridge.enable_ip_masquerade=false', name]), 'ingress network');
}

export function stubUp({ network = DEFAULT_NETWORK, dir = RUNTIME, container = STUB.container, ingress = STUB.ingress, port = STUB.port } = {}) {
  if (!existsSync(path.join(dir, 'mp-stub.env'))) throw new Error('run prepare first');
  if (!docker(['network', 'inspect', network]).ok) throw new Error(`network ${network} not found`);
  docker(['rm', '-f', container]);
  ensureIngress(ingress);
  const mounts = [
    ['backend/torneos/commerce-production/lab/phase-b/mp-stub-production.mjs'],
    ['backend/torneos/infra/torneos-payments-test/mp-emulator.mjs'],
  ].flatMap(([rel]) => ['-v', `${path.join(REPO, rel)}:/lab/${rel}:ro`]);
  must(docker(['create', '--name', container, '--label', 'arma2.lab=commerce-production-phase-b', '--network', ingress,
    '-p', `127.0.0.1:${port}:8080`, '--env-file', path.join(dir, 'mp-stub.env'), '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '-w', '/lab', ...mounts, STUB.image, 'node', 'backend/torneos/commerce-production/lab/phase-b/mp-stub-production.mjs']), 'stub create');
  must(docker(['network', 'connect', '--alias', 'mp-stub', network, container]), 'stub network attach');
  must(docker(['start', container]), 'stub start');
  return { container, network, port };
}

export function stubDown({ container = STUB.container, ingress = STUB.ingress } = {}) {
  docker(['rm', '-f', container]);
  docker(['network', 'rm', ingress]);
}

async function waitFor(label, probe, seconds = 120) {
  for (let i = 0; i < seconds; i += 1) {
    try { if (await probe()) return; } catch { /* not yet */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${label} did not become ready`);
}

// ─────────────────────────── self-test on a private replica

function signedInternal(base, secretHex, pathName, payload) {
  const body = JSON.stringify(payload);
  const time = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const signature = createHmac('sha256', Buffer.from(secretHex, 'hex')).update(`${pathName}\n${time}\n${nonce}\n${body}`).digest('hex');
  return fetch(`${base}${pathName}`, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-time': time, 'x-nonce': nonce, 'x-signature': signature },
    signal: AbortSignal.timeout(90_000) });
}

export async function selftest({ keep = false, log = console.log } = {}) {
  const NAME = 'arma2-phaseb-selftest';
  process.env.COMMERCE_PRODUCTION_LAB_CONTAINER = `${NAME}-db`;
  process.env.COMMERCE_PRODUCTION_LAB_PORT = '58474';
  const lab = await import('../pg-lab.mjs');
  const fx = await import('../fixtures.mjs');
  const net = `${lab.CONTAINER}-net`;
  const dir = path.join(RUNTIME, 'selftest');
  const functions = `${NAME}-functions`;
  const stub = { container: `${NAME}-mp-stub`, ingress: `${NAME}-ingress`, port: 58473 };
  const edgePort = 58472;
  const checks = [];
  const check = (label, ok, detail = '') => { checks.push({ label, ok: Boolean(ok) }); log(`${ok ? '✔' : '✖'} ${label}${ok || !detail ? '' : ` — ${detail}`}`); if (!ok) throw new Error(`selftest: ${label}`); };
  try {
    await lab.up();
    const { secrets } = prepare({ dir, appOrigin: 'http://localhost:3121' });
    // The SQL the lab owner runs: the replica's own login is replaced by the one lab-login.sql creates.
    lab.sql(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${LAB_LOGIN}') THEN REVOKE ${PRODUCTION_ROLE} FROM ${LAB_LOGIN}; DROP ROLE ${LAB_LOGIN}; END IF; END $$;`);
    lab.sql(readFileSync(path.join(dir, 'lab-login.sql'), 'utf8'));
    check('lab-login.sql creates a NOINHERIT login, member of the production role only', lab.sql(`select r.rolcanlogin and not r.rolinherit and not r.rolsuper
      and (select array_agg(g.rolname) from pg_auth_members m join pg_roles g on g.oid = m.roleid where m.member = r.oid) = array['${PRODUCTION_ROLE}']::name[]
      from pg_roles r where r.rolname = '${LAB_LOGIN}'`).trim() === 't');
    lab.sql(readFileSync(path.join(dir, 'scope-open.sql'), 'utf8'));

    // The production worker in the repo's lab router (as on the rehearsal's torneos-functions).
    docker(['rm', '-f', functions]);
    must(docker(['run', '-d', '--name', functions, '--label', 'arma2.lab=commerce-production-phase-b', '--network', net, '--network-alias', 'torneos-functions',
      '-p', `127.0.0.1:${edgePort}:9000`, '--env-file', path.join(dir, 'torneos-functions-production.env'),
      ...MP_BLACKHOLE.flatMap((h) => ['--add-host', `${h}:127.0.0.9`]),
      '-v', `${path.join(REPO, 'backend/torneos/supabase/functions')}:/home/deno/functions:ro`,
      '-v', `${path.join(REPO, 'integration/torneos-core-contracts/torneos-edge-main')}:/home/deno/main:ro`,
      '-v', `${NAME}-deno-cache:/root/.cache/deno`,
      EDGE_IMAGE, 'start', '--main-service', '/home/deno/main', '--port', '9000']), 'edge-runtime run');
    stubUp({ network: net, dir, ...stub });
    const consoleBase = `http://127.0.0.1:${stub.port}/__lab/${secrets.controlToken}`;
    const paymentsBase = `http://127.0.0.1:${edgePort}/torneos-payments-production`;
    await waitFor('mp-stub', async () => (await fetch(`http://127.0.0.1:${stub.port}/__lab/health`)).ok, 60);

    const state = async () => (await (await fetch(`${consoleBase}/state`)).json()).purchases;
    const act = async (body) => {
      const r = await fetch(`${consoleBase}/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json() };
    };
    const preference = async (purchaseId) => {
      let r = null;
      // The first request boots the worker (module download into the cache volume).
      await waitFor('payments worker', async () => { r = await signedInternal(paymentsBase, secrets.internalSecret, '/internal/v1/season-checkout-preference', { purchase_id: purchaseId }); return r.status !== 503; }, 180);
      return { status: r.status, body: await r.json() };
    };

    // 1. checkout → Preference (the worker attests the lab seller, reads the purchase, creates the Preference in the stub)
    const a = fx.world('phase-b-a');
    const pa = fx.checkout(a.owner, a);
    const pref = await preference(pa.id);
    check('Preference created for the purchase (200, Checkout Pro URL on mercadopago.com.ar)', pref.status === 200 && /^https:\/\/www\.mercadopago\.com\.ar\/checkout\/v1\/redirect\?pref_id=/.test(pref.body.checkoutUrl), JSON.stringify(pref));
    const listed = (await state()).find((p) => p.purchaseId === pa.id);
    check('the console lists it, with return links to the preview app', listed && listed.returnPending === `http://localhost:3121/torneos/organizacion/${a.org}/temporada/${a.season}/plan/compra/${pa.id}/pendiente`);
    const html = await (await fetch(`${consoleBase}/`)).text();
    check('the console page renders the purchase and its actions', html.includes(pa.id) && html.includes('Aprobar pago'));
    check('a wrong control token is 404', (await fetch(`http://127.0.0.1:${stub.port}/__lab/${'0'.repeat(32)}/`)).status === 404);

    // 2. approve → signed notification → Premium for that season only
    const other = fx.season(a.owner, a.org, 'phase-b-a-other');
    const approved = await act({ action: 'approve', preferenceId: listed.preferenceId });
    check('approve → notification 200 approved', approved.status === 200 && approved.body.notification.status === 200, JSON.stringify(approved.body));
    check('purchase approved and the season is PREMIUM; the other season stays FREE',
      fx.purchaseRow(pa.id).status === 'approved' && fx.planOf(a.org, a.season) === 'PREMIUM' && fx.planOf(a.org, other) === 'FREE');
    const replay = await act({ action: 'resend', paymentId: approved.body.paymentId });
    check('a repeated notification changes nothing', replay.body.notification.status === 200 && fx.purchaseRow(pa.id).status === 'approved');
    const reconcile = await signedInternal(paymentsBase, secrets.internalSecret, '/internal/v1/purchase-reconcile', { purchase_id: pa.id });
    check('reconcile route answers (200) for the approved purchase', reconcile.status === 200);

    // 3. panel refund → revoked, nothing deleted
    const refunded = await act({ action: 'refund', paymentId: approved.body.paymentId });
    check('refund → purchase refunded, season back to FREE', refunded.body.notification.status === 200 && fx.purchaseRow(pa.id).status === 'refunded' && fx.planOf(a.org, a.season) === 'FREE');

    // 4. pending (cash) → accredited
    const b = fx.world('phase-b-b');
    const pb = fx.checkout(b.owner, b);
    const prefB = await preference(pb.id);
    const pending = await act({ action: 'pending', preferenceId: prefB.body.preferenceId });
    check('pending payment → purchase stays open, FREE', pending.body.notification.status < 300 && fx.planOf(b.org, b.season) === 'FREE' && fx.purchaseRow(pb.id).status !== 'approved');
    const accredited = await act({ action: 'accredit', paymentId: pending.body.paymentId });
    check('accreditation → approved, PREMIUM', accredited.body.notification.status === 200 && fx.purchaseRow(pb.id).status === 'approved' && fx.planOf(b.org, b.season) === 'PREMIUM');

    // 5. rejected then approved (another card), then chargeback dispute lost
    const c = fx.world('phase-b-c');
    const pc = fx.checkout(c.owner, c);
    const prefC = await preference(pc.id);
    const rejected = await act({ action: 'reject', preferenceId: prefC.body.preferenceId });
    check('rejected payment → still FREE, purchase open for another card', rejected.body.notification.status < 300 && fx.planOf(c.org, c.season) === 'FREE');
    const second = await act({ action: 'approve', preferenceId: prefC.body.preferenceId });
    check('second card approved → PREMIUM', second.body.notification.status === 200 && fx.planOf(c.org, c.season) === 'PREMIUM');
    const dispute = await act({ action: 'dispute', paymentId: second.body.paymentId });
    check('chargeback dispute → Premium suspended', dispute.body.notification.status === 200 && fx.planOf(c.org, c.season) === 'FREE', JSON.stringify(dispute.body));
    const lost = await act({ action: 'dispute-lost', paymentId: second.body.paymentId });
    check('dispute lost (buyer won) → Premium revoked', lost.body.notification.status === 200 && fx.planOf(c.org, c.season) === 'FREE', JSON.stringify(lost.body));
    const d = fx.world('phase-b-d');
    const pd = fx.checkout(d.owner, d);
    const prefD = await preference(pd.id);
    const paidD = await act({ action: 'approve', preferenceId: prefD.body.preferenceId });
    await act({ action: 'dispute', paymentId: paidD.body.paymentId });
    const won = await act({ action: 'dispute-won', paymentId: paidD.body.paymentId });
    check('dispute won (reimbursed to the seller) → Premium restored', won.body.notification.status === 200 && fx.planOf(d.org, d.season) === 'PREMIUM', JSON.stringify(won.body));

    // 6. no secret in any container log
    const logs = must(docker(['logs', functions]), 'logs') + must(docker(['logs', stub.container]), 'logs');
    const leaked = [secrets.accessToken, secrets.webhookSecret, secrets.internalSecret, secrets.controlToken, secrets.dbPassword].filter((s) => logs.includes(s));
    check('no lab secret in the worker or stub logs', leaked.length === 0);
    return { ok: true, checks };
  } finally {
    if (!keep) {
      docker(['rm', '-f', functions]);
      stubDown(stub);
      lab.down();
    }
  }
}

// ─────────────────────────── CLI

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const opt = (name, fallback) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : fallback; };
  try {
    if (command === 'prepare') {
      const r = prepare({ appOrigin: opt('app-origin', 'http://localhost:3121') });
      console.log(JSON.stringify({ runtime: path.relative(REPO, r.dir), files: r.files, gatewayInternalUrl: PAYMENTS_MOUNT, seller: 'generated (lab)', secrets: 'written 0600, not printed' }, null, 2));
    } else if (command === 'stub-up') {
      console.log(JSON.stringify(stubUp({ network: opt('network', DEFAULT_NETWORK) })));
    } else if (command === 'stub-down') {
      stubDown(); console.log('stub removed');
    } else if (command === 'status') {
      const health = await fetch(`http://127.0.0.1:${STUB.port}/__lab/health`).then((r) => r.ok).catch(() => false);
      console.log(JSON.stringify({ stub: health ? 'up' : 'down', console: existsSync(path.join(RUNTIME, 'console-url.txt')) ? readFileSync(path.join(RUNTIME, 'console-url.txt'), 'utf8').trim() : null }));
    } else if (command === 'selftest') {
      const r = await selftest({ keep: rest.includes('--keep') });
      console.log(`selftest: ${r.checks.length} checks passed`);
    } else {
      console.error('usage: prepare [--app-origin URL] | stub-up [--network NAME] | stub-down | status | selftest [--keep]');
      process.exit(2);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
