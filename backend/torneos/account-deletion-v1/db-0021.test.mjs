// ACCOUNT ERASURE 0021: the migration's own guarantees (static), the operator driver offline (fake catalogs), and the real
// transitions on the hosted-like lab as the installer: observe → apply → re-apply refused → rollback refused while the
// ledger has rows → forced rollback (anonymised data stays: irreversible by design) → re-apply. Ends at POST_0021.
//   node --test --test-concurrency=1 backend/torneos/account-deletion-v1/db-0021.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { ACL, BODIES, FILES, GUARDS, REF, TABLE, changedOutside, classify, phraseFor, run } from './remote/db-0021.mjs';
import { body } from './remote/pin-0021.mjs';

const MIGRATION = fs.readFileSync(FILES['apply-0021'].path, 'utf8');
const ROLLBACK = fs.readFileSync(FILES['rollback-0021'].path, 'utf8');
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const md5 = (text) => crypto.createHash('md5').update(text).digest('hex');
const statements = MIGRATION.replace(/--[^\n]*/g, '');

test('the pinned files and bodies are the ones in the tree', () => {
  assert.equal(sha256(MIGRATION), FILES['apply-0021'].sha256);
  assert.equal(sha256(ROLLBACK), FILES['rollback-0021'].sha256);
  assert.equal(md5(body(MIGRATION, 'private.erase_tournament_account')), BODIES.POST_0021.erase);
  assert.equal(md5(body(MIGRATION, 'private.account_erasure_label')), BODIES.POST_0021.label);
  assert.equal(phraseFor('apply-0021'), `APPLY TORNEOS 0021 ${REF} ${FILES['apply-0021'].sha256.slice(0, 12)}`);
  assert.equal(phraseFor('rollback-0021', { force: true }), `ROLLBACK TORNEOS 0021 ${REF} ${FILES['rollback-0021'].sha256.slice(0, 12)} DISCARD ERASURE LEDGER`);
});

test('0021 adds two functions and one private table; it changes no existing body, policy, role, table or trigger definition', () => {
  assert.equal((statements.match(/create function/gi) || []).length, 2);
  assert.equal((statements.match(/create table/gi) || []).length, 1);
  for (const forbidden of [/create or replace/i, /create policy/i, /drop policy/i, /alter policy/i, /alter\s+role/i, /create\s+role/i, /drop\s+(function|table|trigger)/i,
    /create\s+trigger/i, /security\s+invoker/i, /grant\s+(select|insert|update|delete|all)\s+on/i, /storage\./i, /cron\./i, /net\.http/i]) {
    assert.doesNotMatch(statements, forbidden, String(forbidden));
  }
  assert.equal((statements.match(/^grant /gmi) || []).length, 1, 'one grant only');
  assert.match(statements, /grant execute on function private\.erase_tournament_account\(uuid, uuid\) to torneos_core_adapter;/);
  assert.match(statements, /revoke all on function private\.erase_tournament_account\(uuid, uuid\) from public, anon, authenticated, service_role;/);
  assert.match(statements, /revoke all on function private\.account_erasure_label\(text, uuid, uuid\) from public, anon, authenticated, service_role;/);
  assert.match(statements, /revoke all on private\.tournament_account_erasures from public, anon, authenticated, service_role;/);
  assert.match(MIGRATION, /^BEGIN;/m); assert.match(MIGRATION, /^COMMIT;/m);
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
});

test('every foreign key to torneos_identity in the tree is classified by the design matrix (a new one fails here until classified)', () => {
  const dir = 'backend/torneos/supabase/migrations';
  const all = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => fs.readFileSync(`${dir}/${f}`, 'utf8')).join('\n');
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
  assert.match(r, /drop table private\.tournament_account_erasures;/);
  assert.match(r, /TORNEOS_ACCOUNT_ERASURE_ROLLBACK_REFUSED/);
  assert.doesNotMatch(r, /update |delete from|truncate|insert into|alter table/i);
});

// ------------------------------------------------------------------------------------------------ the lab (installer)
if (process.env.ACCOUNT_DELETION_SKIP_LAB !== '1') {
  const { prepare, toPre, drive, installerPool } = await import('./test/lab.mjs');
  const { adapterDb, evidence } = await import('./test/support.mjs');
  const record = evidence('db-0021-lab');

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

    // One fictional person erased: the ledger has a row.
    const pool = installerPool();
    const db = adapterDb();
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
