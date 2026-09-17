#!/usr/bin/env node
// OFFLINE tests of the Phase 3B R3 tooling (decisions B/D/E/C of 2026-09-15). No socket is
// opened: transports and fetch are injected. Run:
//   node --test backend/torneos/phase3b/remote/core-contract.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { split, splitAndTrim } from './cli_parser.mjs';
import * as C from './core-contract.mjs';
import { assertReadOnlySql, run as runRead, QA_USERS_SQL, sessionExistsSql, AbortError } from './mgmt.mjs';
import { run as runWrite, ledgerState, applyDecision, assertWritePath } from './mgmt-write.mjs';
import { run as runRollback, assertRollbackPath, ALLOWED } from './mgmt-rollback.mjs';
import { probe, probeOnce, sign, classify } from './probe-core-contract.mjs';
import { runD1Positive, assertAnonKey } from './d1-positive.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const PAT = 'sbp_0123456789abcdef0123456789abcdef01234567';
const CORE = C.CORE_REF;
const PROD = C.PROD_REF;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const SECRET = 'ab'.repeat(32);
const rendered = C.renderAll(REPO);
const [V1, V11] = rendered;

// ───────────────────────── cli_parser: the CLI's own fixtures ─────────────────────────
test('cli_parser is the validated port (sha pinned) and splits all.sql into the 18 CLI fixtures + "\\n"', () => {
  assert.equal(sha(fs.readFileSync(path.join(HERE, 'cli_parser.mjs'))), C.CLI_PARSER_SHA256);
  const dir = path.join(HERE, 'testdata');
  const fixtures = fs.readdirSync(dir).filter((n) => n.startsWith('split_')).sort().map((n) => fs.readFileSync(path.join(dir, n), 'utf8'));
  assert.equal(fixtures.length, 18);
  const actual = split(fs.readFileSync(path.join(dir, 'all.sql')));
  assert.deepEqual([...actual].sort(), [...fixtures, '\n'].sort());
  assert.deepEqual(splitAndTrim('select 1 ; '), ['select 1']);
  assert.deepEqual(splitAndTrim("select ';'; select $$a;b$$"), ["select ';'", 'select $$a;b$$']);
});

// ───────────────────────── D: ledger rows + rendered apply SQL ─────────────────────────
test('D: migration bytes, CLI-faithful ledger rows and rendered apply SQL match the pins', () => {
  assert.equal(V1.migration_sha256, '2967ae6f67e36877c4931cb7821535eab10c5b7312026846f619b14fb045672c');
  assert.equal(V11.migration_sha256, '5256413839ad0abe9c9533a675461cc6589fd720e6b2bede3bc8d201a75ce422');
  assert.equal(V1.row.statements_count, 22); assert.equal(V1.row.statements_digest, '09ad7d261523fa1c2bb6e203a1624467'); assert.equal(V1.row.statements_bytes, 16688);
  assert.equal(V11.row.statements_count, 3); assert.equal(V11.row.statements_digest, 'b424cc66022e7ab721e8070d0b05cdc7'); assert.equal(V11.row.statements_bytes, 12088);
  for (const m of rendered) {
    assert.equal(sha(m.apply_sql), C.APPLY_SQL_SHA256[m.version]);
    assert.equal(m.apply_sql_sha256, C.APPLY_SQL_SHA256[m.version]);
    assert.equal((m.apply_sql.match(/insert into supabase_migrations\.schema_migrations/g) || []).length, 1, 'exactly one ledger INSERT');
    assert.doesNotMatch(m.apply_sql, /on conflict/i, 'never an upsert: a pre-existing row aborts the transaction');
    assert.match(m.apply_sql, /\ncommit;\n$/);
    assert.ok(m.apply_sql.indexOf('insert into supabase_migrations') < m.apply_sql.lastIndexOf('commit;'), 'the INSERT commits with the objects');
    for (const s of m.row.statements) assert.ok(m.apply_sql.includes(`$r3stmt$${s}$r3stmt$`), 'every statement is dollar-quoted verbatim');
    assert.doesNotMatch(m.apply_sql, new RegExp(PROD));
  }
  // v1 owns its transaction: the file bytes are kept verbatim up to its final `commit;`.
  const v1Text = fs.readFileSync(path.join(REPO, V1.file), 'utf8');
  assert.ok(v1Text.endsWith('commit;\n'));
  assert.ok(V1.apply_sql.startsWith(v1Text.slice(0, -'commit;\n'.length)));
  assert.equal((V1.apply_sql.match(/^commit;/gm) || []).length, 1);
  assert.equal((V1.apply_sql.match(/^begin;/gm) || []).length, 1);
  // v1.1 is wrapped.
  const v11Text = fs.readFileSync(path.join(REPO, V11.file), 'utf8');
  assert.ok(V11.apply_sql.startsWith('begin;\n' + v11Text.replace(/\s+$/, '')));
});

test('D: renderApplySql refuses inner/second transaction control and a non-owner file with BEGIN', () => {
  const m1 = { ...C.MIGRATIONS[0] };
  const bad = 'begin;\nselect 1;\ncommit;\nselect 2;\ncommit;\n';
  assert.throws(() => C.renderApplySql(bad, m1, { version: m1.version, name: m1.name, statements: splitAndTrim(bad) }), /inner_transaction_control|second_commit/);
  const noBegin = 'select 1;\ncommit;\n';
  assert.throws(() => C.renderApplySql(noBegin, m1, { version: m1.version, name: m1.name, statements: splitAndTrim(noBegin) }), /must_open_with_begin/);
  const m2 = { ...C.MIGRATIONS[1] };
  const ownerButNotDeclared = 'begin;\nselect 1;\ncommit;\n';
  assert.throws(() => C.renderApplySql(ownerButNotDeclared, m2, { version: m2.version, name: m2.name, statements: splitAndTrim(ownerButNotDeclared) }), /transaction_control_but_not_owner/);
  assert.throws(() => C.ledgerInsertSql({ version: '20260914120000', name: 'x', statements: ['select $r3stmt$'] }), /dollar_tag/);
  assert.throws(() => C.ledgerInsertSql({ version: '2026', name: 'x', statements: ['select 1'] }), /version_malformed/);
  assert.throws(() => C.loadMigration('relative/path', C.MIGRATIONS[0]), /repo_must_be_absolute/);
});

test('D: the hosted ledger shape (Production audit 2026-08-07) is the only accepted shape', () => {
  const observed = JSON.parse(JSON.stringify(C.LEDGER_SHAPE_EXPECTED));
  observed.relation.owner = 'postgres';
  observed.columns = observed.columns.map((c) => ({ ...c, identity: '', generated: '' }));
  assert.deepEqual(C.ledgerShapeDiff(observed), []);
  const cliOnly = { relation: { kind: 'r', has_rls: false }, columns: observed.columns.slice(0, 3), constraints: [observed.constraints[1]], indexes: [observed.indexes[1]] };
  assert.ok(C.ledgerShapeDiff(cliOnly).length >= 3, 'the bare CLI shape (3 columns) is a difference → STOP');
  const notNullExtra = JSON.parse(JSON.stringify(observed)); notNullExtra.columns[3].not_null = true;
  assert.match(C.ledgerShapeDiff(notNullExtra).join(' '), /created_by\.not_null/);
  const nullsNotDistinct = JSON.parse(JSON.stringify(observed)); nullsNotDistinct.indexes[0].nulls_not_distinct = true;
  assert.match(C.ledgerShapeDiff(nullsNotDistinct).join(' '), /indexes=/);
  assert.deepEqual(C.ledgerShapeDiff(null), ['shape_missing']);
});

test('D: every read-only probe passes the mgmt.mjs guard (single SELECT, no write verb, no `;`)', () => {
  for (const q of [C.LEDGER_SHAPE_SQL, C.ledgerRowsSql([...C.CLI_WRITTEN_VERSIONS, ...C.VERSIONS]), C.LEDGER_ALL_VERSIONS_SQL, C.CONTRACT_ACL_SQL, QA_USERS_SQL, sessionExistsSql('11111111-2222-3333-4444-555555555555', '11111111-2222-3333-4444-555555555556'), ...C.MIGRATIONS.map((m) => m.probe)]) assert.equal(assertReadOnlySql(q), q);
  assert.throws(() => C.ledgerRowsSql(["2026' or 1=1 --"]), /version_malformed/);
  assert.throws(() => sessionExistsSql('x', 'y'), /uuid_malformed/);
  assert.doesNotMatch(QA_USERS_SQL, /\bu\.email\b(?! ~\*| *,? *'\^)/, 'the raw email column is never projected; only the masked form and the qa pattern');
  assert.match(QA_USERS_SQL, /regexp_replace\(u\.email/);
});

test('D: the 9 canonical rows of Core staging — 7 reproduced by the splitter + 2 legacy blobs pinned field by field; every deviation is a STOP', () => {
  const local = C.localLedgerDigests(REPO, C.CLI_WRITTEN_VERSIONS);
  assert.equal(local.length, 9); assert.ok(local.every((l) => l.file && l.statements_count > 0));
  assert.deepEqual(C.EXPECTED_CLI_ROWS, { reproduced: 7, legacy: 2 });
  // the two legacy pins: exact provenance-backed fingerprints (diagnosis 2026-09-16), single element, and the
  // NAMED transformation of the local file reproduces digest AND bytes (the pin is never an opaque number)
  assert.deepEqual(C.LEGACY_LEDGER_ROWS.map((l) => [l.version, l.name, l.statements_count, l.statements_digest, l.statements_bytes, l.transform]), [
    ['20260803090000', 'tournament_social_studio', 1, '32ca5266e223c9a15e1611a4ad412fd1', 24321, 'file_verbatim'],
    ['20260810160355', 'tournament_entitlements_foundation', 1, '90370d0b8c76cbcde3d413a9d46e29d9', 41903, 'file_verbatim'],
  ]);
  for (const l of C.LEGACY_LEDGER_ROWS) {
    const row = local.find((x) => x.version === l.version);
    assert.ok(row.legacy_blob, 'local digests carry the named blob for a legacy version');
    assert.equal(row.legacy_blob.statements_digest, l.statements_digest); assert.equal(row.legacy_blob.statements_bytes, l.statements_bytes);
    assert.equal(md5(fs.readFileSync(path.join(REPO, 'supabase/migrations', row.file))), l.statements_digest, 'file_verbatim == md5(file bytes)');
    assert.notEqual(row.statements_digest, l.statements_digest, 'the splitter row of a legacy version is NOT the pin');
    assert.ok(row.statements_count > 1);
  }
  assert.ok(local.filter((x) => !x.legacy_blob).length === 7);
  // the null flags are pinned PER ROW from the remote observation (never inferred from the other row):
  // 20260803090000 was bookkept by hand (3 nulls); 20260810160355 came through the Management API
  // migrations endpoint, which fills created_by — observed live on 2026-09-17T16:19Z, evidence
  // r3-preflight-failed-20260917T161922Z.json (ledger_raw.rows created_by_is_null=false, rows_created_by_set=1)
  assert.deepEqual(C.LEDGER_NULL_FLAGS, ['created_by_is_null', 'idempotency_key_is_null', 'rollback_is_null']);
  assert.deepEqual(C.LEGACY_LEDGER_ROWS.map((l) => [l.version, l.created_by_is_null, l.idempotency_key_is_null, l.rollback_is_null]), [
    ['20260803090000', true, true, true],
    ['20260810160355', false, true, true],
  ]);
  assert.match(C.LEGACY_LEDGER_ROWS[1].provenance, /r3-preflight-failed-20260917T161922Z\.json/, 'the re-pin cites the observation, not an inference');
  const cliFlags = { created_by_is_null: true, idempotency_key_is_null: true, rollback_is_null: true };
  const flagsFor = (version) => { const l = C.LEGACY_LEDGER_ROWS.find((x) => x.version === version); return l ? Object.fromEntries(C.LEDGER_NULL_FLAGS.map((k) => [k, l[k]])) : { ...cliFlags }; };
  const remoteAsOnCore = local.map((l) => {
    const legacy = C.LEGACY_LEDGER_ROWS.find((x) => x.version === l.version);
    return legacy ? { version: l.version, name: legacy.name, statements_count: '1', statements_digest: legacy.statements_digest, statements_bytes: String(legacy.statements_bytes), ...flagsFor(l.version) }
      : { version: l.version, name: l.name, statements_count: String(l.statements_count), statements_digest: l.statements_digest, statements_bytes: String(l.statements_bytes), ...flagsFor(l.version) };
  });
  assert.equal(remoteAsOnCore.filter((r) => r.created_by_is_null === false).length, 1, 'exactly one of the 9 rows carries created_by, as on Core (totals.rows_created_by_set = 1)');
  const good = C.cliRowsVerdict(C.compareLedgerRows(remoteAsOnCore, local));
  assert.deepEqual(good, { reproduced: 7, legacy_matched: 2, mismatched: 0, absent: 0, expected: { reproduced: 7, legacy: 2 }, ok: true });
  const stop = (rows) => { const v = C.cliRowsVerdict(C.compareLedgerRows(rows, local)); assert.equal(v.ok, false); return v; };
  const edit = (version, patch) => remoteAsOnCore.map((r) => (r.version === version ? { ...r, ...patch } : r));
  // the exact remote rows of the 2026-09-17T16:19Z observation (the 2 legacy rows as core-ledger returned
  // them, cast to the wire types) yield the required verdict; the OLD inferred pin (created_by_is_null
  // true on 20260810160355) is what the fail-closed gate caught and must still be a one-field STOP
  const observed0917 = { '20260803090000': { name: 'tournament_social_studio', statements_count: 1, statements_digest: '32ca5266e223c9a15e1611a4ad412fd1', statements_bytes: 24321, created_by_is_null: true, idempotency_key_is_null: true, rollback_is_null: true }, '20260810160355': { name: 'tournament_entitlements_foundation', statements_count: 1, statements_digest: '90370d0b8c76cbcde3d413a9d46e29d9', statements_bytes: 41903, created_by_is_null: false, idempotency_key_is_null: true, rollback_is_null: true } };
  for (const [version, o] of Object.entries(observed0917)) { const c = C.compareLedgerRows(edit(version, { ...o, statements_count: String(o.statements_count), statements_bytes: String(o.statements_bytes) }), local).find((x) => x.version === version); assert.deepEqual(c.diff, []); assert.equal(c.match, true); assert.deepEqual(c.expected, o); }
  const inferred = C.compareLedgerRows(edit('20260810160355', { created_by_is_null: true }), local).find((x) => x.version === '20260810160355');
  assert.deepEqual(inferred.diff, ['created_by_is_null']); assert.equal(inferred.match, false);
  assert.deepEqual(stop(edit('20260810160355', { created_by_is_null: true })), { ...good, legacy_matched: 1, mismatched: 1, ok: false });
  // a legacy row that suddenly reproduces the splitter is a CHANGE of the fingerprint → STOP
  const soc = local.find((x) => x.version === '20260803090000');
  assert.deepEqual(stop(edit('20260803090000', { statements_count: String(soc.statements_count), statements_digest: soc.statements_digest, statements_bytes: String(soc.statements_bytes) })), { ...good, legacy_matched: 1, mismatched: 1, ok: false });
  // every field of the fingerprint is load-bearing, on BOTH legacy rows, and the flag pins are per row:
  // flipping any flag away from its own row's pin (created_by set on 20260803090000, created_by cleared
  // on 20260810160355, idempotency/rollback set on either) is exactly one diff and a STOP
  const flips = (version) => [{ statements_digest: 'ffff' }, { statements_bytes: '1' }, { statements_count: '2' }, { name: `${C.LEGACY_LEDGER_ROWS.find((x) => x.version === version).name}_x` }, ...C.LEDGER_NULL_FLAGS.map((k) => ({ [k]: !flagsFor(version)[k] }))];
  for (const version of ['20260803090000', '20260810160355']) {
    for (const patch of flips(version)) {
      const v = stop(edit(version, patch)); assert.equal(v.legacy_matched, 1, `${version} ${JSON.stringify(patch)}`); assert.equal(v.mismatched, 1);
      const c = C.compareLedgerRows(edit(version, patch), local).find((x) => x.version === version); assert.equal(c.legacy, true); assert.deepEqual(c.diff, Object.keys(patch));
    }
  }
  // the re-pin never leaks to the other legacy row: swapping the two rows' flag sets is a STOP on both
  assert.deepEqual(stop(edit('20260803090000', flagsFor('20260810160355')).map((r) => (r.version === '20260810160355' ? { ...r, ...flagsFor('20260803090000') } : r))), { ...good, legacy_matched: 0, mismatched: 2, ok: false });
  // a third discrepancy on a CLI-shaped row → STOP; the legacy pins never absorb it
  assert.deepEqual(stop(edit('20260727090000', { statements_digest: 'ffff' })), { ...good, reproduced: 6, mismatched: 1, ok: false });
  // a CLI-shaped row that becomes a blob → STOP (no tolerance by count)
  assert.equal(stop(edit('20260809232508', { statements_count: '1', statements_digest: md5(fs.readFileSync(path.join(REPO, 'supabase/migrations', local.find((x) => x.version === '20260809232508').file))) })).mismatched, 1);
  // absent rows → STOP; a 10th row is invisible to the comparison (all_versions is checked elsewhere)
  assert.deepEqual(stop(remoteAsOnCore.filter((r) => r.version !== '20260810160355')), { ...good, legacy_matched: 1, absent: 1, ok: false });
  assert.equal(stop([]).absent, 9);
  assert.equal(C.cliRowsVerdict(C.compareLedgerRows([...remoteAsOnCore, { version: '20260901000000', name: 'x', statements_count: '1', statements_digest: 'aa', statements_bytes: '1', ...cliFlags }], local)).ok, true);
  // the flags of a null-less remote row (older shape) or a non-boolean flag ('f', 'false', 0) never match
  // a pinned legacy row — whether the pin is true (20260803090000) or false (20260810160355)
  for (const version of ['20260803090000', '20260810160355']) {
    for (const bad of [undefined, null, 'f', 'false', 't', 'true', 0, 1]) {
      const c = C.compareLedgerRows(edit(version, { created_by_is_null: bad }), local).find((x) => x.version === version);
      assert.deepEqual(c.diff, ['created_by_is_null'], `${version} created_by_is_null=${String(bad)}`); assert.equal(c.observed.created_by_is_null, null);
      assert.equal(stop(edit(version, { created_by_is_null: bad })).mismatched, 1);
    }
  }
});

test('D: ledgerState / applyDecision — the complete decision table', () => {
  const m = C.MIGRATIONS[0];
  const ours = { version: m.version, name: m.name, statements_count: '22', statements_digest: m.ledger_digest };
  assert.equal(ledgerState([ours], m), 'ours');
  assert.equal(ledgerState([{ ...ours, statements_digest: 'x' }], m), 'foreign');
  assert.equal(ledgerState([{ ...ours, name: 'other' }], m), 'foreign');
  assert.equal(ledgerState([], m), 'absent');
  assert.equal(applyDecision(false, 'absent'), 'apply');
  assert.equal(applyDecision(true, 'ours'), 'skip');
  assert.equal(applyDecision(true, 'absent'), 'reconcile-ledger');
  assert.equal(applyDecision(true, 'foreign'), 'STOP:ledger_row_not_ours');
  assert.equal(applyDecision(false, 'ours'), 'STOP:ledger_row_without_objects');
  assert.equal(applyDecision(false, 'foreign'), 'STOP:ledger_row_without_objects');
});

// A fake Core staging: answers the read-only probes from its state and records writes.
function fakeCore(state) {
  const log = [];
  const shapeRow = () => { const o = JSON.parse(JSON.stringify(C.LEDGER_SHAPE_EXPECTED)); o.relation.owner = 'postgres'; o.columns = o.columns.map((c) => ({ ...c, identity: '', generated: '' })); o.totals = { total_rows: 9 }; o.standard_conforming_strings = 'on'; return state.badShape ? { ...o, columns: o.columns.slice(0, 3) } : o; };
  const rows = () => C.MIGRATIONS.filter((m) => state.ledger[m.version]).map((m) => ({ version: m.version, name: m.name, statements_count: String(m.statements_count), statements_digest: state.ledger[m.version] === 'ours' ? m.ledger_digest : 'deadbeef', statements_bytes: String(m.ledger_bytes), created_by_is_null: true, idempotency_key_is_null: true, rollback_is_null: true }));
  const transport = async (req) => {
    const reqPath = req.reqPath ?? req.path;
    log.push({ method: req.method, path: reqPath, body: req.body });
    if (req.method === 'POST' && reqPath.endsWith('/database/query')) {
      const q = req.body.query;
      if (req.body.read_only) {
        assertReadOnlySql(q);
        if (q === C.LEDGER_SHAPE_SQL) return { status: 200, body: [{ shape: shapeRow() }] };
        if (q.startsWith('select m.version, m.name')) return { status: 200, body: rows().filter((r) => q.includes(`'${r.version}'`)) };
        if (q === C.LEDGER_ALL_VERSIONS_SQL) return { status: 200, body: rows().map((r) => ({ version: r.version, name: r.name })) };
        if (q === C.MIGRATIONS[0].probe) return { status: 200, body: [{ installed: state.installed.v1 }] };
        if (q === C.MIGRATIONS[1].probe) return { status: 200, body: [{ installed: state.installed.v1 && state.installed.v11 }] };
        if (q === C.CONTRACT_ACL_SQL) return { status: 200, body: [{ acl: state.acl ?? aclOf(state) }] };
        return { status: 400, body: { message: 'unknown probe' } };
      }
      // SQL writes must opt in explicitly; omission must never pass unnoticed in the fake.
      assert.equal(req.body.read_only, false, 'SQL write requires explicit read_only:false');
      // write: simulate the effect
      state.writes.push(q);
      if (state.failWrite) return { status: 400, body: { message: 'boom' }, raw: 'boom' };
      if (q === V1.apply_sql) { state.installed.v1 = true; state.ledger['20260914120000'] = 'ours'; }
      else if (q === V11.apply_sql) { state.installed.v11 = true; state.ledger['20260915120000'] = 'ours'; }
      else if (q.includes(`values ('20260914120000'`)) state.ledger['20260914120000'] = 'ours';
      else if (q.includes(`values ('20260915120000'`)) state.ledger['20260915120000'] = 'ours';
      else if (q === state.rollbackText) { state.installed = { v1: false, v11: false }; state.ledger = {}; }
      return { status: 201, body: [] };
    }
    if (req.method === 'DELETE') { state.deletes.push({ path: reqPath, body: req.body }); return { status: state.deleteStatus ?? 200, body: {} }; }
    return { status: 404, body: null };
  };
  return { transport, log, state };
}
function aclOf(state) {
  const present = state.installed.v1;
  return {
    functions: C.CONTRACT_OBJECTS.functions.map((f) => ({ signature: f.signature, present, security_definer: present ? f.security_definer : null, search_path_empty: present, owner: present ? 'postgres' : null, execute: present ? f.execute : { anon: null, authenticated: null, service_role: null } })),
    tables: C.CONTRACT_OBJECTS.tables.map((t) => ({ name: t.name, present, rls: present ? true : null, owner: present ? 'postgres' : null, privileges: present ? t.privileges : { anon: null, authenticated: null, service_role: null }, indexes: present ? t.indexes : [] })),
    schema: { app_private_present: true, usage: { anon: false, authenticated: false, service_role: false } },
    session_branch: Boolean(state.installed.v1 && state.installed.v11), stray_objects: '0', stray_relations: '0',
  };
}
const fresh = (extra = {}) => ({ installed: { v1: false, v11: false }, ledger: {}, writes: [], deletes: [], ...extra });

test('D/apply: fresh Core staging → exactly two writes (the pinned apply documents), both probed after', async () => {
  const f = fakeCore(fresh());
  const out = await runWrite({ op: 'apply-core-contract', pat: PAT, ref: CORE, repo: REPO }, f.transport);
  assert.deepEqual(f.state.writes.map(sha), [C.APPLY_SQL_SHA256['20260914120000'], C.APPLY_SQL_SHA256['20260915120000']]);
  assert.deepEqual(out.migrations.map((m) => [m.decision, m.applied, m.installed_after, m.ledger_after]), [['apply', true, true, 'ours'], ['apply', true, true, 'ours']]);
  assert.equal(out.ledger_shape_ok, true);
  assert.ok(f.log.every((l) => l.path === `/v1/projects/${CORE}/database/query`));
  assert.ok(f.log.filter((l) => !l.body.read_only).length === 2);
  assert.ok(f.log.findIndex((l) => l.body.query === C.LEDGER_SHAPE_SQL) < f.log.findIndex((l) => !l.body.read_only), 'the shape gate runs before the first write');
});

test('D/apply: re-run on an installed+recorded Core → skip, 0 writes; installed but unrecorded → the INSERT alone (reconcile)', async () => {
  const done = fakeCore(fresh({ installed: { v1: true, v11: true }, ledger: { '20260914120000': 'ours', '20260915120000': 'ours' } }));
  const out = await runWrite({ op: 'apply-core-contract', pat: PAT, ref: CORE, repo: REPO }, done.transport);
  assert.equal(done.state.writes.length, 0);
  assert.deepEqual(out.migrations.map((m) => m.decision), ['skip', 'skip']);
  const half = fakeCore(fresh({ installed: { v1: true, v11: true }, ledger: { '20260914120000': 'ours' } }));
  const out2 = await runWrite({ op: 'apply-core-contract', pat: PAT, ref: CORE, repo: REPO }, half.transport);
  assert.deepEqual(out2.migrations.map((m) => m.decision), ['skip', 'reconcile-ledger']);
  assert.equal(half.state.writes.length, 1);
  assert.equal(half.state.writes[0], `begin;\n${C.ledgerInsertSql(V11.row)}\ncommit;\n`, 'the reconcile write is the ledger INSERT alone');
  assert.equal(out2.migrations[1].ledger_after, 'ours');
});

test('D/apply: STOP states write nothing — foreign ledger row, ledger row without objects, unexpected ledger shape, wrong target', async () => {
  const foreign = fakeCore(fresh({ installed: { v1: true, v11: false }, ledger: { '20260914120000': 'foreign' } }));
  await assert.rejects(runWrite({ op: 'apply-core-contract', pat: PAT, ref: CORE, repo: REPO }, foreign.transport), /ledger_row_not_ours_20260914120000/);
  assert.equal(foreign.state.writes.length, 0);
  const ghost = fakeCore(fresh({ ledger: { '20260914120000': 'ours' } }));
  await assert.rejects(runWrite({ op: 'apply-core-contract', pat: PAT, ref: CORE, repo: REPO }, ghost.transport), /ledger_row_without_objects/);
  assert.equal(ghost.state.writes.length, 0);
  const shape = fakeCore(fresh({ badShape: true }));
  await assert.rejects(runWrite({ op: 'apply-core-contract', pat: PAT, ref: CORE, repo: REPO }, shape.transport), /ledger_shape_unexpected/);
  assert.equal(shape.state.writes.length, 0);
  await assert.rejects(runWrite({ op: 'apply-core-contract', pat: PAT, ref: 'abcdefghijabcdefghij', repo: REPO }, fakeCore(fresh()).transport), /target_not_core_staging/);
  await assert.rejects(runWrite({ op: 'apply-core-contract', pat: PAT, ref: PROD, repo: REPO }, fakeCore(fresh()).transport), /ref_is_production/);
  const dry = fakeCore(fresh());
  const out = await runWrite({ op: 'apply-core-contract', pat: PAT, ref: CORE, repo: REPO, dryRun: true }, dry.transport);
  assert.equal(dry.state.writes.length, 0); assert.deepEqual(out.migrations.map((m) => m.dry_run), [true, true]);
  // a write that fails leaves nothing half-done at the op level: the second document is never sent
  const failing = fakeCore(fresh({ failWrite: true }));
  await assert.rejects(runWrite({ op: 'apply-core-contract', pat: PAT, ref: CORE, repo: REPO }, failing.transport), /apply_status_400/);
  assert.equal(failing.state.writes.length, 1);
});

// ───────────────────────── read-only ops ─────────────────────────
test('read-only ops: core-ledger / core-contract-acl / secret-names / function / core-qa-users / core-session-exists', async () => {
  const f = fakeCore(fresh({ installed: { v1: true, v11: true }, ledger: { '20260914120000': 'ours' } }));
  const log = [];
  const t = async (req) => {
    log.push(req);
    if (req.method === 'GET' && req.path === `/v1/projects/${CORE}/secrets`) return { status: 200, body: [{ name: 'TORNEOS_CONTRACT_SERVICE_SECRET', value: 'SECRETVALUE0123' }, { name: 'SUPABASE_URL', value: 'https://x' }] };
    if (req.method === 'GET' && req.path === `/v1/projects/${CORE}/functions/torneos-core-contract`) return { status: 200, body: { slug: 'torneos-core-contract', status: 'ACTIVE', version: 1, verify_jwt: false, ezbr_sha256: 'e'.repeat(64), import_map: 'x' } };
    if (req.method === 'GET' && req.path === `/v1/projects/${CORE}/functions/missing-fn`) return { status: 404, body: { message: 'not found' } };
    if (req.method === 'POST' && req.body.query === QA_USERS_SQL) return { status: 200, body: [{ id_prefix: 'aaaaaaaa', email_masked: 'q***@example.org', looks_like_qa: true, confirmed: true, has_password: true, live: true, not_banned: true, anonymous: false, sessions: '1' }, { id_prefix: 'bbbbbbbb', email_masked: 'n***@example.org', looks_like_qa: false, confirmed: true, has_password: true, live: true, not_banned: true, anonymous: false, sessions: '3' }] };
    if (req.method === 'POST' && req.body.query.startsWith('select exists (select 1 from auth.sessions')) return { status: 200, body: [{ session_present: false, user_sessions: '0' }] };
    return f.transport(req);
  };
  const ledger = await runRead({ op: 'core-ledger', pat: PAT, ref: CORE }, t);
  assert.deepEqual(C.ledgerShapeDiff(ledger.shape), []);
  assert.equal(ledger.rows.length, 1); assert.equal(ledger.installed['20260914120000'].installed, true);
  const acl = await runRead({ op: 'core-contract-acl', pat: PAT, ref: CORE }, t);
  assert.deepEqual(C.aclFailures(acl.acl), []);
  const names = await runRead({ op: 'secret-names', pat: PAT, ref: CORE }, t);
  assert.deepEqual(names.secret_names, ['SUPABASE_URL', 'TORNEOS_CONTRACT_SERVICE_SECRET']);
  assert.doesNotMatch(JSON.stringify(names), /SECRETVALUE0123/);
  const fn = await runRead({ op: 'function', pat: PAT, ref: CORE }, t);
  assert.equal(fn.present, true); assert.equal(fn.fn.verify_jwt, false); assert.equal('import_map' in fn.fn, false);
  assert.deepEqual(await runRead({ op: 'function', pat: PAT, ref: CORE, slug: 'missing-fn' }, t), { ref: CORE, slug: 'missing-fn', present: false, fn: null });
  await assert.rejects(runRead({ op: 'function', pat: PAT, ref: CORE, slug: '../x' }, t), /slug_malformed/);
  const qa = await runRead({ op: 'core-qa-users', pat: PAT, ref: CORE }, t);
  assert.deepEqual(qa.dedicated_candidates, ['q***@example.org']);
  assert.doesNotMatch(JSON.stringify(qa), /@example\.org"[^,]*"email"/);
  const sess = await runRead({ op: 'core-session-exists', pat: PAT, ref: CORE, session_id: '11111111-2222-3333-4444-555555555555', user_id: '11111111-2222-3333-4444-555555555556' }, t);
  assert.deepEqual(sess, { ref: CORE, session_present: false, user_sessions: 0 });
  for (const l of log) { assert.ok(l.method === 'GET' || (l.method === 'POST' && l.body.read_only === true), 'read-only only'); assert.doesNotMatch(l.path, new RegExp(PROD)); }
  for (const op of ['core-ledger', 'core-contract-acl', 'secret-names', 'function', 'core-qa-users']) await assert.rejects(runRead({ op, pat: PAT, ref: PROD }, t), /ref_is_production/);
});

// ───────────────────────── E: rollback ─────────────────────────
test('E: the pinned rollback SQL — hash, exact object set, guards, no CASCADE, no schema drop, out-of-scope names absent', () => {
  const { text, sha256 } = C.loadRollbackSql();
  assert.equal(sha256, C.ROLLBACK_SQL_SHA256);
  const code = text.replace(/--[^\n]*/g, '');
  for (const stmt of ['drop function if exists public.torneos_contract_execute(text, text, jsonb);', 'drop function if exists app_private.torneos_contract_importable_team(uuid, uuid);', 'drop function if exists app_private.torneos_contract_visible_player(uuid);', 'drop function if exists app_private.torneos_contract_url(text);', 'drop function if exists app_private.torneos_contract_email(text);', 'drop table if exists app_private.torneos_contract_rate_events;', 'drop table if exists app_private.torneos_contract_nonces;']) assert.ok(code.includes(stmt), stmt);
  assert.equal((code.match(/\bdrop\b/gi) || []).length, 7, 'exactly 7 DROPs');
  assert.equal((code.match(/\bdelete from\b/gi) || []).length, 1, 'one DELETE: the two ledger rows');
  assert.match(code, /delete from supabase_migrations\.schema_migrations\s+where version in \('20260914120000', '20260915120000'\)/);
  assert.doesNotMatch(code, /cascade|drop schema|tournament_|auth\.users|auth\.sessions|cron\.|storage\.|truncate|alter role|create /i);
  for (const m of C.MIGRATIONS) assert.ok(text.includes(`('${m.version}', '${m.ledger_digest}')`), 'guard digest ' + m.version);
  assert.match(code, /^begin;/m); assert.match(code, /commit;\s*$/);
  assert.match(code, /R3_ROLLBACK_ABORTED: ledger rows not written by R3/);
  assert.match(code, /R3_ROLLBACK_ABORTED: schema app_private vanished/);
});

test('E: mgmt-rollback — only three request shapes, target hardcoded, digests guarded before the write, residue refused', async () => {
  assert.equal(ALLOWED.length, 3);
  assertRollbackPath('POST', `/v1/projects/${CORE}/database/query`);
  assertRollbackPath('DELETE', `/v1/projects/${CORE}/functions/torneos-core-contract`);
  assertRollbackPath('DELETE', `/v1/projects/${CORE}/secrets`);
  for (const [m, p] of [['DELETE', `/v1/projects/${CORE}/functions/push-sender`], ['DELETE', `/v1/projects/${PROD}/functions/torneos-core-contract`], ['DELETE', `/v1/projects/${CORE}`], ['POST', `/v1/projects/abcdefghijabcdefghij/database/query`], ['GET', `/v1/projects/${CORE}/secrets`], ['DELETE', `/v1/projects/${CORE}/database/query`]]) assert.throws(() => assertRollbackPath(m, p), AbortError, `${m} ${p}`);
  const { text } = C.loadRollbackSql();
  const installed = () => fakeCore(fresh({ installed: { v1: true, v11: true }, ledger: { '20260914120000': 'ours', '20260915120000': 'ours' }, rollbackText: text }));
  const ok = installed();
  const out = await runRollback({ op: 'rollback-sql', pat: PAT, ref: CORE }, ok.transport);
  assert.deepEqual(ok.state.writes, [text]); assert.equal(out.rolled_back, true); assert.deepEqual(out.ledger_rows_before, ['20260914120000', '20260915120000']); assert.deepEqual(out.ledger_rows_after, []);
  const foreign = fakeCore(fresh({ installed: { v1: true, v11: true }, ledger: { '20260914120000': 'foreign' }, rollbackText: text }));
  await assert.rejects(runRollback({ op: 'rollback-sql', pat: PAT, ref: CORE }, foreign.transport), /ledger_rows_not_ours_20260914120000/);
  assert.equal(foreign.state.writes.length, 0);
  const stuck = installed(); stuck.state.acl = aclOf({ installed: { v1: true, v11: true } });
  await assert.rejects(runRollback({ op: 'rollback-sql', pat: PAT, ref: CORE }, stuck.transport), /rollback_residue/);
  const dry = installed();
  const d = await runRollback({ op: 'rollback-sql', pat: PAT, ref: CORE, dryRun: true }, dry.transport);
  assert.equal(dry.state.writes.length, 0); assert.equal(d.dryRun, true); assert.equal(d.rollback_sql_sha256, C.ROLLBACK_SQL_SHA256);
  await assert.rejects(runRollback({ op: 'rollback-sql', pat: PAT, ref: 'abcdefghijabcdefghij' }, installed().transport), /target_not_core_staging/);
  const del = installed();
  assert.deepEqual(await runRollback({ op: 'delete-function', pat: PAT, ref: CORE }, del.transport), { deleted: true, slug: 'torneos-core-contract' });
  assert.deepEqual(await runRollback({ op: 'delete-secret', pat: PAT, ref: CORE }, del.transport), { deleted: true, name: 'TORNEOS_CONTRACT_SERVICE_SECRET' });
  assert.deepEqual(del.state.deletes, [{ path: `/v1/projects/${CORE}/functions/torneos-core-contract`, body: undefined }, { path: `/v1/projects/${CORE}/secrets`, body: ['TORNEOS_CONTRACT_SERVICE_SECRET'] }]);
  const gone = installed(); gone.state.deleteStatus = 404;
  assert.deepEqual(await runRollback({ op: 'delete-function', pat: PAT, ref: CORE }, gone.transport), { deleted: false, absent: true, slug: 'torneos-core-contract' });
  await assert.rejects(runRollback({ op: 'apply-core-contract', pat: PAT, ref: CORE }, installed().transport), /unknown_op/);
  // mgmt-write.mjs itself still cannot DELETE anything
  assert.doesNotMatch(fs.readFileSync(path.join(HERE, 'mgmt-write.mjs'), 'utf8'), /method:\s*'DELETE'|'DELETE'/);
  assert.throws(() => assertWritePath('DELETE', `/v1/projects/${CORE}/secrets`), AbortError);
});

// ───────────────────────── B.3: signed harness against a faithful fake of the Edge Function ─────────────────────────
function fakeContract({ secret, deployed = true }) {
  const nonces = new Set();
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  return async (url, init) => {
    const u = new URL(url);
    if (!deployed) return new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'Requested function was not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
    if (!secret) return json(503, { error: 'CORE_UNAVAILABLE' });
    let p = u.pathname.replace('/functions/v1', '').replace('/torneos-core-contract', '');
    if (!['/v1/session', '/v1/verified-email', '/v1/directory', '/v1/team-snapshot'].includes(p)) return json(404, { error: 'NOT_FOUND' });
    if (init.method !== 'POST') return json(404, { error: 'NOT_FOUND' });
    const body = Buffer.from(init.body ?? '');
    if (body.length === 0) return json(400, { error: 'INVALID_REQUEST' });
    const h = init.headers; const time = h['x-time'], nonce = h['x-nonce'], sig = h['x-signature'];
    if (!time || !nonce || !sig) return json(401, { error: 'SERVICE_AUTH_REQUIRED' });
    if (Math.abs(Math.floor(Date.now() / 1000) - Number(time)) > 30) return json(401, { error: 'SERVICE_AUTH_REQUIRED' });
    const expect = crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(`${p}\n${time}\n${nonce}\n`).update(body).digest('hex');
    if (expect !== sig) return json(401, { error: 'SERVICE_AUTH_REQUIRED' });
    let raw; try { raw = JSON.parse(body.toString()); } catch { return json(400, { error: 'INVALID_REQUEST' }); }
    const keys = Object.keys(raw).sort().join(',');
    const want = p === '/v1/session' ? 'core_user_id,session_id' : 'core_user_id,expected_email,session_id';
    if (keys !== want) return json(400, { error: 'INVALID_REQUEST' });
    if (nonces.has(nonce)) return json(401, { error: 'REPLAY' });
    nonces.add(nonce);
    return json(403, { error: 'FORBIDDEN' });
  };
}
test('B.3: signed harness — 9 exact answers → SIGNED_HARNESS_PASS; classification of secret-missing / not-deployed / mismatch; retries', async () => {
  const pass = await probe({ ref: CORE, secret: SECRET, fetchImpl: fakeContract({ secret: SECRET }) });
  assert.equal(pass.verdict, 'SIGNED_HARNESS_PASS'); assert.equal(pass.pass, true); assert.equal(pass.checks.length, 9);
  assert.deepEqual(pass.checks.map((c) => [c.observed.status, c.observed.body.error]), C.PROBE_EXPECT.map((e) => [e.status, e.body.error]));
  assert.doesNotMatch(JSON.stringify(pass), new RegExp(SECRET));
  assert.equal((await probeOnce({ ref: CORE, secret: SECRET, fetchImpl: fakeContract({ secret: null }) })).verdict, 'SECRET_NOT_CONFIGURED');
  assert.equal((await probeOnce({ ref: CORE, secret: SECRET, fetchImpl: fakeContract({ deployed: false }) })).verdict, 'FUNCTION_NOT_FOUND');
  assert.equal((await probeOnce({ ref: CORE, secret: SECRET, fetchImpl: fakeContract({ secret: 'cd'.repeat(32) }) })).verdict, 'SECRET_MISMATCH');
  assert.equal((await probeOnce({ ref: CORE, secret: null, fetchImpl: fakeContract({ secret: SECRET }) })).verdict, 'NO_SECRET_GIVEN');
  let n = 0; const down = fakeContract({ secret: null }); const up = fakeContract({ secret: SECRET });
  const flaky = async (url, init) => (n++ < 2 ? down(url, init) : up(url, init));
  const retried = await probe({ ref: CORE, secret: SECRET, retries: 3, interval_ms: 1, fetchImpl: flaky });
  assert.equal(retried.verdict, 'SIGNED_HARNESS_PASS'); assert.equal(retried.attempts.length, 2);
  const unreachable = await probe({ ref: CORE, secret: SECRET, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(unreachable.verdict, 'UNREACHABLE'); assert.equal(unreachable.pass, false);
  await assert.rejects(probe({ ref: PROD, secret: SECRET, fetchImpl: fakeContract({ secret: SECRET }) }), /production/);
  const h = sign(SECRET, '/v1/session', Buffer.from('{}'), { time: 1, nonce: '0'.repeat(32) });
  assert.equal(h['x-signature'], crypto.createHmac('sha256', Buffer.from(SECRET, 'hex')).update('/v1/session\n1\n' + '0'.repeat(32) + '\n{}').digest('hex'));
  assert.equal(classify([{ status: 0 }], null), 'UNREACHABLE');
});

// ───────────────────────── C: D1 positive against a fake GoTrue + contract ─────────────────────────
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const ANON = `${b64({ alg: 'HS256' })}.${b64({ iss: 'supabase', ref: CORE, role: 'anon' })}.sig`;
function fakeGoTrue({ secret, userId, sessionId }) {
  const sessions = new Set();
  const contract = fakeContractWithSessions({ secret, sessions, userId });
  const access = `${b64({ alg: 'HS256' })}.${b64({ sub: userId, session_id: sessionId, role: 'authenticated', aud: 'authenticated', is_anonymous: false })}.sig`;
  return { fetchImpl: async (url, init) => {
    const u = new URL(url);
    if (u.pathname === '/auth/v1/token') {
      const body = JSON.parse(Buffer.from(init.body).toString());
      if (init.headers.apikey !== ANON) return new Response('{"error":"no apikey"}', { status: 401 });
      if (body.email !== 'qa@example.org' || body.password !== 'correct-horse') return new Response(JSON.stringify({ error_code: 'invalid_credentials' }), { status: 400 });
      sessions.add(sessionId);
      return new Response(JSON.stringify({ access_token: access, refresh_token: 'REFRESHTOKEN12345', user: { id: userId } }), { status: 200 });
    }
    if (u.pathname === '/auth/v1/logout') { assert.equal(u.searchParams.get('scope'), 'local'); assert.equal(init.headers.authorization, `Bearer ${access}`); sessions.delete(sessionId); return new Response(null, { status: 204 }); }
    return contract(url, init);
  }, access, sessions };
}
function fakeContractWithSessions({ secret, sessions, userId }) {
  const nonces = new Set();
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  return async (url, init) => {
    const p = new URL(url).pathname.replace('/functions/v1/torneos-core-contract', '');
    const body = Buffer.from(init.body ?? '');
    const h = init.headers;
    const expect = crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(`${p}\n${h['x-time']}\n${h['x-nonce']}\n`).update(body).digest('hex');
    if (expect !== h['x-signature']) return json(401, { error: 'SERVICE_AUTH_REQUIRED' });
    if (nonces.has(h['x-nonce'])) return json(401, { error: 'REPLAY' }); nonces.add(h['x-nonce']);
    const r = JSON.parse(body.toString());
    if (r.core_user_id === userId && sessions.has(r.session_id)) return json(200, { active: true, checked_at: Math.floor(Date.now() / 1000) });
    return json(403, { error: 'FORBIDDEN' });
  };
}
test('C: D1 positive — login → 200 {active:true} → logout(local) → 403; sanitized output; anon key bound to Core staging', async () => {
  const userId = '11111111-2222-3333-4444-555555555555', sessionId = '99999999-8888-7777-6666-555555555555';
  const g = fakeGoTrue({ secret: SECRET, userId, sessionId });
  const out = await runD1Positive({ ref: CORE, anon_key: ANON, email: 'qa@example.org', password: 'correct-horse', secret: SECRET, fetchImpl: g.fetchImpl });
  assert.equal(out.pass, true); assert.equal(out.verdict, 'D1_POSITIVE_PASS');
  assert.deepEqual(out.steps.map((s) => s.status), [200, 200, 204, 403]);
  assert.equal(out.session_id, sessionId); assert.equal(g.sessions.size, 0);
  const text = JSON.stringify(out);
  assert.doesNotMatch(text, /correct-horse|REFRESHTOKEN12345|qa@example\.org/);
  assert.doesNotMatch(text, new RegExp(g.access.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const bad = await runD1Positive({ ref: CORE, anon_key: ANON, email: 'qa@example.org', password: 'wrong-password', secret: SECRET, fetchImpl: g.fetchImpl });
  assert.equal(bad.verdict, 'LOGIN_FAILED'); assert.equal(bad.pass, false);
  const prodAnon = `${b64({ alg: 'HS256' })}.${b64({ ref: PROD, role: 'anon' })}.sig`;
  await assert.rejects(runD1Positive({ ref: CORE, anon_key: prodAnon, email: 'qa@example.org', password: 'correct-horse', secret: SECRET, fetchImpl: g.fetchImpl }), /anon_key_ref_mismatch|production/);
  assert.throws(() => assertAnonKey(`${b64({})}.${b64({ ref: CORE, role: 'service_role' })}.s`, CORE), /role_not_anon/);
  await assert.rejects(runD1Positive({ ref: PROD, anon_key: ANON, email: 'qa@example.org', password: 'correct-horse', secret: SECRET, fetchImpl: g.fetchImpl }), /production/);
});

// ───────────────────────── shell runners: static contracts ─────────────────────────
const SRC = (f) => fs.readFileSync(path.join(HERE, f), 'utf8');
const idx = (s, needle) => { const i = s.indexOf(needle); assert.ok(i >= 0, `missing: ${needle}`); return i; };
test('deploy-core-contract.sh: pins before PAT → read-only preflight → evidence → preflight-only/dry-run stops → HUMAN phrase → apply → secret state machine → deploy → signed harness → ACL → evidence', () => {
  const s = SRC('deploy-core-contract.sh');
  assert.equal(spawnSync('bash', ['-n', path.join(HERE, 'deploy-core-contract.sh')], { encoding: 'utf8' }).status, 0);
  const order = ['node_json() {', 'jv() {', 'r3_failure_evidence() {', 'failure_detail() {', 'preflight_failed() {', 'stage_failed() {', 'preflight_stop_evidence() {', 'step "0. pins', 'read_pat', 'step "1. PREFLIGHT', 'LEDGER_SHAPE_UNEXPECTED', 'cli_verdict.ok', 'preflight_stop_evidence CLI_ROWS_NOT_REPRODUCED', 'canonical rows of Core staging not reproduced', 'SECRET_REMOTE_PRESENT_KEYCHAIN_ABSENT', 'r3-preflight-$STAMP.json', 'PHASE3B_R3_PREFLIGHT_ONLY_STOP', 'PHASE3B_CORE_CONTRACT_DRYRUN', 'step "HUMAN AUTHORIZATION"', 'APPLY R3 $CORE_REF', 'mgmt_write apply-core-contract ",\\"ref\\":\\"$CORE_REF\\",\\"repo\\":$(json_escape "$REPO")"', 'step "3. service secret', 'SECRET_ACTION="generated+stored+set"', 'SECRET_ACTION="reconciled-from-keychain"', 'SECRET_ACTION="reused-pending-probe"', 'step "4. deploy', 'DEP="$(mgmt_write deploy-function ",\\"ref\\":\\"$CORE_REF\\",\\"slug\\":\\"$SLUG\\",\\"repo\\":$(json_escape "$REPO")")"', 'step "5. signed harness', 'if [[ "$VERDICT" == "SECRET_MISMATCH" && "$SECRET_ACTION" == "reused-pending-probe" ]]', '\nunset CONTRACT_SECRET\n', 'SIGNED_HARNESS_PASS', 'step "6. ACL probe', 'aclFailures', 'core-contract-$STAMP.json', 'PHASE3B_CORE_CONTRACT_DEPLOYED'];
  let last = -1; for (const n of order) { const i = idx(s, n); assert.ok(i > last, `out of order: ${n}`); last = i; }
  assert.ok(idx(s, 'renderAll') < idx(s, 'read_pat'), 'pins verified before the PAT');
  assert.ok(idx(s, 'loadRollbackSql') < idx(s, 'read_pat'), 'rollback pin verified before the PAT');
  assert.equal((s.match(/mgmt_write set-secrets/g) || []).length, 1, 'one set-secrets call site (the state machine function)');
  assert.match(s, /CONTRACT_SECRET="\$\(keychain_read "\$KC_CORE_SERVICE" contract-secret\)"/);
  assert.match(s, /printf '\{"ref":"%s","secret":"%s","retries":%s,"interval_ms":10000\}' "\$CORE_REF" "\$CONTRACT_SECRET" "\$1" \| node "\$PROBE"/, 'the secret reaches the probe through the printf builtin pipe only');
  assert.doesNotMatch(s, /export (PAT|CONTRACT_SECRET)|SUPABASE_ACCESS_TOKEN|<<<|--linked|supabase (db|link|secrets|functions)|curl /);
  assert.doesNotMatch(s, /echo[^\n]*CONTRACT_SECRET|printf[^\n]*%s[^\n]*CONTRACT_SECRET[^\n]*>(?!&2)/, 'the secret is never echoed');
  assert.doesNotMatch(s, /unsigned_probe_status|must fail closed: 401\/403\/503/, 'the old 503-tolerant probe is gone');
  assert.match(s, /\[\[ "\$VERDICT" != "SIGNED_HARNESS_PASS" \]\]/);
  assert.match(s, /trap 'cleanup_secrets; unset CONTRACT_SECRET' EXIT INT TERM HUP/);
  assert.match(s, /\[\[ "\$\(printf '%s' "\$FN_AFTER" \| json_field fn\.verify_jwt\)" == "false" \]\] \|\| stage_failed "4\. deploy read-back"/);
  assert.match(s, /r3-failed-\$STAMP\.json/, 'a failed stage leaves failure evidence, never core-contract-*');
  // ONE writer for both evidence families (r3-preflight-failed-* before the phrase, r3-failed-* after it),
  // defined before the first capture so that a read failure in step 1 is persisted too; read_only follows the family
  assert.equal((s.match(/promote_evidence "\$tmp" "\$EVIDENCE_DIR\/\$1-\$STAMP\.json" \|\| true/g) || []).length, 1, 'one writer of the failure evidence');
  assert.equal((s.match(/promote_evidence "\$(TMP|tmp)" "\$EVIDENCE_DIR\/r3-(preflight-)?failed-\$STAMP\.json"/g) || []).length, 0, 'no ad-hoc writer of the failure families remains');
  assert.match(s, /preflight_stop_evidence\(\) \{ r3_failure_evidence r3-preflight-failed "\$1" "\$2"; \} # \$1=stop code \$2=detail \(JSON\)/);
  assert.match(s, /grep -q true && \{ preflight_stop_evidence CONTRACT_LEDGER_STATE_INCONSISTENT [^\n]*; abort "inconsistent contract\/ledger state/);
  assert.match(s, /\|\| \{ preflight_stop_evidence SECRET_REMOTE_PRESENT_KEYCHAIN_ABSENT "\{\\"secret_name\\":\\"\$SECRET_NAME\\",\\"remote\\":\\"PRESENT\\",\\"keychain\\":\\"\$KC_STATE\\"\}"; abort "SECRET_REMOTE_PRESENT_KEYCHAIN_ABSENT/);
  assert.ok(idx(s, 'r3_failure_evidence() {') < idx(s, 'step "0. pins') && idx(s, 'stage_failed() {') < idx(s, 'read_pat'), 'the failure helpers exist before any credential is read and before the first capture');
  const helper = s.slice(idx(s, 'r3_failure_evidence() {'), idx(s, 'failure_detail() {'));
  assert.doesNotMatch(helper, /CONTRACT_SECRET|\$PAT|SECRETS_NOW|secret_names|keychain_read|\bAFTER\b|\$SET\b/, 'the failure evidence never carries a secret value or the secret inventory');
  assert.match(helper, /"read_only":%s/); assert.match(helper, /ro=true/);
  for (const k of ['"stop":"%s"', '"failed_at":"%s"', '"detail":%s', '"pins":%s', '"ledger":%s', '"ledger_raw":%s', '"migrations":%s', '"deploy":%s', '"function":%s', '"probe":%s', '"acl_after":%s', '"acl_failures":%s', '"ledger_after":%s']) assert.ok(helper.includes(k), k);
  assert.match(helper, /"\$\{KC_STATE:-unread\}" "\$\{REMOTE_SECRET:-unread\}"/, 'set -u safe: stages that never ran read as unread/null');
  for (const fn of ['preflight_failed', 'stage_failed']) {
    const body = s.slice(idx(s, `${fn}() {`), idx(s, `${fn}() {`) + 420);
    assert.match(body, /out="\$\(redact_known "\$3"\)"/, `${fn}: the captured output is redacted before stderr and before the evidence`);
    assert.match(body, /printf '%s\\n' "\$out" >&2/, `${fn}: the captured output reaches stderr`);
    assert.match(body, /failure_detail "\$2" "\$out"/, `${fn}: exit code + output persisted`);
    assert.ok(body.indexOf('>&2') < body.indexOf('r3_failure_evidence') && body.indexOf('r3_failure_evidence') < body.indexOf('abort "'), `${fn}: stderr → evidence → abort`);
  }
  // every capture that can fail is guarded ON ITS OWN LINE (a bare `X="$(…)"` under set -e dies in the assignment)
  const lines = s.split('\n');
  const captureStart = /^\s*[A-Z_]+="\$\((mgmt|mgmt_write|node|printf '%s' "\$[A-Z_]+" \| node|keychain_read|mktemp|gen_hex)\b/;
  let open = null; const unguarded = []; let guarded = 0;
  for (const l of lines) {
    if (open === null) { if (!captureStart.test(l)) continue; open = l; }
    if (/\)"( \|\| |;| *$)/.test(l) || /^\s*[A-Z_]+="\$\([^\n]*\)"/.test(l)) { const closing = l; if (/\)" \|\| (stage_failed|preflight_failed|abort)\b/.test(closing)) guarded++; else unguarded.push(open.slice(0, 60)); open = null; }
  }
  assert.deepEqual(unguarded, [], 'unguarded captures'); assert.equal(guarded, 23, `guarded captures: ${guarded}`);
  for (const stage of ['"2. migrations"', '"3. secret generation"', '"3. keychain add"', '"3. keychain read"', '"3. set-secrets"', '"3. set-secrets verify"', '"4. deploy"', '"4. deploy read-back"', '"5. signed harness"', '"6. acl probe"', '"6. acl evaluation"', '"6. acl expectations"', '"6. ledger after"']) assert.ok(s.includes(`stage_failed ${stage}`), `stage ${stage}`);
  for (const code of ['PROJECT_READ_FAILED', 'LEDGER_READ_FAILED', 'LEDGER_EVAL_FAILED', 'SECRET_NAMES_READ_FAILED', 'FUNCTION_READ_FAILED', 'ACL_READ_FAILED', 'DRYRUN_APPLY_FAILED', 'DRYRUN_DEPLOY_FAILED']) assert.ok(s.includes(`preflight_failed ${code}`), `stop code ${code}`);
  assert.doesNotMatch(s, /nothing partially applied/, 'a failed apply POST is NOT claimed to be side-effect free: the server may have committed (idle_timeout) — re-observe');
  assert.match(s, /verify with --preflight-only before any re-run/);
  assert.match(s, /\|\| VERDICT="PROBE_OUTPUT_NOT_JSON"/, 'a non-JSON probe output is a verdict, not a silent death');
  // the secret-names inventory (AFTER, SECRETS_NOW) may be handed over ONLY on its own failed capture line
  // (`"$?"`: node exited non-zero → the variable holds the {"ok":false} line, never the inventory); a secret value never
  assert.doesNotMatch(s, /(stage_failed|preflight_failed) [A-Z_"0-9. -]+ 1 "\$(AFTER|SECRETS_NOW)"/, 'the inventory is never persisted from a later check');
  assert.doesNotMatch(s, /(stage_failed|preflight_failed) [^;\n]*"\$CONTRACT_SECRET"/, 'a secret value is never captured output');
  assert.match(s, /stage_failed "3\. set-secrets verify" 1 "" "set-secrets did not take effect/);
  assert.match(s, /preflight_failed SECRET_NAMES_READ_FAILED 1 "" "secret names read failed/);
  assert.doesNotMatch(s, /CLI_MATCHED" -ge 1/, 'no loose cardinality: the verdict fixes 7 reproduced + 2 legacy exactly');
  assert.doesNotMatch(s, /rollback-core-contract\.sh"?\s*$/m, 'the rollback is never executed by the apply runner');
});

test('rollback-core-contract.sh: pins before PAT → read-only preflight → foreign rows STOP → preflight-only/dry-run → HUMAN phrase → function → SQL → secret → post-verify → evidence', () => {
  const s = SRC('rollback-core-contract.sh');
  assert.equal(spawnSync('bash', ['-n', path.join(HERE, 'rollback-core-contract.sh')], { encoding: 'utf8' }).status, 0);
  const order = ['step "0. pins', 'loadRollbackSql', 'read_pat', 'step "1. PREFLIGHT', 'were NOT written by R3', 'rollback-preflight-$STAMP.json', 'PHASE3B_R3_ROLLBACK_PREFLIGHT_ONLY_STOP', 'PHASE3B_R3_ROLLBACK_DRYRUN', 'step "HUMAN AUTHORIZATION"', 'ROLLBACK R3 $CORE_REF', 'mgmt_rollback delete-function', 'mgmt_rollback rollback-sql', 'mgmt_rollback delete-secret', 'step "5. post-verify', 'rollbackResidue', 'core-contract-rollback-$STAMP.json', 'PHASE3B_CORE_CONTRACT_ROLLED_BACK'];
  let last = -1; for (const n of order) { const i = idx(s, n); assert.ok(i > last, `out of order: ${n}`); last = i; }
  assert.match(s, /CORE_REF="hhyvmhgpapyuzjgxfnqv"/);
  const code = s.split('\n').filter((l) => !l.startsWith('#')).join('\n');
  assert.doesNotMatch(code, /mgmt_write |psql|database\/query|\bdrop (function|table|schema)/, 'the runner sends nothing but the three mgmt_rollback ops');
  assert.doesNotMatch(s, /export PAT|SUPABASE_ACCESS_TOKEN|<<<|--linked|supabase (db|link|secrets|functions)|curl /);
  assert.match(s, /Keychain entry kept/);
  assert.equal((s.match(/mgmt_rollback (delete-function|rollback-sql|delete-secret) /g) || []).length, 3, 'exactly the three ops in the real run');
  assert.match(s, /for op in delete-function rollback-sql delete-secret; do/, 'the dry-run covers the same three ops');
});

test('test-d1-positive.sh: never creates a user, STOPs without a dedicated candidate, credentials via tty only, logout scope=local, masked evidence', () => {
  const s = SRC('test-d1-positive.sh');
  assert.equal(spawnSync('bash', ['-n', path.join(HERE, 'test-d1-positive.sh')], { encoding: 'utf8' }).status, 0);
  assert.doesNotMatch(s, /admin\/users|service_key|SERVICE key/);
  assert.match(s, /D1_POSITIVE_NO_DEDICATED_QA_USER/);
  assert.match(s, /read_secret QA_PASSWORD/); assert.match(s, /read_secret CORE_ANON/);
  assert.match(s, /unset QA_PASSWORD CORE_ANON CONTRACT_SECRET/);
  assert.match(s, /is not a dedicated QA candidate — refused/);
  assert.match(s, /core-session-exists/); assert.match(s, /session_present\)" == "false"/);
  assert.match(s, /"user_id_prefix":"%s"/); assert.match(s, /"id_prefix":"%s"/);
  const evidenceLine = s.split('\n').find((l) => l.includes('"tool":"phase3b/remote/test-d1-positive.sh"'));
  assert.doesNotMatch(evidenceLine, /"email"|"password"|"token"|"anon_key"|QA_PASSWORD|CORE_ANON|CONTRACT_SECRET|QA_EMAIL/, 'the evidence template carries no credential, email or token');
  assert.match(SRC('d1-positive.mjs'), /logout\?scope=local/);
  assert.doesNotMatch(s, /export |<<<|--linked|supabase (db|link)|curl /);
});

test('runners: without a TTY they stop before reading anything (no PAT, no network, no Keychain)', () => {
  for (const [f, args] of [['deploy-core-contract.sh', ['--preflight-only']], ['rollback-core-contract.sh', ['--preflight-only']], ['test-d1-positive.sh', ['--list-only']]]) {
    const r = spawnSync('bash', [path.join(HERE, f), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
    assert.notEqual(r.status, 0, `${f}: a TTY-less run must never succeed`);
    assert.match(r.stderr, /PHASE3B_BLOCKED_NO_TTY/, f);
    assert.doesNotMatch(r.stdout + r.stderr, /r3-preflight-|EVIDENCE /);
  }
});

// ───────────────────────── summarize strictness (python) ─────────────────────────
test('summarize_r3: a dry-run, a 503/404 probe, a missing ledger row or an ACL failure is never "deployed"; the full synthetic PASS is', () => {
  const evidenceOk = {
    generated_at: 'x', core_ref: CORE, mode: 'apply', pins: { rollback_sql_sha256: C.ROLLBACK_SQL_SHA256, cli_parser_sha256: C.CLI_PARSER_SHA256 },
    migrations: rendered.map((m) => ({ version: m.version, sha256: m.migration_sha256, apply_sql_sha256: m.apply_sql_sha256, decision: 'apply', applied: true, installed_after: true, ledger_after: 'ours' })),
    ledger_rows_after: rendered.map((m) => ({ version: m.version, name: m.name, statements_count: String(m.row.statements_count), statements_digest: m.row.statements_digest, statements_bytes: String(m.row.statements_bytes), created_by_is_null: true, idempotency_key_is_null: true, rollback_is_null: true })),
    secret: { name: C.SECRET_NAME, keychain: 'PRESENT', remote: 'PRESENT', action: 'generated+stored+set' },
    deploy: { files: ['functions/_shared/supabaseApiKeys.ts', 'functions/_shared/torneosCoreContract.ts', 'functions/torneos-core-contract/index.ts'].map((p) => ({ path: p, sha256: sha(fs.readFileSync(path.join(REPO, 'supabase', p))) })) },
    function: { slug: 'torneos-core-contract', status: 'ACTIVE', version: 1, verify_jwt: false, ezbr_sha256: 'a'.repeat(64) },
    probe: { verdict: 'SIGNED_HARNESS_PASS', pass: true, checks: C.PROBE_EXPECT.map((e) => ({ name: e.name, ok: true, observed: { status: e.status, body: e.body } })) },
    acl: { failures: [], acl: aclOf({ installed: { v1: true, v11: true } }) },
  };
  const py = (core) => {
    const r = spawnSync('python3', ['-c', `import sys, json; sys.path.insert(0, ${JSON.stringify(path.join(HERE, '..'))}); import summarize_r3 as r3; c = json.loads(sys.stdin.read()); print(json.dumps([r3.r3_migrations_recorded(c), r3.r3_function_signed_harness(c), r3.r3_acl_certified(c)]))`], { input: JSON.stringify(core), encoding: 'utf8', cwd: REPO, timeout: 60000 });
    assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout);
  };
  assert.deepEqual(py(evidenceOk), [true, true, true]);
  assert.deepEqual(py({ ...evidenceOk, mode: 'dry-run' }), [false, false, false]);
  assert.deepEqual(py({ ...evidenceOk, probe: { ...evidenceOk.probe, verdict: 'SECRET_NOT_CONFIGURED', pass: false, checks: evidenceOk.probe.checks.map((c, i) => (i === 0 ? { ...c, ok: false, observed: { status: 503, body: { error: 'CORE_UNAVAILABLE' } } } : c)) } })[1], false);
  assert.deepEqual(py({ ...evidenceOk, probe: { ...evidenceOk.probe, checks: evidenceOk.probe.checks.map((c, i) => (i === 3 ? { ...c, observed: { status: 404, body: { code: 'NOT_FOUND' } } } : c)) } })[1], false);
  assert.equal(py({ ...evidenceOk, ledger_rows_after: evidenceOk.ledger_rows_after.slice(0, 1) })[0], false);
  assert.equal(py({ ...evidenceOk, ledger_rows_after: evidenceOk.ledger_rows_after.map((r) => ({ ...r, statements_digest: 'ffff' })) })[0], false);
  assert.equal(py({ ...evidenceOk, migrations: evidenceOk.migrations.map((m) => ({ ...m, ledger_after: 'absent' })) })[0], false);
  assert.equal(py({ ...evidenceOk, function: { ...evidenceOk.function, verify_jwt: true } })[1], false);
  assert.equal(py({ ...evidenceOk, function: { ...evidenceOk.function, status: 'REMOVED' } })[1], false);
  const brokenAcl = JSON.parse(JSON.stringify(evidenceOk)); brokenAcl.acl.acl.functions[0].execute.anon = true;
  assert.equal(py(brokenAcl)[2], false);
  assert.equal(py({ ...evidenceOk, core_ref: PROD })[0], false);
  // the legacy evidence shape (unsigned_probe_status 503) is never accepted
  assert.deepEqual(py({ generated_at: 'x', core_ref: CORE, mode: 'apply', unsigned_probe_status: '503', migrations: [] }), [false, false, false]);
});

// ───────────────────────── capture contract: the silent failure of 2026-09-17T17:08Z ─────────────────────────
// The runner's own helper block (node_json … preflight_stop_evidence) is executed by bash 3.2 with lib.sh sourced,
// mgmt/mgmt_write stubbed, EVIDENCE_DIR in a temp dir. No tty, no network, no Keychain.
const RUNNER_SRC = SRC('deploy-core-contract.sh');
const HELPERS = RUNNER_SRC.slice(idx(RUNNER_SRC, 'node_json() {'), idx(RUNNER_SRC, '\nstep "0. pins'));
const FAKE_PAT = 'sbp_TESTPATTESTPATTESTPATTESTPAT01';
function runHarness(body, { stamp = '20990101T000000Z', mode = 'apply' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-capture-'));
  const script = `set -euo pipefail
source ${JSON.stringify(path.join(HERE, 'lib.sh'))}
EVIDENCE_DIR=${JSON.stringify(dir)}; MODE=${JSON.stringify(mode)}; CORE_REF=${JSON.stringify(CORE)}; STAMP=${JSON.stringify(stamp)}
SECRETS_KNOWN+=(${JSON.stringify(FAKE_PAT)}); SECRETS_KNOWN+=(${JSON.stringify(SECRET)})
${HELPERS}
${body}
`;
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
  const files = fs.readdirSync(dir).filter((f) => !f.startsWith('.'));
  const evidence = Object.fromEntries(files.map((f) => [f, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))]));
  const raw = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, files, evidence, raw };
}
const STUB_FAIL = (fn, out, rc = 1) => `${fn}() { printf '%s\\n' ${JSON.stringify(out)}; return ${rc}; }`;
const ERR_APPLY = '{"ok":false,"op":"apply-core-contract","error":"apply_status_500_20260914120000_torneos_core_contract_v1.sql_boom","detail":{"phase":"apply","version":"20260914120000","status":500,"elapsed_ms":812},"elapsed_ms":2210}';

test('capture contract: the OLD pattern reproduces the silent failure — EXIT 1, empty stderr, no evidence, the error JSON lost', () => {
  const r = runHarness(`${STUB_FAIL('mgmt_write', ERR_APPLY)}
PINS='{"migrations":[]}'
MIG="$(mgmt_write apply-core-contract ",\\"ref\\":\\"$CORE_REF\\"")"
printf '%s\\n' "$MIG" >&2; abort "migrations failed (nothing partially applied: each version is one transaction)"`);
  assert.equal(r.status, 1);
  assert.equal(r.stderr, '', 'nothing reaches stderr: the shell died in the assignment');
  assert.equal(r.stdout, '');
  assert.deepEqual(r.files, [], 'no evidence file');
});

test('capture contract: the fixed pattern preserves the error JSON, the exit code and writes r3-failed-* from step 2', () => {
  const r = runHarness(`${STUB_FAIL('mgmt_write', ERR_APPLY)}
PINS='{"migrations":[{"version":"20260914120000"}]}'; PROJ='{"ok":true,"project":{"id":"${CORE}","name":"arma2-torneos-staging"}}'; KC_STATE=ABSENT; REMOTE_SECRET=absent
LEDGER_EVAL='{"versions":[{"version":"20260914120000","decision":"apply"}]}'; LEDGER='{"ok":true,"shape":{"x":1},"rows":[],"installed":{"20260914120000":{"installed":false}},"all_versions":[]}'
MIG="$(mgmt_write apply-core-contract ",\\"ref\\":\\"$CORE_REF\\"")" || stage_failed "2. migrations" "$?" "$MIG" "migrations failed"
printf 'NOT_REACHED\\n'`);
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stdout, /NOT_REACHED/);
  assert.ok(r.stderr.includes(ERR_APPLY), 'the error JSON reaches stderr verbatim');
  assert.match(r.stderr, /!! ABORT: migrations failed \(stage: 2\. migrations, exit 1; evidence r3-failed-20990101T000000Z\.json\)/);
  assert.deepEqual(r.files, ['r3-failed-20990101T000000Z.json']);
  assert.match(r.stdout, /EVIDENCE .*r3-failed-20990101T000000Z\.json\n[0-9a-f]{64}  /);
  const e = r.evidence['r3-failed-20990101T000000Z.json'];
  assert.equal(e.mode, 'apply'); assert.equal(e.read_only, false); assert.equal(e.core_ref, CORE);
  assert.equal(e.stop, '2. migrations'); assert.equal(e.failed_at, '2. migrations');
  assert.deepEqual(e.detail, { exit_code: 1, output: JSON.parse(ERR_APPLY) });
  assert.equal(e.detail.output.detail.phase, 'apply'); assert.equal(e.detail.output.detail.elapsed_ms, 812);
  assert.deepEqual(e.project, { id: CORE, name: 'arma2-torneos-staging' });
  assert.deepEqual(e.pins, { migrations: [{ version: '20260914120000' }] });
  assert.equal(e.keychain, 'ABSENT'); assert.equal(e.remote_secret, 'absent'); assert.equal(e.secret_action, null);
  assert.deepEqual(e.ledger, { versions: [{ version: '20260914120000', decision: 'apply' }] });
  assert.deepEqual(e.ledger_raw, { shape: { x: 1 }, rows: [], installed: { '20260914120000': { installed: false } }, all_versions: [] });
  // stages that never ran are null, not missing and not a set -u crash
  for (const k of ['migrations', 'deploy', 'function', 'probe', 'acl_after', 'acl_failures', 'ledger_after', 'function_before', 'acl_before']) { assert.ok(k in e, k); assert.equal(e[k], null, k); }
  assert.doesNotMatch(r.raw['r3-failed-20990101T000000Z.json'], /sbp_|secret_names/);
});

test('capture contract: a stage that exits 0 with {"ok":false} is caught by the second line, exit code 1 recorded', () => {
  const r = runHarness(`${STUB_FAIL('mgmt', '{"ok":false,"error":"project_status_503"}', 0)}
PINS='{}'
PROJ="$(mgmt project ",\\"ref\\":\\"$CORE_REF\\"")" || preflight_failed PROJECT_READ_FAILED "$?" "$PROJ" "project read failed"
printf '%s' "$PROJ" | json_field ok | grep -q true || preflight_failed PROJECT_READ_FAILED 1 "$PROJ" "project read failed"
printf 'NOT_REACHED\\n'`, { mode: '--preflight-only' });
  assert.equal(r.status, 1); assert.doesNotMatch(r.stdout, /NOT_REACHED/);
  assert.match(r.stderr, /project_status_503/); assert.match(r.stderr, /!! ABORT: project read failed \(exit 1; evidence r3-preflight-failed-20990101T000000Z\.json\)/);
  const e = r.evidence['r3-preflight-failed-20990101T000000Z.json'];
  assert.equal(e.read_only, true); assert.equal(e.mode, '--preflight-only'); assert.equal(e.stop, 'PROJECT_READ_FAILED');
  assert.deepEqual(e.detail, { exit_code: 1, output: { ok: false, error: 'project_status_503' } });
  assert.equal(e.project, null, 'an error line has no .project → null, never a broken template');
  assert.equal(e.keychain, 'unread'); assert.equal(e.remote_secret, 'unread'); assert.equal(e.ledger, null); assert.equal(e.ledger_raw, null);
  assert.doesNotMatch(r.raw['r3-preflight-failed-20990101T000000Z.json'], /secret_names|sbp_/);
});

test('capture contract: a failure at the ACL stage (step 6) carries every earlier stage — migrations, deploy, function, probe, secret action', () => {
  const MIGS = '{"ok":true,"op":"apply-core-contract","migrations":[{"version":"20260914120000","decision":"apply","applied":true,"installed_after":true,"ledger_after":"ours","apply_status":201,"apply_elapsed_ms":1543},{"version":"20260915120000","decision":"apply","applied":true,"installed_after":true,"ledger_after":"ours","apply_status":201,"apply_elapsed_ms":402}]}';
  const ERR_ACL = '{"ok":false,"op":"core-contract-acl","error":"request_failed_idle_timeout","detail":{"method":"POST","path":"/v1/projects/' + CORE + '/database/query","code":null,"elapsed_ms":20004,"idle_timeout_ms":20000},"elapsed_ms":20010}';
  const r = runHarness(`${STUB_FAIL('mgmt', ERR_ACL)}
PINS='{"p":1}'; PROJ='{"ok":true,"project":{"id":"${CORE}"}}'; KC_STATE=PRESENT; REMOTE_SECRET=PRESENT; SECRET_ACTION="generated+stored+set"
MIG='${MIGS}'; DEP='{"ok":true,"op":"deploy-function","deployed":"torneos-core-contract","files":[{"path":"a.ts","sha256":"aa"}]}'
FN_NOW='{"ok":true,"present":false,"fn":null}'; FN_AFTER='{"ok":true,"present":true,"fn":{"slug":"torneos-core-contract","status":"ACTIVE","verify_jwt":false,"ezbr_sha256":"ee"}}'
PROBE_OUT='{"ok":true,"verdict":"SIGNED_HARNESS_PASS","checks":[{"name":"unsigned","ok":true}]}'; ACL_BEFORE='{"ok":true,"acl":{"functions":[]}}'
ACL_AFTER="$(mgmt core-contract-acl ",\\"ref\\":\\"$CORE_REF\\"")" || stage_failed "6. acl probe" "$?" "$ACL_AFTER" "acl read failed"
printf 'NOT_REACHED\\n'`);
  assert.equal(r.status, 1); assert.doesNotMatch(r.stdout, /NOT_REACHED/);
  assert.ok(r.stderr.includes(ERR_ACL)); assert.match(r.stderr, /!! ABORT: acl read failed \(stage: 6\. acl probe, exit 1; evidence r3-failed-20990101T000000Z\.json\)/);
  const e = r.evidence['r3-failed-20990101T000000Z.json'];
  assert.equal(e.failed_at, '6. acl probe');
  assert.equal(e.detail.output.detail.idle_timeout_ms, 20000); assert.equal(e.detail.output.detail.elapsed_ms, 20004);
  assert.deepEqual(e.migrations, JSON.parse(MIGS).migrations);
  assert.equal(e.migrations[0].apply_elapsed_ms, 1543);
  assert.equal(e.deploy.deployed, 'torneos-core-contract'); assert.deepEqual(e.function, { slug: 'torneos-core-contract', status: 'ACTIVE', verify_jwt: false, ezbr_sha256: 'ee' });
  assert.equal(e.probe.verdict, 'SIGNED_HARNESS_PASS'); assert.equal(e.secret_action, 'generated+stored+set');
  assert.equal(e.keychain, 'PRESENT'); assert.equal(e.remote_secret, 'PRESENT');
  assert.deepEqual(e.function_before, { ok: true, present: false, fn: null }); assert.deepEqual(e.acl_before, { functions: [] });
  assert.equal(e.acl_after, null); assert.equal(e.acl_failures, null); assert.equal(e.ledger_after, null);
});

test('capture contract: ACL expectations not met and a non-JSON captured output are persisted as text; ledger_after read', () => {
  const r = runHarness(`ACL_FAILS='["public.torneos_contract_execute(text,text,jsonb): execute anon=true expected false"]'
ACL_AFTER='{"ok":true,"acl":{"functions":[{"signature":"f","execute":{"anon":true}}]}}'; MIG='{"ok":true,"migrations":[]}'; PINS='{}'
LEDGER_AFTER='not json at all
second line'
[[ "$ACL_FAILS" == "[]" ]] || { printf '  %s\\n' "$ACL_FAILS"; stage_failed "6. acl expectations" 1 "$ACL_FAILS" "ACL expectations not met — NOT deployed"; }
printf 'NOT_REACHED\\n'`);
  assert.equal(r.status, 1);
  const e = r.evidence['r3-failed-20990101T000000Z.json'];
  assert.equal(e.failed_at, '6. acl expectations');
  assert.deepEqual(e.acl_failures, ['public.torneos_contract_execute(text,text,jsonb): execute anon=true expected false']);
  assert.deepEqual(e.detail.output, ['public.torneos_contract_execute(text,text,jsonb): execute anon=true expected false']);
  assert.deepEqual(e.acl_after, { functions: [{ signature: 'f', execute: { anon: true } }] });
  assert.equal(e.ledger_after, 'not json at all\nsecond line', 'a non-JSON value is kept as a string, never dropped');
  assert.deepEqual(e.migrations, []);
});

test('capture contract: a known secret in the captured output is redacted on stderr and in the evidence (pure bash, before promote_evidence)', () => {
  const leak = `{"ok":false,"error":"set_secrets_status_400_echo ${SECRET} token ${FAKE_PAT}"}`;
  const r = runHarness(`${STUB_FAIL('mgmt_write', leak)}
PINS='{}'; MIG='{"ok":true,"migrations":[]}'; SECRET_ACTION="generated+stored+set"
SET="$(mgmt_write set-secrets)" || stage_failed "3. set-secrets" "$?" "$SET" "set-secrets failed"
printf 'NOT_REACHED\\n'`);
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stderr, new RegExp(SECRET)); assert.doesNotMatch(r.stderr, /sbp_TESTPAT/);
  assert.match(r.stderr, /set_secrets_status_400_echo «REDACTED» token «REDACTED»/);
  assert.match(r.stderr, /!! ABORT: set-secrets failed \(stage: 3\. set-secrets, exit 1/);
  assert.deepEqual(r.files, ['r3-failed-20990101T000000Z.json'], 'the redacted evidence passes promote_evidence');
  const raw = r.raw['r3-failed-20990101T000000Z.json'];
  assert.doesNotMatch(raw, new RegExp(SECRET)); assert.doesNotMatch(raw, /sbp_TESTPAT/); assert.match(raw, /«REDACTED» token «REDACTED»/);
  assert.equal(r.evidence['r3-failed-20990101T000000Z.json'].detail.output.error, 'set_secrets_status_400_echo «REDACTED» token «REDACTED»');
});

test('capture contract: when the evidence cannot be promoted (same-second stamp) the error still reached stderr first', () => {
  const r = runHarness(`${STUB_FAIL('mgmt_write', ERR_APPLY)}
PINS='{}'
printf '{}' > "$EVIDENCE_DIR/r3-failed-$STAMP.json"
MIG="$(mgmt_write apply-core-contract)" || stage_failed "2. migrations" "$?" "$MIG" "migrations failed"
printf 'NOT_REACHED\\n'`);
  assert.equal(r.status, 1); assert.doesNotMatch(r.stdout, /NOT_REACHED/);
  assert.ok(r.stderr.includes(ERR_APPLY)); assert.match(r.stderr, /EVIDENCE_EXISTS/);
});

test('capture contract: jv — unset → null, JSON → value, field path, non-JSON → string; under set -u', () => {
  const r = runHarness(`unset MAYBE || true
A='{"x":{"y":[1,2]},"z":"s"}'; B='plain text'; C=''
printf '%s|%s|%s|%s|%s|%s|%s\\n' "$(jv MAYBE)" "$(jv A)" "$(jv A x.y)" "$(jv A z)" "$(jv A nope)" "$(jv B)" "$(jv C)"`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'null|{"x":{"y":[1,2]},"z":"s"}|[1,2]|"s"|null|"plain text"|null\n');
});

test('lib.sh: redact_known replaces every known secret (≥ 8 chars) without any process seeing it in argv', () => {
  const r = spawnSync('bash', ['-c', `set -euo pipefail; source ${JSON.stringify(path.join(HERE, 'lib.sh'))}; SECRETS_KNOWN=(${JSON.stringify(FAKE_PAT)} "ab" ${JSON.stringify(SECRET)}); redact_known "a ${FAKE_PAT} b ${SECRET} c ab d"`], { encoding: 'utf8' });
  assert.equal(r.status, 0); assert.equal(r.stdout, 'a «REDACTED» b «REDACTED» c ab d');
  assert.match(SRC('lib.sh'), /out="\$\{out\/\/"\$s"\/«REDACTED»\}"/, 'pure bash substitution');
});

// ───────────────────────── mgmt-write: failure detail (phase, version, status, elapsed_ms) ─────────────────────────
test('mgmt-write: a failed apply POST carries phase/version/status/elapsed_ms and says the server state must be re-observed', async () => {
  const f = fakeCore(fresh({ failWrite: true }));
  const t = async (req) => { const res = await f.transport(req); return req.body?.read_only ? res : { ...res, elapsed_ms: 777 }; };
  let caught; try { await runWrite({ op: 'apply-core-contract', pat: PAT, ref: CORE, repo: REPO }, t); } catch (e) { caught = e; }
  assert.ok(caught instanceof AbortError); assert.match(caught.message, /apply_status_400/);
  assert.deepEqual(caught.detail, { phase: 'apply', version: '20260914120000', query_bytes: V1.apply_sql_bytes, server_state_after_failure: 'UNKNOWN_reobserve_with_preflight_only', status: 400, elapsed_ms: 777 });
  assert.equal(f.state.writes.length, 1);
  // a transport failure (idle_timeout / reset) on the write: the transport's own detail is kept and tagged with the phase
  const g = fakeCore(fresh());
  const cut = async (req) => { if (req.method === 'POST' && !req.body?.read_only) { const e = new AbortError('request_failed_idle_timeout'); e.detail = { method: 'POST', path: req.reqPath, code: null, elapsed_ms: 20003, idle_timeout_ms: 20000, body_bytes: 33960 }; throw e; } return g.transport(req); };
  let cutErr; try { await runWrite({ op: 'apply-core-contract', pat: PAT, ref: CORE, repo: REPO }, cut); } catch (e) { cutErr = e; }
  assert.match(cutErr.message, /request_failed_idle_timeout/);
  assert.deepEqual(cutErr.detail, { phase: 'apply', version: '20260914120000', query_bytes: V1.apply_sql_bytes, server_state_after_failure: 'UNKNOWN_reobserve_with_preflight_only', method: 'POST', path: `/v1/projects/${CORE}/database/query`, code: null, elapsed_ms: 20003, idle_timeout_ms: 20000, body_bytes: 33960 });
  assert.equal(g.state.writes.length, 0, 'the fake never received the document: nothing was simulated as applied');
  // post-apply checks name their phase and keep the apply status/elapsed
  const h = fakeCore(fresh());
  const ghost = async (req) => { const res = await h.transport(req); if (req.method === 'POST' && !req.body?.read_only) { h.state.installed.v1 = false; return { ...res, elapsed_ms: 1500 }; } return res; };
  let ghostErr; try { await runWrite({ op: 'apply-core-contract', pat: PAT, ref: CORE, repo: REPO }, ghost); } catch (e) { ghostErr = e; }
  assert.match(ghostErr.message, /apply_not_effective_20260914120000/);
  assert.deepEqual(ghostErr.detail, { phase: 'post-apply', version: '20260914120000', apply_status: 201, apply_elapsed_ms: 1500, installed_after: false, ledger_after: 'ours' });
  // probes name their phase too; STOP decisions carry the observed pair
  const p = fakeCore(fresh()); const probeFail = async (req) => (req.body?.query === C.MIGRATIONS[0].probe ? { status: 500, body: null, raw: 'db down', elapsed_ms: 12 } : p.transport(req));
  let probeErr; try { await runWrite({ op: 'apply-core-contract', pat: PAT, ref: CORE, repo: REPO }, probeFail); } catch (e) { probeErr = e; }
  assert.match(probeErr.message, /probe_status_500_db down/); assert.deepEqual(probeErr.detail, { phase: 'probe-before', version: '20260914120000', status: 500, elapsed_ms: 12 });
  let stopErr; try { await runWrite({ op: 'apply-core-contract', pat: PAT, ref: CORE, repo: REPO }, fakeCore(fresh({ installed: { v1: true, v11: false }, ledger: { '20260914120000': 'foreign' } })).transport); } catch (e) { stopErr = e; }
  assert.deepEqual(stopErr.detail, { phase: 'decision', version: '20260914120000', installed_before: true, ledger_before: 'foreign' });
  // the success entries record the apply status and the measured time of the write
  const ok = fakeCore(fresh()); const timed = async (req) => { const res = await ok.transport(req); return req.body?.read_only ? res : { ...res, elapsed_ms: 1234 }; };
  const out = await runWrite({ op: 'apply-core-contract', pat: PAT, ref: CORE, repo: REPO }, timed);
  assert.deepEqual(out.migrations.map((m) => [m.applied, m.apply_status, m.apply_elapsed_ms]), [[true, 201, 1234], [true, 201, 1234]]);
  const dry = await runWrite({ op: 'apply-core-contract', pat: PAT, ref: CORE, repo: REPO, dryRun: true }, fakeCore(fresh()).transport);
  assert.ok(dry.migrations.every((m) => m.dry_run === true && !('apply_status' in m)));
});

test('mgmt-write / mgmt CLI: the failure line is one JSON with op, error, detail and elapsed_ms; exit 1; no network needed', () => {
  const w = spawnSync(process.execPath, [path.join(HERE, 'mgmt-write.mjs')], { input: JSON.stringify({ op: 'apply-core-contract', pat: PAT, ref: 'abcdefghijabcdefghij', repo: REPO }), encoding: 'utf8', timeout: 20000 });
  assert.equal(w.status, 1);
  const lines = w.stdout.trim().split('\n'); assert.equal(lines.length, 1, 'exactly one line');
  const j = JSON.parse(lines[0]);
  assert.equal(j.ok, false); assert.equal(j.op, 'apply-core-contract'); assert.match(j.error, /target_not_core_staging/); assert.equal(j.detail, null); assert.equal(typeof j.elapsed_ms, 'number');
  assert.doesNotMatch(w.stdout, /sbp_0123/);
  const r = spawnSync(process.execPath, [path.join(HERE, 'mgmt.mjs')], { input: JSON.stringify({ op: 'core-ledger', pat: PAT, ref: PROD }), encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 1);
  const k = JSON.parse(r.stdout.trim()); assert.equal(k.ok, false); assert.equal(k.op, 'core-ledger'); assert.match(k.error, /ref_is_production/); assert.equal(k.detail, null); assert.equal(typeof k.elapsed_ms, 'number');
  for (const f of ['mgmt.mjs', 'mgmt-write.mjs']) {
    const src = SRC(f);
    assert.match(src, /e\.detail = \{ method, path(: reqPath)?, code: err\.code \?\? null, elapsed_ms: Date\.now\(\) - started, idle_timeout_ms: CONNECT_TIMEOUT_MS/, `${f}: transport failures carry where/when`);
    assert.match(src, /clearTimeout\(deadline\)/, `${f}: the deadline never races a written line`);
    assert.doesNotMatch(src.slice(src.indexOf('e.detail = {'), src.indexOf('e.detail = {') + 200), /\bpat\b|Authorization|\bbody\b(?!_bytes)/, `${f}: the detail never carries the token or the body`);
  }
  assert.equal(SRC('mgmt-write.mjs').match(/const CONNECT_TIMEOUT_MS = (\d+);/)[1], '20000', 'idle timeout unchanged (no evidence yet to change it)');
  assert.equal(SRC('mgmt-write.mjs').match(/const DEADLINE_MS = (\d+);/)[1], '180000');
});
