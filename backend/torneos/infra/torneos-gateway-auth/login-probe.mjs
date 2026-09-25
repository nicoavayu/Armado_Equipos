// GATEWAY/AUTH — --db-certify login probe: each torneos_edge_* login really authenticates (SCRAM) through the Supavisor
// pooler of Arma2 Torneos, on the session port 5432 AND the transaction port 6543, sslmode=verify-full with the Supabase
// CA, with its Keychain password — and inside the session it can do exactly what the gateway does and nothing else.
//
// Every probe runs inside transactions that END IN ROLLBACK (the allowed writes are the gateway's own statements, never
// committed); the last block re-reads in a fresh transaction that nothing survived. Each check is one statement followed
// by `\echo` of psql's :SQLSTATE (and :LAST_ERROR_MESSAGE when the message is part of the contract), so the verdict is the
// server's own answer, not a parsed error string. The password reaches psql only as PGPASSWORD of a minimal env.
import crypto from 'node:crypto';
import { spawn as realSpawn } from 'node:child_process';
import { TORNEOS_REF, EDGE_LOGINS, BRIDGE } from './gateway-auth-contract.mjs';
import { PSQL_BIN, CA_CERT, POOLER_HOST_PATTERN } from './psql-gateway-auth.mjs';

export const PROBE_PORTS = Object.freeze([5432, 6543]);
const TIMEOUT_MS = 60 * 1000;
const OK = '00000';
const DENIED = '42501';
const FORBIDDEN_TARGETS = Object.freeze(['postgres', 'service_role', 'authenticated', 'anon', 'authenticator', 'torneos_payment_service', 'supabase_admin']);

export function loginEnv({ host, port, login, password }) {
  if (!POOLER_HOST_PATTERN.test(host)) throw new Error('pooler_host_not_sa_east_1');
  if (!PROBE_PORTS.includes(port)) throw new Error('pooler_port_not_pinned');
  if (!EDGE_LOGINS.some((l) => l.login === login)) throw new Error('login_not_pinned');
  return {
    PATH: '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', LANG: 'C', PGHOST: host, PGPORT: String(port), PGUSER: `${login}.${TORNEOS_REF}`, PGDATABASE: 'postgres',
    PGSSLMODE: 'verify-full', PGSSLROOTCERT: CA_CERT, PGCONNECT_TIMEOUT: '20', PGAPPNAME: 'arma2-torneos-gateway-auth-db-certify', PGPASSWORD: password,
  };
}

// keep: the statement's effect must persist in the transaction (SET LOCAL ROLE, set_config(…, true), the upsert the next
// checks read): on success its savepoint is RELEASED, on error rolled back (the next checks then fail, fail closed).
// Assertions fail with a RUNTIME cast error (22P02) of a non-constant value: `ELSE 1/0` is constant-folded by the planner
// and raises even when the condition holds (measured in the 2026-09-25 rehearsal).
const check = (name, sql, expect, { message = null, keep = false } = {}) => ({ name, sql, expect, message, keep });
const claimsFor = ({ sub, coreUserId, now }) => JSON.stringify({ role: 'authenticated', iss: BRIDGE.issuer, aud: BRIDGE.audience, sub, core_user_id: coreUserId,
  session_id: crypto.randomUUID(), jti: crypto.randomUUID(), iat: now, nbf: now, exp: now + BRIDGE.ttl });

/** The checks for one login. `fresh` = random UUIDs that exist nowhere (so every insert is new and every lookup misses). */
export function loginChecks(login, { fresh = { coreUserId: crypto.randomUUID(), identity: crypto.randomUUID() }, now = Math.floor(Date.now() / 1000) } = {}) {
  const own = EDGE_LOGINS.find((l) => l.login === login)?.memberOf;
  if (!own) throw new Error('login_not_pinned');
  const other = EDGE_LOGINS.find((l) => l.login !== login).memberOf;
  const before = [
    check('noinherit_no_table_before_set_role', 'SELECT count(*) FROM public.torneos_identity', DENIED),
    check('noinherit_no_private_before_set_role', "SELECT private.authorize_core_contract('verified_email', '{}'::jsonb)", DENIED),
    ...[other, ...FORBIDDEN_TARGETS].map((r) => check(`set_role_refused_${r}`, `SET LOCAL ROLE ${r}`, DENIED)),
    check('create_table_refused', 'CREATE TABLE public.torneos_gateway_probe_refused (x int)', DENIED),
    check('create_role_refused', 'CREATE ROLE torneos_gateway_probe_refused', DENIED),
  ];
  const common = [
    check('set_role_own', `SET LOCAL ROLE ${own}`, OK, { keep: true }),
    check('current_user_is_own', `SELECT CASE WHEN current_user = '${own}' THEN 1 ELSE (current_user::text)::int END`, OK),
    check('set_role_other_refused_after_own', `SET LOCAL ROLE ${other}`, DENIED),
  ];
  const specific = login === 'torneos_edge_identity_writer' ? [
    // exactly the gateway's allocateIdentity / identityExists (db.ts), then what the role must NOT do
    check('allowed_identity_upsert', `INSERT INTO public.torneos_identity(core_user_id) VALUES ('${fresh.coreUserId}') ON CONFLICT(core_user_id) DO UPDATE SET core_user_id = EXCLUDED.core_user_id RETURNING id`, OK, { keep: true }),
    check('allowed_identity_read_back', `SELECT CASE WHEN count(*) = 1 THEN 1 ELSE ('count=' || count(*))::int END FROM public.torneos_identity WHERE core_user_id = '${fresh.coreUserId}'`, OK),
    check('identity_mapping_immutable', `UPDATE public.torneos_identity SET core_user_id = '${crypto.randomUUID()}' WHERE core_user_id = '${fresh.coreUserId}'`, '23514', { message: 'TORNEOS_IDENTITY_MAPPING_IMMUTABLE' }),
    check('identity_delete_refused', `DELETE FROM public.torneos_identity WHERE core_user_id = '${fresh.coreUserId}'`, DENIED),
    check('identity_id_update_refused', `UPDATE public.torneos_identity SET id = id WHERE core_user_id = '${fresh.coreUserId}'`, DENIED),
    check('other_public_table_refused', 'SELECT 1 FROM public.tournament_competition_formats LIMIT 1', DENIED),
    check('private_schema_refused', 'SELECT 1 FROM private.core_contract_attestations LIMIT 1', DENIED),
    check('adapter_function_refused', "SELECT private.authorize_core_contract('verified_email', '{}'::jsonb)", DENIED),
  ] : [
    // exactly the gateway's Adapter (adapter.ts): authorize → identity gate; attest → INSERT-only
    check('gate_without_claims', "SELECT private.authorize_core_contract('verified_email', '{}'::jsonb)", DENIED, { message: 'TORNEOS_AUTH_REQUIRED' }),
    check('set_forged_bridge_claims', `SELECT set_config('request.jwt.claims', '${claimsFor({ sub: fresh.identity, coreUserId: fresh.coreUserId, now })}', true)`, OK, { keep: true }),
    check('gate_unknown_identity', "SELECT private.authorize_core_contract('verified_email', '{}'::jsonb)", DENIED, { message: 'TORNEOS_AUTH_REQUIRED' }),
    check('attest_insert_reaches_constraints', `INSERT INTO private.core_contract_attestations (identity_id, session_id, contract, request_hash, response, observed_at) VALUES ('${fresh.identity}', '${crypto.randomUUID()}', 'verified_email', '${'0'.repeat(64)}', '{}'::jsonb, now())`, '23503'),
    check('attest_read_refused', 'SELECT 1 FROM private.core_contract_attestations LIMIT 1', DENIED),
    check('attest_delete_refused', 'DELETE FROM private.core_contract_attestations', DENIED),
    check('identity_table_refused', 'SELECT 1 FROM public.torneos_identity LIMIT 1', DENIED),
    check('identity_insert_refused', `INSERT INTO public.torneos_identity(core_user_id) VALUES ('${fresh.coreUserId}')`, DENIED),
    check('other_public_table_refused', 'SELECT 1 FROM public.tournament_competition_formats LIMIT 1', DENIED),
  ];
  const after = [
    // a FRESH transaction: nothing from the rolled-back block survived
    check('rollback_left_nothing', `SELECT CASE WHEN s.n = 0 THEN 1 ELSE ('count=' || s.n)::int END FROM (SELECT count(*) AS n FROM public.torneos_identity WHERE core_user_id = '${fresh.coreUserId}') s`, OK),
  ];
  return { own, before, common, specific, after, fresh };
}

const q = (s) => s.replace(/\n/g, ' ');
const stmt = (c, i) => [`SAVEPOINT p${i};`, `${q(c.sql)};`, `\\echo 'R|${c.name}|' :SQLSTATE '|' :LAST_ERROR_MESSAGE`,
  ...(c.keep ? ['\\if :ERROR', `ROLLBACK TO SAVEPOINT p${i};`, '\\else', `RELEASE SAVEPOINT p${i};`, '\\endif'] : [`ROLLBACK TO SAVEPOINT p${i};`])];

/** The psql script (stdin) for one login. Two transactions, both ROLLBACK; the read-back runs as the own role. */
export function loginProbeScript(checks) {
  let i = 0;
  const lines = ['\\set ON_ERROR_STOP 0', '\\set QUIET 1', "SELECT 'W|' || session_user || '|' || current_user || '|' || (SELECT count(*) FROM pg_roles WHERE rolname = current_user AND rolcanlogin AND NOT rolinherit);",
    'BEGIN;', "SET LOCAL statement_timeout = '15s';"];
  for (const c of [...checks.before, ...checks.common, ...checks.specific]) lines.push(...stmt(c, i++));
  lines.push('ROLLBACK;', 'BEGIN;', "SET LOCAL statement_timeout = '15s';", `SET LOCAL ROLE ${checks.own === 'torneos_identity_writer' ? 'torneos_identity_writer' : 'torneos_core_adapter'};`);
  if (checks.own === 'torneos_identity_writer') for (const c of checks.after) lines.push(...stmt(c, i++));
  lines.push('ROLLBACK;', "\\echo 'E|done'", '');
  return lines.join('\n');
}

/** Parses the probe output against the checks; returns { pass, whoami, results[], failures[] } (no secrets in it). */
export function evaluateLoginProbe(login, checks, stdout) {
  const results = []; const failures = []; let whoami = null; let done = false;
  for (const line of String(stdout).split('\n')) {
    if (line.startsWith('W|')) { const [, session, current, noinherit] = line.split('|'); whoami = { session_user: session, current_user: current, login_noinherit: noinherit === '1' }; }
    if (line.startsWith('E|done')) done = true;
    const m = /^R\|([a-z0-9_]+)\| (\S+) \|\s?(.*)$/.exec(line);
    if (m) results.push({ name: m[1], sqlstate: m[2], message: m[2] === OK ? null : m[3].slice(0, 120) });
  }
  const want = [...checks.before, ...checks.common, ...checks.specific, ...(checks.own === 'torneos_identity_writer' ? checks.after : [])];
  if (!done) failures.push('probe_incomplete');
  if (!whoami || whoami.session_user !== login || whoami.current_user !== login || !whoami.login_noinherit) failures.push('session_identity_not_the_login');
  for (const c of want) {
    const r = results.find((x) => x.name === c.name);
    if (!r) { failures.push(`missing_${c.name}`); continue; }
    if (r.sqlstate !== c.expect) failures.push(`${c.name}_sqlstate_${r.sqlstate}_want_${c.expect}`);
    else if (c.message && r.message !== c.message) failures.push(`${c.name}_message_not_${c.message}`);
  }
  if (results.length !== want.length) failures.push(`unexpected_result_count_${results.length}_want_${want.length}`);
  return { pass: failures.length === 0, whoami, results: results.map((r) => ({ ...r, expect: want.find((c) => c.name === r.name)?.expect ?? null })), failures };
}

/** Runs one probe; resolves { code, stdout, stderr_tail } (never rejects). */
export function runPsqlProbe({ script, env, redact, spawn = realSpawn }) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(PSQL_BIN, ['-X', '--no-psqlrc', '-q', '-A', '-t', '-f', '-'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (c) => { out = (out + c.toString('utf8')).slice(-64000); });
    child.stderr.on('data', (c) => { err = (err + c.toString('utf8')).slice(-8000); });
    const timer = setTimeout(() => child.kill('SIGTERM'), TIMEOUT_MS);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, elapsed_ms: Date.now() - started, stdout: '', stderr_tail: redact(`spawn_error ${e.message}`) }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, elapsed_ms: Date.now() - started, stdout: out, stderr_tail: redact(err.split('\n').filter((l) => /FATAL|could not|SSL|certificate|password|timeout/i.test(l)).slice(-4).join('\n')) }); });
    child.stdin.end(script);
  });
}

/** Both logins × both pooler ports. `password(login)` reads the custody; nothing it returns is kept. */
export async function probeEdgeLogins({ host, password, redact, run = runPsqlProbe, ports = PROBE_PORTS }) {
  const out = [];
  for (const { login } of EDGE_LOGINS) {
    for (const port of ports) {
      const checks = loginChecks(login);
      const r = await run({ script: loginProbeScript(checks), env: loginEnv({ host, port, login, password: password(login) }), redact });
      const ev = evaluateLoginProbe(login, checks, r.stdout);
      if (r.code !== 0 && !ev.failures.includes('probe_incomplete')) ev.failures.push(`psql_exit_${r.code}`);
      out.push({ login, port, pool_mode: port === 5432 ? 'session' : 'transaction', sslmode: 'verify-full', auth: 'password → SCRAM-SHA-256 verifier (server holds the verifier only)',
        psql_exit: r.code, elapsed_ms: r.elapsed_ms, stderr_tail: ev.pass ? null : r.stderr_tail, pass: ev.pass && r.code === 0, whoami: ev.whoami, results: ev.results, failures: ev.failures });
    }
  }
  return { pass: out.length === EDGE_LOGINS.length * ports.length && out.every((x) => x.pass), runs: out };
}
