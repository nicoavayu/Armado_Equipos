// CONTENT MODERATION 0022 operator driver, offline: the exact files and bodies it pins, the states it recognizes, the gates on
// every write ("nothing outside 0022 moved", phrase, file hash, state), the platform inbox and `act`. The real transitions
// ran on the disposable lab through run() as the installer: moderation-0022.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  ACL, ACTIONS, BODIES, FILES, PLATFORM_REMOVE_MD5, REF, TABLES, TRIGGERS, changedOutside, classify, inboxSql, parseAct, phraseFor, run,
} from './remote/db-0022.mjs';

const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const KEPT = {
  counts: { authenticated: 207, anon: 16, service_role: 352 },
  kept_fn: { count: 600, digest: 'f' }, kept_relations: { count: 120, digest: 'r' }, kept_triggers: { count: 60, digest: 't' },
  kept_policies: { count: 40, digest: 'p' },
};
const catalogAt = (state, extra = {}) => ({
  torneos_tables: true,
  prerequisites: { connected: true, season_lifecycle: true, platform_remove: PLATFORM_REMOVE_MD5 },
  ...KEPT,
  counts: state === 'POST_0022' ? { ...KEPT.counts, authenticated: KEPT.counts.authenticated + 7 } : KEPT.counts,
  bodies: { ...BODIES[state] },
  acl: { ...ACL[state] },
  tables: { ...TABLES[state] },
  triggers: { ...TRIGGERS[state] },
  rows: state === 'POST_0022' ? 0 : null,
  ...extra,
});
const REPORT = '3f2a9c1e-1111-4222-8333-444455556666';

test('db 0022 pins the exact files of this branch, the target ref and the bodies the migration installs', () => {
  assert.equal(REF, 'onzpwnqxnvlgsevivngf');
  for (const f of Object.values(FILES)) assert.equal(sha256(f.path), f.sha256, f.rel);
  const migration = fs.readFileSync(FILES['apply-0022'].path, 'utf8');
  assert.ok(migration.includes(PLATFORM_REMOVE_MD5), 'the migration pins the same lever body');
  assert.ok(Object.values(BODIES.POST_0022).every((md5) => /^[0-9a-f]{32}$/.test(md5)));
  assert.equal(new Set(Object.values(BODIES.POST_0022)).size, 14);
  assert.equal(phraseFor('apply-0022'), `APPLY TORNEOS 0022 ${REF} ${FILES['apply-0022'].sha256.slice(0, 12)}`);
  assert.equal(phraseFor('rollback-0022', { force: true }), `ROLLBACK TORNEOS 0022 ${REF} ${FILES['rollback-0022'].sha256.slice(0, 12)} DISCARD MODERATION ROWS`);
  assert.equal(phraseFor('act', { reportId: REPORT }), `ACT TORNEOS 0022 ${REF} 3f2a9c1e`);
  assert.throws(() => phraseFor('apply-0022', { force: true }), /FORCE_ONLY_FOR_ROLLBACK/);
  // The rollback names every object the migration creates, and nothing it does not.
  const rollback = fs.readFileSync(FILES['rollback-0022'].path, 'utf8');
  for (const name of [...migration.matchAll(/^create (?:table|function|trigger) ([a-z_.]+)/gm)].map((m) => m[1].split('.').pop())) {
    assert.ok(rollback.includes(name), `rollback drops ${name}`);
  }
  assert.ok(!/create or replace/i.test(migration), '0022 replaces no existing function');
});

test('db 0022 classify: PRE_0022, POST_0022, and every drift fails closed', () => {
  for (const state of ['PRE_0022', 'POST_0022']) assert.deepEqual(classify(catalogAt(state)), { state, failures: [] });
  assert.equal(classify({ torneos_tables: false }).state, 'DRIFT');
  assert.equal(classify(catalogAt('POST_0022', { rows: 12 })).state, 'POST_0022', 'moderation rows are data');
  const drift = [
    catalogAt('PRE_0022', { prerequisites: { connected: false, season_lifecycle: true, platform_remove: PLATFORM_REMOVE_MD5 } }),
    catalogAt('PRE_0022', { prerequisites: { connected: true, season_lifecycle: true, platform_remove: 'x' } }),
    catalogAt('POST_0022', { bodies: { ...BODIES.POST_0022, engine: 'f'.repeat(32) } }),
    catalogAt('POST_0022', { acl: { ...ACL.POST_0022, platform_handle: { ...ACL.POST_0022.platform_handle, service_role: true } } }),
    catalogAt('POST_0022', { acl: { ...ACL.POST_0022, report: { ...ACL.POST_0022.report, anon: true } } }),
    catalogAt('POST_0022', { tables: { ...TABLES.POST_0022, 'public.tournament_content_reports': { rls: true, api_grants: true, policies: 0 } } }),
    catalogAt('POST_0022', { triggers: { ...TRIGGERS.POST_0022, tournament_public_pages_moderation_hold: 'D' } }),
    catalogAt('POST_0022', { rows: null }),
    catalogAt('PRE_0022', { rows: 3 }),
  ];
  for (const catalog of drift) assert.equal(classify(catalog).state, 'DRIFT', JSON.stringify(classify(catalog)));
});

test('db 0022 changedOutside: exactly ±7 authenticated, anon and service_role fixed, kept sections identical', () => {
  assert.deepEqual(changedOutside(catalogAt('PRE_0022'), catalogAt('POST_0022'), 'apply'), []);
  assert.deepEqual(changedOutside(catalogAt('POST_0022'), catalogAt('PRE_0022'), 'rollback'), []);
  assert.deepEqual(changedOutside(catalogAt('PRE_0022'), catalogAt('POST_0022', { counts: { ...KEPT.counts, authenticated: 215 } }), 'apply'), ['counts']);
  assert.deepEqual(changedOutside(catalogAt('PRE_0022'), catalogAt('POST_0022', { counts: { authenticated: 214, anon: 17, service_role: 352 } }), 'apply'), ['counts']);
  assert.deepEqual(changedOutside(catalogAt('PRE_0022'), catalogAt('POST_0022', { kept_fn: { count: 600, digest: 'g' }, kept_triggers: { count: 61, digest: 't' } }), 'apply'),
    ['kept_fn', 'kept_triggers']);
});

function fakeDb(states, { code = 0, stdout = '' } = {}) {
  let i = 0; const applied = []; const reads = []; const writes = [];
  return {
    applied, reads, writes,
    deps: {
      readFile: (p) => fs.readFileSync(p),
      catalog: async () => states[Math.min(i, states.length - 1)],
      applySql: async (sql) => { applied.push(sql); i += 1; return { code }; },
      readOnlySql: async (sql) => { reads.push(sql); return { code, stdout }; },
      writeSql: async (sql) => { writes.push(sql); return { code, stdout }; },
    },
  };
}

test('db 0022 run: phrase, file hash and observed state gate every schema write; rows need the force phrase', async () => {
  const ok = fakeDb([catalogAt('PRE_0022'), catalogAt('POST_0022')]);
  const out = await run('apply-0022', phraseFor('apply-0022').split(' '), ok.deps);
  assert.equal(out.verdict, 'APPLY_0022_DONE');
  assert.equal(ok.applied.length, 1);
  await assert.rejects(run('apply-0022', ['APPLY', 'TORNEOS', '0022'], ok.deps), /PHRASE_REQUIRED/);
  await assert.rejects(run('apply-0022', phraseFor('apply-0022').split(' '), { ...fakeDb([catalogAt('POST_0022')]).deps }), /PRE_STATE_POST_0022/);
  await assert.rejects(run('apply-0022', phraseFor('apply-0022').split(' '), { ...ok.deps, readFile: () => Buffer.from('tampered') }), /FILE_HASH_MISMATCH/);
  const moved = fakeDb([catalogAt('PRE_0022'), catalogAt('POST_0022', { kept_policies: { count: 41, digest: 'q' } })]);
  assert.equal((await run('apply-0022', phraseFor('apply-0022').split(' '), moved.deps)).verdict, 'APPLY_0022_FAILED');
  const withRows = fakeDb([catalogAt('POST_0022', { rows: 5 }), catalogAt('PRE_0022')]);
  await assert.rejects(run('rollback-0022', phraseFor('rollback-0022').split(' '), withRows.deps), /ROLLBACK_REFUSED 5 moderation rows/);
  assert.equal(withRows.applied.length, 0, 'nothing written');
  const forced = await run('rollback-0022', phraseFor('rollback-0022', { force: true }).split(' '), withRows.deps);
  assert.equal(forced.verdict, 'ROLLBACK_0022_DONE');
  assert.ok(withRows.applied[0].startsWith("SET torneos.moderation_rollback_force = 'DISCARD MODERATION ROWS';"));
});

test('db 0022 inbox: read only, POST_0022 only, a fixed status set', async () => {
  const db = fakeDb([catalogAt('POST_0022')], { stdout: `${JSON.stringify([{ id: REPORT, ageHours: 30 }, { id: 'b', ageHours: 2 }])}\n` });
  const out = await run('inbox', [], db.deps);
  assert.equal(out.verdict, 'INBOX_READ');
  assert.equal(out.pending, 2);
  assert.equal(out.oldestHours, 30);
  assert.equal(db.reads[0], "select public.platform_list_tournament_content_reports('pending', 200)::text;");
  assert.equal(db.writes.length + db.applied.length, 0);
  assert.throws(() => inboxSql("open'; drop table x; --"), /STATUS_INVALID/);
  await assert.rejects(run('inbox', [], fakeDb([catalogAt('PRE_0022')]).deps), /STATE_PRE_0022/);
});

test('db 0022 act: validated report id, status, action and note; exact phrase; one quoted call', async () => {
  const phrase = phraseFor('act', { reportId: REPORT }).split(' ');
  const decision = parseAct([REPORT, 'resolved', 'take_down_tournament', 'Logo', "con 'comillas'", ...phrase]);
  assert.equal(decision.note, "Logo con 'comillas'");
  assert.equal(decision.sql, `select public.platform_handle_tournament_content_report('${REPORT}'::uuid, 'resolved', 'take_down_tournament', 'Logo con ''comillas''')::text;`);
  assert.equal(parseAct([REPORT, 'under_review', 'none', ...phrase]).sql.includes(', null, null)'), true);
  assert.throws(() => parseAct(['no-uuid', 'resolved', 'none', 'x', ...phrase]), /REPORT_ID_REQUIRED/);
  assert.throws(() => parseAct([REPORT, 'escalated', 'none', 'x', ...phrase]), /STATUS_INVALID/);
  assert.throws(() => parseAct([REPORT, 'resolved', 'drop_everything', 'nota', ...phrase]), /ACTION_INVALID/);
  assert.throws(() => parseAct([REPORT, 'resolved', 'none', ...phrase]), /NOTE_REQUIRED/);
  assert.throws(() => parseAct([REPORT, 'resolved', 'none', 'nota', 'ACT', 'TORNEOS', '0022', REF, 'ffffffff']), /PHRASE_REQUIRED/);
  assert.ok(ACTIONS.every((action) => /^[a-z_]+$/.test(action)));
  const db = fakeDb([catalogAt('POST_0022')], { stdout: `${JSON.stringify({ reportId: REPORT, status: 'resolved' })}\n` });
  const out = await run('act', [REPORT, 'resolved', 'none', 'Revisado', ...phrase], db.deps);
  assert.equal(out.verdict, 'ACT_DONE');
  assert.match(db.writes[0], /^\\set ON_ERROR_STOP 1\nBEGIN;\nselect public\.platform_handle_tournament_content_report/);
  assert.equal(db.applied.length, 0);
  const failed = fakeDb([catalogAt('POST_0022')], { code: 3 });
  await assert.rejects(run('act', [REPORT, 'resolved', 'none', 'Revisado', ...phrase], failed.deps), /ACT_FAILED 3/);
});
