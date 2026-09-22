// R4.2 shared helpers. No secret is ever written by this module: every persisted document goes
// through assertNoSecret() against the run's known-secret registry, and evidence files are
// created 0600 with the exclusive flag (never overwritten).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const root = path.dirname(fileURLToPath(import.meta.url));          // …/phase3b/r42
export const phase3b = path.resolve(root, '..');
export const r4 = phase3b + '/r4';
export const evidence = phase3b + '/evidence';
export const repo = path.resolve(phase3b, '../../..');
export const runtime = root + '/.runtime';
export const docker = '/Applications/Docker.app/Contents/Resources/bin/docker';
export const CORE_REF = 'hhyvmhgpapyuzjgxfnqv';
export const PROD_REF = 'rcyuuoaqfwcembdajcss';
export const CORE_ORIGIN = `https://${CORE_REF}.supabase.co`;
export const GATEWAY_ORIGIN = 'http://127.0.0.1:58431';
export const GATEWAY = `${GATEWAY_ORIGIN}/torneos-gateway`;
export const REST_ORIGIN = 'http://127.0.0.1:58430';
export const DB_CONTAINER = 'arma2-torneos-isolated-local-torneos-db-1';
export const REST_CONTAINER = 'arma2-torneos-isolated-local-torneos-rest-1';
export const ISOLATED_NETWORK = 'arma2-torneos-isolated-local_isolated';
export const EDGE_IMAGE = 'sha256:a82676277615aee03c4f288cbbbf68dedb5ba8693073e567ab8dbfdd11ba5d45';
export const ROUTE_IMAGE = 'sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453';
export const NODE_IMAGE_TAG = 'node:22.22.0-bookworm-slim';
export const ISSUER = 'urn:arma2:local:identity-bridge';
export const AUDIENCE = 'arma2-torneos-local';
export const TTL = 120;

export const utc = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z/, 'Z');
export const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
export const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
export const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class Stop extends Error { constructor(code, detail) { super(detail ? `${code}: ${detail}` : code); this.code = code; } }
export const stop = (code, detail) => { throw new Stop(code, detail); };

// ─────────────────────────────── secret registry ───────────────────────────────
const known = [];
export function registerSecret(value) { if (typeof value === 'string' && value.length >= 8 && !known.includes(value)) known.push(value); }
export function knownCount() { return known.length; }
export function redact(text) { let out = String(text); for (const s of known) out = out.split(s).join('«REDACTED»'); return out; }
export function containsSecret(text) { const t = String(text); return known.find((s) => t.includes(s)) !== undefined; }
export function assertNoSecret(text, where = 'output') { if (containsSecret(text)) throw new Stop('SECRET_IN_' + where.toUpperCase()); return text; }
export function forget() { known.length = 0; }

// ─────────────────────────────── processes ───────────────────────────────
export function call(bin, args, {input, ok = false, timeout = 60000, env} = {}) {
  const r = spawnSync(bin, args, {input, encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024,
    env: env ?? {PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: '1'}});
  if (!ok && (r.status !== 0 || r.error)) {
    throw new Stop('COMMAND_FAILED', `${path.basename(bin)} ${args.slice(0, 2).join(' ')} status=${r.status ?? 'timeout'} ${redact((r.stderr ?? '')).slice(-600)}`);
  }
  return r;
}
export const d = (args, opts) => call(docker, args, opts);
/** Same contract as call() (env, timeout, SIGKILL, COMMAND_FAILED) but the child never blocks the
 * operator event loop: pooled keep-alive sockets keep receiving their peer's close while it runs. */
export function callAsync(bin, args, {input, ok = false, timeout = 60000, env} = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '', stderr = '', spawnError = null, timedOut = false, settled = false;
    const child = spawn(bin, args, {stdio: ['pipe', 'pipe', 'pipe'], env: env ?? {PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: '1'}});
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    const settle = (status, signal) => {
      if (settled) return; settled = true; clearTimeout(timer);
      const r = {status: timedOut ? null : status, signal, stdout, stderr, error: spawnError ?? (timedOut ? Object.assign(new Error('ETIMEDOUT'), {code: 'ETIMEDOUT'}) : undefined)};
      if (!ok && (r.status !== 0 || r.error)) reject(new Stop('COMMAND_FAILED', `${path.basename(bin)} ${args.slice(0, 2).join(' ')} status=${r.status ?? 'timeout'} ${redact(stderr).slice(-600)}`));
      else resolve(r);
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => { stdout += c; }); child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (e) => { spawnError = e; settle(null, null); });
    child.on('close', settle);
    child.stdin.on('error', () => {});
    child.stdin.end(input === undefined ? undefined : input);
  });
}
export const dAsync = (args, opts) => callAsync(docker, args, opts);
export const inspect = (name) => JSON.parse(d(['inspect', name]).stdout)[0];
export function inspectTry(name) { const r = d(['inspect', name], {ok: true}); return r.status === 0 ? JSON.parse(r.stdout)[0] : null; }

const PSQL = ['psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'];
/** SQL as supabase_admin through the R2 container socket (stdin, never argv). */
export function psqlTry(query) {
  const r = d(['exec', '-i', DB_CONTAINER, ...PSQL], {input: query, ok: true});
  const filtered = (r.stderr ?? '').split('\n').filter((l) => /^(ERROR|psql|DETAIL):/.test(l)).join('\n');
  return {ok: r.status === 0, out: r.stdout ?? '', error: r.status === 0 ? null : (filtered || `status=${r.status ?? 'signal'} ${(r.stderr ?? '').slice(-300)}`)};
}
export function psql(query) { const r = psqlTry(query); if (!r.ok) throw new Stop('SQL_FAILED', r.error); return r.out; }
export const sqlOne = (query) => psql(query).trim().split('\n').pop();
/** SQL as a client role with bridge claims (server position), same shape as the Phase 2D lab. */
export function asRole(role, claims, query) {
  return psqlTry(`BEGIN; SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claims', ${lit(JSON.stringify(claims))}, true); ${query}; COMMIT;`);
}

// Same query audit.mjs uses for its R2 baseline (roles, functions+ACL+source, tables+ACL+RLS, policies, FDW count).
export const CATALOG_SQL = `BEGIN READ ONLY;
 SELECT json_build_object('roles',(SELECT json_agg(r ORDER BY rolname) FROM (SELECT rolname,rolsuper,rolinherit,rolcanlogin,rolbypassrls FROM pg_roles)r),'functions',(SELECT json_agg(r ORDER BY oid) FROM (SELECT oid,proname,proacl,prosrc FROM pg_proc WHERE pronamespace IN (SELECT oid FROM pg_namespace WHERE nspname IN ('public','private')))r),'tables',(SELECT json_agg(r ORDER BY oid) FROM (SELECT oid,relname,relacl,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace IN (SELECT oid FROM pg_namespace WHERE nspname IN ('public','private')))r),'policies',(SELECT json_agg(p ORDER BY schemaname,tablename,policyname) FROM pg_policies p),'foreign_servers',(SELECT count(*) FROM pg_foreign_server));
 COMMIT;
`;
export function catalogSHA256() {
  return sha(d(['exec', DB_CONTAINER, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-c', CATALOG_SQL]).stdout);
}
/** Exact row count of every ordinary table in public/private, keyed schema.table. */
export function tableCounts() {
  const out = psql(`SELECT n.nspname||'.'||c.relname||'|'||(xpath('/row/c/text()', query_to_xml('select count(*) as c from '||quote_ident(n.nspname)||'.'||quote_ident(c.relname), false, true, '')))[1]::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN ('public','private') ORDER BY 1;`);
  const counts = {};
  for (const line of out.trim().split('\n').filter(Boolean)) { const [name, n] = line.split('|'); counts[name] = Number(n); }
  return counts;
}
export function r2Snapshot() {
  const a = inspect(DB_CONTAINER), b = inspect(REST_CONTAINER);
  return {db: {id: a.Id, image: a.Image, started: a.State.StartedAt, health: a.State.Health?.Status, running: a.State.Running, networks: a.NetworkSettings.Networks, mounts: a.Mounts},
    rest: {id: b.Id, image: b.Image, started: b.State.StartedAt, running: b.State.Running, networks: b.NetworkSettings.Networks},
    catalogSHA256: catalogSHA256(),
    ringSHA256: sha(fs.readFileSync(repo + '/integration/torneos-isolated-local/.runtime/config.json')),
    jwksSHA256: sha(fs.readFileSync(repo + '/integration/torneos-isolated-local/.runtime/public/jwks.json'))};
}

// ─────────────────────────────── RS256 bridge tokens (node:crypto only) ───────────────────────────────
export const b64u = (s) => Buffer.from(s).toString('base64url');
export function signJWT(key, claims, header = {}) {
  const h = b64u(JSON.stringify({alg: 'RS256', typ: 'JWT', kid: key.kid, ...header}));
  const p = b64u(JSON.stringify(claims));
  if (header.alg === 'none') return `${h}.${p}.`;
  const sig = crypto.createSign('RSA-SHA256').update(`${h}.${p}`).sign(crypto.createPrivateKey(key.privateKey));
  return `${h}.${p}.${Buffer.from(sig).toString('base64url')}`;
}
/** A bridge bearer with the certified claim contract; overrides/deletions produce the negative cases. */
export function bridgeToken(key, {sub, coreUserId, sessionId}, overrides = {}, header = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {core_user_id: coreUserId, session_id: sessionId, role: 'authenticated', iss: ISSUER, aud: AUDIENCE, sub,
    iat: now, nbf: now, exp: now + TTL, jti: crypto.randomUUID(), ...overrides};
  for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete claims[k];
  const token = signJWT(key, claims, header);
  registerSecret(token);
  return token;
}
export function decodeJwt(token) { try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')); } catch { return null; } }
export function decodeHeader(token) { try { return JSON.parse(Buffer.from(String(token).split('.')[0], 'base64url').toString('utf8')); } catch { return null; } }

/** Negative token variants, each expected to be refused (401) by the gateway. Pure; unit-tested. */
export function tokenVariants(ring, identity) {
  const k1 = ring.keys.find((k) => k.kid === ring.activeKid);
  const k2 = ring.keys.find((k) => k.kid !== ring.activeKid);
  const now = Math.floor(Date.now() / 1000);
  const v = [
    ['wrong_issuer', () => bridgeToken(k1, identity, {iss: 'urn:arma2:staging:identity-bridge'})],
    ['wrong_audience', () => bridgeToken(k1, identity, {aud: 'arma2-torneos-staging'})],
    ['unknown_kid', () => bridgeToken(k1, identity, {}, {kid: 'p3b-k9'})],
    ['standby_kid_p3b_k2', () => bridgeToken(k2, identity, {}, {kid: k2.kid})],
    ['expired', () => bridgeToken(k1, identity, {iat: now - 400, nbf: now - 400, exp: now - 280})],
    ['ttl_121', () => bridgeToken(k1, identity, {exp: now + 121})],
    ['ttl_60', () => bridgeToken(k1, identity, {exp: now + 60})],
    ['nbf_not_iat', () => bridgeToken(k1, identity, {nbf: now - 10})],
    ['iat_future', () => bridgeToken(k1, identity, {iat: now + 60, nbf: now + 60, exp: now + 180})],
    ['role_service_role', () => bridgeToken(k1, identity, {role: 'service_role'})],
    ['role_anon', () => bridgeToken(k1, identity, {role: 'anon'})],
    ['alg_none', () => bridgeToken(k1, identity, {}, {alg: 'none'})],
    ['typ_not_jwt', () => bridgeToken(k1, identity, {}, {typ: 'JWS'})],
    ['sub_not_uuid', () => bridgeToken(k1, identity, {sub: 'owner'})],
    ['core_user_id_not_uuid', () => bridgeToken(k1, identity, {core_user_id: '1'})],
    ['session_id_not_uuid', () => bridgeToken(k1, identity, {session_id: 'session'})],
    ['jti_missing', () => bridgeToken(k1, identity, {jti: undefined})],
    ['session_id_missing', () => bridgeToken(k1, identity, {session_id: undefined})],
    ['core_user_id_missing', () => bridgeToken(k1, identity, {core_user_id: undefined})],
    ['garbage', () => 'not.a.jwt'],
    ['empty', () => ''],
  ];
  return v.map(([name, make]) => ({name, token: make()}));
}

// ─────────────────────────────── guarded HTTP ───────────────────────────────
/** fetch confined to the run's three origins; redirects are always an error. */
export function guardedFetch(allowedOrigins) {
  const allowed = new Set(allowedOrigins);
  return async function (url, init = {}) {
    const u = new URL(url);
    if (!allowed.has(u.origin)) throw new Stop('EGRESS_GUARD', u.origin);
    if (u.hostname.split('.').includes(PROD_REF)) throw new Stop('PRODUCTION_REFUSED');
    let r;
    try { r = await fetch(u, {...init, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(20000)}); }
    catch (e) {
      // No response is not a synthetic HTTP 503. Keep safe transport diagnostics, never request headers.
      throw new Stop('HTTP_TRANSPORT_FAILED', JSON.stringify({origin:u.origin,path:u.pathname,httpResponse:false,
        name:e.name,message:e.message,causeCode:e.cause?.code,causeName:e.cause?.name,causeMessage:e.cause?.message}));
    }
    const text = await r.text();
    let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return {status: r.status, headers: Object.fromEntries(r.headers.entries()), body};
  };
}

// ─────────────────────────────── evidence ───────────────────────────────
export function writeEvidence(kind, doc, stamp) {
  fs.mkdirSync(evidence, {recursive: true});
  const p = `${evidence}/${kind}-${stamp ?? utc()}.json`;
  const text = JSON.stringify(doc, null, 2) + '\n';
  assertNoSecret(text, 'evidence');
  if (text.includes(`"ref":"${PROD_REF}"`) || text.includes(`${PROD_REF}.supabase.co/`)) throw new Stop('EVIDENCE_NAMES_PRODUCTION_TARGET');
  fs.writeFileSync(p, text, {mode: 0o600, flag: 'wx'});
  return p;
}
export const fileSHA = (p) => sha(fs.readFileSync(p));
export const artifact = (p) => ({path: path.relative(evidence, p), sha256: fileSHA(p)});
export function log(line) { process.stdout.write(redact(`[r42 ${new Date().toISOString().slice(11, 19)}] ${line}`) + '\n'); }
