// ERROR-CONTRACT-V1 — expected Torneos domain errors answer 4xx with their functional code, on the REAL local stack
// (the Phase 3A lab: real Core sessions, the Torneos migrations behind PostgREST v14.15, the gateway under test —
// Node by default, the Edge port with GATEWAY=edge).
//
//   A. install: 0006 applied in order, 0000–0005 byte-identical, bodies pinned and regenerable byte for byte, catalog
//      sweep (no function raises 40001; every contract message only with its PTxyz), re-apply no-op, refusal of a
//      third body state / of a database without 0005, rollback, gateway map = contract.json.
//   B. the product flows that used to end as "Torneos no disponible", driven through the gateway as the product's
//      actors, each asserting status + code + message, a single database execution (counted exactly from the
//      database ERROR log) and that the same bearer keeps working afterwards.
//   C. the retry storm: the PostgREST mechanism (a throwaway function) and the three former domain 40001 raises.
//   D. what must NOT change: a genuine unstructured 500 stays 500, a timeout stays 503, 401 / 403 unchanged, no-store.
//
// EC_PHASE=before runs B/C/D against a database WITHOUT 0006 and only records (evidence of the defect and of the
// gateway's legacy-SQLSTATE defense); the default (after) asserts. EC_EVIDENCE=1 writes
// backend/torneos/error-contract-v1/evidence/<gateway>/<phase>.json. Nothing touches a remote target.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { decodeJwt } from 'jose';
import { sql, sqlTry, inGateway, dc, BASE, GATEWAY_BASE, GATEWAY_NAME, PROJECT, repo, root } from './lab.mjs';

const PHASE = process.env.EC_PHASE === 'before' ? 'before' : 'after';
const AFTER = PHASE === 'after';
const RUN = 'ec' + randomBytes(3).toString('hex');
const results = [];
const mapping = [];
const seenSecrets = [];
const torneosSql = (q) => sql('torneos-db', q);
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const migrationsDir = `${repo}backend/torneos/supabase/migrations/`;
const MIGRATION = '00000000000006_domain_error_contract.sql';
const contract = JSON.parse(await readFile(`${repo}backend/torneos/error-contract-v1/contract.json`, 'utf8'));
const migrationSql = AFTER ? await readFile(`${migrationsDir}${MIGRATION}`, 'utf8') : '';
const rollbackSql = AFTER ? await readFile(`${repo}${contract.migration.rollback}`, 'utf8') : '';
const docker = process.platform === 'darwin' ? '/Applications/Docker.app/Contents/Resources/bin/docker' : 'docker';
const composeArgs = ['--host', 'unix:///var/run/docker.sock', 'compose', '--project-name', PROJECT, '--env-file', '.runtime/compose.env', '-f', 'compose.yaml'];

// ---------------------------------------------------------------- transport
const noStore = [];
async function request(path, token, method = 'GET', data, extraHeaders = {}) {
  const base = path.startsWith('/auth/v1') ? BASE : GATEWAY_BASE;
  const r = await fetch(`${base}${path}`, { method, headers: { connection: 'close',
    ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data !== undefined ? { 'content-type': 'application/json' } : {}), ...extraHeaders },
    body: data !== undefined ? (typeof data === 'string' ? data : JSON.stringify(data)) : undefined });
  const text = await r.text(); let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!path.startsWith('/auth/v1')) noStore.push({ path: path.replace(/[0-9a-f-]{36}/g, ':id'), status: r.status, cacheControl: r.headers.get('cache-control') });
  return { status: r.status, body, headers: r.headers };
}
const gw = (name, token, params = {}) => request(`/torneos/rest/v1/rpc/${name}`, token, 'POST', params);
/** Direct PostgREST from inside the private network (the gateway container): the database's own HTTP mapping. */
function rest(path, body, token = null, timeoutMs = 8000) {
  const out = inGateway(`const t = Date.now(); let status = null; let text = '';
    try {
      const r = await fetch('http://torneos-rest:3000' + ${JSON.stringify(path)}, { method: 'POST', signal: AbortSignal.timeout(${timeoutMs}),
        headers: { 'content-type': 'application/json', ${token ? `authorization: 'Bearer ' + ${JSON.stringify(token)}` : ''} }, body: ${JSON.stringify(JSON.stringify(body))} });
      status = r.status; text = await r.text();
    } catch (e) { status = 'client-timeout'; }
    let parsed = null; try { parsed = JSON.parse(text); } catch {}
    console.log(JSON.stringify({ status, body: parsed, ms: Date.now() - t }));`);
  return JSON.parse(out.trim().split('\n').pop());
}
const errCode = (r) => r.body?.code ?? r.body?.error ?? null;
const errMsg = (r) => r.body?.message ?? r.body?.error ?? null;
const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;

// ---------------------------------------------------------------- exact execution counter
// Every failed execution of a RAISE is one `ERROR:  <message>` line in the Torneos database log (log_min_messages
// default; log_min_error_statement=panic keeps the statements themselves out). pg_stat counters are flushed lazily by
// busy backends and undercount a storm by orders of magnitude, so the log is the instrument.
function dbErrorCount(message, sinceIso) {
  const r = spawnSync(docker, [...composeArgs, 'logs', '--no-color', '--no-log-prefix', '--since', sinceIso, 'torneos-db'],
    { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('local compose logs failed');
  const needle = `ERROR:  ${message}`;
  let n = 0;
  for (const line of (r.stdout + r.stderr).split('\n')) if (line.endsWith(needle)) n += 1;
  return n;
}
/** Runs `fn`, then counts the database executions of `message` right after the answer and 3 s later. */
async function executions(message, fn) {
  await sleep(1100);
  const since = new Date(Date.now() - 1000).toISOString();
  const t0 = Date.now();
  const response = await fn();
  const ms = Date.now() - t0;
  await sleep(1500);
  const atAnswer = dbErrorCount(message, since);
  await sleep(3000);
  const later = dbErrorCount(message, since);
  return { response, ms, executions: atAnswer, executionsAfter3s: later, stillRunning: later > atAnswer };
}
/** Ends a PostgREST retry loop still spinning on `rpc` (only needed without 0006). */
function stopLoops(rpc) {
  return torneosSql(`select count(pg_terminate_backend(pid)) from pg_stat_activity
    where usename = 'authenticator' and pid <> pg_backend_pid() and query like ${lit(`%${rpc}%`)}`).trim();
}
/** A psql session in the background (holds locks while the gateway request runs). */
function sqlBackground(query) {
  return new Promise((resolve) => {
    const child = spawn(docker, [...composeArgs, 'exec', '-T', 'torneos-db', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'],
      { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ ok: code === 0, out, error: err.split('\n').filter((l) => l.startsWith('ERROR:')).join('\n') }));
    child.stdin.end(query);
  });
}

// ---------------------------------------------------------------- identities (real Core sessions)
async function coreActor(label) {
  const email = `${RUN}-${label}-${randomUUID().slice(0, 6)}@example.test`;
  const password = `${randomUUID()}Aa!`;
  const s = await request('/auth/v1/signup', null, 'POST', { email, password, data: { full_name: `${RUN} ${label}` } });
  assert.equal(s.status, 200, `GoTrue signup for ${label}`);
  seenSecrets.push(s.body.access_token, s.body.refresh_token, password);
  const u = { label, email, coreToken: s.body.access_token, coreUserId: s.body.user.id };
  await exchange(u);
  return u;
}
async function exchange(u) {
  const r = await request('/exchange', u.coreToken, 'POST');
  assert.equal(r.status, 200, `exchange for ${u.label}: ${show(r)}`);
  seenSecrets.push(r.body.access_token);
  u.token = r.body.access_token; u.tokenAt = Date.now(); u.identity = decodeJwt(u.token).sub;
  return u.token;
}
async function tok(u) { if (!u.token || Date.now() - u.tokenAt > 80_000) await exchange(u); return u.token; }
const setService = (service, action) => dc([action, service], undefined, true);
async function waitFor(label, probe, attempts = 90, interval = 1000) {
  for (let i = 0; i < attempts; i++) {
    try { if (await probe()) return; } catch { /* restarting */ }
    await sleep(interval);
  }
  throw new Error(`${label} did not recover`);
}

// ---------------------------------------------------------------- the suite
test(`ERROR-CONTRACT-V1 — domain errors are 4xx, not outages (${GATEWAY_NAME} gateway, ${PHASE} 0006)`, async (t) => {
  async function check(name, fn, { phases = ['before', 'after'] } = {}) {
    if (!phases.includes(PHASE)) return;
    await t.test(name, async () => {
      try { await fn(); results.push({ name, status: 'PASS' }); }
      catch (error) { results.push({ name, status: 'FAIL', error: String(error.message ?? error).slice(0, 600) }); throw error; }
    });
  }
  const ok = async (name, who, params = {}) => {
    const r = await gw(name, await tok(who), params);
    assert.equal(r.status, 200, `${name} as ${who.label}: ${show(r)}`);
    return r.body;
  };
  /**
   * One contract case through the gateway: records status / code / executions; after 0006 asserts the contract
   * status, the PTxyz code, the message, exactly one execution with nothing still running, a prompt answer, and
   * that the same bearer keeps working (the transport keeps it; the gateway never revokes it for a domain error).
   */
  const domain = async (label, name, who, params, message, { measure = true, stop = true } = {}) => {
    const token = await tok(who);
    const m = measure ? await executions(message, () => gw(name, token, params)) : { response: await gw(name, token, params) };
    const r = m.response;
    const again = await gw('get_tournament_workspace_context', token, {});
    const row = { case: label, rpc: name, route: 'gateway', expected: contract.http[message], status: r.status, code: errCode(r),
      message: errMsg(r), ms: m.ms ?? null, executions: m.executions ?? null, executionsAfter3s: m.executionsAfter3s ?? null,
      stillRunning: m.stillRunning ?? null, bearerPreserved: again.status === 200 };
    mapping.push(row);
    if (m.stillRunning && stop) row.loopsStopped = stopLoops(name);
    if (AFTER) {
      assert.equal(r.status, contract.http[message], `${label}: ${show(r)}`);
      assert.equal(errCode(r), `PT${contract.http[message]}`, `${label}: ${show(r)}`);
      assert.equal(errMsg(r), message, `${label}: ${show(r)}`);
      if (measure) {
        assert.equal(m.executions, 1, `${label}: exactly one database execution (${m.executions})`);
        assert.equal(m.stillRunning, false, `${label}: nothing keeps running after the answer`);
        assert.ok(m.ms < 2000, `${label}: answered promptly (${m.ms} ms)`);
      }
      assert.equal(again.status, 200, `${label}: the same bearer still works`);
    }
    return row;
  };
  const S = {};
  let owner; let outsider; const captains = [];

  try {
    // ================================================================ A. install / pins / sweep
    await check('A1 install: 0006 applied last from the migrations directory; 0000–0005 byte-identical to their certified sha256', async () => {
      const install = JSON.parse(await readFile(`${root}.runtime/install.json`, 'utf8'));
      const applied = install.torneos.migrations_after_baseline.map((m) => m.file.split('/').pop());
      assert.deepEqual(applied, (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort().slice(1));
      assert.equal(applied.at(-1), MIGRATION);
      const entry = install.torneos.migrations_after_baseline.find((m) => m.file.endsWith(MIGRATION));
      assert.equal(entry.sha256, contract.migration.sha256, 'the lab applied this tree\'s 0006');
      assert.equal(createHash('sha256').update(migrationSql).digest('hex'), contract.migration.sha256);
      for (const [file, sha] of Object.entries(contract.migration.untouched_migrations)) {
        assert.equal(createHash('sha256').update(await readFile(`${migrationsDir}${file}`)).digest('hex'), sha, `${file} unchanged`);
      }
    }, { phases: ['after'] });
    await check('A2 bodies: the 18 md5 pins hold; build-migration.mjs --check regenerates 0006, its rollback and the pins byte for byte from the live catalog', async () => {
      for (const pin of contract.migration.pins) {
        assert.equal(torneosSql(`select md5(prosrc) from pg_proc where oid = ${lit(pin.function)}::regprocedure`).trim(), pin.md5_after, pin.function);
      }
      const r = spawnSync(process.execPath, [`${repo}backend/torneos/error-contract-v1/build-migration.mjs`, '--check'], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(JSON.parse(r.stdout.trim().split('\n').pop()).check, 'PASS');
    }, { phases: ['after'] });
    await check('A3 catalog sweep: no Torneos function raises 40001; each contract message only with its PTxyz (exact counts); invariants / readiness / commerce keep their SQLSTATE', async () => {
      const raises = JSON.parse(torneosSql(`select coalesce(json_agg(json_build_object('f', p.oid::regprocedure::text, 'stmt', m[1])), '[]')
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace, regexp_matches(p.prosrc, '(raise\\s+exception[^;]*;)', 'gi') m
        where n.nspname in ('public', 'private')`));
      assert.deepEqual(raises.filter((r) => /errcode\s*=\s*'40001'/i.test(r.stmt)).map((r) => r.f), [], 'no domain 40001');
      for (const [message, status] of Object.entries(contract.http)) {
        const hits = raises.filter((r) => r.stmt.includes(`'${message}'`));
        const expected = contract.changes.flatMap((c) => c.raises).filter((r) => r.message === message).reduce((a, r) => a + r.count, 0);
        assert.equal(hits.length, expected, message);
        for (const h of hits) assert.match(h.stmt, new RegExp(`errcode\\s*=\\s*'PT${status}'`, 'i'), `${message} in ${h.f}`);
      }
      const legacy = (message) => raises.filter((r) => r.stmt.includes(`'${message}'`)).map((r) => /errcode\s*=\s*'([^']+)'/i.exec(r.stmt)?.[1]);
      assert.deepEqual([...new Set(legacy('TORNEOS_MATCH_REVIEW_OPEN'))], ['55000'], 'invariant unchanged');
      assert.deepEqual([...new Set(legacy('TORNEOS_MATCH_CORRECTION_STALE'))], ['55000'], 'invariant unchanged');
      assert.deepEqual([...new Set(legacy('TORNEOS_MEDIA_PIPELINE_NOT_READY'))], ['55000'], 'readiness unchanged');
      assert.ok(legacy('TORNEOS_PURCHASE_TRANSITION_INVALID').every((c) => c === '55000'), 'commerce unchanged');
      assert.deepEqual([...new Set(legacy('TORNEOS_PURCHASE_NOT_FOUND'))], ['P0002'], 'commerce unchanged');
      const [auth, anon] = torneosSql(`select count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')) || '|' || count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE'))
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'`).trim().split('|').map(Number);
      assert.deepEqual([auth, anon], [contract.migration.acl.authenticated_public, contract.migration.acl.anon_public], 'client catalog unchanged (171 / 12)');
      for (const c of contract.changes) {
        const [a, n, definer] = torneosSql(`select has_function_privilege('authenticated', ${lit(c.function)}::regprocedure, 'EXECUTE') || '|' || has_function_privilege('anon', ${lit(c.function)}::regprocedure, 'EXECUTE') || '|' || prosecdef from pg_proc where oid = ${lit(c.function)}::regprocedure`).trim().split('|');
        assert.equal(n, 'false', `${c.function}: anon never`);
        if (c.reach.startsWith('closed')) assert.equal(a, 'false', `${c.function} stays closed`);
        if (c.reach.startsWith('gateway') || c.reach.startsWith('PostgREST')) assert.deepEqual([a, definer], ['true', 'true'], `${c.function} executable by authenticated, SECURITY DEFINER`);
      }
    }, { phases: ['after'] });
    await check('A4 migration: re-apply is a no-op; a third body state and a database without 0005 are refused before any change', async () => {
      const md5s = () => torneosSql(`select string_agg(md5(prosrc), ',' order by f) from unnest(array[${contract.migration.pins.map((p) => lit(p.function)).join(',')}]) f join pg_proc p on p.oid = f::regprocedure`).trim();
      const before = md5s();
      const again = sqlTry('torneos-db', migrationSql);
      assert.equal(again.ok, true, again.error);
      assert.equal(md5s(), before, 'nothing changed');
      const third = sqlTry('torneos-db', `BEGIN;
        CREATE OR REPLACE FUNCTION public.publish_tournament_fixture(p_organization_id uuid, p_fixture_version_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $x$ begin return null; end $x$;
        ${migrationSql.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')}
        ROLLBACK;`);
      assert.equal(third.ok, false); assert.match(third.error, /TORNEOS_ERROR_CONTRACT_V1_PRECONDITION_FAILED: public\.publish_tournament_fixture\(uuid,uuid\) body [0-9a-f]{32} is neither/);
      const no0005 = sqlTry('torneos-db', `BEGIN; ALTER TABLE public.tournaments DROP COLUMN match_result_dual_control_enabled CASCADE;
        ${migrationSql.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')}
        ROLLBACK;`);
      assert.equal(no0005.ok, false); assert.match(no0005.error, /TORNEOS_ERROR_CONTRACT_V1_PRECONDITION_FAILED: 0005 \(OFFICIALIZATION-V1\) not in force/);
      assert.equal(md5s(), before, 'refusals left the database untouched');
    }, { phases: ['after'] });
    await check('A5 rollback: the documented rollback restores the 18 POST_0005 bodies (md5) in a rolled-back transaction; then 0006 is intact', async () => {
      const r = sqlTry('torneos-db', `BEGIN; ${rollbackSql.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')}
        SELECT string_agg(md5(p.prosrc), ',' order by u.ord) FROM unnest(array[${contract.migration.pins.map((p) => lit(p.function)).join(',')}]) WITH ORDINALITY u(f, ord) JOIN pg_proc p ON p.oid = u.f::regprocedure;
        ROLLBACK;`);
      assert.equal(r.ok, true, r.error);
      assert.equal(r.out.trim().split('\n').pop(), contract.migration.pins.map((p) => p.md5_before).join(','), 'POST_0005 bodies restored');
      for (const pin of contract.migration.pins) {
        assert.equal(torneosSql(`select md5(prosrc) from pg_proc where oid = ${lit(pin.function)}::regprocedure`).trim(), pin.md5_after, `${pin.function} intact`);
      }
    }, { phases: ['after'] });
    await check('A6 gateway defense: DOMAIN_ERROR_STATUS = contract.json http; only 500 + legacy SQLSTATE + contract message is mapped, everything else passes through', async () => {
      const g = await import(`${repo}backend/torneos/supabase/functions/torneos-gateway/competition.ts`);
      assert.deepEqual({ ...g.DOMAIN_ERROR_STATUS }, contract.http);
      assert.deepEqual([...g.LEGACY_DOMAIN_SQLSTATES], contract.postgrest.legacy_5xx_sqlstates);
      const enc = (o) => new TextEncoder().encode(typeof o === 'string' ? o : JSON.stringify(o));
      assert.equal(g.domainErrorStatus(500, enc({ code: '55000', message: 'TORNEOS_QUALIFICATION_INCOMPLETE' })), 409);
      assert.equal(g.domainErrorStatus(500, enc({ code: '54000', message: 'TORNEOS_PUBLISH_RATE_LIMITED' })), 429);
      assert.equal(g.domainErrorStatus(500, enc({ code: '54000', message: 'TORNEOS_DRAFT_LIMIT_REACHED' })), 422);
      for (const [status, body] of [[500, { code: 'P0002', message: 'query returned no rows' }], [500, { code: '55000', message: 'TORNEOS_MATCH_REVIEW_OPEN' }],
        [500, { code: 'XX000', message: 'TORNEOS_QUALIFICATION_INCOMPLETE' }], [500, 'not json'], [500, ''], [503, { code: '55000', message: 'TORNEOS_QUALIFICATION_INCOMPLETE' }],
        [502, { code: '55000', message: 'TORNEOS_QUALIFICATION_INCOMPLETE' }], [500, { code: '55000', message: 'TORNEOS_QUALIFICATION_INCOMPLETE ' }],
        [409, { code: 'PT409', message: 'TORNEOS_STALE_FIXTURE_VERSION' }], [500, [{ code: '55000', message: 'TORNEOS_QUALIFICATION_INCOMPLETE' }]],
        [500, { code: '55000', message: 'TORNEOS_QUALIFICATION_INCOMPLETE', pad: 'x'.repeat(5000) }]]) {
        assert.equal(g.domainErrorStatus(status, enc(body)), status, JSON.stringify(body).slice(0, 80));
      }
    }, { phases: ['after'] });

    // ================================================================ C0. the PostgREST mechanism (throwaway function)
    await check('C0 mechanism: PostgREST re-executes a deterministic 40001 without end — it outlives the client; the same RAISE as PT409 runs once and answers at once', async () => {
      const message = `TORNEOS_EC_PROBE_${RUN.toUpperCase()}`;
      torneosSql(`create function public.zz_error_contract_probe(p_code text, p_message text) returns int language plpgsql as $$ begin raise exception using errcode = p_code, message = p_message; end $$;
        grant execute on function public.zz_error_contract_probe(text, text) to anon; notify pgrst, 'reload schema';`);
      try {
        await waitFor('probe in the schema cache', async () => rest('/rpc/zz_error_contract_probe', { p_code: 'PT409', p_message: 'TORNEOS_EC_WARMUP' }).status === 409, 20);
        const storm = await executions(message, async () => rest('/rpc/zz_error_contract_probe', { p_code: '40001', p_message: message }, null, 3000));
        const pt = await executions(`${message}_PT`, async () => rest('/rpc/zz_error_contract_probe', { p_code: 'PT409', p_message: `${message}_PT` }));
        mapping.push({ case: 'C0 probe 40001', rpc: 'zz_error_contract_probe', route: 'postgrest', status: storm.response.status, executions: storm.executions, executionsAfter3s: storm.executionsAfter3s, stillRunning: storm.stillRunning, ms: storm.ms });
        mapping.push({ case: 'C0 probe PT409', rpc: 'zz_error_contract_probe', route: 'postgrest', status: pt.response.status, executions: pt.executions, executionsAfter3s: pt.executionsAfter3s, ms: pt.response.ms });
        assert.equal(storm.response.status, 'client-timeout', 'no answer at all within 3 s');
        assert.ok(storm.executions > 100, `thousands of executions (${storm.executions})`);
        assert.ok(storm.stillRunning, 'still re-executing 3 s after the client gave up');
        assert.equal(pt.response.status, 409); assert.equal(pt.response.body?.code, 'PT409');
        assert.deepEqual([pt.executions, pt.stillRunning], [1, false], 'PT409: one execution');
      } finally {
        // Dropping the function turns the loop's next attempt into 42883: the loop ends.
        torneosSql(`drop function if exists public.zz_error_contract_probe(text, text); notify pgrst, 'reload schema';`);
      }
      const settled = dbErrorCount(message, new Date(Date.now() - 2000).toISOString());
      await sleep(2000);
      assert.equal(dbErrorCount(message, new Date(Date.now() - 1500).toISOString()), 0, `the loop ended once the function was dropped (${settled} in the last 2 s before)`);
      assert.equal(torneosSql("select count(*) from pg_proc where proname = 'zz_error_contract_probe'").trim(), '0');
    });

    // ================================================================ B. actors and fixtures
    owner = await coreActor('owner');
    outsider = await coreActor('outsider');
    for (let i = 0; i < 6; i++) captains.push(await coreActor(`captain-${i}`));
    const day = (offset) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);
    const mkTournament = async (slug) => {
      const tnt = await ok('create_tournament_with_defaults', owner, { p_organization_id: S.org, p_season_id: S.season, p_name: `Copa ${slug}`, p_slug: `${slug}-${RUN}`, p_description: null, p_sport_modality: 'football_5', p_competition_format: 'league', p_gender_category: 'open', p_start_date: day(-1), p_end_date: day(60), p_idempotency_key: randomUUID() });
      const cat = await ok('save_tournament_category', owner, { p_organization_id: S.org, p_tournament_id: tnt.id, p_category_id: null, p_name: 'Libre', p_slug: 'libre', p_description: null, p_sort_order: null, p_min_age: null, p_max_age: null, p_gender_category: null, p_sport_modality: null, p_team_size: null, p_status: 'active' });
      await ok('change_tournament_status', owner, { p_organization_id: S.org, p_tournament_id: tnt.id, p_status: 'registration' });
      return { id: tnt.id, category: cat.id };
    };
    const approvedTeam = async (tournament, name, captain) => {
      const created = await ok('create_tournament_team_entry', owner, { p_organization_id: S.org, p_tournament_id: tournament.id, p_category_id: tournament.category, p_arma2_team_id: null, p_name: name, p_short_name: null, p_primary_color: null, p_secondary_color: null, p_registration_source: 'manual', p_manager_user_id: null, p_manager_email: null, p_manager_display_name: null, p_idempotency_key: randomUUID() });
      const players = [];
      for (const [display, shirt, position, gk] of [['Arquero', 1, 'ARQ', true], ['Defensor', 2, 'DEF', false], ['Volante', 3, 'MED', false], ['Delantero', 4, 'DEL', false], ['Lateral', 5, 'DEF', false]]) {
        const prov = await ok('create_tournament_provisional_player', owner, { p_organization_id: S.org, p_team_entry_id: created.entryId, p_display_name: `${display} ${name}` });
        players.push((await ok('add_tournament_roster_player', owner, { p_organization_id: S.org, p_team_entry_id: created.entryId, p_roster_id: created.rosterId, p_arma2_user_id: null, p_provisional_player_id: prov.id, p_display_name: `${display} ${name}`, p_avatar_url: null, p_shirt_number: shirt, p_primary_position: position, p_secondary_position: null, p_is_goalkeeper: gk })).id);
      }
      const invite = await ok('invite_tournament_team_manager', owner, { p_organization_id: S.org, p_team_entry_id: created.entryId, p_email: captain.email, p_display_name: captain.label, p_role: 'captain' });
      seenSecrets.push(invite.token);
      await ok('accept_tournament_team_invitation', captain, { p_token: invite.token });
      const submitted = await ok('submit_tournament_team_entry', owner, { p_organization_id: S.org, p_team_entry_id: created.entryId });
      assert.equal(submitted.validation.valid, true, JSON.stringify(submitted.validation));
      await ok('review_tournament_team_entry', owner, { p_organization_id: S.org, p_team_entry_id: created.entryId, p_decision: 'approved', p_reason: 'Plantel verificado', p_issues: [] });
      return { entry: created.entryId, players, captain, name };
    };
    const matchesOf = (fixture) => JSON.parse(torneosSql(`select coalesce(json_agg(json_build_object('id', m.id, 'phase', m.phase_id, 'home', hp.team_entry_id, 'away', ap.team_entry_id) order by m.match_number), '[]')
      from public.tournament_matches m left join public.tournament_competition_participants hp on hp.id = m.home_participant_id left join public.tournament_competition_participants ap on ap.id = m.away_participant_id
      where m.fixture_version_id = ${lit(fixture)}`));
    const publishedFixture = (tournament) => torneosSql(`select id from public.tournament_fixture_versions where tournament_id = ${lit(tournament)} and status = 'published'`).trim();
    const scheduleAt = async (match, hoursAhead, court) => {
      const at = new Date(Date.now() + hoursAhead * 3600_000); at.setUTCMinutes(0, 0, 0);
      await ok('schedule_tournament_match', owner, { p_organization_id: S.org, p_match_id: match, p_scheduled_at: at.toISOString(), p_venue_id: S.venue, p_court_id: court, p_duration_minutes: 60, p_override_warnings: true, p_override_reason: 'Certificación' });
    };
    /** Owner alone (dual control OFF, the default): open → outcome → score → submit → review → validate → official. */
    const officialResult = async (match, home, homeScore, awayScore, { stopAfterReview = false } = {}) => {
      const op = (await ok('open_tournament_match_operation', owner, { p_organization_id: S.org, p_match_id: match, p_override_reason: 'Certificación' })).operation.id;
      const base = { p_organization_id: S.org, p_match_operation_id: op };
      await ok('set_tournament_match_outcome', owner, { ...base, p_outcome: { outcomeType: 'played', countsForStandings: true, countsForPlayerStats: true, requiresResolution: false } });
      await ok('set_tournament_match_score', owner, { ...base, p_score: { homeScore, awayScore, scoreType: 'played' } });
      for (let g = 0; g < homeScore; g++) await ok('add_tournament_match_event', owner, { ...base, p_event: { teamEntryId: home, rosterPlayerId: null, eventType: 'goal', minute: 10 + g, period: 'first_half', unidentifiedPlayerReason: 'Autor no identificado en la planilla' } });
      await ok('submit_tournament_match_operation', owner, base);
      await ok('review_tournament_match_operation', owner, { ...base, p_decision: 'approved', p_reason: 'Acta revisada' });
      if (!stopAfterReview) {
        await ok('validate_tournament_match_operation', owner, base);
        await ok('make_tournament_match_official', owner, base);
      }
      return op;
    };

    await check('B0 fixtures: organization + season; league L with 4 approved teams (captains through the Core contract), league C with 2', async () => {
      S.org = (await ok('create_tournament_organization', owner, { p_name: `Liga ${RUN}`, p_slug: `liga-${RUN}`, p_idempotency_key: randomUUID() })).organization.id;
      S.season = (await ok('create_tournament_season', owner, { p_organization_id: S.org, p_name: 'Apertura', p_slug: `apertura-${RUN}`, p_start_date: null, p_end_date: null, p_idempotency_key: randomUUID() })).id;
      S.L = await mkTournament('lima');
      S.L.teams = [];
      for (let i = 0; i < 4; i++) S.L.teams.push(await approvedTeam(S.L, `Club ${i} ${RUN}`, captains[i]));
      S.C = await mkTournament('charlie');
      S.C.teams = [await approvedTeam(S.C, `Uno ${RUN}`, captains[4]), await approvedTeam(S.C, `Dos ${RUN}`, captains[5])];
      S.venue = (await ok('create_tournament_venue', owner, { p_organization_id: S.org, p_name: `Club ${RUN}`, p_address: 'Calle 123', p_place_id: null, p_latitude: null, p_longitude: null, p_locality: 'Buenos Aires', p_timezone: 'America/Argentina/Buenos_Aires', p_notes: null })).id;
      S.court = (await ok('create_tournament_court', owner, { p_organization_id: S.org, p_venue_id: S.venue, p_name: 'Cancha 1', p_sport_modality: 'football_5', p_notes: null })).id;
      S.courtC = (await ok('create_tournament_court', owner, { p_organization_id: S.org, p_venue_id: S.venue, p_name: 'Cancha 2', p_sport_modality: 'football_5', p_notes: null })).id;
    });

    // ---------------------------------------------------------------- fixture
    await check('B1 STALE_FIXTURE_VERSION: "Generar borrador" twice, "Publicar" on the older draft → 409 at once, one execution; the newest draft then publishes', async () => {
      const scope = { p_organization_id: S.org, p_tournament_id: S.L.id, p_category_id: S.L.category };
      await ok('freeze_tournament_participants', owner, { ...scope, p_idempotency_key: randomUUID() });
      S.L.d1 = (await ok('generate_tournament_fixture', owner, { ...scope, p_seed: `a-${RUN}`, p_configuration: {}, p_idempotency_key: randomUUID() })).fixtureVersionId;
      S.L.d2 = (await ok('generate_tournament_fixture', owner, { ...scope, p_seed: `b-${RUN}`, p_configuration: {}, p_idempotency_key: randomUUID() })).fixtureVersionId;
      assert.equal(torneosSql(`select count(*) from public.tournament_fixture_versions where tournament_id = ${lit(S.L.id)} and status = 'draft'`).trim(), '2', 'two drafts, each with its Publicar button');
      // Without 0006 the failed click keeps re-executing inside PostgREST: it is left running (before-mode only) while
      // the organizer publishes the newest draft, to observe what the orphaned loop does next.
      const row = await domain('fixture: publish the older draft', 'publish_tournament_fixture', owner, { p_organization_id: S.org, p_fixture_version_id: S.L.d1 }, 'TORNEOS_STALE_FIXTURE_VERSION', { stop: AFTER });
      await ok('publish_tournament_fixture', owner, { p_organization_id: S.org, p_fixture_version_id: S.L.d2 });
      await sleep(3000);
      if (row.stillRunning) row.loopsStopped = stopLoops('publish_tournament_fixture');
      S.L.fixture = publishedFixture(S.L.id);
      row.publishedAfterwards = S.L.fixture === S.L.d2 ? 'newest draft' : 'OLDER draft (ghost publish by the retry loop)';
      if (AFTER) assert.equal(S.L.fixture, S.L.d2, 'the newest draft is the published fixture');
      S.L.matches = matchesOf(S.L.fixture);
      assert.equal(S.L.matches.length, 6);
      S.L.phase = S.L.matches[0].phase;
    });
    await check('B2 FIXTURE_DRAFT_READ_ONLY: a revision draft left open when the competition starts → editing it answers 409 (trigger)', async () => {
      S.L.draft = (await ok('supersede_tournament_fixture', owner, { p_organization_id: S.org, p_fixture_version_id: S.L.fixture, p_idempotency_key: randomUUID() })).fixtureVersionId;
      await ok('start_tournament_competition', owner, { p_organization_id: S.org, p_tournament_id: S.L.id });
      const phase = torneosSql(`select id from public.tournament_phases where fixture_version_id = ${lit(S.L.draft)} order by sequence_number limit 1`).trim();
      await domain('fixture: edit a draft after the start', 'update_draft_fixture', owner, { p_organization_id: S.org, p_fixture_version_id: S.L.draft, p_action: 'create_round', p_payload: { phaseId: phase, name: 'Fecha extra' } }, 'TORNEOS_FIXTURE_DRAFT_READ_ONLY');
    });

    // ---------------------------------------------------------------- match day
    await check('B3 MATCH_SQUAD_LOCKED: the captain saves and submits the squad, then saves again → 409', async () => {
      S.m = S.L.matches[0];
      await scheduleAt(S.m.id, 2, S.court);
      S.home = S.L.teams.find((x) => x.entry === S.m.home);
      const squad = S.home.players.map((rosterPlayerId, index) => ({ rosterPlayerId, availabilityStatus: 'no_response', callupStatus: 'called_up', lineupStatus: 'starter', isGoalkeeper: index === 0, isCaptain: index === 1, attendanceStatus: 'present' }));
      const params = { p_organization_id: S.org, p_match_id: S.m.id, p_team_entry_id: S.home.entry, p_players: squad };
      await ok('save_match_squad', S.home.captain, params);
      await ok('submit_match_squad', S.home.captain, { p_organization_id: S.org, p_match_id: S.m.id, p_team_entry_id: S.home.entry });
      await domain('squad: save after submitting', 'save_match_squad', S.home.captain, params, 'TORNEOS_MATCH_SQUAD_LOCKED');
    });
    await check('B4 MATCH_REVIEW_NOT_OPEN: a second approval of an acta another tab already approved → 409; the acta then validates and becomes official', async () => {
      S.op = await officialResult(S.m.id, S.m.home, 1, 0, { stopAfterReview: true });
      const base = { p_organization_id: S.org, p_match_operation_id: S.op };
      await domain('acta: approve twice', 'review_tournament_match_operation', owner, { ...base, p_decision: 'approved', p_reason: 'Segunda pestaña' }, 'TORNEOS_MATCH_REVIEW_NOT_OPEN');
      await ok('validate_tournament_match_operation', owner, base);
      await ok('make_tournament_match_official', owner, base);
    });
    await check('B5 QUALIFICATION_INCOMPLETE: table published after 1 of 6 matches, "Resolver clasificados" → 409 with the bearer preserved', async () => {
      const scope = { p_organization_id: S.org, p_tournament_id: S.L.id, p_category_id: S.L.category, p_phase_id: S.L.phase, p_group_id: null };
      const rev = await ok('rebuild_tournament_standings', owner, { ...scope, p_reason: 'Fecha 1', p_idempotency_key: randomUUID() });
      S.L.revision = rev?.revisionId ?? rev?.id ?? rev;
      await ok('publish_tournament_standings_revision', owner, { p_revision_id: S.L.revision, p_reason: 'Tabla parcial' });
      await domain('qualification: resolve mid-phase', 'resolve_tournament_qualification', owner, { p_revision_id: S.L.revision, p_reason: 'Clasificación' }, 'TORNEOS_QUALIFICATION_INCOMPLETE');
    });
    await check('B6 STANDINGS_SOURCES_CHANGED: an official score changes while the table is being rebuilt → 409 at once after the lock, one execution (no transparent retry)', async () => {
      const scope = { p_organization_id: S.org, p_tournament_id: S.L.id, p_category_id: S.L.category, p_phase_id: S.L.phase, p_group_id: null };
      // A concurrent actor: holds the revisions table against INSERT (the rebuild has already fingerprinted its sources
      // by then), changes the official score and commits after 2 s. Scores are not locked by the rebuild.
      const concurrent = sqlBackground(`BEGIN; LOCK TABLE public.tournament_standings_revisions IN SHARE ROW EXCLUSIVE MODE; SELECT pg_sleep(3);
        SET LOCAL session_replication_role = replica; UPDATE public.tournament_match_scores SET home_score = home_score + 1 WHERE match_operation_id = ${lit(S.op)}; COMMIT;`);
      await waitFor('concurrent lock held', async () => torneosSql(`select count(*) from pg_locks where relation = 'public.tournament_standings_revisions'::regclass
        and mode = 'ShareRowExclusiveLock' and granted`).trim() === '1', 40, 100);
      const row = await domain('standings: sources change during the rebuild', 'rebuild_tournament_standings', owner, { ...scope, p_reason: 'Recalcular', p_idempotency_key: randomUUID() }, 'TORNEOS_STANDINGS_SOURCES_CHANGED');
      const lock = await concurrent;
      assert.equal(lock.ok, true, lock.error);
      torneosSql(`begin; set local session_replication_role = replica; update public.tournament_match_scores set home_score = home_score - 1 where match_operation_id = ${lit(S.op)}; commit;`);
      if (AFTER) assert.ok(row.ms < 4500, `answered right after the concurrent commit (${row.ms} ms, lock held ≤ 3 s)`);
    });
    await check('B7 MATCH_CORRECTION_EXISTS: request a correction twice → 409; create the correction version twice → 409', async () => {
      const base = { p_organization_id: S.org, p_match_operation_id: S.op };
      await ok('request_tournament_match_correction', owner, { ...base, p_reason: 'Gol mal cargado' });
      await domain('correction: request twice', 'request_tournament_match_correction', owner, { ...base, p_reason: 'Otra pestaña' }, 'TORNEOS_MATCH_CORRECTION_EXISTS');
      await ok('create_tournament_match_correction', owner, base);
      await domain('correction: create twice', 'create_tournament_match_correction', owner, base, 'TORNEOS_MATCH_CORRECTION_EXISTS');
    });

    // ---------------------------------------------------------------- communications
    const draft = async (title, extra = {}) => {
      const r = await ok('create_tournament_announcement_draft', owner, { p_organization_id: S.org, p_tournament_id: S.L.id, p_category_id: null, p_announcement_type: 'general', p_title: title, p_summary: 'Resumen del aviso', p_body: 'Texto del aviso para el torneo.', p_priority: 'normal', p_acknowledgement_mode: 'none', p_scheduled_for: null, p_supersedes_id: null, p_correction_reason: null, p_idempotency_key: randomUUID(), ...extra });
      return r.id ?? r.announcementId ?? r;
    };
    const audience = (id, type = 'tournament') => ok('replace_tournament_announcement_audience', owner, { p_announcement_id: id, p_audience_type: type, p_category_id: null, p_team_entry_id: null, p_match_id: null, p_specific_user_id: null });
    const publish = (id) => ok('publish_tournament_announcement', owner, { p_announcement_id: id, p_expected_recipient_count: null });

    await check('B8 RECIPIENT_LIMIT_REACHED: an organization audience of 5 001 members → 422 (fixture members, removed afterwards)', async () => {
      torneosSql(`with ids as (insert into public.torneos_identity(core_user_id) select gen_random_uuid() from generate_series(1, 5001) returning id)
        insert into public.tournament_organization_members(organization_id, user_id, role, joined_at) select ${lit(S.org)}, id, 'collaborator', now() from ids`);
      try {
        S.big = await draft('Aviso a toda la organización');
        await audience(S.big, 'organization');
        await domain('announcement: 5 001 recipients', 'publish_tournament_announcement', owner, { p_announcement_id: S.big, p_expected_recipient_count: null }, 'TORNEOS_RECIPIENT_LIMIT_REACHED');
      } finally {
        torneosSql(`with gone as (delete from public.tournament_organization_members where organization_id = ${lit(S.org)} and role = 'collaborator' returning user_id)
          delete from public.torneos_identity where id in (select user_id from gone)`);
      }
    });
    await check('B9 CORRECTION_ALREADY_SUPERSEDED: two corrections of one published announcement; the second publication → 409 at once, one execution', async () => {
      const original = await draft('Horario de la fecha 1');
      await audience(original); await publish(original);
      const c1 = await draft('Horario corregido', { p_supersedes_id: original, p_correction_reason: 'Cambio de cancha' });
      const c2 = await draft('Horario corregido (otra pestaña)', { p_supersedes_id: original, p_correction_reason: 'Cambio de hora' });
      await audience(c1); await audience(c2);
      await publish(c1);
      assert.equal(torneosSql(`select status from public.tournament_announcements where id = ${lit(original)}`).trim(), 'superseded');
      const row = await domain('announcement: publish a second correction', 'publish_tournament_announcement', owner, { p_announcement_id: c2, p_expected_recipient_count: null }, 'TORNEOS_CORRECTION_ALREADY_SUPERSEDED');
      if (!AFTER && row.status === 503 && row.loopsStopped === undefined) row.loopsStopped = stopLoops('publish_tournament_announcement');
      S.openDrafts = [S.big, c2];
    });
    await check('B10 LINK_LIMIT_REACHED: a 6th link on an announcement → 422', async () => {
      S.linked = await draft('Aviso con enlaces');
      for (const [i, m] of S.L.matches.slice(0, 5).entries()) {
        await ok('set_tournament_announcement_link', owner, { p_announcement_id: S.linked, p_link_type: 'match', p_resource_id: m.id, p_external_url: null, p_label: `Partido ${i + 1}`, p_sort_order: i });
      }
      await domain('announcement: 6th link', 'set_tournament_announcement_link', owner, { p_announcement_id: S.linked, p_link_type: 'match', p_resource_id: S.L.matches[5].id, p_external_url: null, p_label: 'Partido 6', p_sort_order: 5 }, 'TORNEOS_LINK_LIMIT_REACHED');
    });
    await check('B11 AUDIENCE_LIMIT_REACHED: a 13th audience criterion → 422 (PostgREST: set_tournament_announcement_audience is executable by authenticated, not allowlisted in the gateway)', async () => {
      const token = await tok(owner);
      const criteria = [...S.L.teams.map((x) => ({ p_audience_type: 'team', p_team_entry_id: x.entry, p_match_id: null })),
        ...S.L.matches.map((m) => ({ p_audience_type: 'match', p_team_entry_id: null, p_match_id: m.id })),
        ...S.L.matches.slice(0, 3).map((m) => ({ p_audience_type: 'home_team', p_team_entry_id: null, p_match_id: m.id }))];
      assert.equal(criteria.length, 13);
      for (const c of criteria.slice(0, 12)) {
        const r = rest('/rpc/set_tournament_announcement_audience', { p_announcement_id: S.linked, p_category_id: null, p_specific_user_id: null, ...c }, token);
        assert.equal(r.status, 200, JSON.stringify(r));
      }
      const m = await executions('TORNEOS_AUDIENCE_LIMIT_REACHED', async () => rest('/rpc/set_tournament_announcement_audience', { p_announcement_id: S.linked, p_category_id: null, p_specific_user_id: null, ...criteria[12] }, token));
      const row = { case: 'announcement: 13th audience', rpc: 'set_tournament_announcement_audience', route: 'postgrest', expected: 422, status: m.response.status, code: m.response.body?.code, message: m.response.body?.message, ms: m.ms, executions: m.executions, executionsAfter3s: m.executionsAfter3s, stillRunning: m.stillRunning };
      mapping.push(row);
      if (AFTER) assert.deepEqual([row.status, row.code, row.message, row.executions, row.stillRunning], [422, 'PT422', 'TORNEOS_AUDIENCE_LIMIT_REACHED', 1, false]);
    });
    await check('B12 PUBLISH_RATE_LIMITED: the 21st publication of the hour in the organization → 429', async () => {
      const published = () => Number(torneosSql(`select count(*) from public.tournament_announcements where organization_id = ${lit(S.org)} and status in ('published','superseded','archived','revoked') and published_at >= now() - interval '1 hour'`).trim());
      while (published() < 20) { const id = await draft(`Aviso ${published() + 1}`); await audience(id); await publish(id); }
      S.limited = await draft('Aviso 21'); await audience(S.limited);
      await domain('announcement: 21st publication in an hour', 'publish_tournament_announcement', owner, { p_announcement_id: S.limited, p_expected_recipient_count: null }, 'TORNEOS_PUBLISH_RATE_LIMITED');
    });
    await check('B13 DRAFT_LIMIT_REACHED: the 101st open draft of the author → 422', async () => {
      const open = () => Number(torneosSql(`select count(*) from public.tournament_announcements where organization_id = ${lit(S.org)} and author_user_id = ${lit(owner.identity)} and status in ('draft','scheduled')`).trim());
      while (open() < 100) await Promise.all(Array.from({ length: Math.min(10, 100 - open()) }, (_, i) => draft(`Borrador ${i}-${randomUUID().slice(0, 4)}`)));
      assert.equal(open(), 100);
      await domain('announcement: 101st draft', 'create_tournament_announcement_draft', owner, { p_organization_id: S.org, p_tournament_id: S.L.id, p_category_id: null, p_announcement_type: 'general', p_title: 'Uno más', p_summary: 'Resumen del aviso', p_body: 'Texto del aviso para el torneo.', p_priority: 'normal', p_acknowledgement_mode: 'none', p_scheduled_for: null, p_supersedes_id: null, p_correction_reason: null, p_idempotency_key: randomUUID() }, 'TORNEOS_DRAFT_LIMIT_REACHED');
    });

    // ---------------------------------------------------------------- finished competition (tournament C)
    await check('B14 QUALIFICATION_AMBIGUOUS: a 0-0 league of two leaves the table tied → "Resolver clasificados" → 409', async () => {
      const scope = { p_organization_id: S.org, p_tournament_id: S.C.id, p_category_id: S.C.category };
      await ok('freeze_tournament_participants', owner, { ...scope, p_idempotency_key: randomUUID() });
      S.C.fixture = (await ok('generate_tournament_fixture', owner, { ...scope, p_seed: null, p_configuration: {}, p_idempotency_key: randomUUID() })).fixtureVersionId;
      await ok('publish_tournament_fixture', owner, { p_organization_id: S.org, p_fixture_version_id: S.C.fixture });
      await ok('start_tournament_competition', owner, { p_organization_id: S.org, p_tournament_id: S.C.id });
      const [match] = matchesOf(S.C.fixture);
      S.C.match = match;
      await scheduleAt(match.id, 1, S.courtC);
      await officialResult(match.id, match.home, 0, 0);
      const rev = await ok('rebuild_tournament_standings', owner, { ...scope, p_phase_id: match.phase, p_group_id: null, p_reason: 'Fin de la liga', p_idempotency_key: randomUUID() });
      S.C.revision = rev?.revisionId ?? rev?.id ?? rev;
      await ok('publish_tournament_standings_revision', owner, { p_revision_id: S.C.revision, p_reason: 'Tabla final' });
      const statuses = torneosSql(`select string_agg(distinct classification_status, ',') from public.tournament_team_standings where revision_id = ${lit(S.C.revision)}`).trim();
      if (!statuses.includes('manual_review')) {
        // The tie-break chain decided the tie (e.g. by draw order): pin the certified manual-review state as a fixture.
        torneosSql(`begin; set local session_replication_role = replica; update public.tournament_team_standings set classification_status = 'manual_review' where revision_id = ${lit(S.C.revision)}; commit;`);
      }
      const row = await domain('qualification: tied table', 'resolve_tournament_qualification', owner, { p_revision_id: S.C.revision, p_reason: 'Clasificación' }, 'TORNEOS_QUALIFICATION_AMBIGUOUS');
      row.fixture = statuses.includes('manual_review') ? 'natural tie' : `classification pinned to manual_review (was ${statuses})`;
    });
    await check('B15 COMPETITION_READ_ONLY: after "Finalizar", appending playoffs → 409 (was 500) and changing the dual-control policy → 409 (was 400)', async () => {
      await ok('finish_tournament_competition', owner, { p_organization_id: S.org, p_tournament_id: S.C.id });
      await domain('finished: append playoffs', 'append_tournament_playoff_phase', owner, { p_organization_id: S.org, p_tournament_id: S.C.id, p_category_id: S.C.category, p_source_phase_id: S.C.match.phase, p_qualifier_count: 2, p_double_leg: false, p_idempotency_key: randomUUID() }, 'TORNEOS_COMPETITION_READ_ONLY');
      await domain('finished: dual-control policy', 'set_tournament_match_dual_control', owner, { p_organization_id: S.org, p_tournament_id: S.C.id, p_enabled: true }, 'TORNEOS_COMPETITION_READ_ONLY');
    });

    // ================================================================ D. what does not change
    await check('D1 genuine server error: a corrupted tournament (discipline rules row missing) → rebuild answers an unstructured 500 (P0002), passed through unchanged', async () => {
      const saved = torneosSql(`select row_to_json(r) from public.tournament_discipline_rules r where tournament_id = ${lit(S.L.id)}`).trim();
      assert.ok(saved);
      torneosSql(`begin; set local session_replication_role = replica; delete from public.tournament_discipline_rules where tournament_id = ${lit(S.L.id)}; commit;`);
      let r;
      try {
        r = await gw('rebuild_tournament_standings', await tok(owner), { p_organization_id: S.org, p_tournament_id: S.L.id, p_category_id: S.L.category, p_phase_id: S.L.phase, p_group_id: null, p_reason: 'Recalcular', p_idempotency_key: randomUUID() });
      } finally {
        torneosSql(`begin; set local session_replication_role = replica; insert into public.tournament_discipline_rules select * from json_populate_record(null::public.tournament_discipline_rules, ${lit(saved)}::json); commit;`);
      }
      mapping.push({ case: 'genuine: INTO STRICT on corrupted data', rpc: 'rebuild_tournament_standings', route: 'gateway', expected: 500, status: r.status, code: errCode(r), message: errMsg(r) });
      assert.equal(r.status, 500, show(r));
      assert.equal(errCode(r), 'P0002');
      assert.doesNotMatch(errMsg(r) ?? '', /^TORNEOS_/, 'unstructured: the transport treats it as an outage (fail closed)');
    });
    await check('D2 gateway timeout: Torneos REST frozen → 503 {error:"access denied"} after the 5 s budget (TORNEOS_UNAVAILABLE in the transport), then recovery', async () => {
      const token = await tok(owner);
      setService('torneos-rest', 'pause');
      let r; const t0 = Date.now();
      try { r = await gw('get_tournament_workspace_context', token, {}); } finally { setService('torneos-rest', 'unpause'); }
      const ms = Date.now() - t0;
      mapping.push({ case: 'genuine: upstream timeout', rpc: 'get_tournament_workspace_context', route: 'gateway', expected: 503, status: r.status, code: errCode(r), ms });
      assert.deepEqual([r.status, r.body], [503, { error: 'access denied' }]);
      assert.ok(ms >= 4500 && ms < 9000, `${ms} ms`);
      await waitFor('Torneos REST', async () => (await gw('get_tournament_workspace_context', token, {})).status === 200);
    });
    await check('D3 401 / 403 unchanged: no bearer and a forged bearer → 401; an RPC outside the allowlist → 403 rpc not enabled; another workspace → 403 42501', async () => {
      const none = await gw('resolve_tournament_qualification', null, { p_revision_id: S.L.revision, p_reason: 'x' });
      assert.deepEqual([none.status, none.body], [401, { error: 'access denied' }]);
      const forged = await gw('resolve_tournament_qualification', 'a.b.c', { p_revision_id: S.L.revision, p_reason: 'x' });
      assert.deepEqual([forged.status, forged.body], [401, { error: 'access denied' }]);
      const closed = await gw('mark_tournament_suspension_served', await tok(owner), {});
      assert.deepEqual([closed.status, closed.body], [403, { error: 'rpc not enabled' }]);
      const cross = await gw('resolve_tournament_qualification', await tok(outsider), { p_revision_id: S.L.revision, p_reason: 'Clasificación' });
      assert.deepEqual([cross.status, errCode(cross), errMsg(cross)], [403, '42501', 'TORNEOS_QUALIFICATION_FORBIDDEN']);
    });
    await check('D4 bearer: every domain error of this run left the same bearer working; none was answered 5xx', async () => {
      const domainRows = mapping.filter((r) => r.route === 'gateway' && r.expected >= 409 && r.expected < 500);
      assert.ok(domainRows.length >= 14, `${domainRows.length} domain cases`);
      if (AFTER) {
        assert.deepEqual(domainRows.filter((r) => !r.bearerPreserved).map((r) => r.case), []);
        assert.deepEqual(domainRows.filter((r) => r.status >= 500).map((r) => r.case), []);
      }
    });
    await check('D5 no-store: every gateway response of this run carried Cache-Control: no-store', async () => {
      assert.deepEqual(noStore.filter((r) => !/no-store/.test(r.cacheControl ?? '')), []);
      assert.ok(noStore.length > 200, `${noStore.length} responses`);
    });
  } finally {
    const summary = { run: RUN, gateway: GATEWAY_NAME, phase: PHASE, at: new Date().toISOString(), total: results.length,
      passed: results.filter((r) => r.status === 'PASS').length, failed: results.filter((r) => r.status === 'FAIL').length };
    if (process.env.EC_EVIDENCE === '1') {
      const dir = `${repo}backend/torneos/error-contract-v1/evidence/${GATEWAY_NAME}`;
      await mkdir(dir, { recursive: true });
      const payload = JSON.stringify({ summary, results, mapping,
        no_store: { responses: noStore.length, without_no_store: noStore.filter((r) => !/no-store/.test(r.cacheControl ?? '')).length } }, null, 2) + '\n';
      for (const secret of seenSecrets.filter(Boolean)) if (payload.includes(secret)) throw new Error('evidence would leak a secret');
      await writeFile(`${dir}/${PHASE}.json`, payload);
    }
    console.log(JSON.stringify(summary));
    console.log(JSON.stringify(mapping));
  }
});
