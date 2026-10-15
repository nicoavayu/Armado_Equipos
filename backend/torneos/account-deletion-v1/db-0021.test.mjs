// ACCOUNT ERASURE 0021: the migration's own guarantees (static), the operator driver offline (fake catalogs), and the real
// transitions on the hosted-like lab as the installer: observe → apply → re-apply refused → rollback refused while the
// ledger has rows → forced rollback (anonymised data stays: irreversible by design) → re-apply. Ends at POST_0021.
//   node --test --test-concurrency=1 backend/torneos/account-deletion-v1/db-0021.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { ACL, BODIES, ERASURE_ROLE, FILES, GUARDS, REF, TABLE, changedOutside, classify, phraseFor, run } from './remote/db-0021.mjs';
import { body } from './remote/pin-0021.mjs';
import * as EL from './remote/erasure-login.mjs';
import { scramKeys } from '../infra/torneos-gateway-auth/gateway-auth-contract.mjs';

const MIGRATION = fs.readFileSync(FILES['apply-0021'].path, 'utf8');
const ROLLBACK = fs.readFileSync(FILES['rollback-0021'].path, 'utf8');
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const md5 = (text) => crypto.createHash('md5').update(text).digest('hex');
const statements = MIGRATION.replace(/--[^\n]*/g, '');

test('the pinned files and bodies are the ones in the tree', () => {
  assert.equal(sha256(MIGRATION), FILES['apply-0021'].sha256);
  assert.equal(sha256(ROLLBACK), FILES['rollback-0021'].sha256);
  assert.equal(md5(body(MIGRATION, 'private.erase_tournament_account')), BODIES.POST_0021.erase);
  assert.equal(md5(body(MIGRATION, 'private.confirm_tournament_account_erasure')), BODIES.POST_0021.confirm);
  assert.equal(md5(body(MIGRATION, 'private.account_erasure_label')), BODIES.POST_0021.label);
  assert.equal(phraseFor('apply-0021'), `APPLY TORNEOS 0021 ${REF} ${FILES['apply-0021'].sha256.slice(0, 12)}`);
  assert.equal(phraseFor('rollback-0021', { force: true }), `ROLLBACK TORNEOS 0021 ${REF} ${FILES['rollback-0021'].sha256.slice(0, 12)} DISCARD ERASURE LEDGER`);
});

test('0021 adds three functions, one private table and one NOLOGIN role; it changes no existing body, policy, role, table or trigger definition', () => {
  assert.equal((statements.match(/create function/gi) || []).length, 3);
  assert.equal((statements.match(/create table/gi) || []).length, 1);
  assert.deepEqual(statements.match(/create\s+role[^;]*;/gi), ['create role torneos_erasure_writer nologin noinherit;'], 'one role, no login, no attribute');
  for (const forbidden of [/create or replace/i, /create policy/i, /drop policy/i, /alter policy/i, /alter\s+role/i, /drop\s+role/i, /password/i,
    /grant\s+torneos_\w+\s+to/i, /drop\s+(function|table|trigger)/i,
    /create\s+trigger/i, /security\s+invoker/i, /grant\s+(select|insert|update|delete|all)\s+on/i, /storage\./i, /cron\./i, /net\.http/i]) {
    assert.doesNotMatch(statements, forbidden, String(forbidden));
  }
  // The erasure role's grants, exactly; nothing to the core adapter (it used to run the erasure: no longer).
  assert.deepEqual(statements.match(/^grant [^;]*;/gmi), [
    'grant usage on schema private to torneos_erasure_writer;',
    'grant execute on function private.erase_tournament_account(uuid, uuid) to torneos_erasure_writer;',
    'grant execute on function private.confirm_tournament_account_erasure(uuid, uuid) to torneos_erasure_writer;',
  ]);
  for (const fn of ['erase_tournament_account', 'confirm_tournament_account_erasure']) {
    assert.match(statements, new RegExp(`revoke all on function private\\.${fn}\\(uuid, uuid\\)\\s+from public, anon, authenticated, service_role, torneos_core_adapter, torneos_identity_writer;`), fn);
  }
  assert.match(statements, /revoke all on function private\.account_erasure_label\(text, uuid, uuid\) from public, anon, authenticated, service_role;/);
  assert.match(statements, /revoke all on private\.tournament_account_erasures from public, anon, authenticated, service_role;/);
  assert.match(MIGRATION, /^BEGIN;/m); assert.match(MIGRATION, /^COMMIT;/m);
});

test('the ledger states: torneos_erased → core_confirmed (by core or operator); the confirmation sweeps first and refuses to leave a row unconfirmed', () => {
  assert.match(statements, /state text not null default 'torneos_erased'/);
  assert.match(statements, /check \(state in \('torneos_erased', 'core_confirmed'\)\)/);
  assert.match(statements, /core_confirmed_by in \('core', 'operator'\)/);
  const confirm = body(MIGRATION, 'private.confirm_tournament_account_erasure');
  assert.match(MIGRATION, /create function private\.confirm_tournament_account_erasure[\s\S]*?security definer\nset search_path = ''/);
  assert.ok(confirm.indexOf('private.erase_tournament_account(p_core_user_id, p_request_id)') < confirm.indexOf("set state = 'core_confirmed'"), 'sweep before confirming');
  assert.match(confirm, /TORNEOS_ACCOUNT_ERASURE_POSTCONDITION_FAILED', detail = 'confirmation'/);
  assert.doesNotMatch(confirm, /\bcommit\b|\brollback\b|dblink|delete from/i);
  // The reconcile query is read only and shows no personal data; the completion only moves the state.
  const reconcileSql = fs.readFileSync('backend/torneos/account-deletion-v1/remote/reconcile-0021.sql', 'utf8').replace(/--[^\n]*/g, '');
  assert.doesNotMatch(reconcileSql, /\b(update|insert|delete|truncate|alter|create|drop|grant)\b/i);
  assert.match(reconcileSql, /e\.state = 'torneos_erased'/);
  assert.match(reconcileSql, /interval '24 hours'/);
  assert.doesNotMatch(reconcileSql, /display_name|email|core_user_id\s+as|select\s+i\.core_user_id/i);
  const complete = fs.readFileSync('backend/torneos/account-deletion-v1/remote/reconcile-complete-0021.sql', 'utf8').replace(/--[^\n]*/g, '');
  assert.deepEqual(complete.match(/\b(update|insert into|delete from)\s+\S+/gi), ['update private.tournament_account_erasures']);
  assert.match(complete, /core_confirmed_by = 'operator'/);
});

test('the erasure login (out of band): SCRAM verifier only, LOGIN NOINHERIT, member of the erasure role only; Secret Manager names', () => {
  const pw = crypto.randomBytes(30).toString('base64url');
  const { password, verifier } = EL.newCredential(crypto.randomBytes);
  assert.match(verifier, /^SCRAM-SHA-256\$4096:/);
  const salt = Buffer.from(verifier.split('$')[1].split(':')[1], 'base64');
  assert.equal(verifier.split('$')[2].split(':')[0], scramKeys(password, salt, 4096).storedKey.toString('base64'), 'the verifier is of this password');
  const sql = EL.renderProvisionSql(verifier);
  assert.ok(!sql.includes(password), 'the plaintext never reaches the SQL');
  assert.match(sql, /CREATE ROLE torneos_edge_erasure_writer LOGIN NOINHERIT PASSWORD 'SCRAM-SHA-256\$/);
  assert.match(sql, /GRANT torneos_erasure_writer TO torneos_edge_erasure_writer;/);
  assert.match(sql, /ERASURE_LOGIN_ALREADY_PRESENT/);
  assert.equal((sql.match(/GRANT /g) || []).length, 1);
  assert.doesNotMatch(sql, /torneos_core_adapter|torneos_identity_writer|SUPERUSER|CREATEROLE|BYPASSRLS| INHERIT/);
  assert.throws(() => EL.renderProvisionSql(`md5${'a'.repeat(32)}`), /verifier_shape/);
  assert.throws(() => EL.renderRotationSql(pw), /verifier_shape/, 'a plaintext password is refused');
  assert.match(EL.renderRotationSql(verifier), /ALTER ROLE torneos_edge_erasure_writer PASSWORD 'SCRAM-SHA-256\$/);
  assert.ok(!EL.PROVISION_SQL_TEMPLATE.includes('SCRAM-SHA-256$'), 'the printable template masks the verifier');
  assert.equal(EL.erasureDbUrl({ poolerHost: 'aws-0-sa-east-1.pooler.supabase.com', password: pw }),
    `postgres://torneos_edge_erasure_writer.${REF}:${pw}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`);
  assert.throws(() => EL.erasureDbUrl({ poolerHost: 'aws-0-us-east-1.pooler.supabase.com', password: pw }), /pooler_host/);
  assert.deepEqual([EL.ERASURE_ENV, EL.GCP.secret, EL.GCP.project], ['TORNEOS_DB_ERASURE_WRITER_URL', 'torneos-gw-db-erasure-writer-url', 'arma2-465223']);
});

test('the erasure body: security definer + empty search_path, one transaction, every bypassed guard re-enabled and verified, payments never written', () => {
  const erase = body(MIGRATION, 'private.erase_tournament_account');
  assert.match(MIGRATION, /create function private\.erase_tournament_account[\s\S]*?security definer\nset search_path = ''/);
  assert.doesNotMatch(erase, /\bcommit\b|\brollback\b|dblink|pg_background/i, 'no autonomous or partial commit');
  // Every DISABLE has its ENABLE, on the same constant list the start-up and final checks verify.
  const disabled = [...erase.matchAll(/alter table (\S+) disable trigger (\w+)/g)].map((m) => `${m[1]}|${m[2]}`).sort();
  const enabled = [...erase.matchAll(/alter table (\S+) enable trigger (\w+)/g)].map((m) => `${m[1]}|${m[2]}`).sort();
  assert.deepEqual(disabled, enabled);
  assert.deepEqual(disabled, GUARDS.map((g) => `${g.rel}|${g.trigger}`).sort());
  const constant = /c_guards constant text\[\] := array\[([\s\S]*?)\];/.exec(erase)[1].match(/'([^']+)'/g).map((x) => x.slice(1, -1)).sort();
  assert.deepEqual(constant, disabled);
  assert.match(erase, /TORNEOS_ACCOUNT_ERASURE_GUARD_STATE/);
  assert.match(erase, /TORNEOS_ACCOUNT_ERASURE_POSTCONDITION_FAILED', detail = 'guard '/);
  // Purchases, purchase events, grants, plans, payments: read nowhere, written nowhere.
  assert.doesNotMatch(erase, /tournament_purchase|plan_grant|payment|entitlement|tournament_seasons/i);
  // History tables are never written: events, scores, outcomes, standings, statistics, announcements, documents, audit (insert only).
  for (const table of ['tournament_match_events', 'tournament_match_scores', 'tournament_match_outcomes', 'tournament_team_standings',
    'tournament_player_statistics', 'tournament_discipline_ledgers', 'tournament_announcements', 'tournament_document_acknowledgements']) {
    assert.doesNotMatch(erase, new RegExp(`(update|delete from) public\\.${table}\\b`), table);
  }
  assert.doesNotMatch(erase, /(update|delete from) public\.tournament_audit_log/);
  assert.match(erase, /pg_advisory_xact_lock/);
  assert.match(erase, /to_regclass\('public\.tournament_organization_sponsors'\) is not null/, '0020 handled only when present');
  // 0022 (moderation) handled only when present, through dynamic SQL: reports detached / scrubbed, mutes and blocks of the person deleted.
  assert.match(erase, /to_regclass\('public\.tournament_content_reports'\) is not null/, '0022 handled only when present');
  for (const table of ['tournament_content_reports', 'tournament_content_report_events', 'tournament_communication_mutes', 'tournament_applicant_blocks']) {
    assert.match(erase, new RegExp(`execute '(update|delete from) public\\.${table}\\b`), table);
  }
});

// Other branches' migrations (0020 #212, 0022 #216) join the scan when given, as in the lab variants: the matrix must
// classify their tables too before they reach main.
const EXTRA_MIGRATIONS = [process.env.ACCOUNT_DELETION_WITH_0020, process.env.ACCOUNT_DELETION_WITH_0022].filter(Boolean);
test(`every foreign key to torneos_identity in the tree${EXTRA_MIGRATIONS.length ? ` (+ ${EXTRA_MIGRATIONS.map((f) => f.split('/').pop().slice(0, 14)).join(', ')})` : ''} is classified by the design matrix (a new one fails here until classified)`, () => {
  const dir = 'backend/torneos/supabase/migrations';
  const all = [...fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => fs.readFileSync(`${dir}/${f}`, 'utf8')),
    ...EXTRA_MIGRATIONS.map((f) => fs.readFileSync(f, 'utf8'))].join('\n');
  const design = fs.readFileSync('docs/superpowers/specs/2026-10-15-torneos-account-deletion-design.md', 'utf8');
  const tables = new Set();
  // ALTER TABLE … ADD CONSTRAINT … REFERENCES public.torneos_identity (baseline) and inline column references (later migrations).
  for (const m of all.matchAll(/ALTER TABLE ONLY (\S+)\s+ADD CONSTRAINT \w+ FOREIGN KEY \([^)]*\) REFERENCES public\.torneos_identity/gi)) tables.add(m[1].replace(/^public\./, ''));
  for (const m of all.matchAll(/create table(?: if not exists)? (\S+) \(([\s\S]*?)\n\);/gi)) {
    if (/references public\.torneos_identity/i.test(m[2])) tables.add(m[1].replace(/^public\./, ''));
  }
  const missing = [...tables].filter((t) => !design.includes(`\`${t}\``)).sort();
  assert.deepEqual(missing, [], 'add these tables to the matrix (and to the erasure if they hold personal data)');
  assert.ok(tables.size >= 60, `found ${tables.size}`);
});

const kept = { kept_fn: { count: 900, digest: 'f' }, kept_relations: { count: 300, digest: 'r' }, kept_policies: { count: 400, digest: 'p' }, kept_triggers: { count: 120, digest: 't' } };
const catalogAt = (state, mutate = (c) => c) => mutate({
  torneos_tables: true,
  prerequisites: { connected_v1: true, core_adapter_role: true, identity_trigger: true, guards: JSON.parse(JSON.stringify(GUARDS)), sponsors_0020: false },
  bodies: { ...BODIES[state] }, acl: JSON.parse(JSON.stringify(ACL[state])), table: TABLE[state] ? { ...TABLE[state] } : null,
  erasure_role: JSON.parse(JSON.stringify(ERASURE_ROLE[state])), erasure_role_logins: state === 'POST_0021' ? ['torneos_edge_erasure_writer'] : [],
  rows: state === 'POST_0021' ? 0 : null, counts: { authenticated: 600, anon: 30 }, ...JSON.parse(JSON.stringify(kept)),
});

test('classify: the two states (with or without 0020), and every drift by name', () => {
  assert.deepEqual(classify(catalogAt('PRE_0021')), { state: 'PRE_0021', failures: [] });
  assert.deepEqual(classify(catalogAt('POST_0021')), { state: 'POST_0021', failures: [] });
  assert.equal(classify(catalogAt('POST_0021', (c) => { c.prerequisites.sponsors_0020 = true; return c; })).state, 'POST_0021');
  assert.equal(classify(null).state, 'DRIFT');
  assert.deepEqual(classify(catalogAt('POST_0021', (c) => { c.bodies.erase = 'x'; return c; })).state, 'DRIFT');
  assert.match(classify(catalogAt('POST_0021', (c) => { c.acl.erase.authenticated = true; return c; })).failures.join(), /acl\.erase/);
  assert.match(classify(catalogAt('POST_0021', (c) => { c.table.client_grants = true; return c; })).failures.join(), /table/);
  assert.match(classify(catalogAt('PRE_0021', (c) => { c.prerequisites.guards[0].enabled = 'D'; return c; })).failures.join(), /guards/);
  assert.match(classify(catalogAt('PRE_0021', (c) => { c.prerequisites.guards[3].owned_by_installer = false; return c; })).failures.join(), /guards/);
  assert.match(classify(catalogAt('PRE_0021', (c) => { c.prerequisites.core_adapter_role = false; return c; })).failures.join(), /torneos_core_adapter_missing/);
  assert.match(classify(catalogAt('PRE_0021', (c) => { c.rows = 3; return c; })).failures.join(), /rows_without_table/);
  // The erasure role, whole: the core adapter running the erasure again, an extra grant, a login attribute → drift.
  assert.match(classify(catalogAt('POST_0021', (c) => { c.acl.erase.core_adapter = true; return c; })).failures.join(), /acl\.erase/);
  assert.match(classify(catalogAt('POST_0021', (c) => { c.acl.confirm.erasure_writer = false; return c; })).failures.join(), /acl\.confirm/);
  assert.match(classify(catalogAt('POST_0021', (c) => { c.erasure_role.relations = 1; return c; })).failures.join(), /erasure_role/);
  assert.match(classify(catalogAt('POST_0021', (c) => { c.erasure_role.functions.push('private.current_identity_id()'); return c; })).failures.join(), /erasure_role/);
  assert.match(classify(catalogAt('POST_0021', (c) => { c.erasure_role.login = true; return c; })).failures.join(), /erasure_role/);
  assert.match(classify(catalogAt('POST_0021', (c) => { c.erasure_role.schemas.push('public'); return c; })).failures.join(), /erasure_role/);
  assert.match(classify(catalogAt('PRE_0021', (c) => { c.erasure_role = { ...ERASURE_ROLE.POST_0021 }; return c; })).failures.join(), /erasure_role/);
  assert.equal(classify(catalogAt('POST_0021', (c) => { c.erasure_role_logins = []; return c; })).state, 'POST_0021', 'the login is provisioned after 0021, out of band');
});

test('changedOutside: anything else moving is named; EXECUTE counts of anon/authenticated must not move at all', () => {
  const a = catalogAt('PRE_0021'); const b = catalogAt('POST_0021');
  assert.deepEqual(changedOutside(a, b), []);
  assert.deepEqual(changedOutside(a, catalogAt('POST_0021', (c) => { c.kept_fn.digest = 'g'; c.kept_triggers.digest = 'u'; return c; })), ['kept_fn', 'kept_triggers']);
  assert.deepEqual(changedOutside(a, catalogAt('POST_0021', (c) => { c.counts.authenticated += 1; return c; })), ['counts']);
});

test('run(): phrase, file hash, pre-state and the ledger refusal are checked before any write', async () => {
  const writes = [];
  const fake = (states, rows = 0) => {
    let i = 0;
    return { readFile: (p) => fs.readFileSync(p), catalog: async () => { const c = catalogAt(states[Math.min(i, states.length - 1)]); i += 1; if (c.rows !== null) c.rows = rows; return c; },
      applySql: async (t) => { writes.push(t); return { code: 0 }; } };
  };
  await assert.rejects(run('apply-0021', ['APPLY'], fake(['PRE_0021'])), /PHRASE_REQUIRED/);
  await assert.rejects(run('apply-0021', phraseFor('apply-0021').split(' '), fake(['POST_0021'])), /PRE_STATE_POST_0021/);
  await assert.rejects(run('apply-0021', phraseFor('apply-0021').split(' '), { ...fake(['PRE_0021']), readFile: () => Buffer.from('x') }), /FILE_HASH_MISMATCH/);
  await assert.rejects(run('rollback-0021', phraseFor('rollback-0021').split(' '), fake(['POST_0021'], 2)), /ROLLBACK_REFUSED 2 ledger rows/);
  assert.equal(writes.length, 0, 'every refusal happened before any write');
  const applied = await run('apply-0021', phraseFor('apply-0021').split(' '), fake(['PRE_0021', 'POST_0021']));
  assert.equal(applied.verdict, 'APPLY_0021_DONE');
  const forced = await run('rollback-0021', phraseFor('rollback-0021', { force: true }).split(' '), fake(['POST_0021', 'PRE_0021'], 2));
  assert.deepEqual([forced.verdict, forced.forced], ['ROLLBACK_0021_DONE', true]);
  assert.match(writes.at(-1), /^SET torneos\.account_erasure_rollback_force = 'DISCARD ERASURE LEDGER';/);
});

test('the rollback removes only what 0021 added, refuses with ledger rows unless forced, and touches no data', () => {
  const r = ROLLBACK.replace(/--[^\n]*/g, '');
  assert.match(r, /drop function private\.erase_tournament_account\(uuid, uuid\);/);
  assert.match(r, /drop function private\.account_erasure_label\(text, uuid, uuid\);/);
  assert.match(r, /drop function private\.confirm_tournament_account_erasure\(uuid, uuid\);/);
  assert.match(r, /drop table private\.tournament_account_erasures;/);
  assert.match(r, /revoke usage on schema private from torneos_erasure_writer;\ndrop role torneos_erasure_writer;/);
  assert.doesNotMatch(r, /drop role torneos_edge/i, 'the out-of-band login is the operator\'s to keep or drop');
  assert.match(r, /TORNEOS_ACCOUNT_ERASURE_ROLLBACK_REFUSED/);
  assert.doesNotMatch(r, /update |delete from|truncate|insert into|alter table/i);
});

// ------------------------------------------------------------------------------------------------ the lab (installer)
if (process.env.ACCOUNT_DELETION_SKIP_LAB !== '1') {
  const { prepare, toPre, drive, installerPool, gatewayLoginUrl, provisionErasureLogin } = await import('./test/lab.mjs');
  const { erasureDb, evidence } = await import('./test/support.mjs');
  const record = evidence('db-0021-lab');
  const pg = (await import('pg')).default;

  test('lab: observe → apply → re-apply refused → rollback refused with ledger rows → forced rollback (anonymisation stays) → re-apply', async () => {
    await prepare();
    await toPre();
    const observed = await drive('observe');
    record({ step: 'observe', verdict: observed.verdict, sponsors0020: observed.catalog.prerequisites.sponsors_0020 });
    assert.deepEqual(observed.verdict, { state: 'PRE_0021', failures: [] });

    const applied = await drive('apply-0021');
    record({ step: 'apply-0021', verdict: applied.verdict, before: applied.before, after: applied.after, changedOutside: applied.changedOutside });
    assert.deepEqual([applied.verdict, applied.before, applied.after, applied.changedOutside], ['APPLY_0021_DONE', 'PRE_0021', 'POST_0021', []]);

    await assert.rejects(drive('apply-0021'), /PRE_STATE_POST_0021/);
    record({ step: 're-apply', refused: true });

    // The erasure login, provisioned with the operator's SQL after 0021: observed (by name) without changing the state.
    gatewayLoginUrl('erasureWriter');
    const provisioned = await drive('observe');
    assert.deepEqual([provisioned.verdict.state, provisioned.catalog.erasure_role_logins], ['POST_0021', ['torneos_edge_erasure_writer']]);
    record({ step: 'erasure login provisioned (SCRAM, out of band)', state: provisioned.verdict.state, logins: provisioned.catalog.erasure_role_logins,
      role: provisioned.catalog.erasure_role });

    // Rotation (runbook): a new verifier for the same login; the old password stops working at COMMIT, the new one works.
    const oldUrl = gatewayLoginUrl('erasureWriter');
    const rotation = provisionErasureLogin();
    assert.equal(rotation.rotated, true);
    const tryLogin = async (url) => { const c = new pg.Client({ connectionString: url }); try { await c.connect(); await c.query('select 1'); return 'ok'; } catch (e) { return e.code ?? e.message; } finally { await c.end().catch(() => {}); } };
    assert.equal(await tryLogin(oldUrl), '28P01', 'the old password is refused');
    assert.equal(await tryLogin(rotation.url), 'ok');
    record({ step: 'erasure credential rotated', oldPassword: '28P01 refused', newPassword: 'ok' });

    // One fictional person erased: the ledger has a row.
    const pool = installerPool();
    const db = erasureDb();
    try {
      const id = randomUUID(); const core = randomUUID();
      await pool.query('insert into public.torneos_identity(id, core_user_id) values ($1, $2)', [id, core]);
      await pool.query("insert into public.tournament_user_profiles(user_id, display_name) values ($1, 'Rollback Ficticio')", [id]);
      assert.equal((await db.erase(core)).outcome, 'erased');
      await assert.rejects(drive('rollback-0021'), /ROLLBACK_REFUSED 1 ledger rows|ROLLBACK_REFUSED \d+ ledger rows/);
      record({ step: 'rollback without force', refused: true });

      const rolled = await drive('rollback-0021', { force: true });
      record({ step: 'rollback-0021 (forced)', verdict: rolled.verdict, before: rolled.before, after: rolled.after, changedOutside: rolled.changedOutside, forced: rolled.forced });
      assert.deepEqual([rolled.verdict, rolled.after, rolled.changedOutside], ['ROLLBACK_0021_DONE', 'PRE_0021', []]);
      // What the rollback cannot restore: the profile stays deleted, the identity stays severed.
      const after = (await pool.query('select (select count(*)::int from public.tournament_user_profiles where user_id = $1) profiles, (select count(*)::int from public.torneos_identity where core_user_id = $2) mapped', [id, core])).rows[0];
      assert.deepEqual(after, { profiles: 0, mapped: 0 });
      record({ step: 'after rollback: the erasure is not undone', profiles: after.profiles, identityStillMapped: after.mapped });

      const again = await drive('apply-0021');
      record({ step: 're-apply after rollback', verdict: again.verdict, changedOutside: again.changedOutside });
      assert.deepEqual([again.verdict, again.changedOutside], ['APPLY_0021_DONE', []]);
      // The role is new: the login lost its membership with the rollback and is refused until the runbook's re-grant.
      await assert.rejects(db.erase(core), /permission denied to set role/);
      gatewayLoginUrl('erasureWriter'); // REGRANT_SQL
      record({ step: 'erasure login after rollback + re-apply', beforeRegrant: 'permission denied to set role', afterRegrant: 'ok' });
      // The ledger was discarded: the same Core user is now answered as no_identity (nothing left to erase either way).
      assert.equal((await db.erase(core)).outcome, 'no_identity');
      record({ step: 'erasure of the same user after rollback + re-apply', outcome: 'no_identity' });
    } finally { await db.end(); await pool.end(); }
    const final = await drive('observe');
    assert.equal(final.verdict.state, 'POST_0021');
    record({ step: 'final observe', state: final.verdict.state, readOnly: final.catalog.tx_read_only });
    assert.equal(final.catalog.tx_read_only, 'on', 'the catalog runs in a read-only transaction');
  });
}
