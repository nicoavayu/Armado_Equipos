#!/usr/bin/env node
// Phase 3B — R2 LOCAL certification of the isolated Torneos stack (integration/torneos-isolated-local).
//   A. catalog        — the SHARED verification contract (same SQL + same expect as the remote runner)
//   B. equivalence    — phase2c/acl-inventory.sql on the live stack vs the certified Phase 2D
//                       after-real inventory through the Phase 2C `api_view` (0 mismatches / 479)
//   C. data API       — real PostgREST on 127.0.0.1:58430: 33 gated RPCs denied to anon and to a valid
//                       RS256 identity bearer (42501 before the body), P0 reaches its body, forged
//                       bearers 401 (PT401 from private.check_token), torneos_identity protected,
//                       staging v1 allowlist ⊆ authenticated EXECUTE and disjoint from the gate
//   D. isolation      — no Core service resolvable, no egress, no network extensions, no foreign
//                       servers, no FK outside Torneos, no Core monolith / Core contract objects
//   E. evidence       — phase3b/evidence/local-torneos-certify-<UTC>.json (never overwritten)
// Every HTTP request is confined to 127.0.0.1:58430 by a runtime guard; the runner imports none of
// the remote helpers. Any failed check → STOP (exit 1); the evidence is written anyway.
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  CERTIFIED, FILES, PROJECT, REST, STAMP, canonical, config, dc, docker, evaluateExpect, inDb, integrity,
  prepare, promoteEvidence, repo, root, runInfo, secretsKnown, sha256, sql, sqlTry, stop,
} from '../../../../integration/torneos-isolated-local/lab.mjs';
import { bearer } from '../../../../integration/torneos-isolated-local/jwt.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const P0 = 'review_tournament_team_entry';
const GATED_CODE = '42501';
const deniedBeforeBody = (r) => [401, 403].includes(r.status) && r.body?.code === GATED_CODE && /permission denied for function/.test(r.body?.message ?? '');
const deniedTable = (r) => [401, 403].includes(r.status) && r.body?.code === GATED_CODE && /permission denied for table/.test(r.body?.message ?? '');

// ------------------------------------------------------------------ runtime request guard
const REQUESTS = { total: 0, hosts: new Set() };
const rawFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const u = new URL(typeof input === 'string' ? input : input.url);
  if (u.host !== '127.0.0.1:58430' || u.protocol !== 'http:') stop('REMOTE_REQUEST_REFUSED', u.host);
  REQUESTS.total += 1; REQUESTS.hosts.add(u.host);
  return rawFetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(15000) });
};
async function rest(path, { method = 'GET', token, body } = {}) {
  const r = await fetch(`${REST}${path}`, { method, headers: { 'content-type': 'application/json', accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  const text = await r.text(); let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: r.status, body: parsed };
}

// ------------------------------------------------------------------ check harness
const checks = [];
let failures = 0;
async function check(section, name, fn) {
  const row = { section, name, ok: false };
  try { const detail = await fn(); row.ok = true; if (detail !== undefined) row.detail = detail; console.log(`  [ok] ${section} ${name}`); }
  catch (e) { failures += 1; row.error = String(e?.message ?? e).slice(0, 400); console.log(`  [FAIL] ${section} ${name}\n        ${row.error}`); }
  checks.push(row);
  return row;
}
const eq = (a, b, msg) => { if (canonical(a) !== canonical(b)) throw new Error(`${msg}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`); };
const ok = (v, msg) => { if (!v) throw new Error(msg); };
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
/** SQL as a LOGIN role over TCP with its password (scram on the container network): the URI travels
 *  on psql's stdin as a \connect meta-command — never argv, never a file, never the host. */
function sqlAsLogin(user, password, query) {
  return sqlTry(`\\connect "postgres://${user}:${password}@torneos-db:5432/postgres"\n${query}`);
}
function nullArgs(argString) {
  const args = {};
  for (const part of argString.split(',').map((s) => s.trim()).filter(Boolean)) args[part.split(/\s+/)[0]] = null;
  return args;
}
function composePs() {
  const out = dc(['ps', '-a', '--format', 'json']).trim();
  if (!out) return [];
  return out.startsWith('[') ? JSON.parse(out) : out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function main() {
  const c = await prepare();
  const run = await runInfo();
  ok(run?.stamp, 'no .runtime/run.json: run `lab.mjs up` first');
  const integ = await integrity();
  const activeKey = c.keys.find((k) => k.kid === c.activeKid);
  const standbyKey = c.keys.find((k) => k.kid !== c.activeKid);
  const expectDoc = integ.expect;
  const gated = integ.gated_names;
  const allowlistDoc = JSON.parse(await readFile(FILES.allowlist, 'utf8'));
  const allowlist = [...new Set(Object.values(allowlistDoc.features).flat())];
  const evidence = { checks, catalog: null, equivalence: null, data_api: {}, isolation: {} };
  console.log(`Phase 3B R2-local certify — project ${PROJECT}, bootstrap run ${run.stamp}, REST ${REST}`);

  // ================================================================ A. catalog (shared contract)
  let verification;
  await check('A', 'catalog matches the shared expect document (same SQL + same 16 expectations as the remote runner)', async () => {
    verification = JSON.parse(sql(integ.verify_sql));
    const rows = evaluateExpect(expectDoc, verification);
    const bad = rows.filter((r) => !r.ok);
    evidence.catalog = { verify_sql_sha256: integ.verify_sql_sha256, expect_sha256: integ.expect_sha256, verification, expectations: rows, catalog_hash: sha256(canonical(verification)) };
    ok(rows.length === 16, `${rows.length} expectations`);
    ok(!bad.length, bad.map((b) => `${b.key}=${b.got}≠${b.expected}`).join('; '));
    return { passed: `${rows.length - bad.length}/${rows.length}`, catalog_hash: evidence.catalog.catalog_hash, server_version: verification.server_version };
  });

  // ================================================================ B. object-by-object equivalence
  let inventory;
  await check('B', 'phase2c/acl-inventory.sql on the live stack ≡ certified Phase 2D after-real (api_view): 0 mismatches / 479 objects', async () => {
    inventory = JSON.parse(sql(await readFile(FILES.aclInventory, 'utf8')));
    const r = spawnSync('python3', [`${HERE}api_view.py`], { input: JSON.stringify({ live: inventory, certified_path: FILES.certifiedAcl }), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    ok(r.status === 0, `api_view bridge failed: ${(r.stderr ?? '').slice(-300)}`);
    const cmp = JSON.parse(r.stdout);
    evidence.equivalence = cmp;
    eq(cmp.compared, 479, 'objects compared'); eq(cmp.mismatches.length, 0, 'mismatches');
    eq(cmp.counts, { functions: 366, sequences: 7, relations: 106 }, 'object counts');
    eq(cmp.live_summary.security_definer_public, 304, 'public SECURITY DEFINER'); eq(cmp.live_summary.security_definer_total, 305, 'total SECURITY DEFINER');
    eq(cmp.live_summary.execute.anon.public_functions, 12, 'anon EXECUTE'); eq(cmp.live_summary.execute.authenticated.public_functions, 147, 'authenticated EXECUTE'); eq(cmp.live_summary.execute.service_role.public_functions, 328, 'service_role EXECUTE');
    eq(cmp.live_summary.sequence_privilege.anon, 0, 'anon sequences'); eq(cmp.live_summary.public_execute_functions, 0, 'PUBLIC EXECUTE'); eq(cmp.live_summary.anon_write_privilege_relations, 0, 'anon write on relations');
    return { compared: cmp.compared, mismatches: 0, api_view_sha256: cmp.live_view_sha256, certified_view_sha256: cmp.certified_view_sha256 };
  });

  // ================================================================ C. data API on 127.0.0.1:58430
  const argsOf = new Map();
  await check('C', 'declared parameters of the 33 gated RPCs and P0 resolved from the live catalog', async () => {
    const rows = JSON.parse(sql(`select json_agg(json_build_object('name', p.proname, 'args', pg_get_function_identity_arguments(p.oid), 'sig', p.oid::regprocedure::text) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${[...gated, P0].map(lit).join(',')})`));
    for (const r of rows) if (!argsOf.has(r.name)) argsOf.set(r.name, r);
    eq(argsOf.size, 34, 'functions resolved'); ok([...argsOf.values()].every((r) => Object.keys(nullArgs(r.args)).length > 0), 'every function has named parameters');
    eq(argsOf.get(P0).sig, `${P0}(uuid,uuid,text,text,jsonb)`, 'P0 signature');
  });
  await check('C', 'anon OpenAPI: PostgREST answers on loopback; none of the 33 gated RPCs is listed for anon', async () => {
    const r = await rest('/');
    eq(r.status, 200, 'GET / as anon');
    const paths = Object.keys(r.body?.paths ?? {});
    const listedGated = gated.filter((n) => paths.includes(`/rpc/${n}`));
    eq(listedGated, [], 'gated RPCs in anon OpenAPI');
    evidence.data_api.anon_openapi = { paths: paths.length, rpc_paths: paths.filter((p) => p.startsWith('/rpc/')).length, gated_listed: listedGated.length };
    return evidence.data_api.anon_openapi;
  });
  const sweep = [];
  async function sweepRole(role, token) {
    for (const n of gated) {
      const args = nullArgs(argsOf.get(n).args);
      const post = await rest(`/rpc/${n}`, { method: 'POST', token, body: args });
      const get = await rest(`/rpc/${n}?${new URLSearchParams(Object.fromEntries(Object.keys(args).map((k) => [k, ''])))}`, { method: 'GET', token });
      sweep.push({ function: n, role, post: { status: post.status, code: post.body?.code, message: String(post.body?.message ?? '').slice(0, 80) }, get: { status: get.status, code: get.body?.code }, verdict: deniedBeforeBody(post) && (deniedBeforeBody(get) || [400, 404, 405].includes(get.status)) ? 'DENIED_BEFORE_BODY' : 'OTHER' });
    }
  }
  await check('C', '33 gated RPCs as anon: 42501 permission denied for function (before the body), POST and GET', async () => {
    await sweepRole('anon', undefined);
    const rows = sweep.filter((r) => r.role === 'anon');
    eq(rows.length, 33, 'rows'); eq(rows.filter((r) => r.verdict !== 'DENIED_BEFORE_BODY').map((r) => r.function), [], 'not denied');
    return { denied: 33 };
  });
  // Synthetic identity through the gateway's real LOGIN role (TCP + scram + NOINHERIT → SET ROLE).
  const identity = { id: randomUUID(), core_user_id: randomUUID(), synthetic: true, note: 'core_user_id is synthetic (no Core user exists); deleted at the end of the run' };
  await check('C', 'identity seeding path = the gateway\'s: torneos_edge_identity_writer over TCP/scram, INSERT refused without SET ROLE (NOINHERIT), allowed after SET ROLE torneos_identity_writer', async () => {
    const insert = `insert into public.torneos_identity(id, core_user_id) values (${lit(identity.id)}, ${lit(identity.core_user_id)});`;
    const direct = sqlAsLogin('torneos_edge_identity_writer', c.writerPassword, insert);
    ok(!direct.ok && /permission denied/.test(direct.error ?? ''), `INSERT without SET ROLE must be refused: ${direct.error || 'succeeded'}`);
    const viaRole = sqlAsLogin('torneos_edge_identity_writer', c.writerPassword, `set role torneos_identity_writer;\n${insert}\nselect count(*) from public.torneos_identity where id=${lit(identity.id)};`);
    ok(viaRole.ok && viaRole.out.trim().endsWith('1'), `INSERT via SET ROLE failed: ${viaRole.error}`);
    return { login: 'torneos_edge_identity_writer', transport: 'tcp scram torneos-db:5432', noinherit_enforced: true };
  });
  let token;
  await check('C', 'valid RS256 bearer (kid p3b-k1, TTL 120) reaches PostgREST: own identity row readable (RLS own_identity), exactly 1 row', async () => {
    token = bearer(activeKey, identity); secretsKnown.push(token);
    const r = await rest('/torneos_identity?select=id,core_user_id', { token });
    eq(r.status, 200, `GET /torneos_identity: ${JSON.stringify(r.body).slice(0, 200)}`);
    eq(r.body, [{ id: identity.id, core_user_id: identity.core_user_id }], 'own row only');
  });
  await check('C', '33 gated RPCs as authenticated (valid bearer): 42501 permission denied for function (before the body), POST and GET', async () => {
    await sweepRole('authenticated', token);
    const rows = sweep.filter((r) => r.role === 'authenticated');
    eq(rows.length, 33, 'rows'); eq(rows.filter((r) => r.verdict !== 'DENIED_BEFORE_BODY').map((r) => r.function), [], 'not denied');
    evidence.data_api.gated_sweep = sweep;
    return { denied: 33 };
  });
  await check('C', `P0 ${P0} as authenticated: EXECUTE reaches the function body (not "permission denied for function"); as anon: denied before the body`, async () => {
    const body = { p_organization_id: randomUUID(), p_team_entry_id: randomUUID(), p_decision: 'approved', p_reason: 'phase3b r2-local probe', p_metadata: {} };
    const names = Object.keys(nullArgs(argsOf.get(P0).args));
    const args = Object.fromEntries(names.map((n, i) => [n, Object.values(body)[i]]));
    const auth = await rest(`/rpc/${P0}`, { method: 'POST', token, body: args });
    const anon = await rest(`/rpc/${P0}`, { method: 'POST', body: args });
    ok(!deniedBeforeBody(auth), `authenticated was denied before the body: ${JSON.stringify(auth.body)}`);
    ok(deniedBeforeBody(anon), `anon must be denied before the body: ${JSON.stringify(anon.body)}`);
    evidence.data_api.p0 = { function: argsOf.get(P0).sig, parameters: names, authenticated: { status: auth.status, code: auth.body?.code, message: String(auth.body?.message ?? '').slice(0, 120), reached_body: true }, anon: { status: anon.status, code: anon.body?.code, message: String(anon.body?.message ?? '').slice(0, 80) } };
    return evidence.data_api.p0;
  });
  await check('C', 'forged bearers are refused with 401: untrusted kid / expired / wrong aud (PostgREST), wrong iss / TTL≠120 / nbf≠iat / unknown identity / missing session_id / role≠authenticated (PT401 from private.check_token), alg none', async () => {
    const now = Math.floor(Date.now() / 1000);
    const cases = [
      ['untrusted kid (standby p3b-k2, not in JWKS)', bearer(standbyKey, identity), /^(PGRST30\d|PT401)$/],
      ['expired', bearer(activeKey, identity, { iat: now - 1000, nbf: now - 1000, exp: now - 880 }), /^(PGRST30\d|PT401)$/],
      ['wrong aud', bearer(activeKey, identity, { aud: 'arma2-core' }), /^(PGRST30\d|PT401)$/],
      ['alg none', (() => { const b64u = (s) => Buffer.from(s).toString('base64url'); return `${b64u(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64u(JSON.stringify({ role: 'authenticated', sub: identity.id, core_user_id: identity.core_user_id, iss: 'urn:arma2:local:identity-bridge', aud: 'arma2-torneos-local', iat: now, nbf: now, exp: now + 120, jti: randomUUID(), session_id: randomUUID() }))}.`; })(), /^(PGRST30\d|PT401)$/],
      ['wrong iss', bearer(activeKey, identity, { iss: 'urn:arma2:other' }), /^PT401$/],
      ['TTL 3600 (exp-iat ≠ 120)', bearer(activeKey, identity, { exp: now + 3600 }), /^PT401$/],
      ['nbf ≠ iat', bearer(activeKey, identity, { nbf: now - 10 }), /^PT401$/],
      ['unknown identity (sub not in torneos_identity)', bearer(activeKey, { id: randomUUID(), core_user_id: identity.core_user_id }), /^PT401$/],
      ['core_user_id mismatch', bearer(activeKey, { id: identity.id, core_user_id: randomUUID() }), /^PT401$/],
      ['missing session_id', bearer(activeKey, identity, { session_id: undefined }), /^PT401$/],
      ['role service_role claim', bearer(activeKey, identity, { role: 'service_role' }), /^PT401$/],
    ];
    const rows = [];
    for (const [name, tok, codeRe] of cases) {
      secretsKnown.push(tok);
      const r = await rest('/torneos_identity?select=id', { token: tok });
      // The RPC probe must match a real signature: PostgREST resolves the function from its schema
      // cache BEFORE any SQL runs, so a body that matches no signature is a 404 that never reaches
      // private.check_token. With P0's declared parameters the request reaches the database.
      const rpc = await rest(`/rpc/${P0}`, { method: 'POST', token: tok, body: nullArgs(argsOf.get(P0).args) });
      rows.push({ case: name, status: r.status, code: r.body?.code, rpc_status: rpc.status, rpc_code: rpc.body?.code, ok: r.status === 401 && codeRe.test(String(r.body?.code)) && rpc.status === 401 && codeRe.test(String(rpc.body?.code)) });
    }
    evidence.data_api.forged_bearers = rows;
    eq(rows.filter((r) => !r.ok), [], 'forged bearer accepted or wrong code');
    return { cases: rows.length, all_401: true, pt401: rows.filter((r) => r.code === 'PT401').length };
  });
  await check('C', 'torneos_identity: anon cannot read (42501 permission denied for table); authenticated cannot INSERT (42501)', async () => {
    const anon = await rest('/torneos_identity?select=id');
    const ins = await rest('/torneos_identity', { method: 'POST', token, body: { id: randomUUID(), core_user_id: randomUUID() } });
    ok(deniedTable(anon), `anon read: ${JSON.stringify(anon.body).slice(0, 160)}`);
    ok(deniedTable(ins), `authenticated insert: ${JSON.stringify(ins.body).slice(0, 160)}`);
    evidence.data_api.identity_table = { anon_read: { status: anon.status, code: anon.body?.code }, authenticated_insert: { status: ins.status, code: ins.body?.code } };
  });
  await check('C', 'staging v1 allowlist (43) ⊆ authenticated EXECUTE on the live catalog, ∩ gate = ∅, every name exists', async () => {
    const live = new Map();
    for (const f of inventory.functions) if (f.schema === 'public') live.set(f.name, (live.get(f.name) ?? []).concat([f]));
    eq(allowlist.length, 43, 'allowlist size');
    eq(allowlist.filter((n) => !live.has(n)), [], 'allowlisted but absent');
    eq(allowlist.filter((n) => !live.get(n).every((f) => f.authenticated)), [], 'allowlisted without authenticated EXECUTE');
    eq(allowlist.filter((n) => gated.includes(n)), [], 'allowlist ∩ gate');
    eq(gated.filter((n) => !live.get(n).every((f) => !f.anon && !f.authenticated && f.service_role)), [], 'gated with client EXECUTE or without service_role');
    evidence.data_api.allowlist = { size: allowlist.length, subset_of_authenticated_execute: true, disjoint_from_gate: true, gate_size: gated.length, sha256: sha256(await readFile(FILES.allowlist)) };
    return evidence.data_api.allowlist;
  });
  await check('C', 'synthetic identity removed; torneos_identity has 0 rows', async () => {
    sql(`delete from public.torneos_identity where id=${lit(identity.id)};`);
    eq(sql('select count(*) from public.torneos_identity').trim(), '0', 'identity rows');
    evidence.data_api.identity_rows = 0;
  });

  // ================================================================ D. isolation
  const ps = composePs();
  const names = Object.fromEntries(ps.map((p) => [p.Service, p.Name]));
  await check('D', 'containers: torneos-db + torneos-rest only (no gateway in R2), certified image ids, internal network, loopback-only ports, mounts inside this worktree', async () => {
    eq(Object.keys(names).sort(), ['torneos-db', 'torneos-rest'], 'services running');
    const insp = JSON.parse(docker(['inspect', names['torneos-db'], names['torneos-rest']]).stdout);
    const out = {};
    for (const i of insp) {
      const svc = i.Config.Labels['com.docker.compose.service'];
      const nets = Object.keys(i.NetworkSettings.Networks).sort();
      const ports = Object.entries(i.NetworkSettings.Ports ?? {}).flatMap(([p, b]) => (b ?? []).map((x) => `${x.HostIp}:${x.HostPort}->${p}`));
      const mounts = i.Mounts.map((m) => ({ type: m.Type, source: m.Type === 'volume' ? m.Name : m.Source, destination: m.Destination, rw: m.RW }));
      out[svc] = { image: i.Config.Image, image_id: i.Image, networks: nets, ports, mounts, project: i.Config.Labels['com.docker.compose.project'], phase_label: i.Config.Labels['arma2.phase'] };
      eq(i.Config.Labels['com.docker.compose.project'], PROJECT, `${svc} project`);
      eq(i.Config.Labels['arma2.phase'], '3b-local-torneos', `${svc} label`);
      ok(nets.every((n) => n.startsWith(`${PROJECT}_`)), `${svc} networks ${nets}`);
      ok(ports.every((p) => p.startsWith('127.0.0.1:')), `${svc} ports ${ports}`);
      for (const m of mounts) ok(m.type === 'volume' ? m.source.startsWith(`${PROJECT}_`) : m.source.startsWith(root.replace(/\/$/, '')), `${svc} mount ${JSON.stringify(m)}`);
    }
    eq(out['torneos-db'].image_id, CERTIFIED.image_id, 'torneos-db image id'); eq(out['torneos-db'].networks, [`${PROJECT}_isolated`], 'db networks'); eq(out['torneos-db'].ports, [], 'db ports');
    eq(out['torneos-rest'].networks, [`${PROJECT}_isolated`, `${PROJECT}_loopback-ingress`], 'rest networks'); eq(out['torneos-rest'].ports, ['127.0.0.1:58430->3000/tcp'], 'rest ports');
    eq(out['torneos-rest'].image, CERTIFIED.postgrest_image, 'postgrest image');
    const net = JSON.parse(docker(['network', 'inspect', `${PROJECT}_isolated`]).stdout)[0];
    eq(net.Internal, true, 'isolated network internal');
    evidence.isolation.containers = out;
    return { services: Object.keys(out) };
  });
  await check('D', 'from torneos-db: no Core service resolvable (core-db, core-auth, core-api, the Phase 3A/1.5/QA containers), internal DNS works for torneos-rest, NO default route, TCP connect to TEST-NET fails immediately (network unreachable — no packet leaves)', async () => {
    const probe = (h) => inDb(`getent hosts ${h} >/dev/null 2>&1; echo $?`).out;
    const dns = Object.fromEntries(['core-db', 'core-auth', 'core-api', 'core-rest', 'arma2-core-contracts-phase3a-core-db-1', 'arma2-sso-phase15-core-db-1', 'supabase_db_arma2-torneos-qa-seed'].map((h) => [h, probe(h)]));
    const self = probe('torneos-rest');
    // RFC 5737 TEST-NET addresses: unroutable by definition; on an internal network bash's connect
    // fails at once with "Network is unreachable" (exit 1) — a routed network would time out (124).
    const egress = Object.fromEntries(['192.0.2.1/443', '198.51.100.1/53'].map((t) => [t, inDb(`timeout 4 bash -c 'exec 3<>/dev/tcp/${t}' 2>&1 >/dev/null; echo "rc=$?"`).out.replace(/\n/g, ' ')]));
    const defaultRoutes = inDb("awk 'NR>1 && $2==\"00000000\" {n++} END {print n+0}' /proc/net/route").out;
    evidence.isolation.dns_from_db = { resolvable_exit_codes: dns, torneos_rest_resolvable_exit: self };
    evidence.isolation.egress_from_db = { default_routes: Number(defaultRoutes), connect_attempts: egress };
    eq(self, '0', 'internal DNS sanity (torneos-rest must resolve)');
    for (const [h, rc] of Object.entries(dns)) ok(rc !== '0', `${h} resolvable from torneos-db`);
    eq(Number(defaultRoutes), 0, 'default routes in torneos-db');
    for (const [t, res] of Object.entries(egress)) ok(/Network (is )?unreachable/.test(res) && /rc=1$/.test(res), `connect to ${t}: ${res}`);
    return { core_hosts_unresolvable: true, default_routes: 0, egress: 'network unreachable' };
  });
  await check('D', 'database: extensions = {pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp}; dblink/postgres_fdw/pg_net/http NOT installed; 0 foreign servers; 0 FK leaving public/private; 0 references to auth.* from Torneos functions; no Core monolith or Core contract objects', async () => {
    const d = JSON.parse(sql(`select json_build_object(
      'extensions', (select json_agg(extname order by extname) from pg_extension),
      'network_extensions_installed', (select coalesce(json_agg(extname),'[]') from pg_extension where extname in ('dblink','postgres_fdw','pg_net','http','pgsodium_fdw')),
      'foreign_servers', (select count(*) from pg_foreign_server), 'foreign_tables', (select count(*) from pg_foreign_table),
      'fk_total', (select count(*) from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace where c.contype='f' and n.nspname in ('public','private')),
      'fk_leaving_torneos', (select count(*) from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace join pg_class f on f.oid=c.confrelid join pg_namespace fn on fn.oid=f.relnamespace where c.contype='f' and n.nspname in ('public','private') and fn.nspname not in ('public','private')),
      'functions_referencing_auth_schema', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and (p.prosrc ~* '\\mauth\\.(uid|jwt|role|email|users|sessions)\\M')),
      'core_monolith_usuarios', to_regclass('public.usuarios') is not null,
      'core_contract_execute', to_regprocedure('public.torneos_contract_execute(text,text,jsonb)') is not null,
      'app_private_schema', exists(select 1 from pg_namespace where nspname='app_private'),
      'public_tables', (select count(*) from pg_tables where schemaname='public'),
      'tournament_tables', (select count(*) from pg_tables where schemaname='public' and tablename like 'tournament%'),
      'db_pre_request', (select json_agg(c) from pg_roles r, unnest(r.rolconfig) c where r.rolname='authenticator' and c like 'pgrst.db_pre_request=%'),
      'login_roles', (select json_agg(rolname order by rolname) from pg_roles where rolcanlogin and rolname not like 'pg_%')
    )`));
    evidence.isolation.database = d;
    eq(d.extensions, ['pg_stat_statements', 'pgcrypto', 'plpgsql', 'supabase_vault', 'uuid-ossp'], 'extensions');
    eq(d.network_extensions_installed, [], 'network extensions'); eq(d.foreign_servers, 0, 'foreign servers'); eq(d.foreign_tables, 0, 'foreign tables');
    eq(d.fk_leaving_torneos, 0, 'FK leaving public/private'); eq(d.functions_referencing_auth_schema, 0, 'functions referencing auth.*');
    eq(d.core_monolith_usuarios, false, 'Core monolith table present'); eq(d.core_contract_execute, false, 'Core contract present'); eq(d.app_private_schema, false, 'app_private present');
    eq(d.db_pre_request, ['pgrst.db_pre_request=private.check_token'], 'pre-request');
    return { extensions: d.extensions, fk_total: d.fk_total, public_tables: d.public_tables, login_roles: d.login_roles };
  });
  await check('D', 'runtime request guard: every HTTP request of this run went to 127.0.0.1:58430 (remote literals/imports are asserted offline by local.test.mjs)', async () => {
    eq([...REQUESTS.hosts], ['127.0.0.1:58430'], 'request hosts');
    ok(REQUESTS.total > 100, `too few requests recorded (${REQUESTS.total})`);
    return { http_requests: REQUESTS.total, hosts: [...REQUESTS.hosts] };
  });

  // ================================================================ E. evidence
  const summary = {
    generated_at: new Date().toISOString(), tool: 'backend/torneos/phase3b/local/certify-torneos-local.mjs', phase: '3B', step: 'R2-local certify', project: PROJECT,
    bootstrap_run: run, rest: REST, image: CERTIFIED.image, image_id: CERTIFIED.image_id,
    baseline_sha256: integ.baseline_sha256, gate_sha256: integ.gate_sha256, verify_sql_sha256: integ.verify_sql_sha256, expect_sha256: integ.expect_sha256,
    checks_passed: checks.filter((x) => x.ok).length, checks_total: checks.length, ok: failures === 0,
    catalog_hash: evidence.catalog?.catalog_hash ?? null, api_view_sha256: evidence.equivalence?.live_view_sha256 ?? null, certified_view_sha256: evidence.equivalence?.certified_view_sha256 ?? null,
    equivalence: evidence.equivalence ? { compared: evidence.equivalence.compared, mismatches: evidence.equivalence.mismatches, counts: evidence.equivalence.counts, live_summary: evidence.equivalence.live_summary } : null,
    catalog: evidence.catalog, data_api: evidence.data_api, isolation: evidence.isolation,
    http_requests: { total: REQUESTS.total, hosts: [...REQUESTS.hosts], remote: 0 },
    checks,
  };
  const ev = await promoteEvidence(`local-torneos-certify-${STAMP}.json`, summary);
  console.log(failures ? `PHASE3B_R2_LOCAL_CERTIFY_FAILED ${failures}/${checks.length} → ${ev.file}` : `PHASE3B_R2_LOCAL_CERTIFIED ${checks.length}/${checks.length} → ${ev.file}`);
  if (failures) process.exitCode = 1;
}
main().catch((e) => { console.error(`!! STOP ${e?.message ?? e}`); process.exitCode = 1; });
