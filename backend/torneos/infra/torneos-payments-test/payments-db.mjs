// PAYMENTS TEST — the psql legs. Same transport as the certified gateway/auth tooling (psql-gateway-auth.mjs): the
// Supavisor pooler of Arma2 Torneos in sa-east-1, sslmode=verify-full with the Supabase CA, a MINIMAL child environment
// built here, the password only as PGPASSWORD, the SQL on stdin (never argv, never a file).
//
//   PB        applyPaymentBootstrap   as `postgres` (the certified installer): the ONE rendered transaction.
//   PB-cert   payment login probe     as the payments login, 5432 + 6543: what it can and cannot do; every block ROLLBACK.
//   ORD       ordering probe          as the payments login: the MP-B1.2 permutations on the hosted functions, each in its
//                                     own transaction that ENDS IN ROLLBACK, then a fresh read proving nothing survived.
import crypto from 'node:crypto';
import { spawn as realSpawn } from 'node:child_process';
import { applySql as realApplySql, PSQL_BIN, CA_CERT, POOLER_HOST_PATTERN } from '../torneos-gateway-auth/psql-gateway-auth.mjs';
import { TORNEOS_REF, PAYMENT_LOGIN, PAYMENT_ROLE } from './payments-test-contract.mjs';

export { PSQL_BIN, CA_CERT, POOLER_HOST_PATTERN };
const PSQL_TIMEOUT_MS = 5 * 60 * 1000;
export const MAX_PROBE_STDOUT = 4 * 1024 * 1024;
/**
 * The certified login-probe runner keeps only the LAST 64 KB of stdout (enough for its probes). The ordering run prints
 * far more (a purchase projection per step), and on the hosted pooler that cut its first lines (identity, initial
 * state): found by the first remote run, 2026-09-26. This runner keeps the whole output up to 4 MB and fails closed
 * (stdout_overflow) beyond that instead of dropping lines.
 */
export function runPsqlProbe({ script, env, redact, spawn = realSpawn }) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(PSQL_BIN, ['-X', '--no-psqlrc', '-q', '-A', '-t', '-f', '-'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let size = 0; let overflow = false; let err = '';
    child.stdout.on('data', (c) => { size += c.length; if (size > MAX_PROBE_STDOUT) { overflow = true; return; } chunks.push(c); });
    child.stderr.on('data', (c) => { err = (err + c.toString('utf8')).slice(-8000); });
    const timer = setTimeout(() => child.kill('SIGTERM'), PSQL_TIMEOUT_MS);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, elapsed_ms: Date.now() - started, stdout: '', stderr_tail: redact(`spawn_error ${e.message}`) }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const tail = redact(err.split('\n').filter((l) => /FATAL|could not|SSL|certificate|password|timeout/i.test(l)).slice(-4).join('\n'));
      resolve(overflow ? { code: -2, elapsed_ms: Date.now() - started, stdout: '', stderr_tail: 'stdout_overflow' } : { code: code ?? -1, elapsed_ms: Date.now() - started, stdout: Buffer.concat(chunks).toString('utf8'), stderr_tail: tail });
    });
    child.stdin.end(script);
  });
}
export const PORTS = Object.freeze([5432, 6543]);
const OK = '00000'; const DENIED = '42501';

function env({ host, port, user, password, app }) {
  if (!POOLER_HOST_PATTERN.test(host)) throw new Error('pooler_host_not_sa_east_1');
  if (!PORTS.includes(port)) throw new Error('pooler_port_not_pinned');
  return { PATH: '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', LANG: 'C', PGHOST: host, PGPORT: String(port), PGUSER: `${user}.${TORNEOS_REF}`, PGDATABASE: 'postgres',
    PGSSLMODE: 'verify-full', PGSSLROOTCERT: CA_CERT, PGCONNECT_TIMEOUT: '20', PGAPPNAME: app, PGPASSWORD: password };
}
export const installerEnv = ({ host, password }) => env({ host, port: 5432, user: 'postgres', password, app: 'arma2-torneos-payments-test-bootstrap' });
export const paymentLoginEnv = ({ host, port, password }) => env({ host, port, user: PAYMENT_LOGIN, password, app: 'arma2-torneos-payments-test-probe' });

export function applyPaymentBootstrap({ sql, host, password, redact, applySql = realApplySql }) {
  return applySql({ sql, env: installerEnv({ host, password }), redact });
}

// ─────────────────────────── shared script machinery ───────────────────────────
const q = (s) => s.replace(/\n/g, ' ');
/** One statement under a savepoint; its SQLSTATE (and message) echoed; kept only when `keep` and it succeeded. */
const stmt = (tag, sql, i, keep) => [`SAVEPOINT p${i};`, `${q(sql)};`, `\\echo 'E|${tag}|' :SQLSTATE '|' :LAST_ERROR_MESSAGE`,
  ...(keep ? ['\\if :ERROR', `ROLLBACK TO SAVEPOINT p${i};`, '\\else', `RELEASE SAVEPOINT p${i};`, '\\endif'] : [`ROLLBACK TO SAVEPOINT p${i};`])];
const lit = (v) => (v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const HEAD = ['\\set ON_ERROR_STOP 0', '\\set QUIET 1',
  "SELECT 'W|' || session_user || '|' || current_user || '|' || (SELECT count(*) FROM pg_roles WHERE rolname = current_user AND rolcanlogin AND NOT rolinherit);"];
function parse(stdout) {
  const out = { whoami: null, errors: {}, rows: {}, done: false };
  for (const line of String(stdout).split('\n')) {
    if (line.startsWith('W|')) { const [, s, c, n] = line.split('|'); out.whoami = { session_user: s, current_user: c, login_noinherit: n === '1' }; }
    if (line === 'Z|done') out.done = true;
    let m = /^E\|([A-Za-z0-9_:.-]+)\| (\S+) \|\s?(.*)$/.exec(line);
    if (m) out.errors[m[1]] = { sqlstate: m[2], message: m[2] === OK ? null : m[3].slice(0, 160) };
    m = /^R\|([A-Za-z0-9_:.-]+)\|(.*)$/.exec(line);
    if (m) { try { out.rows[m[1]] = JSON.parse(m[2]); } catch { out.rows[m[1]] = { unparsed: true }; } }
  }
  return out;
}
const whoamiOk = (w) => !!w && w.session_user === PAYMENT_LOGIN && w.current_user === PAYMENT_LOGIN && w.login_noinherit;

// ─────────────────────────── PB-cert: the payments login, exactly ───────────────────────────
export function loginChecks({ fresh = crypto.randomUUID() } = {}) {
  const c = (name, sql, expect, message = null, keep = false) => ({ name, sql, expect, message, keep });
  const ref = `arma2:season:purchase:${fresh}`;
  const before = [
    c('noinherit_no_rpc_before_set_role', `SELECT public.get_provider_tournament_purchase(${lit(ref)}, 'MERCADO_PAGO', 'test')`, DENIED),
    c('noinherit_no_table_before_set_role', 'SELECT count(*) FROM public.tournament_purchases', DENIED),
    ...['postgres', 'service_role', 'authenticated', 'anon', 'authenticator', 'supabase_admin', 'torneos_identity_writer', 'torneos_core_adapter',
      'torneos_edge_identity_writer', 'torneos_edge_core_adapter'].map((r) => c(`set_role_refused_${r}`, `SET LOCAL ROLE ${r}`, DENIED)),
    c('create_table_refused', 'CREATE TABLE public.torneos_payments_probe_refused (x int)', DENIED),
    c('create_role_refused', 'CREATE ROLE torneos_payments_probe_refused', DENIED),
  ];
  const own = [
    c('set_role_payment_service', `SET LOCAL ROLE ${PAYMENT_ROLE}`, OK, null, true),
    c('current_user_is_payment_service', `SELECT CASE WHEN current_user = '${PAYMENT_ROLE}' THEN 1 ELSE (current_user::text)::int END`, OK),
    c('set_role_other_refused_after_own', 'SET LOCAL ROLE torneos_identity_writer', DENIED),
    // the four RPCs: executable (their own domain refusal), with no row of any real purchase involved
    c('rpc_lookup_executes_not_found', `SELECT public.get_provider_tournament_purchase(${lit(ref)}, 'MERCADO_PAGO', 'test')`, 'P0002', 'TORNEOS_PURCHASE_NOT_FOUND'),
    c('rpc_lookup_refuses_other_provider_env', `SELECT public.get_provider_tournament_purchase(${lit(ref)}, 'MERCADO_PAGO', 'live')`, '22023', 'TORNEOS_PROVIDER_INVALID'),
    c('rpc_status_executes_unknown_purchase', `SELECT public.apply_verified_tournament_payment_status(${lit(fresh)}::uuid, 'MERCADO_PAGO', 'test', 'approved', 'approved', NULL, '1', now())`, '22023', 'TORNEOS_PURCHASE_INVALID'),
    c('rpc_reversal_executes_unknown_purchase', `SELECT public.apply_verified_tournament_payment_reversal(${lit(fresh)}::uuid, 'MERCADO_PAGO', 'test', 'refund', 'refunded', NULL, '1', now())`, '22023', 'TORNEOS_PURCHASE_INVALID'),
    c('rpc_status_refuses_missing_ordering', `SELECT public.apply_verified_tournament_payment_status(${lit(fresh)}::uuid, 'MERCADO_PAGO', 'test', 'approved', 'approved', NULL, '1', NULL)`, '22023', 'TORNEOS_PROVIDER_ORDERING_REQUIRED'),
    c('rpc_record_preference_executes', `SELECT public.record_tournament_purchase_preference(${lit(fresh)}::uuid, 'MERCADO_PAGO', 'test', 'probe-preference', now() + interval '30 minutes')`, 'NOT_42501'),
    // everything else: refused
    ...['tournament_purchases', 'tournament_purchase_events', 'tournament_season_plan_grants', 'tournament_season_plan_grant_events', 'tournament_payment_provider_watermarks',
      'torneos_identity', 'tournament_organizations'].map((t) => c(`table_refused_${t}`, `SELECT 1 FROM public.${t} LIMIT 1`, DENIED)),
    c('unordered_status_refused', `SELECT public.unordered_tournament_payment_status(${lit(fresh)}::uuid, 'MERCADO_PAGO', 'test', 'approved', 'approved', NULL, '1')`, DENIED),
    c('unordered_reversal_refused', `SELECT public.unordered_tournament_payment_reversal(${lit(fresh)}::uuid, 'MERCADO_PAGO', 'test', 'refund', 'refunded', NULL, '1')`, DENIED),
    c('order_function_refused', `SELECT public.order_verified_tournament_payment(${lit(fresh)}::uuid, 'MERCADO_PAGO', 'test', 'status', 'approved', 'approved', NULL, '1', now())`, DENIED),
    c('activation_refused', `SELECT public.activate_verified_tournament_purchase(${lit(fresh)}::uuid, 'MERCADO_PAGO', 'test', 'approved')`, DENIED),
    c('baseline_reversal_refused', `SELECT public.apply_tournament_purchase_reversal(${lit(fresh)}::uuid, 'refund', 'payments test probe')`, DENIED),
    c('client_checkout_refused', `SELECT public.create_tournament_season_checkout_purchase(${lit(fresh)}::uuid, ${lit(fresh)}::uuid, ${lit(fresh)}::uuid)`, DENIED),
    c('private_schema_refused', 'SELECT private.current_identity_id()', DENIED),
    c('seven_arg_signature_gone', `SELECT public.apply_verified_tournament_payment_status(${lit(fresh)}::uuid, 'MERCADO_PAGO', 'test', 'approved', 'approved', NULL, '1')`, '42883'),
    c('create_function_refused', 'CREATE FUNCTION public.torneos_payments_probe_refused() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$', DENIED),
  ];
  return { before, own, fresh };
}
export function loginProbeScript(checks) {
  let i = 0;
  const lines = [...HEAD, 'BEGIN;', "SET LOCAL statement_timeout = '15s';"];
  for (const c of [...checks.before, ...checks.own]) lines.push(...stmt(c.name, c.sql, i++, c.keep));
  lines.push('ROLLBACK;', "\\echo 'Z|done'", '');
  return lines.join('\n');
}
export function evaluateLoginProbe(checks, stdout) {
  const p = parse(stdout); const failures = []; const results = [];
  if (!p.done) failures.push('probe_incomplete');
  if (!whoamiOk(p.whoami)) failures.push('session_identity_not_the_payments_login');
  for (const c of [...checks.before, ...checks.own]) {
    const r = p.errors[c.name];
    if (!r) { failures.push(`missing_${c.name}`); continue; }
    results.push({ name: c.name, sqlstate: r.sqlstate, message: r.message, expect: c.expect });
    const ok = c.expect === 'NOT_42501' ? r.sqlstate !== DENIED : c.expect === 'NOT_OK' ? r.sqlstate !== OK : r.sqlstate === c.expect;
    if (!ok) failures.push(`${c.name}_sqlstate_${r.sqlstate}_want_${c.expect}`);
    else if (c.message && r.message !== c.message) failures.push(`${c.name}_message_not_${c.message}`);
  }
  return { pass: failures.length === 0, whoami: p.whoami, results, failures };
}

// ─────────────────────────── ORD: provider ordering / watermark on the hosted functions, rolled back ───────────────────────────
const stamp = (n) => `2026-09-20T00:00:${String(n).padStart(2, '0')}.000-03:00`;
const REVERSAL = { disputed: ['chargeback_disputed', 'charged_back', null], restored: ['chargeback_restored', 'charged_back', 'reimbursed'],
  settled: ['chargeback_buyer_won', 'charged_back', 'settled'], refunded: ['refund', 'refunded', null] };
/**
 * [label, steps, expected final status, expected last-step outcome]. Steps: [state, provider second, payment slot].
 * The first row is the historical bug that produced 0003: approved → dispute → restored → the OLD dispute arrives last.
 */
export const ORDERING_CASES = Object.freeze([
  ['restored-then-old-dispute', [['approved', 1], ['disputed', 2], ['restored', 3], ['disputed', 2]], 'approved', 'stale_ignored'],
  ['restored-then-old-approved', [['approved', 1], ['disputed', 2], ['restored', 3], ['approved', 1]], 'approved', 'stale_ignored'],
  ['disputed-then-old-approved', [['approved', 1], ['disputed', 2], ['approved', 1]], 'charged_back', 'stale_ignored'],
  ['approved-then-old-pending', [['approved', 3], ['pending', 1]], 'approved', 'stale_ignored'],
  ['approved-then-old-rejected', [['approved', 3], ['rejected', 1]], 'approved', 'stale_ignored'],
  ['refunded-then-old-approved', [['approved', 1], ['refunded', 3], ['approved', 1]], 'refunded', 'stale_ignored'],
  ['refunded-then-old-dispute', [['approved', 1], ['refunded', 3], ['disputed', 2]], 'refunded', 'stale_ignored'],
  ['settled-then-old-restore', [['approved', 1], ['disputed', 2], ['settled', 4], ['restored', 3]], 'charged_back', 'stale_ignored'],
  ['duplicate-approved', [['approved', 1], ['approved', 1]], 'approved', 'provider_snapshot_duplicate'],
  ['duplicate-dispute', [['approved', 1], ['disputed', 2], ['disputed', 2]], 'charged_back', 'provider_snapshot_duplicate'],
  ['duplicate-restored', [['approved', 1], ['disputed', 2], ['restored', 3], ['restored', 3]], 'approved', 'provider_snapshot_duplicate'],
  ['duplicate-refund', [['approved', 1], ['refunded', 3], ['refunded', 3]], 'refunded', 'provider_snapshot_duplicate'],
  ['equal-time-conflict', [['approved', 1], ['disputed', 1]], 'approved', 'provider_ordering_anomaly'],
  ['independent-attempts', [['rejected', 9, 'A'], ['approved', 1, 'B']], 'approved', null],
]);
export const ORDERING_REFUSALS = Object.freeze([
  ['not-ready-without-preference', 'no_preference', 'approved', 1, '55000', 'TORNEOS_PURCHASE_NOT_READY'],
  ['null-provider-time', 'preference', 'approved', null, '22023', 'TORNEOS_PROVIDER_ORDERING_REQUIRED'],
  ['infinite-provider-time', 'preference', 'approved', 'infinity', '22023', 'TORNEOS_PROVIDER_ORDERING_REQUIRED'],
  ['live-environment', 'preference_live', 'approved', 1, '22023', 'TORNEOS_PROVIDER_INVALID'],
  ['unknown-purchase', 'unknown', 'approved', 1, '22023', 'TORNEOS_PURCHASE_INVALID'],
]);
function applyCall(pid, state, time, payment, env = 'test') {
  const t = time === null ? 'NULL' : time === 'infinity' ? "'infinity'" : lit(stamp(time));
  if (REVERSAL[state]) { const [action, status, detail] = REVERSAL[state]; return `public.apply_verified_tournament_payment_reversal(${lit(pid)}::uuid, 'MERCADO_PAGO', ${lit(env)}, ${lit(action)}, ${lit(status)}, ${lit(detail)}, ${lit(payment)}, ${t}::timestamptz)`; }
  return `public.apply_verified_tournament_payment_status(${lit(pid)}::uuid, 'MERCADO_PAGO', ${lit(env)}, ${lit(state)}, ${lit(state)}, NULL, ${lit(payment)}, ${t}::timestamptz)`;
}
/** A synthetic provider payment id that cannot collide with a Mercado Pago id (19 digits, 99-prefixed). Never committed. */
const syntheticPayment = () => `99${crypto.randomInt(10 ** 8, 10 ** 9 - 1)}${crypto.randomInt(10 ** 8, 10 ** 9 - 1)}`;
export function orderingScript({ purchaseId }) {
  const ref = `arma2:season:purchase:${purchaseId}`;
  const lookup = `public.get_provider_tournament_purchase(${lit(ref)}, 'MERCADO_PAGO', 'test')`;
  const lines = [...HEAD];
  let i = 0;
  lines.push('BEGIN;', `SET LOCAL ROLE ${PAYMENT_ROLE};`, `SELECT 'R|initial|' || ${lookup}::text;`, 'ROLLBACK;');
  const open = () => lines.push('BEGIN;', "SET LOCAL statement_timeout = '15s';", `SET LOCAL ROLE ${PAYMENT_ROLE};`);
  const record = (tag) => lines.push(...stmt(`${tag}:pref`, `SELECT 'R|${tag}:pref|' || public.record_tournament_purchase_preference(${lit(purchaseId)}::uuid, 'MERCADO_PAGO', 'test', ${lit(`qa-ordering-${tag}`)}, now() + interval '30 minutes')::text`, i++, true));
  for (const [label, steps] of ORDERING_CASES) {
    const slots = {};
    open(); record(label);
    steps.forEach(([state, n, slot = 'X'], k) => {
      slots[slot] ??= syntheticPayment();
      lines.push(`SELECT 'R|${label}:before${k}|' || ${lookup}::text;`);
      lines.push(...stmt(`${label}:${k}`, `SELECT 'R|${label}:${k}|' || ${applyCall(purchaseId, state, n, slots[slot])}::text`, i++, true));
    });
    lines.push(`SELECT 'R|${label}:final|' || ${lookup}::text;`, 'ROLLBACK;');
  }
  for (const [label, setup, state, n] of ORDERING_REFUSALS) {
    open();
    if (setup !== 'no_preference' && setup !== 'unknown') record(label);
    const pid = setup === 'unknown' ? crypto.randomUUID() : purchaseId;
    lines.push(...stmt(`${label}:0`, `SELECT 'R|${label}:0|' || ${applyCall(pid, state, n, syntheticPayment(), setup === 'preference_live' ? 'live' : 'test')}::text`, i++, false));
    lines.push('ROLLBACK;');
  }
  lines.push('BEGIN;', `SET LOCAL ROLE ${PAYMENT_ROLE};`, `SELECT 'R|after|' || ${lookup}::text;`, 'ROLLBACK;', "\\echo 'Z|done'", '');
  return lines.join('\n');
}
const pick = (r) => (r && typeof r === 'object' ? { status: r.status ?? null, outcome: r.outcome ?? null, stateChanged: r.stateChanged ?? null, idempotentReplay: r.idempotentReplay ?? null,
  requiresManualRefund: r.requiresManualRefund ?? null, requiresManualReview: r.requiresManualReview ?? null } : null);
export function evaluateOrdering(stdout) {
  const p = parse(stdout); const failures = []; const cases = [];
  if (!p.done) failures.push('probe_incomplete');
  if (!whoamiOk(p.whoami)) failures.push('session_identity_not_the_payments_login');
  const initial = p.rows.initial; const after = p.rows.after;
  if (!initial || initial.status !== 'created' || initial.providerPreferenceId !== null) failures.push('qa_purchase_not_created_without_preference');
  if (initial && (initial.provider !== 'MERCADO_PAGO' || initial.providerEnvironment !== 'test' || initial.amount !== 39900 || initial.currency !== 'ARS')) failures.push('qa_purchase_not_mp_test_39900');
  for (const [label, steps, expected, lastOutcome] of ORDERING_CASES) {
    const f = [];
    if (p.errors[`${label}:pref`]?.sqlstate !== OK) f.push(`preference_${p.errors[`${label}:pref`]?.sqlstate ?? 'missing'}`);
    const results = steps.map((s, k) => ({ step: `${s[0]}@${s[1]}${s[2] ? `/${s[2]}` : ''}`, sqlstate: p.errors[`${label}:${k}`]?.sqlstate ?? null, before: p.rows[`${label}:before${k}`]?.status ?? null, result: pick(p.rows[`${label}:${k}`]) }));
    for (const r of results) if (r.sqlstate !== OK) f.push(`step_${r.step}_${r.sqlstate}`);
    const last = results.at(-1);
    const final = p.rows[`${label}:final`]?.status ?? null;
    if (final !== expected) f.push(`final_${final}_want_${expected}`);
    if (lastOutcome) {
      if (last.result?.outcome !== lastOutcome) f.push(`last_outcome_${last.result?.outcome}_want_${lastOutcome}`);
      if (last.result?.stateChanged !== false) f.push('last_step_changed_state');
      if (last.before !== final) f.push('last_step_moved_the_purchase');
      if (lastOutcome === 'provider_ordering_anomaly' && last.result?.requiresManualReview !== true) f.push('anomaly_without_manual_review');
    }
    cases.push({ label, expected_final: expected, final, expected_last_outcome: lastOutcome, steps: results, pass: f.length === 0, failures: f });
    failures.push(...f.map((x) => `${label}:${x}`));
  }
  for (const [label, , , , sqlstate, message] of ORDERING_REFUSALS) {
    const e = p.errors[`${label}:0`];
    const ok = e?.sqlstate === sqlstate && e?.message === message;
    cases.push({ label, expected: `${sqlstate} ${message}`, got: e ? `${e.sqlstate} ${e.message}` : null, pass: ok });
    if (!ok) failures.push(`${label}:got_${e?.sqlstate}_${e?.message}`);
  }
  if (!after || after.status !== 'created' || after.providerPreferenceId !== null || JSON.stringify(after) !== JSON.stringify(initial)) failures.push('rollback_left_a_trace');
  return { pass: failures.length === 0, whoami: p.whoami, initial: initial ? { status: initial.status, amount: initial.amount, currency: initial.currency, provider: initial.provider, environment: initial.providerEnvironment } : null,
    after_identical_to_initial: !!after && JSON.stringify(after) === JSON.stringify(initial), cases, failures };
}
